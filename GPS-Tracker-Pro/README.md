# GPS Tracker Pro

A real-time GPS tracking dashboard for vehicles, people, pets, assets, and
IoT tracking devices — built with plain HTML5/CSS3/JavaScript, Leaflet with
OpenStreetMap tiles, and Firebase (Realtime Database + Authentication).

## Features

- **Live tracking dashboard** — animated markers, last 30-point route trails,
  auto map centering, multi-device view.
- **Device management** — add/edit/delete vehicle, human, pet, and asset
  trackers.
- **History module** — pick a device + date range, replay the route, and see
  distance / duration / avg speed / max speed.
- **Geofencing** — circular safe zones with enter/exit alerts.
- **Alerts** — low battery, offline device, speed limit exceeded, geofence
  violation, surfaced as toasts and logged to `alerts/` in the database.
- **Firebase Authentication** — email/password sign-in gates every dashboard
  page.

## 1. Configure Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create a **Realtime Database** (not Firestore) in your preferred region.
4. Under Project Settings → General → Your apps, register a Web app and copy
   the config object into `js/firebase.js`:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

5. Set Realtime Database rules (require sign-in, reject writes from
   unauthenticated clients) — a starting point:

```json
{
  "rules": {
    "devices": { ".read": "auth != null", ".write": "auth != null" },
    "history": { ".read": "auth != null", ".write": "auth != null" },
    "geofences": { ".read": "auth != null", ".write": "auth != null" },
    "alerts": { ".read": "auth != null", ".write": "auth != null" }
  }
}
```

## 2. Map tiles (OpenStreetMap + Leaflet)

The dashboard renders with **Leaflet** and free **OpenStreetMap / CARTO** tiles
loaded from the CDN — no API key or billing required. Leaflet is loaded in
`index.html` and `history.html` via `unpkg.com/leaflet@1.9.4`, and `js/map.js`
owns the map, markers, trails, and geofence circles. To use your own tile
provider, change `TILE_URL` in `js/map.js`.

## 3. Data model

```
devices/{deviceId}
  deviceId, name, type (vehicle|human|pet|asset)
  latitude, longitude, speed, battery, status, timestamp

history/{deviceId}/{pushId}
  latitude, longitude, speed, timestamp

geofences/{geofenceId}
  name, deviceId (optional — omit to apply to all devices)
  lat, lng, radius (meters), active

alerts/{pushId}
  deviceId, deviceName, type, severity, title, message, timestamp, read
```

A tracking device (or a simulator/backend) should periodically write to
`devices/{deviceId}` **and** push a copy into `history/{deviceId}` so the
route trail and history page have data to draw from, e.g.:

```js
const point = { latitude, longitude, speed, battery, status: "online",
                 timestamp: new Date().toISOString() };
db.ref(`devices/${deviceId}`).update({ deviceId, name, type, ...point });
db.ref(`history/${deviceId}`).push(point);
```

## 4. Run

This is a static site — no build step. Serve the folder with any static
server (Firebase Hosting, `npx serve`, VS Code Live Server, etc.) since
`file://` URLs can break the tile layer and Firebase Auth redirects.

## 5. Project structure

```
GPS-Tracker-Pro/
├── index.html      Live tracking dashboard
├── devices.html    Device + geofence management
├── history.html    Historical route playback & trip stats
├── login.html       Firebase Authentication sign-in
├── css/style.css     Design system (dark, glassmorphism)
└── js/
    ├── firebase.js   Firebase init, auth guard, shared utilities
    ├── map.js        Leaflet map, markers, trails, geofence circles
    ├── tracker.js     Live dashboard logic
    ├── devices.js     Device / geofence CRUD
    ├── history.js     History query + trip statistics
    └── alerts.js      Alert detection, toasts, notification log
```
