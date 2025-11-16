import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const joinBtn = document.getElementById('joinBtn');
const playerNameInput = document.getElementById('playerName');
const joinScreen = document.getElementById('join-screen');
const mainScreen = document.getElementById('main');
const welcomeEl = document.getElementById('welcome');
const adminPanel = document.getElementById('admin-panel');

let displayName = '';
let currentUser = null;

joinBtn.addEventListener('click', async () => {
  displayName = playerNameInput.value.trim();
  if (!displayName) return alert('Enter a name');

  try {
    await signInAnonymously(auth);
    // onAuthStateChanged will now trigger
  } catch (e) {
    console.error('Auth error', e);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;

    // Make sure displayName is set
    if (!displayName) displayName = 'Anonymous';

    // Save user info in database
    const userRef = ref(db, 'users/' + user.uid);
    await set(userRef, {
      uid: user.uid,
      name: displayName,
      joinedAt: Date.now()
    });

    // Initialize balance if not exists
    const balanceRef = ref(db, 'balances/' + user.uid);
    const balanceSnap = await get(balanceRef);
    if (!balanceSnap.exists()) {
      await set(balanceRef, 1000);
    }

    // Update DOM
    joinScreen.style.display = 'none';
    mainScreen.style.display = 'block';
    welcomeEl.textContent = `${displayName} (Balance: 1000)`;

    // Show admin panel if name is 'admin'
    if (displayName.toLowerCase() === 'admin') {
      adminPanel.style.display = 'block';
    }
  } else {
    // user logged out
    joinScreen.style.display = 'block';
    mainScreen.style.display = 'none';
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

