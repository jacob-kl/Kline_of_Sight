// ─────────────────────────────────────────────────────────
// Firebase configuration
// Where to find this:
//   Firebase Console → Project Settings (gear icon) →
//   Your apps → your web app → SDK setup and configuration
// ─────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────
// Cloudinary configuration
// Cloud name:   Cloudinary Console → Dashboard (top of page)
// Upload preset: Console Settings → Upload → Upload presets
//   → the unsigned preset you created (e.g. "photo-map")
// ─────────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME    = "YOUR_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "photo-map";
