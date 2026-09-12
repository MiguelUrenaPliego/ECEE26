// Santo Domingo relative-position map -- based on maps/template (same
// visual language / no-backend approach). Single fixed categorical
// attribute (relativePosition: isolated/lateral/corner/confined/torque),
// computed geometrically for every building via footprint_attributes'
// contact-force classification (code/footprint_attributes/position.py) --
// NOT the raw field-survey column, which only exists for buildings actually
// surveyed by hand (near-total coverage gap on Naco). See
// data/shape_parameters/prepare_shape_data.py, which writes this map's data
// too.
const { GeoJsonLayer } = deck;
const { MapboxOverlay } = deck;

const DATASETS = {
  quisquella: { label: "Ensanche Quisquella", dir: "../../data/relative_position/quisquella" },
  naco: { label: "Naco", dir: "../../data/relative_position/naco" },
};
const DEFAULT_DATASET = "quisquella";

const POSITION_COLORS = {
  isolated: "#4299e1",
  lateral: "#e2a33f",
  corner: "#4fbf8f",
  confined: "#8744ad",
  torque: "#c0392b",
  unlabeled: "#6b7280",
};
const POSITION_ORDER = ["isolated", "lateral", "corner", "confined", "torque", "unlabeled"];
const POSITION_LABELS = {
  isolated: "Isolated",
  lateral: "Lateral",
  corner: "Corner",
  confined: "Confined",
  torque: "Torque",
  unlabeled: "Unlabeled",
};

const DEFAULT_BUILDING_HEIGHT_M = 8;
const METRES_PER_FLOOR = 3;
const HEIGHT_EXAGGERATION = 2;
const SHOWCASE_PITCH = 55;
const SHOWCASE_IDLE_RESUME_MS = 30_000;
const SHOWCASE_ROTATE_DEG_PER_SEC = 2.2;

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const state = {
  datasetId: DEFAULT_DATASET,
  data: { type: "FeatureCollection", features: [] },
  datasetCenter: null,
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
};

const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const map = new maplibregl.Map({
  container: "map",
  style: DARK_STYLE,
  center: [-69.94, 18.46],
  zoom: 15,
  pitch: SHOWCASE_PITCH,
  bearing: 0,
  attributionControl: false,
});

map.addControl(new maplibregl.AttributionControl({ compact: true }));
// MapLibre's compact attribution starts expanded (<details open>) on
// initial load regardless of the compact flag -- force it closed so the
// "i" button is always collapsed on startup.
(() => {
  const attribEl = document.querySelector(".maplibregl-ctrl-attrib");
  if (!attribEl) return;
  attribEl.removeAttribute("open");
  const observer = new MutationObserver(() => attribEl.removeAttribute("open"));
  observer.observe(attribEl, { attributes: true, attributeFilter: ["open"] });
  setTimeout(() => observer.disconnect(), 5000);
})();

const overlay = new MapboxOverlay({ layers: [] });
map.addControl(overlay);

map.setMaxPitch(85); // MapLibre's default 60 is too flat for a presentation "look straight down the street" shot

// Middle-button drag: does exactly what right-button drag does (MapLibre's
// own dragRotate -- horizontal movement changes bearing, vertical movement
// changes pitch), so rotate/tilt is reachable from either button, not
// right-only. preventDefault stops the browser's auto-scroll on a bare
// middle-click.
map.getCanvas().addEventListener("mousedown", (event) => {
  if (event.button !== 1) return;
  event.preventDefault();
  registerUserInteraction();
  let lastX = event.clientX;
  let lastY = event.clientY;
  const onMouseMove = (moveEvent) => {
    const dx = moveEvent.clientX - lastX;
    const dy = moveEvent.clientY - lastY;
    lastX = moveEvent.clientX;
    lastY = moveEvent.clientY;
    map.setBearing((map.getBearing() - dx * 0.5) % 360);
    const nextPitch = Math.min(85, Math.max(0, map.getPitch() - dy * 0.5));
    map.setPitch(nextPitch);
  };
  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});

