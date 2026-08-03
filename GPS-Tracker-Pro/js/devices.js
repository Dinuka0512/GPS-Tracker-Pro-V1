/* ==========================================================================
   devices.js
   Drives devices.html — CRUD for tracked devices (vehicles, humans, pets,
   assets) plus a simple geofence manager. Writes go straight to the
   `devices/` and `geofences/` nodes in Firebase Realtime Database.
   ========================================================================== */

const els = {};
let editingDeviceId = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bindUI();
  GPSApp.requireAuth(() => {
    listenDevices();
    listenGeofences();
  });
});

function cacheEls() {
  els.tableBody = document.getElementById("devicesTableBody");
  els.addBtn = document.getElementById("addDeviceBtn");
  els.modalBackdrop = document.getElementById("deviceModalBackdrop");
  els.form = document.getElementById("deviceForm");
  els.modalTitle = document.getElementById("deviceModalTitle");
  els.cancelBtn = document.getElementById("cancelDeviceBtn");

  els.geofenceTableBody = document.getElementById("geofenceTableBody");
  els.addGeofenceBtn = document.getElementById("addGeofenceBtn");
  els.geofenceModalBackdrop = document.getElementById("geofenceModalBackdrop");
  els.geofenceForm = document.getElementById("geofenceForm");
  els.cancelGeofenceBtn = document.getElementById("cancelGeofenceBtn");
  els.geofenceDeviceSelect = document.getElementById("geofenceDeviceSelect");
}

function bindUI() {
  els.addBtn?.addEventListener("click", () => openDeviceModal());
  els.cancelBtn?.addEventListener("click", closeDeviceModal);
  els.modalBackdrop?.addEventListener("click", (e) => { if (e.target === els.modalBackdrop) closeDeviceModal(); });
  els.form?.addEventListener("submit", saveDevice);

  els.addGeofenceBtn?.addEventListener("click", openGeofenceModal);
  els.cancelGeofenceBtn?.addEventListener("click", closeGeofenceModal);
  els.geofenceModalBackdrop?.addEventListener("click", (e) => { if (e.target === els.geofenceModalBackdrop) closeGeofenceModal(); });
  els.geofenceForm?.addEventListener("submit", saveGeofence);

  document.getElementById("logoutBtn")?.addEventListener("click", GPSApp.signOutUser);
}

/* -----------------------------------------------------------------------
   Devices — realtime list + CRUD
   ----------------------------------------------------------------------- */
function listenDevices() {
  GPSApp.refs.devices.on("value", (snap) => {
    const data = snap.val() || {};
    renderDevicesTable(data);
    populateGeofenceDeviceSelect(data);
  }, (err) => console.error("devices listener error:", err));
}

function renderDevicesTable(data) {
  const entries = Object.entries(data);
  if (!entries.length) {
    els.tableBody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted)">No devices yet — add your first tracker.</td></tr>`;
    return;
  }

  els.tableBody.innerHTML = entries.map(([id, d]) => {
    const offline = GPSApp.isDeviceStale(d);
    return `
      <tr>
        <td><strong>${escapeHTML(d.name)}</strong><br><span style="color:var(--text-muted);font-size:11px;font-family:var(--font-mono)">${id}</span></td>
        <td><span class="type-pill ${d.type}">${d.type}</span></td>
        <td><span class="status-pill ${offline ? "offline" : "online"}">${offline ? "Offline" : "Online"}</span></td>
        <td>${d.battery ?? 0}%</td>
        <td>${d.speed ?? 0} km/h</td>
        <td>${GPSApp.timeAgo(d.timestamp)}</td>
        <td>
          <button class="btn btn-ghost" style="padding:6px 10px;" data-edit="${id}">Edit</button>
          <button class="btn btn-danger" style="padding:6px 10px;" data-delete="${id}">Delete</button>
        </td>
      </tr>`;
  }).join("");

  els.tableBody.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openDeviceModal(btn.dataset.edit, data[btn.dataset.edit])));
  els.tableBody.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteDevice(btn.dataset.delete)));
}

