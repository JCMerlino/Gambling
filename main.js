// main.js - modular, uses Firebase CDN SDK. Paste your firebase-config.js next to this file (see firebase-config.example.js)
import { firebaseConfig } from './firebase-config.js';

// Import Firebase modular SDK from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getDatabase, ref, push, set, onValue, update, get, child, remove, onDisconnect, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js';

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let displayName = '';

const joinScreen = document.getElementById('join-screen');
const mainScreen = document.getElementById('main');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const playerNameInput = document.getElementById('playerName');
const welcomeEl = document.getElementById('welcome');
const adminPanel = document.getElementById('admin-panel');
const createBetBtn = document.getElementById('createBetBtn');
const betNameInput = document.getElementById('betName');
const betOptionsInput = document.getElementById('betOptions');
const betsContainer = document.getElementById('bets');

joinBtn.addEventListener('click', async () => {
  const name = playerNameInput.value.trim();
  if (!name) return alert('Enter a display name');
  displayName = name;
  try {
    await signInAnonymously(auth);
    // onAuthStateChanged will continue
  } catch (e) {
    console.error('Auth error', e);
    alert('Failed to sign in anonymously: ' + e.message);
  }
});

leaveBtn.addEventListener('click', async () => {
  if (currentUser) {
    // remove presence
    const userRef = ref(db, 'users/' + currentUser.uid);
    await remove(userRef);
  }
  await signOut(auth);
  location.reload();
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // save display name & default balance if not exists
    const userRef = ref(db, 'users/' + user.uid);
    await set(userRef, {
      name: displayName,
      uid: user.uid,
      joinedAt: Date.now()
    });
    // ensure balance
    const balRef = ref(db, 'balances/' + user.uid);
    const snap = await get(balRef);
    if (!snap.exists()) {
      await set(balRef, 1000); // default fake money
    }
    // presence cleanup on disconnect
    const presenceRef = ref(db, 'presence/' + user.uid);
    set(presenceRef, { name: displayName, ts: Date.now() });
    onDisconnect(presenceRef).remove();

    joinScreen.style.display = 'none';
    mainScreen.style.display = 'block';
    welcomeEl.textContent = displayName + ' (Balance: ... )';
    // Admin simple rule: if displayName is 'admin' (case-insensitive)
    if (displayName.toLowerCase() === 'admin') adminPanel.style.display = 'block';
    listenBets();
    listenBalance();
  } else {
    currentUser = null;
    joinScreen.style.display = 'block';
    mainScreen.style.display = 'none';
  }
});

createBetBtn.addEventListener('click', async () => {
  const name = betNameInput.value.trim();
  const options = betOptionsInput.value.split(',').map(s=>s.trim()).filter(Boolean);
  if (!name || options.length < 2) return alert('Provide a title and at least 2 options');
  const betsRef = ref(db, 'bets');
  const newBetRef = push(betsRef);
  await set(newBetRef, {
    id: newBetRef.key,
    name,
    options,
    createdBy: currentUser.uid,
    createdAt: Date.now(),
    status: 'open',
    placements: {}
  });
  betNameInput.value = '';
  betOptionsInput.value = '';
});

function listenBets() {
  const betsRef = ref(db, 'bets');
  onValue(betsRef, (snapshot) => {
    const data = snapshot.val() || {};
    renderBets(data);
  });
}

function listenBalance() {
  const balRef = ref(db, 'balances/' + currentUser.uid);
  onValue(balRef, (snap) => {
    const bal = snap.val();
    welcomeEl.textContent = displayName + ' (Balance: ' + (bal ?? '...') + ')';
  });
}

