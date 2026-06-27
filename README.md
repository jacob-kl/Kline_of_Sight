<div align="center">

<h1>📍 Our Photo Map</h1>

<p>A shared travel photo map for you and your people.<br/>
Upload photos from anywhere — they pin to the map exactly where you took them.</p>

<p>
  <img src="https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white" alt="Leaflet"/>
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black" alt="Firebase"/>
  <img src="https://img.shields.io/badge/Cloudinary-3448C5?style=flat-square&logo=cloudinary&logoColor=white" alt="Cloudinary"/>
  <img src="https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel"/>
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA"/>
</p>

<br/>

**[📍 View our travels →](preview.geojson)**

<sub>Opens an interactive map — no app install needed.</sub>

</div>

---

## What it does

Open the map, tap **+**, pick a photo, and choose whether to use your GPS location or drop a pin manually. The photo uploads to Cloudinary, the location gets saved to Firestore, and it appears on the map as a circular thumbnail right where you were. Nearby photos stack into a cluster — tap any cluster to browse the full album from that trip. Everyone with the link sees new photos appear in real time, no refresh needed.

Anyone can view the map. Adding photos requires signing in with Google.

---

## Tech stack

| Layer | Tool | Free tier |
|---|---|---|
| Map | [Leaflet.js](https://leafletjs.com) + CartoDB tiles | Unlimited |
| Clustering | [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | Unlimited |
| Photo storage | [Cloudinary](https://cloudinary.com) | 25 GB storage, 25 GB/month bandwidth |
| Database | [Firebase Firestore](https://firebase.google.com/products/firestore) | 1 GB storage, 50k reads/day |
| Auth | [Firebase Authentication](https://firebase.google.com/products/auth) | Unlimited Google sign-ins |
| Reverse geocoding | [Nominatim](https://nominatim.org) (OpenStreetMap) | Free, no key |
| Hosting | [Vercel](https://vercel.com) | Unlimited for personal projects |

---

## Setup

You need three accounts, all free, all no credit card required.

---

### Step 1 — Firebase (Auth + Firestore)

**1.1 Create a project**

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Enter a project name (e.g. `photo-map`), click through the steps, click **Create project**

**1.2 Enable Google sign-in**

1. In the left sidebar, click **Build → Authentication**
2. Click **Get started**
3. Under the **Sign-in method** tab, click **Google**
4. Toggle **Enable** on, add a support email, click **Save**

**1.3 Create a Firestore database**

1. In the left sidebar, click **Build → Firestore Database**
2. Click **Create database**
3. Select **Start in production mode**, click **Next**
4. Choose any region close to you, click **Enable**

**1.4 Set Firestore security rules**

1. In Firestore, click the **Rules** tab
2. Replace the contents with the following and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /locations/{locationId} {
      allow read:   if true;                  // anyone with the link can view
      allow create: if request.auth != null;  // must be signed in to add a location
      allow update: if request.auth != null;  // must be signed in to add a photo
      allow delete: if false;                 // no deletion from the app
    }
  }
}
```

**1.5 Get your config**

1. In the left sidebar, click the **gear icon → Project settings**
2. Scroll down to **Your apps** and click the **</>** (web) icon
3. Register the app with any nickname, click **Register app**
4. Copy the `firebaseConfig` object — you'll paste it into `config.js` in Step 3

---

### Step 2 — Cloudinary (photo storage)

**2.1 Create an account**

1. Go to [cloudinary.com](https://cloudinary.com) and click **Sign Up Free**
2. Fill in the form — no credit card required

**2.2 Note your cloud name**

On the dashboard homepage, your **Cloud name** is shown near the top (e.g. `dxyz1234`). Copy it.

**2.3 Create an unsigned upload preset**

1. Click your avatar (top right) → **Console Settings**
2. In the left sidebar, click **Upload**
3. Scroll down to **Upload presets** and click **Add upload preset**
4. Set **Signing mode** to **Unsigned**
5. Set **Preset name** to `photo-map` (or any name you want — just match it in `config.js`)
6. Click **Save**

---

### Step 3 — Fill in config.js

Open `config.js` in the repo and replace the placeholder values:

```js
const FIREBASE_CONFIG = {
  apiKey:            "paste-from-firebase",
  authDomain:        "your-project-id.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project-id.firebasestorage.app",
  messagingSenderId: "your-sender-id",
  appId:             "your-app-id"
};

const CLOUDINARY_CLOUD_NAME    = "your-cloud-name";
const CLOUDINARY_UPLOAD_PRESET = "photo-map";
```

> **Why is it safe to commit this?** Firebase web API keys are designed to be public — they identify your project but don't grant access to it. Security comes entirely from the Firestore rules you set in Step 1.4. Cloudinary unsigned presets are also public-facing by design; they can only be used to upload new files, never to modify or delete existing ones.

---

### Step 4 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/photo-map.git
git push -u origin main
```

---

### Step 5 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and click **Sign Up** — use your GitHub account so repos are already linked
2. From the dashboard, click **Add New → Project**
3. Find your `photo-map` repo in the list and click **Import**
4. On the configuration screen:
   - **Framework Preset:** leave as `Other` (this is plain HTML, no framework)
   - **Root Directory:** leave as `./`
   - **Build Command:** leave blank
   - **Output Directory:** leave blank
5. Click **Deploy**

Vercel gives you a live URL in about 30 seconds (e.g. `photo-map-abc123.vercel.app`). From now on, every `git push` to `main` automatically redeploys.

**Custom domain (optional):** In your Vercel project → **Settings → Domains**, you can add your own domain for free.

---

### Step 6 — Authorize your Vercel domain in Firebase

Firebase Auth blocks sign-ins from domains it doesn't recognize.

1. Back in the Firebase Console, go to **Build → Authentication**
2. Click the **Settings** tab
3. Under **Authorized domains**, click **Add domain**
4. Paste your Vercel URL (e.g. `photo-map-abc123.vercel.app`) and click **Add**

Sign-in will now work on your live site.

---

## Using the app

| Action | How |
|---|---|
| View the map | Open the URL — no account needed |
| Sign in | Tap **Sign in** in the header → Google popup |
| Add a photo | Tap **+** → choose photo → pick GPS or drop a pin → **Add to Map** |
| Browse a location | Tap any photo cluster on the map |
| View full screen | Tap a photo in the album |
| Install on phone | **iOS:** Share → Add to Home Screen · **Android:** browser menu → Install app |
| Sign out | Tap your profile photo in the header |

---

## Keeping the map preview updated

The [`preview.geojson`](preview.geojson) file is what GitHub renders as the interactive map linked in this README. Add a new entry whenever you visit a new place — it takes about 30 seconds.

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [LONGITUDE, LATITUDE]
  },
  "properties": {
    "name": "City, Country",
    "description": "2 photos · what you saw",
    "marker-symbol": "camera",
    "marker-color": "#f59e0b",
    "marker-size": "medium"
  }
}
```

Note that GeoJSON uses **`[longitude, latitude]`** order — the reverse of how most maps display it.

---

## Project structure

```
photo-map/
├── index.html          HTML structure
├── style.css           All styles
├── app.js              Map, Firebase, Cloudinary logic
├── config.js           Your credentials (safe to commit)
├── preview.geojson     Interactive map for this README
└── README.md
```

---

## Local development

Open `index.html` directly in your browser. Firestore and Auth work locally out of the box. No build step, no terminal needed.

```bash
# Optional: use a local server if you run into any CORS issues
npx serve .
```

---

## License

MIT — do whatever you want with it.
