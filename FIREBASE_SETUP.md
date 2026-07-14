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
        ".validate": "newData.hasChildren(['format', 'teams', '_createdAt']) && (newData.child('format').val() === 'single' || newData.child('format').val() === 'double' || newData.child('format').val() === 'round' || newData.child('format').val() === 'series') && newData.child('_createdAt').val() <= now && (!data.exists() ? newData.child('_createdAt').val() > now - 60000 : (newData.child('_createdAt').val() === data.child('_createdAt').val() || newData.child('_createdAt').val() > now - 60000))"
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || (root.child('personOf').child(auth.uid).val() != null && root.child('personOf').child(auth.uid).val() === root.child('personOf').child($uid).val()))",
        ".write": "auth != null && auth.uid === $uid",
        "history": {
          "$recId": {
            ".validate": "newData.hasChildren(['id','date'])"
          }
        }
      }
    },
    "linkCodes": {
      "$code": {
        ".read": "auth != null && data.exists() && (now - data.child('createdAt').val()) < 1800000",
        ".write": "auth != null && (!newData.exists() || !data.exists() || data.child('ownerUid').val() === auth.uid)",
        ".validate": "newData.hasChildren(['ownerUid','personId','createdAt']) && newData.child('ownerUid').val() === auth.uid && newData.child('createdAt').val() <= now"
      }
    },
    "people": {
      "$personId": {
        ".read": "auth != null && data.child('linkedUids').child(auth.uid).exists()",
        "linkedUids": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".validate": "(!root.child('people').child($personId).exists() && newData.val() === true) || (data.exists() && newData.val() === data.val()) || (root.child('linkCodes').child(newData.val()).child('personId').val() === $personId && (now - root.child('linkCodes').child(newData.val()).child('createdAt').val()) < 1800000)"
          }
        }
      }
    },
    "personOf": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        ".validate": "!newData.exists() || root.child('people').child(newData.val()).child('linkedUids').child($uid).exists()"
      }
    }
  }
}
```

**What these rules do:**
- `tournaments/$code` — unchanged from before:
  - Tournaments expire automatically after **48 hours** (172,800,000 ms) — unreadable and unwritable after that
  - Any device with the 6-char code can read and write the tournament
  - The 6-char code space (32⁶ ≈ 1 billion) makes brute-force impractical within the 48h window
  - New tournaments must have `format`, `teams`, and `_createdAt`, and `format` must be one of `single`, `double`, `round`, or `series`
  - `_createdAt` can **never be set in the future** (`<= now`) on any write — this is the key protection: it stops a client from forging a future timestamp to make a tournament never expire (the 48h window is anchored to `_createdAt`). On a **new** record it must be the current server time; on an **update** it must either keep the existing value (normal score sync) or be re-stamped to the current server time (rematch/redraw). The worst an attacker can do is refresh the 48h clock by writing — they can never push expiry past 48h from the last write.
- `users/$uid` — backs the optional "Back up my History" feature. A device can always read/write its **own** uid's path, and can additionally *read* (never write) another uid's path once `personOf` confirms they're linked as the same person — that's what lets Personal Stats merge a linked device's History. There's still no way to read an unlinked stranger's history. History records must carry at least `id` and `date` — exactly the two fields the client's restore/merge path depends on — so garbage shapes can't land in a backup (SECURITY_REVIEW.md #12; deliberately no stricter, because legacy imported records may lack newer fields and Firebase drops `null`-valued keys on write).
- `linkCodes/$code` — the short-lived code one device shows another to link them as the same "person" (Display sheet → Back up my History → Show a code). Expires after **30 minutes**, much shorter than a tournament code, since it's meant to be typed on the other device immediately. Only the owner can create/overwrite a code, but **any signed-in device may delete one** (`!newData.exists()` clause) — deleting requires already knowing the code, and knowing the code already grants a join, so this adds no attack surface. The client now uses that clause both ways (SECURITY_REVIEW.md #10, fixed 2026-07-14): `commitLinkCode` deletes the code the moment it's redeemed, and `closeLinkDeviceSheet` deletes an outstanding never-redeemed code when the generator's "show code" step closes (Done, overlay tap, or back button) — so a code is single-use in practice, not just by convention, and doesn't linger as a redeemable artifact for its full 30-minute window once either side is done with it. The record also carries an optional `ownerName` (the generator's device name, display-only) so `redeemLinkCode`'s new confirm step can show *whose* group a code joins before committing (SECURITY_REVIEW.md #11, part b).
- `people/$personId/linkedUids/$uid` — write access is scoped per child key: a device can only ever write **its own uid** into the map. The `.validate` enforces **proof-of-code** on joins (SECURITY_REVIEW.md #8): the value written must be a live, unexpired `linkCodes` entry pointing at this very `personId` — the client stores the redeemed code itself as the membership value. Two escape hatches: the **first** device may write `true` while the group doesn't exist yet (creating a brand-new group protects nothing), and an existing entry may be rewritten with its own current value (idempotent replays). Net effect: a device can no longer self-join an arbitrary `personId` it guessed or learned — it must hold a real, fresh code for it.
- `personOf/$uid` — the reverse index (uid → personId) that makes the `users/$uid` cross-read rule above possible to express without an unbounded scan. Same per-key write scoping as `linkedUids`: a device can only ever write its own uid's entry. The `.validate` requires that uid to already be listed in `people/<that personId>/linkedUids` — without it, a device could point its own `personOf` at *any* `personId` string it could guess or learn, and the `users/$uid` cross-read rule would treat it as legitimately linked to that group. `generateLinkCode`/`redeemLinkCode` already write `linkedUids` before `personOf` (in that order), so this validate always passes for the real flow. Readable **only by its own uid** (`auth.uid === $uid`): nothing in the app ever reads it back — the cross-read rule consults it via `root.child(...)`, which needs no client read grant — and a broader read would be a uid→personId oracle that undermines the "personId is never exposed" property the linking model leans on (SECURITY_REVIEW.md #9).

Click **Publish** to save the rules.

## 4a. Enable Anonymous Authentication (for optional cloud History backup)

The "Back up my History" feature (Display sheet) needs every device to have a stable identity to write under — without a login screen, that's Firebase's **Anonymous** sign-in provider.

1. In Firebase console: **Build → Authentication → Sign-in method**
2. Click **Anonymous** in the provider list → toggle **Enable** → **Save**

Nothing else to configure — the app calls `signInAnonymously()` on load and each device gets its own `uid` silently, with no visible sign-in UI.

> **This step and the rules above are both manual, console-only actions — nothing in this repo deploys them automatically.** There's no `firebase.json`/`database.rules.json` in this repo; the rules text above must be pasted into the console's Rules tab and published by hand after every change, exactly as before. If you update `index.html` to add or change cloud-sync behavior, remember the rules/auth-provider changes ship separately and won't go live just because the code was deployed.

## 5. Done

Deploy `index.html` to Vercel (`cd ~/Desktop/SomeRSet && npx vercel --prod`).

When you start a tournament, the app automatically:
- Generates a join code (e.g. `K7MXQ2`)
- Shows it in the bracket view with a "tap to copy" button
- Syncs all match updates live across devices

Other players go to Tournament → **Join with a code** → enter the 6-character code.
