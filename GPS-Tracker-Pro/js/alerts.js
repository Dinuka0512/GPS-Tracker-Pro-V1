/* ==========================================================================
   alerts.js
   Watches live device updates and raises alerts for:
     - low battery            (battery <= LOW_BATTERY_THRESHOLD)
     - device offline         (no update within OFFLINE_THRESHOLD_MS)
     - speed limit exceeded   (speed > SPEED_LIMIT_KMH)
     - geofence violation     (device exits/enters an active geofence)
   Alerts are pushed to Firebase (`alerts/`) for a persistent log and
   surfaced immediately as toast notifications in the UI.
   ========================================================================== */

const LOW_BATTERY_THRESHOLD = 20;
const SPEED_LIMIT_KMH = 100;

// In-memory de-dupe so we don't spam a toast every DB tick.
const alertCooldowns = {};       // `${deviceId}:${type}` -> timestamp of last toast
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const geofenceState = {};        // `${deviceId}:${geofenceId}` -> "inside" | "outside"
let geofences = [];

document.addEventListener("DOMContentLoaded", () => {
  ensureToastStack();
  loadGeofences();
});

function loadGeofences() {
  GPSApp.refs?.geofences?.on("value", (snap) => {
    const data = snap.val() || {};
    geofences = Object.entries(data).map(([id, g]) => ({ id, ...g }));
  });
}

/* -----------------------------------------------------------------------
   Main entry point — called by tracker.js on every device snapshot.
   ----------------------------------------------------------------------- */
function evaluateDevice(device, previous) {
  if (!device) return;

  checkLowBattery(device);
  checkOffline(device);
  checkSpeedLimit(device);
  checkGeofences(device);
}

function checkLowBattery(device) {
  if (device.battery != null && device.battery <= LOW_BATTERY_THRESHOLD) {
    raiseAlert(device, "battery", "warning",
      `${device.name} battery low`,
      `${device.battery}% remaining`);
  }
}

function checkOffline(device) {
  if (GPSApp.isDeviceStale(device)) {
    raiseAlert(device, "offline", "danger",
      `${device.name} went offline`,
      `Last seen ${GPSApp.timeAgo(device.timestamp)}`);
  }
}

function checkSpeedLimit(device) {
  if (device.speed != null && device.speed > SPEED_LIMIT_KMH) {
    raiseAlert(device, "speed", "danger",
      `${device.name} exceeding speed limit`,
      `${device.speed} km/h (limit ${SPEED_LIMIT_KMH} km/h)`);
  }
}

function checkGeofences(device) {
  if (!geofences.length || device.latitude == null) return;

  geofences
    .filter((g) => !g.deviceId || g.deviceId === device.deviceId)
    .forEach((g) => {
      const distKm = GPSApp.haversineKm(device.latitude, device.longitude, g.lat, g.lng);
      const isInside = distKm * 1000 <= g.radius;
      const key = `${device.deviceId}:${g.id}`;
      const prevState = geofenceState[key];

      if (prevState && prevState !== (isInside ? "inside" : "outside")) {
        if (isInside) {
          raiseAlert(device, "geofence", "warning", `${device.name} entered ${g.name}`, "Geofence entry");
        } else {
          raiseAlert(device, "geofence", "danger", `${device.name} left ${g.name}`, "Geofence exit");
        }
      }
      geofenceState[key] = isInside ? "inside" : "outside";
    });
}

/* -----------------------------------------------------------------------
   Alert dispatch: log to Firebase + show a toast (rate-limited per type).
   ----------------------------------------------------------------------- */
function raiseAlert(device, type, severity, title, message) {
  const key = `${device.deviceId}:${type}:${message}`;
  const now = Date.now();
  if (alertCooldowns[key] && now - alertCooldowns[key] < COOLDOWN_MS) return;
  alertCooldowns[key] = now;

  showToast(severity, title, message);
  bumpAlertBadge();

  GPSApp.refs?.alerts?.push({
    deviceId: device.deviceId,
    deviceName: device.name,
    type, severity, title, message,
    timestamp: new Date().toISOString(),
    read: false
  }).catch((err) => console.error("Failed to log alert:", err));
}

function ensureToastStack() {
  if (document.getElementById("toastStack")) return;
  const mainView = document.querySelector(".main-view") || document.body;
  const stack = document.createElement("div");
  stack.className = "toast-stack";
  stack.id = "toastStack";
  mainView.appendChild(stack);
}

function showToast(severity, title, message) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  const toast = document.createElement("div");
  toast.className = `toast ${severity}`;
  toast.innerHTML = `
    ${iconForSeverity(severity)}
    <div>
      <strong>${escapeHTML(title)}</strong>
      <p>${escapeHTML(message)}</p>
    </div>
    <button class="toast-close" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => toast.remove());
  stack.prepend(toast);

  setTimeout(() => toast.remove(), 8000);
  // Keep the stack from growing unbounded on screen.
  while (stack.children.length > 5) stack.removeChild(stack.lastChild);
}

function iconForSeverity(severity) {
  if (severity === "danger") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4M12 16h.01"/><circle cx="12" cy="12" r="9"/></svg>`;
}

function bumpAlertBadge() {
  const badge = document.getElementById("notifBadge");
  if (badge) badge.style.display = "block";
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

window.GPSApp = window.GPSApp || {};
GPSApp.Alerts = { evaluateDevice };
