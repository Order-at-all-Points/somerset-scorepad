# Firebase Setup for Shared Tournaments

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. "SomeRSet") → Continue
3. Disable Google Analytics if you don't need it → Create project

## 2. Enable Realtime Database

1. In the left sidebar: **Build → Realtime Database**
2. Click **Create Database**
3. Choose a region (US or EU) → **Start in test mode** (we'll replace the rules next)
4. Click **Enable**

## 3. Paste your config into the app

1. In Firebase console: **Project settings (gear icon) → Your apps → SDK setup & configuration**
2. If no app exists, click the **</>** (Web) icon to register one
3. Copy the `firebaseConfig` object values
4. Open `index.html` and find the `SOMERSET_FB_CONFIG` block near the top:

```js
window.SOMERSET_FB_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "your-project.firebaseapp.com",
  databaseURL:       "https://your-project-default-rtdb.firebaseio.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

Only `databaseURL` is strictly required for the app to work.

## 4. Set Security Rules

In Firebase console: **Realtime Database → Rules** tab. Replace the default rules with:

```json
{
  "rules": {
    "tournaments": {
      "$code": {
        ".read": "data.exists() && (now - data.child('_createdAt').val()) < 172800000",
        ".write": "!data.exists() || (data.exists() && (now - data.child('_createdAt').val()) < 172800000)",
        ".validate": "newData.hasChildren(['format', 'teams']) && (newData.child('format').val() === 'single' || newData.child('format').val() === 'double' || newData.child('format').val() === 'round' || newData.child('format').val() === 'series')"
      }
    }
  }
}
```

**What these rules do:**
- Tournaments expire automatically after **48 hours** (172,800,000 ms) — unreadable and unwritable after that
- Any device with the 6-char code can read and write the tournament
- The 6-char code space (32⁶ ≈ 1 billion) makes brute-force impractical within the 48h window
- New tournaments must have `format` and `teams`, and `format` must be one of `single`, `double`, `round`, or `series`
- ⚠️ The old rule required a `rounds` field, which broke Double Elimination (`wBracket`/`lBracket`) and Round Robin (`schedule`) — this is the corrected version

Click **Publish** to save the rules.

## 5. Done

Deploy `index.html` to Vercel (`cd ~/Desktop/SomeRSet && npx vercel --prod`).

When you start a tournament, the app automatically:
- Generates a join code (e.g. `K7MXQ2`)
- Shows it in the bracket view with a "tap to copy" button
- Syncs all match updates live across devices

Other players go to Tournament → **Join with a code** → enter the 6-character code.
