/* ==========================================================================
   tracker.js
   Drives index.html — the live tracking dashboard. Subscribes to Firebase
   Realtime Database for device snapshots + history points, keeps the
   sidebar / map / floating cards in sync, and hands off to alerts.js
   whenever a device crosses a threshold (battery, offline, speed).
   ========================================================================== */

const TRAIL_LENGTH = 5; // last N points drawn per device

const state = {
  devices: {},          // deviceId -> device object
  selectedDeviceId: null,
  activeFilter: "all",  // all | vehicle | human | pet | asset
  searchTerm: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bindUI();
  GPSApp.requireAuth(() => start());
});

function cacheEls() {
  els.deviceList = document.getElementById("deviceList");
  els.deviceCount = document.getElementById("deviceCount");
  els.searchInput = document.getElementById("searchInput");
  els.filterChips = document.querySelectorAll(".filter-chip");
  els.statOnline = document.getElementById("statOnline");
  els.statTotal = document.getElementById("statTotal");
  els.statAvgSpeed = document.getElementById("statAvgSpeed");
  els.statAlerts = document.getElementById("statAlerts");
  els.detailCard = document.getElementById("deviceDetailCard");
  els.loadingOverlay = document.getElementById("loadingOverlay");
  els.mobileAlerts = document.getElementById("mobileAlerts");
  els.sidebar = document.querySelector(".sidebar");
}

function bindUI() {
  els.searchInput?.addEventListener("input", (e) => {
    state.searchTerm = e.target.value.trim().toLowerCase();
    renderDeviceList();
  });

  els.filterChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      els.filterChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeFilter = chip.dataset.filter;
      renderDeviceList();
    });
  });

  document.getElementById("closeDetailBtn")?.addEventListener("click", () => {
    state.selectedDeviceId = null;
    els.detailCard.classList.remove("open");
    renderDeviceList();
  });

  document.getElementById("zoomInBtn")?.addEventListener("click", () => GPSApp.zoomIn());
  document.getElementById("zoomOutBtn")?.addEventListener("click", () => GPSApp.zoomOut());

  document.getElementById("fitAllBtn")?.addEventListener("click", () => GPSApp.fitToAllMarkers());
}

/* -----------------------------------------------------------------------
   Startup: wait for both auth + Leaflet map to be ready, then attach the
   Firebase Realtime Database listener.
   ----------------------------------------------------------------------- */
function start() {
  // Safety net: never let the "acquiring signal" overlay block the map —
  // hide it even if no device data arrives (e.g. no auth / no data yet).
  setTimeout(hideLoading, 8000);

  const onMapReady = () => {
    attachDeviceListener();
    startOfflineWatchdog();
  };
  if (GPSApp.mapReady()) onMapReady();
  else document.addEventListener("gps:map-ready", onMapReady, { once: true });
}

function attachDeviceListener() {
  // 'value' gives us the full device list on every change — simplest model
  // for a moderate fleet size. For very large fleets, prefer child_added /
  // child_changed / child_removed instead.
  GPSApp.refs.devices.on(
    "value",
    (snapshot) => {
      const data = snapshot.val() || {};
      handleDevicesUpdate(data);
      hideLoading();
    },
    (error) => {
      console.error("Firebase devices listener error:", error);
      showConnectionError();
    }
  );
}

function handleDevicesUpdate(data) {
  const previousDevices = state.devices;
  state.devices = data;

  Object.entries(data).forEach(([id, device]) => {
    device.deviceId = device.deviceId || id;
    GPSApp.upsertDeviceMarker(device);
    fetchTrailFor(id, device.type);

    // Alert triggers — compare against previous snapshot to avoid repeats.
    const prev = previousDevices[id];
    GPSApp.Alerts?.evaluateDevice(device, prev);
  });

  // Remove markers for devices that disappeared from the DB.
  Object.keys(previousDevices).forEach((id) => {
    if (!data[id]) GPSApp.removeDeviceMarker(id);
  });

  renderDeviceList();
  renderMobileAlerts();
  renderStats();
  if (state.selectedDeviceId && data[state.selectedDeviceId]) {
    renderDetailCard(data[state.selectedDeviceId]);
  }
}

// Pull the last TRAIL_LENGTH history points for a device's route trail.
function fetchTrailFor(deviceId, type) {
  GPSApp.refs
    .history(deviceId)
    .limitToLast(TRAIL_LENGTH)
    .once("value")
    .then((snap) => {
      const val = snap.val() || {};
      const points = Object.values(val)
        .map((p) => ({ lat: p.latitude, lng: p.longitude, t: p.timestamp }))
        .sort((a, b) => new Date(a.t) - new Date(b.t));
      if (points.length > 1) GPSApp.drawTrail(deviceId, points, type);
    })
    .catch((err) => console.error(`History fetch failed for ${deviceId}:`, err));
}