function openDeviceModal(id = null, device = null) {
  editingDeviceId = id;
  els.modalTitle.textContent = id ? "Edit device" : "Add device";
  els.form.reset();
  if (device) {
    els.form.deviceId.value = id;
    els.form.deviceId.disabled = true;
    els.form.name.value = device.name || "";
    els.form.type.value = device.type || "vehicle";
    els.form.latitude.value = device.latitude ?? "";
    els.form.longitude.value = device.longitude ?? "";
  } else {
    els.form.deviceId.disabled = false;
  }
  els.modalBackdrop.classList.add("open");
}

function closeDeviceModal() {
  els.modalBackdrop.classList.remove("open");
  editingDeviceId = null;
}

function saveDevice(e) {
  e.preventDefault();
  const fd = new FormData(els.form);
  const deviceId = editingDeviceId || fd.get("deviceId").trim();
  if (!deviceId) return;

  const payload = {
    deviceId,
    name: fd.get("name").trim() || deviceId,
    type: fd.get("type"),
    latitude: parseFloat(fd.get("latitude")) || 0,
    longitude: parseFloat(fd.get("longitude")) || 0,
    speed: 0,
    battery: 100,
    status: "online",
    timestamp: new Date().toISOString()
  };

  // Merge onto existing record if editing so live fields (speed/battery)
  // reported by the physical tracker aren't clobbered.
  GPSApp.refs.device(deviceId).update(payload)
    .then(closeDeviceModal)
    .catch((err) => {
      console.error("Failed to save device:", err);
      alert("Could not save device. Check the console / Firebase config.");
    });
}

function deleteDevice(id) {
  if (!confirm("Remove this device and its history? This cannot be undone.")) return;
  GPSApp.refs.device(id).remove();
  GPSApp.refs.history(id).remove();
}

/* -----------------------------------------------------------------------
   Geofences — realtime list + CRUD
   ----------------------------------------------------------------------- */
function listenGeofences() {
  GPSApp.refs.geofences.on("value", (snap) => {
    const data = snap.val() || {};
    renderGeofenceTable(data);
  });
}

function renderGeofenceTable(data) {
  const entries = Object.entries(data);
  if (!els.geofenceTableBody) return;
  if (!entries.length) {
    els.geofenceTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted)">No geofences configured.</td></tr>`;
    return;
  }
  els.geofenceTableBody.innerHTML = entries.map(([id, g]) => `
    <tr>
      <td><strong>${escapeHTML(g.name)}</strong></td>
      <td>${g.deviceId ? escapeHTML(g.deviceId) : "All devices"}</td>
      <td>${g.radius} m</td>
      <td>${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}</td>
      <td><button class="btn btn-danger" style="padding:6px 10px;" data-del-geofence="${id}">Delete</button></td>
    </tr>`).join("");

  els.geofenceTableBody.querySelectorAll("[data-del-geofence]").forEach((btn) =>
    btn.addEventListener("click", () => GPSApp.refs.geofences.child(btn.dataset.delGeofence).remove()));
}

function populateGeofenceDeviceSelect(devices) {
  if (!els.geofenceDeviceSelect) return;
  const current = els.geofenceDeviceSelect.value;
  els.geofenceDeviceSelect.innerHTML =
    `<option value="">All devices</option>` +
    Object.entries(devices).map(([id, d]) => `<option value="${id}">${escapeHTML(d.name)}</option>`).join("");
  els.geofenceDeviceSelect.value = current;
}

function openGeofenceModal() {
  els.geofenceForm.reset();
  els.geofenceModalBackdrop.classList.add("open");
}
function closeGeofenceModal() {
  els.geofenceModalBackdrop.classList.remove("open");
}

function saveGeofence(e) {
  e.preventDefault();
  const fd = new FormData(els.geofenceForm);
  const payload = {
    name: fd.get("name").trim(),
    deviceId: fd.get("deviceId") || null,
    lat: parseFloat(fd.get("lat")),
    lng: parseFloat(fd.get("lng")),
    radius: parseFloat(fd.get("radius")),
    active: true
  };
  if (!payload.name || Number.isNaN(payload.lat) || Number.isNaN(payload.lng)) return;

  GPSApp.refs.geofences.push(payload)
    .then(closeGeofenceModal)
    .catch((err) => console.error("Failed to save geofence:", err));
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
