/* ==========================================================================
   map.js
   Owns the Leaflet + OpenStreetMap map instance and everything drawn on it:
   device markers (with a live "signal pulse" animation), route trail
   polylines, geofence circles, and the historical-route rendering used by
   history.html. No API key required — tiles come from OpenStreetMap/CARTO.
   ========================================================================== */

const TYPE_COLORS = {
  vehicle: "#ff3b3b",
  human: "#ffffff",
  pet: "#c0c0c0",
  asset: "#ff7a7a"
};

const TYPE_ICON_PATHS = {
  // Simple glyph paths (24x24 viewBox) used inside marker pins.
  vehicle: "M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z M6.5 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17.5 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  human: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 21v-1c0-3.3 3.1-6 7-6s7 2.7 7 6v1",
  pet: "M4.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z M9.3 7.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z M14.7 7.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z M19.5 9.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z M12 21c-3 0-6-1.7-6-4.8 0-2 2.2-4.2 2.2-4.2s.9 1 3.8 1 3.8-1 3.8-1 2.2 2.2 2.2 4.2c0 3.1-3 4.8-6 4.8z",
  asset: "M12 2 3 6.5V12c0 5 3.8 8.7 9 10 5.2-1.3 9-5 9-10V6.5L12 2z"
};

let map;
const markerOverlays = {};   // deviceId -> L.Marker
const trailPolylines = {};   // deviceId -> L.Polyline
const trailPointMarkers = {};   // deviceId -> L.Marker[] (dot at each trail point)
const geofenceCircles = {};  // geofenceId -> L.Circle
let historyPolyline = null;
let historyStartMarker = null;
let historyEndMarker = null;

// Dark "command center" tile layer (CARTO basemap) — no API key required.
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* -----------------------------------------------------------------------
   initMap — called once Leaflet is loaded. Dispatches "gps:map-ready" so
   tracker.js / history.js know the map is safe to draw on.
   ----------------------------------------------------------------------- */
function initMap() {
  const defaultCenter = [6.9271, 79.8612]; // Colombo, LK — sensible default
  const WORLD_BOUNDS = [[-85, -180], [85, 180]]; // one Earth only — no tiling/repeats
  map = L.map(document.getElementById("map"), {
    center: defaultCenter,
    zoom: 12,
    zoomControl: false,
    minZoom: 3,
    maxZoom: 18,
    maxBounds: WORLD_BOUNDS,
    maxBoundsViscosity: 1.0
  });
  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    maxZoom: 20,
    noWrap: true
  }).addTo(map);

  document.dispatchEvent(new CustomEvent("gps:map-ready"));
}

// Build a CSS-driven pulsing marker (reuses the pulseRing animation in
// style.css) so no static marker bitmap is needed.
function createMarkerIcon(type) {
  const color = TYPE_COLORS[type] || TYPE_COLORS.vehicle;
  const iconPath = TYPE_ICON_PATHS[type] || TYPE_ICON_PATHS.vehicle;
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:38px;height:38px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};
                    opacity:0.55;animation:pulseRing 2.2s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <div style="position:absolute;inset:6px;border-radius:50%;background:${color};
                    box-shadow:0 0 12px ${color},0 2px 6px rgba(0,0,0,0.4);
                    display:flex;align-items:center;justify-content:center;
                    border:2px solid rgba(10,14,22,0.9);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="${iconPath}"></path>
          </svg>
        </div>
      </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

/* -----------------------------------------------------------------------
   Marker + trail management
   ----------------------------------------------------------------------- */
function upsertDeviceMarker(device) {
  if (!map || device.latitude == null || device.longitude == null) return;
  const latLng = [device.latitude, device.longitude];

  if (markerOverlays[device.deviceId]) {
    animateMarkerTo(markerOverlays[device.deviceId], latLng);
  } else {
    const marker = L.marker(latLng, { icon: createMarkerIcon(device.type) }).addTo(map);
    markerOverlays[device.deviceId] = marker;
  }
}

