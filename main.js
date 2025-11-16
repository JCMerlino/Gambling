// main.js
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, update } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// DOM elements
const joinBtn = document.getElementById('joinBtn');
const playerNameInput = document.getElementById('playerName');
const joinScreen = document.getElementById('join-screen');
const mainScreen = document.getElementById('main');
const welcomeEl = document.getElementById('welcome');
const adminPanel = document.getElementById('admin-panel');
const betListEl = document.getElementById('bet-list');
const newBetQuestion = document.getElementById('new-bet-question');
const newBetOptions = document.getElementById('new-bet-options');
const createBetBtn = document.getElementById('create-bet-btn');

let displayName = '';
let currentUser = null;

// --- Join Button ---
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

        // Save user info securely
        await set(ref(db, 'users/' + user.uid), {
            uid: user.uid,
            name: displayName,
            joinedAt: Date.now()
        });

        const balanceRef = ref(db, 'balances/' + user.uid);
        const balanceSnap = await get(balanceRef);
        if (!balanceSnap.exists()) await set(balanceRef, 1000);

        // Show UI
        joinScreen.style.display = 'none';
        mainScreen.style.display = 'block';
        welcomeEl.textContent = `${displayName} (Balance: ${balanceSnap.exists() ? balanceSnap.val() : 1000})`;

        // Show admin panel if admin
        if (displayName.toLowerCase() === 'admin') adminPanel.style.display = 'block';

        listenBets();
        listenBalances();
    } else {
        // Logged out
        joinScreen.style.display = 'block';
        mainScreen.style.display = 'none';
        currentUser = null;
    }
});

// --- Admin creates bet ---
createBetBtn.addEventListener('click', async () => {
    if (displayName.toLowerCase() !== 'admin') return;

    const question = newBetQuestion.value.trim();
    const options = newBetOptions.value.split(',').map(o => o.trim()).filter(o => o);
    if (!question || options.length < 2) return alert('Enter a question and at least 2 options');

    const betRef = push(ref(db, 'bets'));
    await set(betRef, {
        question,
        options,
        status: 'open',
        winningOption: null,
        createdAt: Date.now()
    });

    newBetQuestion.value = '';
    newBetOptions.value = '';
});

// --- Listen to bets ---
function listenBets() {
    const betsRef = ref(db, 'bets');
    onValue(betsRef, (snapshot) => {
        betListEl.innerHTML = '';
        const bets = snapshot.val();
        if (!bets) return;

        Object.entries(bets).forEach(([betId, bet]) => {
            const div = document.createElement('div');
            div.className = 'bet';
            div.innerHTML = `<strong>${bet.question}</strong> (${bet.status})`;

            // User betting buttons
            bet.options.forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.textContent = opt;
                btn.disabled = bet.status !== 'open' || displayName.toLowerCase() === 'admin';
                btn.addEventListener('click', () => placeBet(betId, idx));
                div.appendChild(btn);
            });

            // Admin settle buttons
            if (displayName.toLowerCase() === 'admin' && bet.status === 'open') {
                bet.options.forEach((opt, idx) => {
                    const settleBtn = document.createElement('button');
                    settleBtn.textContent = `Set winner: ${opt}`;
                    settleBtn.addEventListener('click', () => settleBet(betId, idx));
                    div.appendChild(settleBtn);
                });
            }

            betListEl.appendChild(div);
        });
    });
}

// --- Place a bet ---
async function placeBet(betId, optionIdx) {
    const balanceSnap = await get(ref(db, 'balances/' + currentUser.uid));
    const balance = balanceSnap.val();
    const amount = 100; // demo fixed bet
    if (balance < amount) return alert('Not enough balance');

    // Write user's bet securely
    await set(ref(db, `betResults/${betId}/${currentUser.uid}`), {
        option: optionIdx,
        amount
    });

    await set(ref(db, 'balances/' + currentUser.uid), balance - amount);
}

// --- Settle bet (admin only) ---
async function settleBet(betId, winningOption) {
    if (displayName.toLowerCase() !== 'admin') return;

    await update(ref(db, `bets/${betId}`), {
        status: 'settled',
        winningOption
    });

    const resultsSnap = await get(ref(db, `betResults/${betId}`));
    if (!resultsSnap.exists()) return;

    const results = resultsSnap.val();
    for (const [uid, res] of Object.entries(results)) {
        if (res.option === winningOption) {
            const balRef = ref(db, `balances/${uid}`);
            const balSnap = await get(balRef);
            await set(balRef, balSnap.val() + res.amount * 2); // winner gets double
        }
    }
}

// --- Listen to balance updates ---
function listenBalances() {
    const balRef = ref(db, 'balances/' + currentUser.uid);
    onValue(balRef, (snap) => {
        const val = snap.val();
        welcomeEl.textContent = `${displayName} (Balance: ${val})`;
    });
}