function computeBbox(collection) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords) => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(coords)) {
      coords.forEach(visit);
    }
  };
  for (const f of collection.features) {
    if (f.geometry && "coordinates" in f.geometry) visit(f.geometry.coordinates);
  }
  return [[minX, minY], [maxX, maxY]];
}

function isSelected(feature) {
  return feature.properties?.building_uid === state.selectedBuildingId;
}

function rawHeightMetres(feature) {
  const p = feature.properties ?? {};
  if (typeof p.height === "number") return p.height;
  if (typeof p.n_floors === "number") return p.n_floors * METRES_PER_FLOOR;
  return DEFAULT_BUILDING_HEIGHT_M;
}
let elevationClamp = Infinity;
function elevationClampFor(data) {
  if (data.features.length === 0) return Infinity;
  const heights = data.features.map(rawHeightMetres).sort((a, b) => a - b);
  return heights[Math.floor(0.95 * (heights.length - 1))];
}
function getElevation(feature) {
  return Math.min(rawHeightMetres(feature), elevationClamp) * HEIGHT_EXAGGERATION;
}

function positionKey(feature) {
  const value = feature.properties?.relativePosition;
  return value && POSITION_COLORS[value] ? value : "unlabeled";
}

function getFillColor(feature) {
  return [...hexToRgb(POSITION_COLORS[positionKey(feature)]), 210];
}
function getLineColor(feature) {
  return isSelected(feature) ? [...hexToRgb("#e2a33f"), 255] : [235, 235, 235, 90];
}
function getLineWidth(feature) {
  return isSelected(feature) ? 3 : 1;
}

let onBuildingClick = () => {};

