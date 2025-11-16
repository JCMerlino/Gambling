// firebase-config.js
// Import Firebase App
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";

// Export the config object so main.js can import it
export const firebaseConfig = {
  apiKey: "AIzaSyA2DLlCW-X64oymcVcC42U_xFagHaIgb-U",
  authDomain: "gambling-e298c.firebaseapp.com",
  databaseURL: "https://gambling-e298c-default-rtdb.europe-west1.firebasedatabase.app/",
  projectId: "gambling-e298c",
  storageBucket: "gambling-e298c.firebasestorage.app",
  messagingSenderId: "205801147540",
  appId: "1:205801147540:web:a20aef34c5981a894bf881"
};

// Initialize Firebase App
initializeApp(firebaseConfig);