/* -----------------------------------------------------------------------
   Offline watchdog — re-render every 15s so "last update" / offline
   badges stay accurate even without new Firebase events.
   ----------------------------------------------------------------------- */
function startOfflineWatchdog() {
  setInterval(() => {
    renderDeviceList();
    renderMobileAlerts();
    renderStats();
    if (state.selectedDeviceId && state.devices[state.selectedDeviceId]) {
      renderDetailCard(state.devices[state.selectedDeviceId]);
    }
  }, 15000);
}

/* -----------------------------------------------------------------------
   Rendering
   ----------------------------------------------------------------------- */
function getFilteredDevices() {
  return Object.values(state.devices).filter((d) => {
    const matchesFilter = state.activeFilter === "all" || d.type === state.activeFilter;
    const matchesSearch =
      !state.searchTerm ||
      d.name?.toLowerCase().includes(state.searchTerm) ||
      d.deviceId?.toLowerCase().includes(state.searchTerm);
    return matchesFilter && matchesSearch;
  });
}

function renderDeviceList() {
  if (!els.deviceList) return;
  const list = getFilteredDevices();
  els.deviceCount.textContent = Object.keys(state.devices).length;

  if (!list.length) {
    els.deviceList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>
        </svg>
        <p>No devices match this view</p>
      </div>`;
    return;
  }

  els.deviceList.innerHTML = list
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((d) => deviceCardHTML(d))
    .join("");

  els.deviceList.querySelectorAll(".device-card").forEach((card) => {
    card.addEventListener("click", () => selectDevice(card.dataset.id));
  });
}

function deviceCardHTML(d) {
  const offline = GPSApp.isDeviceStale(d);
  const battery = d.battery ?? 0;
  const batteryClass = battery <= 15 ? "critical" : battery <= 35 ? "low" : "";
  const selected = state.selectedDeviceId === d.deviceId ? "selected" : "";

  return `
    <div class="device-card type-${d.type} ${selected}" data-id="${d.deviceId}">
      <div class="device-icon-wrap">
        <div class="device-icon">${typeIconSVG(d.type)}</div>
        <div class="status-ring ${offline ? "offline" : "online"}"></div>
      </div>
      <div class="device-info">
        <div class="device-info-top">
          <span class="device-name">${escapeHTML(d.name)}</span>
          <span class="device-time">${GPSApp.timeAgo(d.timestamp)}</span>
        </div>
        <div class="device-meta">
          <span class="meta-item">⚡ ${d.speed ?? 0} km/h</span>
          <span class="battery-bar"><span class="battery-fill ${batteryClass}" style="width:${battery}%"></span></span>
          <span class="meta-item">${battery}%</span>
        </div>
        <div class="device-address">${(d.latitude ?? 0).toFixed(4)}, ${(d.longitude ?? 0).toFixed(4)}</div>
      </div>
    </div>`;
}

/* Mobile: device data shown as alert cards over the map (sidebar is hidden
   on phones). Tapping a card selects that device on the map. */
function renderMobileAlerts() {
  if (!els.mobileAlerts) return;
  const list = Object.values(state.devices);
  if (!list.length) {
    els.mobileAlerts.innerHTML = "";
    return;
  }

  els.mobileAlerts.innerHTML = list
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((d) => mobileAlertHTML(d))
    .join("");

  els.mobileAlerts.querySelectorAll(".mobile-alert-card").forEach((card) => {
    card.addEventListener("click", () => selectDevice(card.dataset.id));
  });
}

function mobileAlertHTML(d) {
  const offline = GPSApp.isDeviceStale(d);
  const battery = d.battery ?? 0;
  const batteryClass = battery <= 15 ? "critical" : battery <= 35 ? "low" : "";
  return `
    <div class="mobile-alert-card" data-id="${d.deviceId}">
      <div class="status-ring ${offline ? "offline" : "online"}"></div>
      <div class="mobile-alert-info">
        <div class="mobile-alert-name">
          <span>${escapeHTML(d.name)}</span>
          <span class="mobile-alert-time">${GPSApp.timeAgo(d.timestamp)}</span>
        </div>
        <div class="mobile-alert-meta">
          <span>⚡ ${d.speed ?? 0} km/h</span>
          <span class="battery-bar"><span class="battery-fill ${batteryClass}" style="width:${battery}%"></span></span>
          <span>${battery}%</span>
        </div>
        <div class="mobile-alert-coords">${(d.latitude ?? 0).toFixed(4)}, ${(d.longitude ?? 0).toFixed(4)}</div>
      </div>
    </div>`;
}

function typeIconSVG(type) {
  const icons = {
    vehicle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/><circle cx="6.5" cy="16.5" r="1.5"/><circle cx="17.5" cy="16.5" r="1.5"/></svg>`,
    human: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M5 21v-1c0-3.3 3.1-6 7-6s7 2.7 7 6v1"/></svg>`,
    pet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="4.5" cy="9.5" r="1.5"/><circle cx="9.3" cy="7.2" r="1.5"/><circle cx="14.7" cy="7.2" r="1.5"/><circle cx="19.5" cy="9.5" r="1.5"/><path d="M12 21c-3 0-6-1.7-6-4.8 0-2 2.2-4.2 2.2-4.2s.9 1 3.8 1 3.8-1 3.8-1 2.2 2.2 2.2 4.2c0 3.1-3 4.8-6 4.8z"/></svg>`,
    asset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 3 6.5V12c0 5 3.8 8.7 9 10 5.2-1.3 9-5 9-10V6.5L12 2z"/></svg>`
  };
  return icons[type] || icons.asset;
}