function renderBets(bets) {
  betsContainer.innerHTML = '';
  const keys = Object.keys(bets).sort((a,b)=> (bets[b].createdAt||0)-(bets[a].createdAt||0));
  keys.forEach(k => {
    const b = bets[k];
    const div = document.createElement('div');
    div.className = 'bet';
    const title = document.createElement('h4');
    title.textContent = b.name + (b.status ? (' — ' + b.status) : '');
    div.appendChild(title);

    const opts = document.createElement('div');
    opts.className = 'bet-options';
    b.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt;
      btn.addEventListener('click', () => placeBet(k, opt));
      opts.appendChild(btn);
    });
    div.appendChild(opts);

    const placements = document.createElement('div');
    placements.className = 'small';
    const placementLines = [];
    if (b.placements) {
      Object.values(b.placements).forEach(p => {
        placementLines.push((p.name||p.uid) + ': ' + p.option + ' (' + p.amount + ')');
      });
    }
    placements.innerHTML = '<strong>Placed bets:</strong><br>' + (placementLines.length ? placementLines.join('<br>') : 'None');
    div.appendChild(placements);

    // Admin controls to close and set result
    if (displayName.toLowerCase() === 'admin') {
      const adminControls = document.createElement('div');
      adminControls.style.marginTop = '8px';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = (b.status==='open') ? 'Close bet' : 'Reopen';
      closeBtn.addEventListener('click', async () => {
        const betRef = ref(db, 'bets/' + k + '/status');
        await set(betRef, b.status==='open' ? 'closed' : 'open');
      });
      adminControls.appendChild(closeBtn);

      const resultInput = document.createElement('select');
      b.options.forEach(o => {
        const optEl = document.createElement('option'); optEl.value = o; optEl.text = o; resultInput.appendChild(optEl);
      });
      const settleBtn = document.createElement('button');
      settleBtn.textContent = 'Set result & settle';
      settleBtn.addEventListener('click', async () => {
        if (!confirm('Set result to "' + resultInput.value + '" and settle all bets? This cannot be undone.')) return;
        await settleBet(k, resultInput.value);
      });
      adminControls.appendChild(resultInput);
      adminControls.appendChild(settleBtn);
      div.appendChild(adminControls);
    }

    betsContainer.appendChild(div);
  });
}

async function placeBet(betId, option) {
  if (!currentUser) return alert('Not signed in');
  const betRef = ref(db, 'bets/' + betId);
  const snap = await get(betRef);
  const bet = snap.val();
  if (!bet) return alert('Bet not found');
  if (bet.status && bet.status !== 'open') return alert('Bet is closed');

  const amountStr = prompt('Bet amount? (integer)');
  const amount = parseInt(amountStr);
  if (!amount || amount <= 0) return;
  const balRef = ref(db, 'balances/' + currentUser.uid);
  const balSnap = await get(balRef);
  const bal = balSnap.val() || 0;
  if (bal < amount) return alert('Not enough balance');

  // create placement
  const placementId = push(ref(db, 'bets/' + betId + '/placements')).key;
  const placementRef = ref(db, 'bets/' + betId + '/placements/' + placementId);
  await set(placementRef, {
    id: placementId,
    uid: currentUser.uid,
    name: displayName,
    option,
    amount,
    placedAt: Date.now()
  });

  // deduct balance (transaction-safe approach would use Cloud Functions; this is simple)
  await set(balRef, bal - amount);
}

async function settleBet(betId, winningOption) {
  const betRef = ref(db, 'bets/' + betId);
  const snap = await get(betRef);
  const bet = snap.val();
  if (!bet) return alert('Bet not found');

  // compute payouts: simple fixed-odds pool share:
  const placements = bet.placements || {};
  // sum pools per option
  const pools = {};
  let totalPool = 0;
  Object.values(placements).forEach(p => {
    pools[p.option] = (pools[p.option] || 0) + p.amount;
    totalPool += p.amount;
  });
  const winningPool = pools[winningOption] || 0;

  // For each winner, payout proportionally from totalPool. Losers lose stake.
  if (winningPool === 0) {
    // no winners: nothing to do
  } else {
    // distribute totalPool among winners proportional to stake
    for (const placementId in placements) {
      const p = placements[placementId];
      if (p.option === winningOption) {
        const userBalRef = ref(db, 'balances/' + p.uid);
        const userSnap = await get(userBalRef);
        const userBal = userSnap.val() || 0;
        // payout proportional: share = p.amount / winningPool * totalPool
        const payout = Math.floor((p.amount / winningPool) * totalPool);
        await set(userBalRef, userBal + payout);
      }
    }
  }

  // mark settled
  await update(ref(db, 'bets/' + betId), { status: 'settled', result: winningOption, settledAt: Date.now() });
}