// Smoothly interpolate the marker between its old and new position rather
// than snapping, so live movement reads as continuous motion.
function animateMarkerTo(marker, newPos) {
  const start = marker.getLatLng();
  const startLat = start.lat, startLng = start.lng;
  const endLat = newPos[0], endLng = newPos[1];
  const durationMs = 900;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad
    const lat = startLat + (endLat - startLat) * ease;
    const lng = startLng + (endLng - startLng) * ease;
    marker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function removeDeviceMarker(deviceId) {
  if (markerOverlays[deviceId]) {
    map.removeLayer(markerOverlays[deviceId]);
    delete markerOverlays[deviceId];
  }
  if (trailPolylines[deviceId]) {
    map.removeLayer(trailPolylines[deviceId]);
    delete trailPolylines[deviceId];
  }
  clearTrailPointMarkers(deviceId);
}

// Remove every point dot for a device's trail.
function clearTrailPointMarkers(deviceId) {
  (trailPointMarkers[deviceId] || []).forEach((m) => map.removeLayer(m));
  delete trailPointMarkers[deviceId];
}

// Draws/updates the last-N-points route trail for a device as a
// point-by-point line: a red polyline connecting a small dot at each
// recorded location (0----0----0----0).
function drawTrail(deviceId, points, colorType) {
  const color = TYPE_COLORS[colorType] || TYPE_COLORS.vehicle;
  const latLngs = points.map((p) => [p.lat, p.lng]);

  if (trailPolylines[deviceId]) {
    trailPolylines[deviceId].setLatLngs(latLngs);
  } else {
    trailPolylines[deviceId] = L.polyline(latLngs, {
      color,
      opacity: 0.85,
      weight: 3
    }).addTo(map);
  }

  // Point-by-point dots: one marker at each past location so the route is
  // shown as 0----0----0----0 rather than just a bare line.
  clearTrailPointMarkers(deviceId);
  trailPointMarkers[deviceId] = points.map((p, i) => {
    const isFirst = i === 0;
    const isCurrent = i === points.length - 1;
    const dotColor = isCurrent ? color : "rgba(255,255,255,0.85)";
    const size = isCurrent ? 14 : 9;
    const html = `
      <div style="width:${size}px;height:${size}px;border-radius:50%;
                  background:${dotColor};border:2px solid #0a0a0a;
                  box-shadow:${isCurrent ? `0 0 10px ${color}` : "none"};"></div>`;
    return L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      interactive: false
    }).addTo(map);
  });
}

function panTo(lat, lng, zoom) {
  if (!map) return;
  map.setView([lat, lng], zoom || map.getZoom());
}

function zoomIn() {
  if (map) map.zoomIn();
}

function zoomOut() {
  if (map) map.zoomOut();
}

function fitToAllMarkers() {
  const ids = Object.keys(markerOverlays);
  if (!ids.length || !map) return;
  const bounds = L.latLngBounds();
  ids.forEach((id) => bounds.extend(markerOverlays[id].getLatLng()));
  map.fitBounds(bounds, { padding: [80, 80] });
}

/* -----------------------------------------------------------------------
   Geofences
   ----------------------------------------------------------------------- */
function addGeofenceCircle(geofence) {
  if (geofenceCircles[geofence.id]) map.removeLayer(geofenceCircles[geofence.id]);
  geofenceCircles[geofence.id] = L.circle([geofence.lat, geofence.lng], {
    radius: geofence.radius,
    color: "#ff3b3b",
    opacity: 0.7,
    weight: 2,
    fillColor: "#ff3b3b",
    fillOpacity: 0.1
  }).addTo(map);
}

function removeGeofenceCircle(id) {
  if (geofenceCircles[id]) {
    map.removeLayer(geofenceCircles[id]);
    delete geofenceCircles[id];
  }
}

function clearAllGeofences() {
  Object.keys(geofenceCircles).forEach(removeGeofenceCircle);
}

/* -----------------------------------------------------------------------
   History playback rendering (history.html)
   ----------------------------------------------------------------------- */