function selectDevice(id) {
  state.selectedDeviceId = id;
  const device = state.devices[id];
  if (!device) return;
  renderDeviceList();
  renderDetailCard(device);
  GPSApp.panTo(device.latitude, device.longitude, 15);
}

function renderDetailCard(d) {
  if (!els.detailCard) return;
  const offline = GPSApp.isDeviceStale(d);
  els.detailCard.classList.add("open");
  els.detailCard.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <div class="device-icon type-${d.type}" style="width:36px;height:36px;">${typeIconSVG(d.type)}</div>
        <div>
          <h3>${escapeHTML(d.name)}</h3>
          <span class="tag">${d.type} · ${d.deviceId}</span>
        </div>
      </div>
      <button class="close-btn" id="closeDetailBtn" aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Status</div><div class="value" style="color:${offline ? "var(--text-muted)" : "var(--green)"}">${offline ? "Offline" : "Online"}</div></div>
      <div class="detail-item"><div class="label">Speed</div><div class="value">${d.speed ?? 0} km/h</div></div>
      <div class="detail-item"><div class="label">Battery</div><div class="value">${d.battery ?? 0}%</div></div>
      <div class="detail-item"><div class="label">Updated</div><div class="value">${GPSApp.timeAgo(d.timestamp)}</div></div>
    </div>
    <div class="detail-coords">📍 ${(d.latitude ?? 0).toFixed(6)}, ${(d.longitude ?? 0).toFixed(6)}</div>
    <div class="btn-row">
      <button class="btn btn-primary" id="centerMapBtn">Center on map</button>
      <a class="btn btn-ghost" href="history.html?device=${d.deviceId}">View history</a>
    </div>
  `;
  document.getElementById("closeDetailBtn").addEventListener("click", () => {
    state.selectedDeviceId = null;
    els.detailCard.classList.remove("open");
    renderDeviceList();
  });
  document.getElementById("centerMapBtn").addEventListener("click", () => {
    GPSApp.panTo(d.latitude, d.longitude, 16);
  });
}

function renderStats() {
  const all = Object.values(state.devices);
  const online = all.filter((d) => !GPSApp.isDeviceStale(d));
  const avgSpeed = online.length
    ? Math.round(online.reduce((sum, d) => sum + (d.speed || 0), 0) / online.length)
    : 0;

  if (els.statOnline) els.statOnline.textContent = online.length;
  if (els.statTotal) els.statTotal.textContent = all.length;
  if (els.statAvgSpeed) els.statAvgSpeed.textContent = `${avgSpeed} km/h`;
}

function hideLoading() {
  els.loadingOverlay?.classList.add("hidden");
}

function showConnectionError() {
  if (!els.loadingOverlay) return;
  els.loadingOverlay.classList.remove("hidden");
  els.loadingOverlay.innerHTML = `
    <div class="radar-loader" style="border-color: rgba(255,77,94,0.2)"></div>
    <p style="color:var(--red)">Unable to reach the database — check your Firebase config in js/firebase.js</p>`;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

window.GPSApp = window.GPSApp || {};
Object.assign(window.GPSApp, { trackerState: state });
