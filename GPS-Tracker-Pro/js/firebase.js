/* ==========================================================================
   firebase.js
   Initializes Firebase (App, Auth, Realtime Database) and exposes small
   helper functions used across tracker.js, history.js, alerts.js and the
   device/geofence pages. Loaded via the Firebase "compat" SDK so every
   page can use the global `firebase` object with plain <script> tags.
   ========================================================================== */

/* -----------------------------------------------------------------------
   1. CONFIGURATION — replace with your own Firebase project credentials.
   Find these under Project Settings > General > Your apps (Web app) in
   the Firebase console. The databaseURL must point at a Realtime
   Database instance (not Firestore).
   ----------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBVrJnMrRqApRnmTKZ3m3c2VJUfAbZ1GNo",
  authDomain: "gps-tracker-pro-35958.firebaseapp.com",
  databaseURL: "https://gps-tracker-pro-35958-default-rtdb.firebaseio.com",
  projectId: "gps-tracker-pro-35958",
  storageBucket: "gps-tracker-pro-35958.firebasestorage.app",
  messagingSenderId: "682423750480",
  appId: "1:682423750480:web:688b69c7e3d38c78c22655",
  measurementId: "G-96SZRDDS9V"
};

/* -----------------------------------------------------------------------
   2. INITIALIZE
   ----------------------------------------------------------------------- */
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.database();

/* -----------------------------------------------------------------------
   3. DATABASE PATHS
   Realtime Database shape:
     devices/{deviceId}                -> latest device snapshot
     history/{deviceId}/{pushId}        -> historical GPS points
     geofences/{geofenceId}             -> user-defined safe zones
     alerts/{pushId}                    -> generated alert/notification log
   ----------------------------------------------------------------------- */
const refs = {
  devices: db.ref("devices"),
  device: (id) => db.ref(`devices/${id}`),
  history: (id) => db.ref(`history/${id}`),
  geofences: db.ref("geofences"),
  alerts: db.ref("alerts")
};

/* -----------------------------------------------------------------------
   4. AUTH GUARD
   Every dashboard page (index, devices, history) calls requireAuth() so
   an unauthenticated visitor is bounced to login.html. login.html itself
   calls redirectIfAuthed() so a signed-in user skips the login form.
   ----------------------------------------------------------------------- */
function requireAuth(onReady) {
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    renderUserChip(user);
    if (typeof onReady === "function") onReady(user);
  });
}

function redirectIfAuthed() {
  auth.onAuthStateChanged((user) => {
    if (user) window.location.href = "index.html";
  });
}

function renderUserChip(user) {
  const nameEl = document.getElementById("userChipName");
  const avatarEl = document.getElementById("userChipAvatar");
  if (!nameEl) return;
  const label = user.displayName || user.email || "Operator";
  nameEl.textContent = label;
  if (avatarEl) avatarEl.textContent = label.charAt(0).toUpperCase();
}

function signOutUser() {
  auth.signOut().then(() => {
    window.location.href = "login.html";
  }).catch((err) => {
    console.error("Sign-out failed:", err);
  });
}

/* -----------------------------------------------------------------------
   5. SMALL SHARED UTILITIES (used by multiple modules)
   ----------------------------------------------------------------------- */

// Haversine distance between two lat/lng points, in kilometers.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function timeAgo(isoTimestamp) {
  if (!isoTimestamp) return "—";
  const diffMs = Date.now() - new Date(isoTimestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatDateTime(isoTimestamp) {
  if (!isoTimestamp) return "—";
  const d = new Date(isoTimestamp);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// A device is considered offline if its last update is older than this.
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function isDeviceStale(device) {
  if (!device || !device.timestamp) return true;
  return Date.now() - new Date(device.timestamp).getTime() > OFFLINE_THRESHOLD_MS;
}

// Expose everything on a single namespace so plain <script> tags on every
// page can share it without a module bundler.
window.GPSApp = window.GPSApp || {};
Object.assign(window.GPSApp, {
  auth, db, refs,
  requireAuth, redirectIfAuthed, signOutUser, renderUserChip,
  haversineKm, timeAgo, formatDateTime, isDeviceStale, OFFLINE_THRESHOLD_MS
});