function drawHistoryRoute(points) {
  if (historyPolyline) map.removeLayer(historyPolyline);
  if (historyStartMarker) map.removeLayer(historyStartMarker);
  if (historyEndMarker) map.removeLayer(historyEndMarker);
  if (historyPointMarker) map.removeLayer(historyPointMarker);
  clearHistoryPointDots();
  historyPolyline = historyStartMarker = historyEndMarker = historyPointMarker = null;
  historyPoints = points;
  if (!points.length) return;

  const latLngs = points.map((p) => [p.lat, p.lng]);

  historyPolyline = L.polyline(latLngs, {
    color: "#ff3b3b",
    opacity: 0.9,
    weight: 4
  }).addTo(map);

  // Point-by-point dots so the route reads as 0----0----0----0 and each
  // recorded location is visible. If there are many points, step through
  // them so the dots stay clear instead of piling up.
  const MAX_DOTS = 80;
  const step = Math.max(1, Math.ceil(points.length / MAX_DOTS));
  const dot = L.divIcon({
    className: "",
    html: '<div style="width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,0.85);border:2px solid #0a0a0a;"></div>',
    iconSize: [9, 9],
    iconAnchor: [4.5, 4.5]
  });
  historyPointDots = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const m = L.marker([p.lat, p.lng], { icon: dot, interactive: false }).addTo(map);
    historyPointDots.push(m);
  }

  // Click the route line -> alert the time of the nearest recorded point.
  historyPolyline.on("click", onHistoryLineClick);

  historyStartMarker = L.marker(latLngs[0], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:22px;height:22px;border-radius:50%;background:#ffffff;color:#0a0a0a;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #0a0a0a;">A</div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(map);

  historyEndMarker = L.marker(latLngs[latLngs.length - 1], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:22px;height:22px;border-radius:50%;background:#ff2020;color:#ffffff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #0a0a0a;">B</div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(map);

  map.fitBounds(L.latLngBounds(latLngs), { padding: [60, 60] });
}

let historyPointMarker = null;
let historyPoints = [];
let historyPointDots = [];

// Remove the per-point dots drawn for a history route.
function clearHistoryPointDots() {
  (historyPointDots || []).forEach((m) => map.removeLayer(m));
  historyPointDots = [];
}

// Click on the route line: find the nearest recorded point and "alert" its
// time (popup + marker), then notify history.js so the table row highlights.
function onHistoryLineClick(e) {
  if (!historyPoints.length) return;
  let nearest = historyPoints[0];
  let minDist = Infinity;
  historyPoints.forEach((p) => {
    const d = (p.lat - e.latlng.lat) ** 2 + (p.lng - e.latlng.lng) ** 2;
    if (d < minDist) { minDist = d; nearest = p; }
  });
  markHistoryPoint(nearest.lat, nearest.lng);
  L.popup()
    .setLatLng([nearest.lat, nearest.lng])
    .setContent(`
      <div class="history-point-popup">
        <div class="hpp-time">${new Date(nearest.t).toLocaleString()}</div>
        <div class="hpp-meta">${nearest.lat.toFixed(5)}, ${nearest.lng.toFixed(5)}</div>
        <div class="hpp-meta">${nearest.speed || 0} km/h</div>
      </div>`)
    .openOn(map);
  document.dispatchEvent(new CustomEvent("gps:history-point-selected", { detail: nearest }));
}

// Drop a marker on a specific history point and center the map on it.
function markHistoryPoint(lat, lng, zoom) {
  if (!map) return;
  if (historyPointMarker) map.removeLayer(historyPointMarker);
  historyPointMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: "",
      html: '<div style="width:26px;height:26px;border-radius:50%;background:#ff3b3b;border:3px solid #fff;box-shadow:0 0 14px rgba(255,59,59,0.9);"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    })
  }).addTo(map);
  map.setView([lat, lng], zoom || 16);
}

/* -----------------------------------------------------------------------
   Boot — the #map element is already in the DOM (scripts run at the end of
   <body>), so we can init immediately once the page finishes parsing.
   ----------------------------------------------------------------------- */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}

window.GPSApp = window.GPSApp || {};
Object.assign(window.GPSApp, {
  initMap,
  mapReady: () => !!map,
  upsertDeviceMarker, removeDeviceMarker, drawTrail,
  panTo, zoomIn, zoomOut, fitToAllMarkers,
  addGeofenceCircle, removeGeofenceCircle, clearAllGeofences,
  drawHistoryRoute, markHistoryPoint,
  TYPE_COLORS
});
