// main.js (fixed)
// Replaces your previous main.js. Assumes firebase-config.js exists.
// Important: this client-side code expects secure rules where:
// - users/{uid} and balances/{uid} can be written only by that uid
// - bets can be written by admin
// - betResults/{betId}/{uid} can be written by that uid

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getDatabase, ref, set, get, push, onValue, update, runTransaction
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {

  // DOM
  const joinBtn = document.getElementById('joinBtn');
  const playerNameInput = document.getElementById('playerName');
  const joinScreen = document.getElementById('join-screen');
  const mainScreen = document.getElementById('main');
  const welcomeEl = document.getElementById('welcome');
  const adminPanel = document.getElementById('admin-panel');
  const betListEl = document.getElementById('bet-list');
  const betNameInput = document.getElementById('betName');
  const betOptionsInput = document.getElementById('betOptions');
  const leaveBtn = document.getElementById('leaveBtn');
  const createBetBtn = document.getElementById('createBetBtn');
  


  let displayName = '';
  let currentUser = null;
  let isAdminLocal = false; // determined after user record is written

  // Defensive: ensure elements exist
  if (!joinBtn || !playerNameInput || !joinScreen || !mainScreen || !welcomeEl || !betListEl) {
    console.error('Missing required DOM elements. Check IDs in HTML.');
    return;
  }

  // Initially hide things and disable admin controls until ready
  if (adminPanel) adminPanel.style.display = 'none';
  if (createBetBtn) createBetBtn.disabled = true;

  // --- Join-click ---
  joinBtn.addEventListener('click', async () => {
    displayName = playerNameInput.value.trim();
    if (!displayName) return alert('Enter a name');

    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.error('Auth error:', e);
      alert('Login failed: ' + e.message);
    }
  });

  

  // --- Auth state ---
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      

      // Write user info (so rules that check /users/{uid}/name will see it)
      try {
        // Use update() so we don't overwrite server-controlled fields
        // (for example `isAdmin`) that may already exist on the user record.
        await update(ref(db, `users/${user.uid}`), { uid: user.uid, name: displayName || 'Anonymous', joinedAt: Date.now() });
      } catch (e) {
        console.error('Failed to write user record:', e);
        alert('Failed to set up user in database. Check rules.');
        return;
      }

      // Wait and re-read user entry to be sure rules see it
      const userSnap = await get(ref(db, `users/${user.uid}`));
      if (!userSnap.exists()) {
        console.error('User record missing after set!');
        alert('User record did not appear in database. Check your rules.');
        return;
      }

      // Determine admin status from the stored name or explicit DB flag (prefer the flag)
      const storedName = (userSnap.val().name || '').toString();
      // Prefer a server-controlled flag `isAdmin` in the user record.
      // Fallback to name === 'admin' only for local/testing convenience.
      isAdminLocal = Boolean(userSnap.val().isAdmin) || storedName.toLowerCase() === 'admin';
      
      // Expose admin status in UI for easier debugging
      if (adminPanel) adminPanel.dataset.isAdmin = isAdminLocal ? 'true' : 'false';

      // Ensure balance exists
      try {
        const balRef = ref(db, `balances/${user.uid}`);
        const balSnap = await get(balRef);
        if (!balSnap.exists()) {
          await set(balRef, 1000);
        }
      } catch (e) {
        console.error('Failed to initialize balance:', e);
      }

      // Update UI
      joinScreen.style.display = 'none';
      mainScreen.style.display = 'block';
      // show a temporary balance until listener updates it
      welcomeEl.textContent = `${storedName} (Balance: ...)`;

      // Show admin panel if admin (and enable create button)
      if (isAdminLocal && adminPanel && createBetBtn) {
          adminPanel.style.display = 'block';
          createBetBtn.disabled = false;
      }

      // Attach leave/sign-out handler
      if (leaveBtn) {
        leaveBtn.addEventListener('click', async () => {
          try {
            await signOut(auth);
            displayName = '';
          } catch (e) {
            console.error('Sign-out failed', e);
            alert('Failed to sign out: ' + (e.message || e));
          }
        });
      }


      // Start listeners AFTER user is set up
      listenBets();
      listenBalanceAndApplyPendingPayouts();

    } else {
      // signed out
      currentUser = null;
      isAdminLocal = false;
      joinScreen.style.display = 'block';
      mainScreen.style.display = 'none';
      if (adminPanel) adminPanel.style.display = 'none';
      if (createBetBtn) createBetBtn.disabled = true;
    }
  });

  // --- Admin: create bet ---
  if (createBetBtn) {
    createBetBtn.addEventListener('click', async () => {
      if (!isAdminLocal) return alert('Only admin can create bets. (Not admin)');
      const question = (betNameInput?.value || '').trim();
      const options = (betOptionsInput?.value || '').split(',').map(o => o.trim()).filter(Boolean);
      if (!question || options.length < 2) return alert('Enter a question and at least 2 options');

      try {
        const betRef = push(ref(db, 'bets'));
        await set(betRef, {
          question,
          options,
          status: 'open',
          winningOption: null,
          createdAt: Date.now()
        });
        betNameInput.value = '';
        betOptionsInput.value = '';
        
      } catch (e) {
        console.error('Create bet failed:', e);
        alert('Failed to create bet. Check console and rules.');
      }
    });
  }

  // --- Listen to bets (real-time, everyone) ---
  let betsListenerAttached = false;
  function listenBets() {
    if (betsListenerAttached) return;
    betsListenerAttached = true;
    const betsRef = ref(db, 'bets');
    onValue(betsRef, (snapshot) => {
      const bets = snapshot.val() || {};
      renderBets(bets);
      // For any settled bets, ask client to process payout for this user
      for (const [betId, bet] of Object.entries(bets)) {
        if (bet && bet.status === 'settled' && bet.winningOption != null) {
          // let each client handle its own payout safely
          processSettlementForCurrentUser(betId, bet);
        }
      }
    }, (err) => {
      console.error('bets onValue error', err);
    });
  }

  // Render bets to DOM
  function renderBets(bets) {
    betListEl.innerHTML = '';
    const renderedBetIds = new Set();
    Object.entries(bets).sort((a,b)=> (b[1].createdAt||0)-(a[1].createdAt||0)).forEach(([betId, bet]) => {
      const div = document.createElement('div');
      div.className = 'bet';
      const statusText = bet.status ? ` (${bet.status})` : '';
      const q = document.createElement('div'); q.innerHTML = `<strong>${escapeHtml(bet.question || 'Untitled')}</strong>${statusText}`;
      div.appendChild(q);

      const opts = document.createElement('div');
      opts.className = 'options';
      (bet.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        // Users cannot bet if closed or settled; admin cannot place bets
        btn.disabled = (bet.status !== 'open') || isAdminLocal;
        btn.addEventListener('click', () => placeBet(betId, idx));
        opts.appendChild(btn);
      });
      div.appendChild(opts);

      // Show placed bets summary (readable by everyone if rules allow)
      if (bet.betSummary) {
        const sum = document.createElement('div');
        sum.className = 'summary';
        sum.textContent = `Summary: ${bet.betSummary}`;
        div.appendChild(sum);
      }

      // Live tracker: show counts and expected returns per option
      const tracker = document.createElement('div');
      tracker.className = 'live-tracker loading';
      tracker.textContent = 'Loading live tracker...';
      div.appendChild(tracker);
      renderLiveTracker(betId, bet, tracker);

      // If settled, show payout summary (add placeholder so the UI always shows status)
      if (bet.status === 'settled' && bet.winningOption != null) {
        const placeholder = document.createElement('div');
        placeholder.className = 'settlement-summary loading';
        placeholder.textContent = 'Loading settlement details...';
        div.appendChild(placeholder);
        renderSettlementSummary(betId, bet, placeholder);
      }

      // If admin and bet is open or closed, show settle buttons
      if (isAdminLocal && (bet.status === 'open' || bet.status === 'closed')) {
        const adminControls = document.createElement('div');
        adminControls.className = 'admin-controls';
        (bet.options || []).forEach((opt, idx) => {
          const settleBtn = document.createElement('button');
          settleBtn.textContent = `Set winner: ${opt}`;
          settleBtn.addEventListener('click', () => settleBet(betId, idx));
          adminControls.appendChild(settleBtn);
        });
        // Add a close button so admin can prevent further bets before settling (only if open)
        if (bet.status === 'open') {
          const closeBtn = document.createElement('button');
          closeBtn.textContent = 'Close Betting';
          closeBtn.addEventListener('click', () => closeBet(betId));
          adminControls.appendChild(closeBtn);
        }
        div.appendChild(adminControls);
      }

      renderedBetIds.add(betId);
      betListEl.appendChild(div);
    });

    // Clean up any tracker listeners for bets that no longer exist
    for (const key of Array.from(_trackerListeners.keys())) {
      if (!renderedBetIds.has(key)) {
        try { const unsub = _trackerListeners.get(key); if (typeof unsub === 'function') unsub(); } catch(_) {}
        _trackerListeners.delete(key);
      }
    }
  }

  // Render settlement summary: show pot, stakes by option, winners' payouts
  const _settlementListeners = new Map();
  // Live trackers for open bets
  const _trackerListeners = new Map();
  function renderSettlementSummary(betId, bet, holderEl) {
    // Use a realtime listener so summary updates as betResults change.
    try {
      // Avoid attaching multiple listeners for same betId
      if (_settlementListeners.has(betId)) {
        // already listening; return (listener will update holderEl)
        return;
      }

      const resultsRef = ref(db, `betResults/${betId}`);
      const unsubscribe = onValue(resultsRef, (snap) => {
        try {
          const allResults = snap.exists() ? snap.val() : null;
          if (!allResults) {
            holderEl.textContent = 'No bets placed for this event.';
            holderEl.className = 'settlement-summary empty';
            return;
          }

          // Compute pot and stakes per option
          let pot = 0;
          const stakesByOption = {};
          const playersByOption = {};
          for (const [uid, res] of Object.entries(allResults)) {
            const amt = Number(res.amount) || 0;
            const opt = Number(res.option);
            pot += amt;
            stakesByOption[opt] = (stakesByOption[opt] || 0) + amt;
            if (!playersByOption[opt]) playersByOption[opt] = [];
            playersByOption[opt].push({ uid, amount: amt, payout: Number(res.payout) || 0 });
          }

          // Clear holder and build summary inside it
          holderEl.innerHTML = '';
          holderEl.className = 'settlement-summary';

          const potDiv = document.createElement('div');
          potDiv.className = 'pot-info';
          potDiv.innerHTML = `<strong>Pot: $${pot}</strong>`;
          holderEl.appendChild(potDiv);

          // Show stakes and payouts for each option
          for (let i = 0; i < (bet.options || []).length; i++) {
            const optDiv = document.createElement('div');
            optDiv.className = i === bet.winningOption ? 'option-stakes winner' : 'option-stakes';
            const optionLabel = bet.options[i] || `Option ${i}`;
            const totalStaked = stakesByOption[i] || 0;
            optDiv.innerHTML = `<strong>${escapeHtml(optionLabel)}</strong>: $${totalStaked}`;

            if (playersByOption[i] && playersByOption[i].length > 0) {
              const playersList = document.createElement('div');
              playersList.className = 'players-list';
              playersByOption[i].forEach((p) => {
                const pDiv = document.createElement('div');
                pDiv.className = 'player-entry';
                if (i === bet.winningOption && p.payout > 0) {
                  pDiv.innerHTML = `&nbsp;&nbsp;Stake: $${p.amount} → Payout: $${p.payout}`;
                } else {
                  pDiv.innerHTML = `&nbsp;&nbsp;Stake: $${p.amount}`;
                }
                playersList.appendChild(pDiv);
              });
              optDiv.appendChild(playersList);
            }
            holderEl.appendChild(optDiv);
          }
        } catch (err) {
          console.error('settlement onValue handler error', err);
          holderEl.textContent = 'Unable to load settlement details (check DB rules/permissions).';
          holderEl.className = 'settlement-summary error';
        }
      }, (err) => {
        console.error('betResults onValue error', err);
        holderEl.textContent = 'Unable to load settlement details (check DB rules/permissions).';
        holderEl.className = 'settlement-summary error';
      });

      _settlementListeners.set(betId, unsubscribe);
    } catch (e) {
      console.error('renderSettlementSummary error', e);
      try {
        holderEl.textContent = 'Unable to load settlement details (check DB rules/permissions).';
        holderEl.className = 'settlement-summary error';
      } catch (_) {}
    }
  }

  // Render live tracker for a bet: counts per option, total staked per option,
  // and the current expected return per $1 if that option wins (pot / winnersTotal).
  function renderLiveTracker(betId, bet, holderEl) {
    try {
      if (_trackerListeners.has(betId)) return; // already listening

      const resultsRef = ref(db, `betResults/${betId}`);
      const unsubscribe = onValue(resultsRef, (snap) => {
        try {
          const allResults = snap.exists() ? snap.val() : null;
          if (!allResults) {
            holderEl.textContent = 'No bets yet for this event.';
            holderEl.className = 'live-tracker empty';
            return;
          }

          // Aggregate
          let pot = 0;
          const stakesByOption = {};
          const countByOption = {};
          for (const [uid, res] of Object.entries(allResults)) {
            const amt = Number(res.amount) || 0;
            const opt = Number(res.option);
            pot += amt;
            stakesByOption[opt] = (stakesByOption[opt] || 0) + amt;
            countByOption[opt] = (countByOption[opt] || 0) + 1;
          }

          // Build UI
          holderEl.innerHTML = '';
          holderEl.className = 'live-tracker';
          const potDiv = document.createElement('div');
          potDiv.className = 'pot-info';
          potDiv.innerHTML = `<strong>Pot:</strong> $${pot}`;
          holderEl.appendChild(potDiv);

          for (let i = 0; i < (bet.options || []).length; i++) {
            const optDiv = document.createElement('div');
            optDiv.className = 'tracker-option';
            const label = bet.options[i] || `Option ${i}`;
            const totalStaked = stakesByOption[i] || 0;
            const bettors = countByOption[i] || 0;

            // Expected return per $1 if this option wins (includes original stake)
            let perUnitReturn = 'N/A';
            if (totalStaked > 0) {
              perUnitReturn = (pot / totalStaked).toFixed(2);
            }

            optDiv.innerHTML = `<strong>${escapeHtml(label)}</strong> — ${bettors} bettors — Staked: $${totalStaked} — Return per $1 if wins: ${perUnitReturn === 'N/A' ? 'N/A' : '$' + perUnitReturn}`;
            holderEl.appendChild(optDiv);
          }
        } catch (err) {
          console.error('live tracker onValue handler error', err);
          holderEl.textContent = 'Unable to load live tracker (check DB rules/permissions).';
          holderEl.className = 'live-tracker error';
        }
      }, (err) => {
        console.error('betResults tracker onValue error', err);
        holderEl.textContent = `Unable to load live tracker: ${err.message || 'Check DB rules/permissions.'}`;
        holderEl.className = 'live-tracker error';
      });

      _trackerListeners.set(betId, unsubscribe);
    } catch (e) {
      console.error('renderLiveTracker error', e);
      try { holderEl.textContent = `Unable to load live tracker: ${e.message || 'Check DB rules/permissions.'}`; holderEl.className = 'live-tracker error'; } catch(_) {}
    }
  }

  // --- Place bet (users write their own betResults and balance) ---
  async function placeBet(betId, optionIdx) {
    if (!currentUser) return alert('Not signed in');
    try {
      // For demo: ask amount or use fixed amount
      const amountStr = prompt('Enter bet amount (integer):', '100');
      const amount = parseInt(amountStr || '0', 10);
      if (!amount || amount <= 0) return;
      // Read balance
      const balRef = ref(db, `balances/${currentUser.uid}`);
      const balSnap = await get(balRef);
      const bal = (balSnap.exists() ? Number(balSnap.val()) : 0);
      if (bal < amount) return alert('Not enough balance');

      // Write the user's betResult (allowed by secure rules)
      await set(ref(db, `betResults/${betId}/${currentUser.uid}`), { option: optionIdx, amount, claimed: false, placedAt: Date.now() });

      // Deduct balance using transaction to be safe
      await runTransaction(balRef, (current) => {
        if (current === null) return null;
        const c = Number(current);
        if (c < amount) return; // abort
        return c - amount;
      });

      
    } catch (e) {
      console.error('placeBet error', e);
      alert('Failed to place bet: ' + (e.message || e));
    }
  }

  // --- Admin sets winner (only updates bet entry) ---
  async function settleBet(betId, winningOption) {
    if (!isAdminLocal) return alert('Only admin can settle bets');
    try {
      // Mark bet as settled and record winningOption in a single update
      await update(ref(db, `bets/${betId}`), { status: 'settled', winningOption });
      
    } catch (e) {
      console.error('settleBet error', e);
      alert('Failed to settle bet: ' + (e.message || e));
    }
  }

  // Admin: close betting so no more bets can be placed (before settling)
  async function closeBet(betId) {
    if (!isAdminLocal) return alert('Only admin can close bets');
    try {
      await update(ref(db, `bets/${betId}`), { status: 'closed' });
      
    } catch (e) {
      console.error('closeBet error', e);
      alert('Failed to close bet: ' + (e.message || e));
    }
  }

  // --- When a bet is settled, each client checks whether they placed a winning bet.
  // If so, they apply the payout to their own balance and mark their betResult.claimed = true
  async function processSettlementForCurrentUser(betId, bet) {
    if (!currentUser) return; // not logged in yet
    try {
      const myResultRef = ref(db, `betResults/${betId}/${currentUser.uid}`);
      const mySnap = await get(myResultRef);
      if (!mySnap.exists()) return;
      const myRes = mySnap.val();
      if (myRes.claimed) return; // already paid

      // Read all results for this bet to compute the pot and winners' total
      const allSnap = await get(ref(db, `betResults/${betId}`));
      if (!allSnap.exists()) return;
      const allResults = allSnap.val() || {};

      let pot = 0;
      let winnersTotal = 0;
      for (const [uid, res] of Object.entries(allResults)) {
        const amt = Number(res.amount) || 0;
        pot += amt;
        if (Number(res.option) === Number(bet.winningOption)) {
          winnersTotal += amt;
        }
      }

      // If there are no winners, nothing to distribute (house keeps pot)
      if (winnersTotal <= 0) return;

      // If this user is a winner, compute their proportional share
      if (Number(myRes.option) === Number(bet.winningOption)) {
        // Proportional payout: pot * (userStake / winnersTotal)
        let payout = Math.floor(pot * (Number(myRes.amount) / winnersTotal));
        if (payout <= 0) payout = 0;

        if (payout > 0) {
          const balRef = ref(db, `balances/${currentUser.uid}`);
          // Increase balance safely with transaction
          await runTransaction(balRef, (current) => {
            if (current === null) return payout;
            return Number(current) + payout;
          });
        }

        // Mark as claimed and record the payout amount
        await update(myResultRef, { claimed: true, claimedAt: Date.now(), payout });
      }
    } catch (e) {
      console.error('processSettlementForCurrentUser error', e);
    }
  }

  // --- Balance listener that updates welcome text and ensures pending payouts processed
  function listenBalanceAndApplyPendingPayouts() {
    if (!currentUser) return;
    const balRef = ref(db, `balances/${currentUser.uid}`);
    onValue(balRef, async (snap) => {
      const val = snap.exists() ? snap.val() : 0;
      welcomeEl.textContent = `${displayName || 'You'} (Balance: ${val})`;
    }, (err) => {
      console.error('balance onValue error', err);
    });

    // Also attach bets listener (if not yet)
    // (processSettlementForCurrentUser is called from listenBets when a bet is settled)
  }

  // small helper to escape HTML when rendering
  function escapeHtml(str) {
    return (str+'').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
  }

});
