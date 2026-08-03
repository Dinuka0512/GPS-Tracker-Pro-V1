/* ==========================================================================
   history.js
   Drives history.html — pick a device and a date range, fetch its stored
   GPS points from Firebase, draw the historical route on the map, and
   compute trip statistics (distance, duration, avg/max speed).
   ========================================================================== */

const els = {};
let currentPoints = [];

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bindUI();
  GPSApp.requireAuth(() => {
    populateDeviceSelect();
    setDefaultDateRange();
    const preselect = new URLSearchParams(window.location.search).get("device");
    if (GPSApp.mapReady()) onMapReady(preselect);
    else document.addEventListener("gps:map-ready", () => onMapReady(preselect), { once: true });
  });
});

function onMapReady(preselectDeviceId) {
  if (preselectDeviceId) els.deviceSelect.value = preselectDeviceId;
  loadHistory();
}

function cacheEls() {
  els.deviceSelect = document.getElementById("historyDeviceSelect");
  els.startDate = document.getElementById("historyStartDate");
  els.endDate = document.getElementById("historyEndDate");
  els.loadBtn = document.getElementById("loadHistoryBtn");
  els.statDistance = document.getElementById("historyDistance");
  els.statDuration = document.getElementById("historyDuration");
  els.statAvgSpeed = document.getElementById("historyAvgSpeed");
  els.statMaxSpeed = document.getElementById("historyMaxSpeed");
  els.pointsTableBody = document.getElementById("historyTableBody");
  els.emptyState = document.getElementById("historyEmptyState");
}

function bindUI() {
  els.loadBtn?.addEventListener("click", loadHistory);
}

function populateDeviceSelect() {
  GPSApp.refs.devices.once("value").then((snap) => {
    const data = snap.val() || {};
    els.deviceSelect.innerHTML = Object.entries(data)
      .map(([id, d]) => `<option value="${id}">${escapeHTML(d.name)} (${d.type})</option>`)
      .join("");
  });
}

function setDefaultDateRange() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  els.endDate.value = toDateInputValue(today);
  els.startDate.value = toDateInputValue(weekAgo);
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

/* -----------------------------------------------------------------------
   Fetch + render
   ----------------------------------------------------------------------- */
function loadHistory() {
  const deviceId = els.deviceSelect.value;
  if (!deviceId) return;

  const startMs = new Date(`${els.startDate.value}T00:00:00`).getTime();
  const endMs = new Date(`${els.endDate.value}T23:59:59`).getTime();

  toggleLoading(true);

  GPSApp.refs
    .history(deviceId)
    .once("value")
    .then((snap) => {
      const data = snap.val() || {};
      currentPoints = Object.values(data)
        .filter((p) => {
          const t = new Date(p.timestamp).getTime();
          return t >= startMs && t <= endMs;
        })
        .map((p) => ({ lat: p.latitude, lng: p.longitude, speed: p.speed || 0, t: p.timestamp }))
        .sort((a, b) => new Date(a.t) - new Date(b.t));

      renderRoute();
      renderStats();
      renderTable();
      toggleLoading(false);
    })
    .catch((err) => {
      console.error("History load failed:", err);
      toggleLoading(false);
    });
}

function renderRoute() {
  if (els.emptyState) els.emptyState.style.display = currentPoints.length ? "none" : "block";
  GPSApp.drawHistoryRoute(currentPoints);
}

function renderStats() {
  let totalDistanceKm = 0;
  let maxSpeed = 0;
  let speedSum = 0;

  for (let i = 0; i < currentPoints.length; i++) {
    const p = currentPoints[i];
    maxSpeed = Math.max(maxSpeed, p.speed || 0);
    speedSum += p.speed || 0;
    if (i > 0) {
      totalDistanceKm += GPSApp.haversineKm(
        currentPoints[i - 1].lat, currentPoints[i - 1].lng, p.lat, p.lng
      );
    }
  }

  const avgSpeed = currentPoints.length ? speedSum / currentPoints.length : 0;
  const durationMs = currentPoints.length > 1
    ? new Date(currentPoints[currentPoints.length - 1].t) - new Date(currentPoints[0].t)
    : 0;

  if (els.statDistance) els.statDistance.textContent = `${totalDistanceKm.toFixed(1)} km`;
  if (els.statDuration) els.statDuration.textContent = formatDuration(durationMs);
  if (els.statAvgSpeed) els.statAvgSpeed.textContent = `${avgSpeed.toFixed(0)} km/h`;
  if (els.statMaxSpeed) els.statMaxSpeed.textContent = `${maxSpeed.toFixed(0)} km/h`;
}

function renderTable() {
  if (!els.pointsTableBody) return;
  if (!currentPoints.length) {
    els.pointsTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted)">No GPS points in this range.</td></tr>`;
    return;
  }
  els.pointsTableBody.innerHTML = currentPoints
    .slice(-100) // cap rows rendered for performance
    .reverse()
    .map((p) => `
      <tr>
        <td>${GPSApp.formatDateTime(p.t)}</td>
        <td>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</td>
        <td>${p.speed} km/h</td>
      </tr>`)
    .join("");
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

function toggleLoading(isLoading) {
  els.loadBtn.disabled = isLoading;
  els.loadBtn.textContent = isLoading ? "Loading…" : "Load history";
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