function buildingTooltip({ object, layer }) {
  if (!object || layer?.id !== "buildings") return null;
  const label = POSITION_LABELS[positionKey(object)];
  return { html: `<div><strong>Relative position:</strong> ${label}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
}

function renderLayer() {
  const buildings = new GeoJsonLayer({
    id: "buildings",
    data: state.data,
    filled: true,
    stroked: true,
    pickable: true,
    extruded: state.is3D,
    getElevation,
    getFillColor,
    getLineColor,
    getLineWidth,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    updateTriggers: {
      getLineColor: [state.selectedBuildingId],
      getLineWidth: [state.selectedBuildingId],
      getElevation: [state.is3D],
    },
    onClick: (info) => {
      const id = info.object?.properties?.building_uid;
      if (id !== undefined && id !== null) onBuildingClick(String(id), info.object.properties);
    },
  });
  overlay.setProps({ layers: [buildings], getTooltip: buildingTooltip });
}

// ---------------------------------------------------------------------------
// Legend + chart.
function renderLegend() {
  const container = document.getElementById("legend");
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Relative position";
  container.appendChild(heading);

  const counts = {};
  for (const f of state.data.features) counts[positionKey(f)] = (counts[positionKey(f)] ?? 0) + 1;

  const list = document.createElement("ul");
  list.className = "legend-list";
  for (const key of POSITION_ORDER) {
    if (!counts[key]) continue;
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = POSITION_COLORS[key];
    const label = document.createElement("span");
    label.textContent = `${POSITION_LABELS[key]} (${counts[key]})`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  container.appendChild(list);
}

const CHART_WIDTH = 280;
const CHART_HEIGHT = 220;
const CHART_MARGIN = { top: 26, right: 6, bottom: 46, left: 34 };

function renderPositionChart() {
  const container = document.getElementById("position-count-chart");
  const counts = {};
  for (const f of state.data.features) counts[positionKey(f)] = (counts[positionKey(f)] ?? 0) + 1;
  const total = state.data.features.length;
  const entries = POSITION_ORDER.filter((k) => counts[k]).map((k) => ({ key: k, count: counts[k] }));

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...entries.map((e) => e.count));
  const barGap = 8;
  const barWidth = (plotWidth - barGap * (entries.length - 1)) / entries.length;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;

  let bars = "";
  let labels = "";
  entries.forEach((entry, i) => {
    const barHeight = (entry.count / maxCount) * plotHeight;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const pct = ((entry.count / total) * 100).toFixed(1);
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${POSITION_COLORS[entry.key]}" rx="3"></rect>`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 22}" text-anchor="middle" class="chart-bar-label"><tspan x="${x + barWidth / 2}" dy="0">${entry.count}</tspan><tspan x="${x + barWidth / 2}" dy="14">${pct}%</tspan></text>`;
    labels += `<text x="${x + barWidth / 2 + 4}" y="${plotBottom + 12}" text-anchor="end" class="chart-axis-label" transform="rotate(-40 ${x + barWidth / 2 + 4} ${plotBottom + 12})">${POSITION_LABELS[entry.key]}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(maxCount * t)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${CHART_MARGIN.left}" y1="${plotBottom}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${bars}
    ${labels}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Building popup -- this map is about relative_position, so that's the only
// column shown.
function renderBuildingPanel(id, properties) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  content.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = `Building ${id}`;
  content.appendChild(heading);

  const table = document.createElement("table");
  table.className = "building-summary";
  const tbody = document.createElement("tbody");
  const row = document.createElement("tr");
  const th = document.createElement("th");
  th.textContent = "Relative position";
  const td = document.createElement("td");
  td.textContent = POSITION_LABELS[positionKey({ properties })];
  row.append(th, td);
  tbody.appendChild(row);
  table.appendChild(tbody);
  content.appendChild(table);
  panel.classList.remove("hidden");
}
function closeBuildingPanel() {
  document.getElementById("building-panel").classList.add("hidden");
  state.selectedBuildingId = null;
  renderLayer();
}
function selectBuilding(id, properties) {
  state.selectedBuildingId = id;
  renderLayer();
  renderBuildingPanel(id, properties);
}
onBuildingClick = selectBuilding;

// ---------------------------------------------------------------------------
// Dataset switching.
let datasetDropdown = null;

async function loadDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const buildings = await fetch(`${dir}/buildings.geojson`).then((r) => r.json());
  state.datasetId = datasetId;
  state.data = buildings;
  elevationClamp = elevationClampFor(buildings);

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };

  renderLegend();
  renderPositionChart();
  renderLayer();
}

async function setDataset(datasetId, { fromShowcase = false } = {}) {
  await loadDataset(datasetId);
  datasetDropdown?.setValue(datasetId);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: fromShowcase ? 0 : 500 });
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

function createDropdown(container, options, onChange) {
  container.innerHTML = "";
  container.classList.add("dropdown");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dropdown-toggle";
  const valueEl = document.createElement("span");
  valueEl.className = "dropdown-value";
  toggle.appendChild(valueEl);
  const caret = document.createElement("span");
  caret.className = "dropdown-caret";
  caret.textContent = "▾";
  toggle.appendChild(caret);

  const list = document.createElement("ul");
  list.className = "dropdown-list";
  list.hidden = true;

  function renderOptions(current) {
    list.innerHTML = "";
    for (const option of options) {
      const item = document.createElement("li");
      item.textContent = option.label;
      if (option.value === current) item.classList.add("selected");
      item.addEventListener("click", () => {
        onChange(option.value);
        close();
      });
      list.appendChild(item);
    }
  }
  function close() {
    list.hidden = true;
    container.removeAttribute("data-open");
  }
  function open() {
    list.hidden = false;
    container.setAttribute("data-open", "");
  }
  toggle.addEventListener("click", () => (list.hidden ? open() : close()));
  document.addEventListener("click", (event) => {
    if (!container.contains(event.target)) close();
  });

  container.append(toggle, list);
  renderOptions(options[0]?.value);

  return {
    setValue(value) {
      const option = options.find((o) => o.value === value);
      if (option) valueEl.textContent = option.label;
      renderOptions(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Showcase mode: orbit the dataset center in 3D. Single fixed attribute, so
// nothing to cycle -- unlike the base template/shape-parameters map.
let showcaseRotateFrame = null;
let showcaseIdleTimer = null;

function startShowcase() {
  if (state.showcaseActive) return;
  state.showcaseActive = true;

  if (state.is3D) {
    const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
    map.jumpTo({ center: [(minX + maxX) / 2, (minY + maxY) / 2] });
    let lastFrameTime = performance.now();
    const rotate = (now) => {
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      map.setBearing((map.getBearing() + SHOWCASE_ROTATE_DEG_PER_SEC * dt) % 360);
      showcaseRotateFrame = requestAnimationFrame(rotate);
    };
    showcaseRotateFrame = requestAnimationFrame(rotate);
  }
}

function stopShowcase({ resumeAfterIdle = true } = {}) {
  if (showcaseRotateFrame !== null) cancelAnimationFrame(showcaseRotateFrame);
  showcaseRotateFrame = null;
  state.showcaseActive = false;

  if (showcaseIdleTimer !== null) clearTimeout(showcaseIdleTimer);
  if (resumeAfterIdle) showcaseIdleTimer = setTimeout(startShowcase, SHOWCASE_IDLE_RESUME_MS);
}
function registerUserInteraction() {
  stopShowcase({ resumeAfterIdle: true });
}
["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach((event) => {
  map.on(event, (e) => {
    if (e.originalEvent) registerUserInteraction();
  });
});
map.on("click", () => registerUserInteraction());

function toggle3D(forceOn) {
  state.is3D = forceOn ?? !state.is3D;
  const nextPitch = state.is3D ? (map.getPitch() > 0 ? map.getPitch() : SHOWCASE_PITCH) : 0;
  map.easeTo({ pitch: nextPitch, duration: 500 });
  document.getElementById("view-3d-toggle").classList.toggle("active", state.is3D);
  renderLayer();
}
function resetOrientation() {
  map.easeTo({ bearing: 0, pitch: state.is3D ? SHOWCASE_PITCH : 0, duration: 500 });
}

async function bootstrap() {
  datasetDropdown = createDropdown(
    document.getElementById("dataset-select"),
    Object.entries(DATASETS).map(([value, { label }]) => ({ value, label })),
    (value) => setDataset(value),
  );

  await loadDataset(DEFAULT_DATASET);
  datasetDropdown.setValue(DEFAULT_DATASET);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 0 });

  document.getElementById("controls-toggle").addEventListener("click", (event) => {
    document.getElementById("controls-fields").classList.toggle("hidden");
    event.currentTarget.classList.toggle("collapsed");
  });
  document.getElementById("legend-toggle").addEventListener("click", (event) => {
    document.getElementById("legend").classList.toggle("hidden");
    event.currentTarget.classList.toggle("active");
  });
  document.getElementById("charts-toggle").addEventListener("click", (event) => {
    document.getElementById("charts-panel").classList.toggle("hidden");
    event.currentTarget.classList.toggle("active");
  });
  document.getElementById("view-3d-toggle").addEventListener("click", () => {
    toggle3D();
    registerUserInteraction();
  });
  document.getElementById("reorient-toggle").addEventListener("click", () => {
    resetOrientation();
    registerUserInteraction();
  });
  document.getElementById("resume-showcase-toggle").addEventListener("click", () => {
    if (state.showcaseActive) stopShowcase({ resumeAfterIdle: false });
    else startShowcase();
  });
  document.getElementById("settings-toggle").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("hidden");
  });
  document.getElementById("settings-panel-close").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.add("hidden");
  });
  document.getElementById("building-panel-close").addEventListener("click", closeBuildingPanel);

  startShowcase();
}

map.on("load", () => {
  bootstrap().catch((error) => {
    console.error(error);
    const controls = document.getElementById("controls-body");
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = `Failed to load: ${error.message}. Serve this folder over HTTP so fetch() can read the data files.`;
    controls.appendChild(message);
  });
});
