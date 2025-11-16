import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, update } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Firebase init
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
const createBetBtn = document.getElementById('create-bet-btn');
const newBetQuestion = document.getElementById('new-bet-question');
const newBetOptions = document.getElementById('new-bet-options');
const betListEl = document.getElementById('bet-list');

let displayName = '';
let currentUser = null;

// Disable create bet initially
createBetBtn.disabled = true;

// Join button
joinBtn.addEventListener('click', async () => {
    displayName = playerNameInput.value.trim();
    if (!displayName) return alert('Enter a name');
    try { await signInAnonymously(auth); }
    catch (e) { console.error(e); alert('Login failed: ' + e.message); }
});

// Auth state
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        // Write user info
        await set(ref(db, 'users/' + user.uid), { uid: user.uid, name: displayName, joinedAt: Date.now() });

        // Create balance if missing
        const balSnap = await get(ref(db, 'balances/' + user.uid));
        if (!balSnap.exists()) await set(ref(db, 'balances/' + user.uid), 1000);

        // UI
        joinScreen.style.display = 'none';
        mainScreen.style.display = 'block';
        welcomeEl.textContent = `${displayName} (Balance: 1000)`;

        // Enable admin panel if admin
        if (displayName.toLowerCase() === 'admin') {
            adminPanel.style.display = 'block';
            createBetBtn.disabled = false;
        }

        listenBets();
        listenBalance();
    } else {
        joinScreen.style.display = 'block';
        mainScreen.style.display = 'none';
        currentUser = null;
    }
});

// Admin creates a bet
createBetBtn.addEventListener('click', async () => {
    if (displayName.toLowerCase() !== 'admin') return;
    const question = newBetQuestion.value.trim();
    const options = newBetOptions.value.split(',').map(o => o.trim()).filter(o => o);
    if (!question || options.length < 2) return alert('Enter question and at least 2 options');

    const betRef = push(ref(db, 'bets'));
    try {
        await set(betRef, { question, options, status: 'open', winningOption: null, createdAt: Date.now() });
        newBetQuestion.value = '';
        newBetOptions.value = '';
    } catch (e) {
        console.error('Failed to create bet:', e);
        alert('Error creating bet');
    }
});

// Listen to bets
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

            // User bet buttons
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

// Place bet (user only)
async function placeBet(betId, optionIdx) {
    const balSnap = await get(ref(db, 'balances/' + currentUser.uid));
    const balance = balSnap.val();
    const amount = 100; // fixed demo bet
    if (balance < amount) return alert('Not enough balance');

    try {
        await set(ref(db, `betResults/${betId}/${currentUser.uid}`), { option: optionIdx, amount });
        await set(ref(db, 'balances/' + currentUser.uid), balance - amount);
    } catch (e) { console.error('Failed to place bet:', e); }
}

// Settle bet (admin only)
async function settleBet(betId, winningOption) {
    if (displayName.toLowerCase() !== 'admin') return;

    try {
        await update(ref(db, `bets/${betId}`), { status: 'settled', winningOption });

        const resultsSnap = await get(ref(db, `betResults/${betId}`));
        if (!resultsSnap.exists()) return;

        const results = resultsSnap.val();
        for (const [uid, res] of Object.entries(results)) {
            if (res.option === winningOption) {
                const balSnap = await get(ref(db, `balances/${uid}`));
                await set(ref(db, `balances/${uid}`), balSnap.val() + res.amount * 2);
            }
        }
    } catch (e) { console.error('Failed to settle bet:', e); }
}

// Listen to balance updates
function listenBalance() {
    const balRef = ref(db, 'balances/' + currentUser.uid);
    onValue(balRef, (snap) => {
        const val = snap.val();
        welcomeEl.textContent = `${displayName} (Balance: ${val})`;
    });
}
