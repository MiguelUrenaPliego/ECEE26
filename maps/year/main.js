// Santo Domingo building-year map -- based on maps/template (same visual
// language / no-backend approach). Two attributes (first construction year,
// last modification year) and two raster overlays: a false-color Sentinel-2
// composite and the WSF Evolution first-built-up-year raster the
// first_construction_year column was ultimately sampled from. See
// maps/template/README.md for the parts shared with every map built from
// that template (showcase mode, mouse controls, panel plumbing); see
// maps/height/main.js for the closest sibling (same layer-control pattern).
const { GeoJsonLayer, BitmapLayer } = deck;
const { MapboxOverlay } = deck;

// ---------------------------------------------------------------------------
// Datasets.
const DATASETS = {
  quisquella: { label: "Ensanche Quisquella", dir: "../../data/year/quisquella" },
  naco: { label: "Centro", dir: "../../data/year/naco" },
};
const DEFAULT_DATASET = "quisquella";

// Raster layers, bottom-to-top: Google Satellite / the Sentinel-2 false-color
// composite (either one, see DEFAULT_LAYER_STATE -- satellite is the default,
// sentinel a manual alternative), then the first-construction raster on top.
const LAYER_DEFS = [
  { id: "satellite", label: "Google Satellite", kind: "tile" },
  { id: "sentinel", label: "Sentinel-2 image (2023)", kind: "bitmap", file: "sentinel" },
  { id: "first_construction", label: "First-construction raster (WSF)", kind: "bitmap", file: "first_construction" },
];
const DEFAULT_LAYER_STATE = {
  satellite: { checked: true, opacity: 80 },
  sentinel: { checked: false, opacity: 80 },
  first_construction: { checked: true, opacity: 50 },
};

const ATTRIBUTES = [
  { name: "first_construction_year", label: "First construction year", kind: "numeric" },
  { name: "last_modification_year", label: "Last modification year", kind: "numeric" },
  { name: "code_quality", label: "Code quality", kind: "categorical" },
];

// Dominican Republic seismic-code eras (see
// data/year/prepare_year_data.py's own copy of
// code/ml_structural_system's CODE_YEAR_TABLES["dominican_republic"]):
// pre_code (<1979) -> low_code (1979-2010) -> medium_code (2011+). Colored
// worst-to-best, dark red to green, so severity reads at a glance.
const CODE_QUALITY_COLORS = {
  pre_code: "#c0392b",
  low_code: "#e2a33f",
  medium_code: "#4fbf8f",
  unlabeled: "#6b7280",
};
const CODE_QUALITY_ORDER = ["pre_code", "low_code", "medium_code", "unlabeled"];
const CODE_QUALITY_LABELS = {
  pre_code: "Pre-code",
  low_code: "Low code",
  medium_code: "Medium code",
  unlabeled: "Unlabeled",
};
function codeQualityKey(feature) {
  const value = feature.properties?.code_quality;
  return value && CODE_QUALITY_COLORS[value] ? value : "unlabeled";
}

