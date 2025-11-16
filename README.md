Real-time Fake Betting Night - Firebase version

Files:
- index.html
- main.js
- style.css
- firebase-config.example.js (rename to firebase-config.js and paste your Firebase config)

Setup steps:
1. Create a Firebase project at https://console.firebase.google.com/
2. In the Firebase Console:
   - Go to Authentication > Sign-in method > enable 'Anonymous'
   - Go to Build > Realtime Database > Create database. You may use Test mode while trying, but set rules appropriately before going public.
3. Register a web app in your Firebase project and copy the firebaseConfig object. Paste it into a new file named 'firebase-config.js' (see firebase-config.example.js).
4. Upload all files to a GitHub repo and enable GitHub Pages, or host on any static hosting provider.
5. Open the site. Players click 'Join' after entering a display name. If a player uses the display name 'admin' (case-insensitive), they see admin controls to close and settle bets.

Notes & caveats:
- This implementation uses Firebase anonymous auth and the Realtime Database for real-time sync.
- Balances and payouts are handled simply in client code. For production or to avoid race conditions, implement server-side validation (Cloud Functions) and secure database rules.
- See Firebase docs for details:
  - Anonymous auth: https://firebase.google.com/docs/auth/web/anonymous-auth
  - Realtime Database quickstart: https://firebase.google.com/docs/database/web/start
