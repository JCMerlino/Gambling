// main.js - clean, working version
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// DOM elements
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const playerNameInput = document.getElementById('playerName');
const joinScreen = document.getElementById('join-screen');
const mainScreen = document.getElementById('main');
const welcomeEl = document.getElementById('welcome');
const adminPanel = document.getElementById('admin-panel');

let displayName = '';
let currentUser = null;

// Join button click
joinBtn.addEventListener('click', async () => {
    displayName = playerNameInput.value.trim();
    if (!displayName) return alert('Enter a name');

    try {
        await signInAnonymously(auth);
        // onAuthStateChanged will handle UI update
    } catch (e) {
        console.error('Firebase auth error:', e);
        alert('Login failed: ' + e.message);
    }
});

// Leave button
if (leaveBtn) {
    leaveBtn.addEventListener('click', async () => {
        if (currentUser) {
            const userRef = ref(db, 'users/' + currentUser.uid);
            await set(userRef, null); // optional: remove user on leave
        }
        await signOut(auth);
        location.reload();
    });
}

// Auth state change
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        if (!displayName) displayName = 'Anonymous';

        try {
            // Save user info
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

            // Show admin panel if name = "admin"
            if (displayName.toLowerCase() === 'admin') {
                adminPanel.style.display = 'block';
            }

        } catch (err) {
            console.error('Error updating user/balance:', err);
        }

    } else {
        // User logged out
        joinScreen.style.display = 'block';
        mainScreen.style.display = 'none';
        currentUser = null;
    }
});