const DEFAULT_BUILDING_HEIGHT_M = 8; // fallback for a building with no height match
const METRES_PER_FLOOR = 3;
const HEIGHT_EXAGGERATION = 2; // matches maps/template's own exaggeration, for a consistent visual scale across every map built from it
const SHOWCASE_PITCH = 55;
const SHOWCASE_ATTRIBUTE_CYCLE_MS = 10_000;
const SHOWCASE_IDLE_RESUME_MS = 30_000;
const SHOWCASE_ROTATE_DEG_PER_SEC = 2.2;

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
const UNLABELED_COLOR = "#9e9d94";
const SEQUENTIAL_STEPS = ["#59305c", "#564c8c", "#568c9e", "#8cbf6e", "#e8c547"].map(hexToRgb); // matches the offline YEAR_RAMP used to colorize first_construction.png
function sequentialColor(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return hexToRgb(UNLABELED_COLOR);
  const t = max === min ? 1 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const scaled = t * (SEQUENTIAL_STEPS.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(SEQUENTIAL_STEPS.length - 1, lo + 1);
  const frac = scaled - lo;
  const [r1, g1, b1] = SEQUENTIAL_STEPS[lo];
  const [r2, g2, b2] = SEQUENTIAL_STEPS[hi];
  return [Math.round(lerp(r1, r2, frac)), Math.round(lerp(g1, g2, frac)), Math.round(lerp(b1, b2, frac))];
}

// ---------------------------------------------------------------------------
// State.
const state = {
  datasetId: DEFAULT_DATASET,
  data: { type: "FeatureCollection", features: [] },
  datasetCenter: null,
  attribute: ATTRIBUTES[0],
  numericRange: {}, // attribute name -> [min, max], recomputed per dataset
  layers: JSON.parse(JSON.stringify(DEFAULT_LAYER_STATE)),
  rasterInfo: {},
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
};

// ---------------------------------------------------------------------------
// Map + deck.gl overlay.
const URL_PARAMS = new URLSearchParams(location.search);
const DARK_THEME = URL_PARAMS.get("theme") === "dark";
if (DARK_THEME) document.body.classList.add("theme-dark");
const MAP_STYLE = DARK_THEME
  ? "https://tiles.openfreemap.org/styles/dark"
  : "https://tiles.openfreemap.org/styles/positron";

const map = new maplibregl.Map({
  container: "map",
  style: MAP_STYLE,
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

// Google Satellite as a plain MapLibre raster layer under the deck.gl
// overlay (deck.gl always paints on top of the base map's own layers), so
// toggling/opacity only ever needs paint-property tweaks, never a setStyle.
function setupSatelliteLayer() {
  if (map.getSource("satellite")) return;
  map.addSource("satellite", {
    type: "raster",
    tiles: ["https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"],
    tileSize: 256,
  });
  map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-opacity": 1 } });
}
map.on("load", setupSatelliteLayer);
map.on("styledata", setupSatelliteLayer);

function applySatelliteLayerState() {
  const layerState = state.layers.satellite;
  if (!layerState || !map.getLayer("satellite")) return;
  map.setLayoutProperty("satellite", "visibility", layerState.checked ? "visible" : "none");
  map.setPaintProperty("satellite", "raster-opacity", layerState.opacity / 100);
}

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
  return feature.properties?.id === state.selectedBuildingId;
}
function rawHeightMetres(feature) {
  const p = feature.properties ?? {};
  if (typeof p.height === "number") return p.height;
  if (typeof p.n_floors === "number") return p.n_floors * METRES_PER_FLOOR;
  return DEFAULT_BUILDING_HEIGHT_M;
}
// Matches maps/template's own exaggeration + 95th-percentile clamp: without
// the clamp, this dataset's real-height outliers would make every ordinary
// low-rise building nearly flat by comparison.
let elevationClamp = Infinity;
function elevationClampFor(data) {
  if (data.features.length === 0) return Infinity;
  const heights = data.features.map(rawHeightMetres).sort((a, b) => a - b);
  return heights[Math.floor(0.95 * (heights.length - 1))];
}
function getElevation(feature) {
  return Math.min(rawHeightMetres(feature), elevationClamp) * HEIGHT_EXAGGERATION;
}

function getFillColor(feature) {
  if (state.attribute.kind === "categorical") {
    return [...hexToRgb(CODE_QUALITY_COLORS[codeQualityKey(feature)]), 210];
  }
  const value = feature.properties?.[state.attribute.name];
  const [min, max] = state.numericRange[state.attribute.name] ?? [0, 1];
  return [...sequentialColor(typeof value === "number" ? value : null, min, max), 210];
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
  const value = object.properties?.[state.attribute.name];
  const shown = typeof value === "number" ? String(value) : "n/a";
  return { html: `<div><strong>${state.attribute.label}:</strong> ${shown}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
}

function rasterOverlayLayers() {
  const layers = [];
  for (const def of LAYER_DEFS) {
    if (def.kind !== "bitmap") continue;
    const layerState = state.layers[def.id];
    const info = state.rasterInfo[def.id];
    if (!layerState?.checked || !info) continue;
    layers.push(new BitmapLayer({ id: `raster-${def.id}`, image: info.url, bounds: info.bounds, opacity: layerState.opacity / 100 }));
  }
  return layers; // already bottom-to-top, matching LAYER_DEFS order
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
      getFillColor: [state.attribute.name],
      getLineColor: [state.selectedBuildingId],
      getLineWidth: [state.selectedBuildingId],
      getElevation: [state.is3D],
    },
    onClick: (info) => {
      const id = info.object?.properties?.id;
      if (id !== undefined && id !== null) onBuildingClick(String(id), info.object.properties);
    },
  });
  overlay.setProps({ layers: [...rasterOverlayLayers(), buildings], getTooltip: buildingTooltip });
  applySatelliteLayerState();
}

// ---------------------------------------------------------------------------
// Legend.
function renderLegend() {
  const container = document.getElementById("legend");
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = state.attribute.label;
  container.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "legend-list";

  if (state.attribute.kind === "categorical") {
    const counts = {};
    for (const f of state.data.features) counts[codeQualityKey(f)] = (counts[codeQualityKey(f)] ?? 0) + 1;
    for (const key of CODE_QUALITY_ORDER) {
      if (!counts[key]) continue;
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = CODE_QUALITY_COLORS[key];
      const label = document.createElement("span");
      label.textContent = `${CODE_QUALITY_LABELS[key]} (${counts[key]})`;
      item.append(swatch, label);
      list.appendChild(item);
    }
  } else {
    const [min, max] = state.numericRange[state.attribute.name] ?? [0, 1];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const value = min + (max - min) * t;
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = `rgb(${sequentialColor(value, min, max).join(",")})`;
      const label = document.createElement("span");
      label.textContent = Number.isFinite(value) ? String(Math.round(value)) : "n/a";
      item.append(swatch, label);
      list.appendChild(item);
    }
  }
  container.appendChild(list);
}

// ---------------------------------------------------------------------------
// Layer controls (checkbox + opacity slider), bottom-to-top per LAYER_DEFS.
function renderLayerControls() {
  const container = document.getElementById("layer-controls");
  container.innerHTML = "";
  container.classList.add("layer-control-list");
  for (const def of LAYER_DEFS) {
    const layerState = state.layers[def.id];
    const row = document.createElement("div");
    row.className = "layer-control-row";

    const top = document.createElement("div");
    top.className = "layer-control-row-top";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layerState.checked;
    checkbox.addEventListener("change", () => {
      layerState.checked = checkbox.checked;
      registerUserInteraction();
      renderLayer();
    });

    const label = document.createElement("label");
    label.className = "layer-control-label";
    label.textContent = def.label;

    top.append(checkbox, label);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(layerState.opacity);
    slider.addEventListener("input", () => {
      layerState.opacity = Number(slider.value);
      registerUserInteraction();
      renderLayer();
    });

    row.append(top, slider);
    container.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Charts (right side, always visible): buildings-per-year, the DR
// code-quality mapping table (static reference), and the code-quality
// breakdown. Plain inline SVG, no charting library, same pattern as every
// other map's charts.
const CHART_WIDTH = 280;
const CHART_HEIGHT = 130;
const CHART_MARGIN = { top: 26, right: 6, bottom: 30, left: 34 };
const YEAR_BUCKET_SIZE = 5;

function renderYearCountChart() {
  const container = document.getElementById("year-count-chart");
  const years = state.data.features.map((f) => f.properties?.code_quality_effective_year).filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (years.length === 0) {
    container.innerHTML = '<p class="hint">No data.</p>';
    return;
  }
  const minYear = Math.floor(Math.min(...years) / YEAR_BUCKET_SIZE) * YEAR_BUCKET_SIZE;
  const maxYear = Math.ceil(Math.max(...years) / YEAR_BUCKET_SIZE) * YEAR_BUCKET_SIZE;
  const bucketCount = Math.max(1, Math.round((maxYear - minYear) / YEAR_BUCKET_SIZE));
  const counts = new Array(bucketCount).fill(0);
  for (const y of years) {
    const idx = Math.min(bucketCount - 1, Math.floor((y - minYear) / YEAR_BUCKET_SIZE));
    counts[idx] += 1;
  }

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...counts);
  const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;
  const barGap = 2;
  const barWidth = (plotWidth - barGap * (bucketCount - 1)) / bucketCount;

  let bars = "";
  let labels = "";
  counts.forEach((count, i) => {
    const barHeight = (count / maxCount) * plotHeight;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const pct = ((count / years.length) * 100).toFixed(1);
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#3987e5" rx="1"></rect>`;
    if (count > 0) bars += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" class="chart-bar-label" style="font-size:0.48rem">${pct}%</text>`;
    if (i % 2 === 0) labels += `<text x="${x + barWidth / 2}" y="${plotBottom + 14}" text-anchor="middle" class="chart-axis-label">${minYear + i * YEAR_BUCKET_SIZE}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.5, 1]) {
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

function renderCodeQualityMapping() {
  const container = document.getElementById("code-quality-mapping");
  const rows = [
    { era: "Before 1979", key: "pre_code" },
    { era: "1979 – 2010", key: "low_code" },
    { era: "2011 onward", key: "medium_code" },
  ];
  const body = rows
    .map(
      (r) =>
        `<tr><td>${r.era}</td><td><span class="code-quality-swatch" style="background:${CODE_QUALITY_COLORS[r.key]}"></span>${CODE_QUALITY_LABELS[r.key]}</td></tr>`,
    )
    .join("");
  container.innerHTML = `<table class="code-quality-mapping-table"><thead><tr><th>Effective year</th><th>Code quality</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderCodeQualityChart() {
  const container = document.getElementById("code-quality-chart");
  const counts = {};
  for (const f of state.data.features) counts[codeQualityKey(f)] = (counts[codeQualityKey(f)] ?? 0) + 1;
  const total = state.data.features.length;
  const entries = CODE_QUALITY_ORDER.filter((k) => counts[k]).map((k) => ({ key: k, count: counts[k] }));

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...entries.map((e) => e.count));
  const barGap = 10;
  const barWidth = (plotWidth - barGap * (entries.length - 1)) / entries.length;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;

  let bars = "";
  let labels = "";
  entries.forEach((entry, i) => {
    const barHeight = (entry.count / maxCount) * plotHeight;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const pct = ((entry.count / total) * 100).toFixed(1);
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${CODE_QUALITY_COLORS[entry.key]}" rx="3"></rect>`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 22}" text-anchor="middle" class="chart-bar-label"><tspan x="${x + barWidth / 2}" dy="0">${entry.count}</tspan><tspan x="${x + barWidth / 2}" dy="14">${pct}%</tspan></text>`;
    labels += `<text x="${x + barWidth / 2}" y="${plotBottom + 14}" text-anchor="middle" class="chart-axis-label">${entry.key.replace("_code", "")}</text>`;
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
// Building popup -- this map is about the two year columns, so that's all
// that's shown (not every column the underlying gpkg happens to carry).
const POPUP_FIELDS = [
  { key: "year", label: "Year (survey)" },
  { key: "first_construction_year", label: "First construction year" },
  { key: "last_modification_year", label: "Last modification year" },
  { key: "code_quality_effective_year", label: "Code-quality effective year" },
  { key: "code_quality", label: "Code quality" },
];

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
  for (const { key, label } of POPUP_FIELDS) {
    const value = properties[key];
    if (value === null || value === undefined || value === "") continue;
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = String(value);
    row.append(th, td);
    tbody.appendChild(row);
  }
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
// Attribute (color-by) switching.
let attributeDropdown = null;
function setAttribute(attribute, { fromShowcase = false } = {}) {
  state.attribute = attribute;
  attributeDropdown?.setValue(attribute.name);
  renderLegend();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

function computeNumericRanges(data) {
  for (const attribute of ATTRIBUTES) {
    if (attribute.kind === "categorical") continue;
    const values = data.features.map((f) => f.properties?.[attribute.name]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    state.numericRange[attribute.name] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  }
}

// ---------------------------------------------------------------------------
// Dataset switching.
let datasetDropdown = null;

async function loadDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const buildingsPromise = fetch(`${dir}/buildings.geojson`).then((r) => r.json());
  const rasterPromises = LAYER_DEFS.filter((d) => d.kind === "bitmap").map((d) => fetch(`${dir}/${d.file}.bounds.json`).then((r) => r.json()).then((bounds) => ({ id: d.id, file: d.file, bounds })));

  const [buildings, rasterBoundsList] = await Promise.all([buildingsPromise, Promise.all(rasterPromises)]);

  state.datasetId = datasetId;
  state.data = buildings;
  state.rasterInfo = {};
  for (const { id, file, bounds } of rasterBoundsList) {
    state.rasterInfo[id] = { url: `${dir}/${file}.png`, bounds: [bounds.west, bounds.south, bounds.east, bounds.north] };
  }
  computeNumericRanges(buildings);
  elevationClamp = elevationClampFor(buildings);

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };

  renderLayerControls();
  renderLegend();
  renderYearCountChart();
  renderCodeQualityMapping();
  renderCodeQualityChart();
  renderLayer();
}

async function setDataset(datasetId, { fromShowcase = false } = {}) {
  await loadDataset(datasetId);
  var __h1 = document.querySelector(".subtitle"); if (__h1) __h1.textContent = DATASETS[datasetId].label;
  datasetDropdown?.setValue(datasetId);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: fromShowcase ? 0 : 500 });
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

// ---------------------------------------------------------------------------
// Dropdown builder (dataset / attribute pickers).
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
// Showcase mode: orbit the dataset center in 3D; every 10s flip between
// first_construction_year and last_modification_year. The raster layer
// stack stays at its default (sentinel 100%, first-construction 60%) for
// the duration -- only the building color-by attribute cycles.
let showcaseRotateFrame = null;
let showcaseAttributeTimer = null;
let showcaseIdleTimer = null;
let showcaseAttributeIndex = 0;

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

  setAttribute(ATTRIBUTES[showcaseAttributeIndex], { fromShowcase: true });
  showcaseAttributeTimer = setInterval(() => {
    showcaseAttributeIndex = (showcaseAttributeIndex + 1) % ATTRIBUTES.length;
    setAttribute(ATTRIBUTES[showcaseAttributeIndex], { fromShowcase: true });
  }, SHOWCASE_ATTRIBUTE_CYCLE_MS);
}

function stopShowcase({ resumeAfterIdle = true } = {}) {
  if (showcaseRotateFrame !== null) cancelAnimationFrame(showcaseRotateFrame);
  if (showcaseAttributeTimer !== null) clearInterval(showcaseAttributeTimer);
  showcaseRotateFrame = null;
  showcaseAttributeTimer = null;
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

// ---------------------------------------------------------------------------
// 3D toggle / reorient.
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

// ---------------------------------------------------------------------------
// Bootstrap.
async function bootstrap() {
  datasetDropdown = createDropdown(
    document.getElementById("dataset-select"),
    Object.entries(DATASETS).map(([value, { label }]) => ({ value, label })),
    (value) => setDataset(value),
  );
  attributeDropdown = createDropdown(
    document.getElementById("attribute-select"),
    ATTRIBUTES.map((a) => ({ value: a.name, label: a.label })),
    (value) => setAttribute(ATTRIBUTES.find((a) => a.name === value)),
  );
  attributeDropdown.setValue(state.attribute.name);

  await loadDataset(DEFAULT_DATASET);
  datasetDropdown.setValue(DEFAULT_DATASET);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: 0 });

  document.getElementById("controls-toggle").addEventListener("click", (event) => {
    document.getElementById("controls-fields").classList.toggle("hidden");
    event.currentTarget.classList.toggle("collapsed");
  });
  document.getElementById("layer-controls-toggle").addEventListener("click", (event) => {
    document.getElementById("layer-controls").classList.toggle("hidden");
    event.currentTarget.classList.toggle("active");
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
