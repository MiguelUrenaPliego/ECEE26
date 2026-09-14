// Santo Domingo building-height map -- based on maps/template (same visual
// language / no-backend approach). Two attributes (height, height error vs.
// n_floors*3) and a stack of raster overlays that differs per dataset: the
// drone flight (orthophoto + DTM/DSM) only exists for Ensanche Quisquella,
// the GlobalBuildingAtlas (GBA) height raster exists for both. See
// maps/template/README.md for the parts shared with every map built from
// that template (showcase mode, mouse controls, panel plumbing).
const { GeoJsonLayer, BitmapLayer } = deck;
const { MapboxOverlay } = deck;

// ---------------------------------------------------------------------------
// Datasets.
const DATASETS = {
  quisquella: { label: "Ensanche Quisquella", dir: "../../data/height/quisquella" },
  naco: { label: "Centro", dir: "../../data/height/naco" },
};
const DEFAULT_DATASET = "quisquella";

// Raster layers per dataset, listed bottom-to-top (the order they actually
// stack on the map). "satellite" is a MapLibre raster tile layer (added to
// the map style directly, see setupSatelliteLayer); everything else is a
// deck.gl BitmapLayer sized to that raster's own bounds.json.
const LAYER_DEFS = {
  quisquella: [
    { id: "satellite", label: "Google Satellite", kind: "tile" },
    { id: "low_res_image", label: "Drone photo (low-res)", kind: "bitmap", file: "low_res_image" },
    { id: "max_res_image", label: "Drone photo (max-res tile)", kind: "bitmap", file: "max_res_image" },
    { id: "dtm", label: "DTM (terrain model)", kind: "bitmap", file: "dtm" },
    { id: "dsm", label: "DSM (surface model)", kind: "bitmap", file: "dsm" },
    { id: "dsm_dtm", label: "Height DSM-DTM", kind: "bitmap", file: "dsm_dtm" },
    { id: "gba_height", label: "GBA height raster", kind: "bitmap", file: "gba_height" },
  ],
  naco: [
    { id: "satellite", label: "Google Satellite", kind: "tile" },
    { id: "gba_height", label: "GBA height raster", kind: "bitmap", file: "gba_height" },
  ],
};

// Extra legend shown under the main one for any checked raster whose colors
// don't already match the "Color by" legend -- GBA/DSM-DTM/DTM/DSM all carry
// their own value scale, baked in offline (see prepare_height_data.py),
// distinct from whichever building attribute happens to be selected.
// Numeric where the offline ramp has a fixed range (GBA/DSM-DTM both clamp
// at HEIGHT_CLAMP_M); qualitative low->high for DTM/DSM, whose range is
// stretched per-raster from the data's own min/max and isn't known here.
const RASTER_LEGENDS = {
  gba_height: { label: "GBA height raster", steps: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"], numericMax: 20, unit: "m" },
  dsm_dtm: { label: "Height DSM-DTM", steps: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"], numericMax: 20, unit: "m" },
  dtm: { label: "DTM (terrain model)", steps: ["#256478", "#569c78", "#b8bf60", "#df943e", "#b03c30"] },
  dsm: { label: "DSM (surface model)", steps: ["#256478", "#569c78", "#b8bf60", "#df943e", "#b03c30"] },
};

// Default on/off + opacity per dataset's "video mode" -- see the brief:
// Naco shows satellite + GBA @ 60%; Quisquella shows satellite + low-res
// image @ 100% + canopy height (DSM-DTM) @ 60% (max-res tile, raw DTM and
// raw DSM all available, but off by default -- DSM-DTM is the one that
// actually reads as "building height" rather than raw absolute elevation).
// Also the starting point for manual use before any showcase cycle has
// touched a layer.
const DEFAULT_LAYER_STATE = {
  quisquella: {
    satellite: { checked: true, opacity: 80 },
    low_res_image: { checked: true, opacity: 80 },
    max_res_image: { checked: false, opacity: 80 },
    dtm: { checked: false, opacity: 80 },
    dsm: { checked: false, opacity: 80 },
    dsm_dtm: { checked: true, opacity: 50 },
    gba_height: { checked: false, opacity: 50 },
  },
  naco: {
    satellite: { checked: true, opacity: 80 },
    gba_height: { checked: true, opacity: 50 },
  },
};

const ATTRIBUTES = [
  { name: "height", label: "Height (m)" },
  { name: "height_error", label: "Height error (vs survey) (m)" },
];

const HEIGHT_CLAMP_M = 20; // matches the offline GBA raster's own clamp, so the building fill and the GBA overlay read on the same scale
const HEIGHT_ERROR_CLAMP_M = 10; // +/- range for the diverging ramp
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

const SEQUENTIAL_STEPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"].map(hexToRgb);
function sequentialColor(value, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return hexToRgb("#9e9d94");
  const t = Math.min(1, Math.max(0, value / max));
  const scaled = t * (SEQUENTIAL_STEPS.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(SEQUENTIAL_STEPS.length - 1, lo + 1);
  const frac = scaled - lo;
  const [r1, g1, b1] = SEQUENTIAL_STEPS[lo];
  const [r2, g2, b2] = SEQUENTIAL_STEPS[hi];
  return [Math.round(lerp(r1, r2, frac)), Math.round(lerp(g1, g2, frac)), Math.round(lerp(b1, b2, frac))];
}
// Diverging: blue (shorter than 3x floors) -> gray (0) -> red (taller).
const DIVERGING_NEGATIVE = hexToRgb("#3987e5");
const DIVERGING_ZERO = hexToRgb("#9aa5ac");
const DIVERGING_POSITIVE = hexToRgb("#e0776b");
function divergingColor(value, clamp) {
  if (value === null || value === undefined || Number.isNaN(value)) return hexToRgb("#9e9d94");
  const t = Math.min(1, Math.max(-1, value / clamp));
  const [from, to] = t < 0 ? [DIVERGING_ZERO, DIVERGING_NEGATIVE] : [DIVERGING_ZERO, DIVERGING_POSITIVE];
  const frac = Math.abs(t);
  return [Math.round(lerp(from[0], to[0], frac)), Math.round(lerp(from[1], to[1], frac)), Math.round(lerp(from[2], to[2], frac))];
}

// ---------------------------------------------------------------------------
// State.
const state = {
  datasetId: DEFAULT_DATASET,
  data: { type: "FeatureCollection", features: [] },
  datasetCenter: null,
  attribute: ATTRIBUTES[0],
  layers: {}, // id -> {checked, opacity}
  rasterInfo: {}, // id -> {url, bounds:[w,s,e,n]}
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
};

// ---------------------------------------------------------------------------
// Map + deck.gl overlay.
const URL_PARAMS = new URLSearchParams(location.search);
// &attribute=<name>: pins the showcase to one color-by attribute forever
// instead of cycling through ATTRIBUTES (e.g. a static-screenshot embed
// that should always show "Height error", not whichever one the cycle
// happened to land on).
const LOCK_ATTRIBUTE = URL_PARAMS.get("attribute");
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

// Google Satellite as a plain MapLibre raster layer sitting under the deck.gl
// overlay (deck.gl always paints on top of the base map's own layers), so
// toggling/opacity here never needs a full setStyle -- only paint-property
// tweaks, unlike the roof map's earlier basemap-swap approach.
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
map.on("styledata", setupSatelliteLayer); // re-added if the style ever reloads

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
  const h = feature.properties?.height;
  return typeof h === "number" ? h : 6;
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

function heightErrorFor(feature) {
  const p = feature.properties ?? {};
  if (typeof p.height !== "number" || typeof p.n_floors !== "number") return null;
  return p.height - p.n_floors * 3;
}

function getFillColor(feature) {
  const value = state.attribute.name === "height" ? feature.properties?.height : heightErrorFor(feature);
  const color = state.attribute.name === "height" ? sequentialColor(typeof value === "number" ? value : null, HEIGHT_CLAMP_M) : divergingColor(value, HEIGHT_ERROR_CLAMP_M);
  return [...color, 210];
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
  const p = object.properties ?? {};
  const height = typeof p.height === "number" ? `${p.height.toFixed(1)} m` : "n/a";
  return { html: `<div><strong>Height:</strong> ${height}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
}

function rasterOverlayLayers() {
  const defs = LAYER_DEFS[state.datasetId];
  const layers = [];
  for (const def of defs) {
    if (def.kind !== "bitmap") continue;
    const layerState = state.layers[def.id];
    const info = state.rasterInfo[def.id];
    if (!layerState?.checked || !info) continue;
    layers.push(
      new BitmapLayer({
        id: `raster-${def.id}`,
        image: info.url,
        bounds: info.bounds,
        opacity: layerState.opacity / 100,
      }),
    );
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
  const steps =
    state.attribute.name === "height"
      ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({ value: t * HEIGHT_CLAMP_M, color: sequentialColor(t * HEIGHT_CLAMP_M, HEIGHT_CLAMP_M) }))
      : [-1, -0.5, 0, 0.5, 1].map((t) => ({ value: t * HEIGHT_ERROR_CLAMP_M, color: divergingColor(t * HEIGHT_ERROR_CLAMP_M, HEIGHT_ERROR_CLAMP_M) }));
  for (const step of steps) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = `rgb(${step.color.join(",")})`;
    const label = document.createElement("span");
    label.textContent = `${step.value >= 0 && state.attribute.name === "height_error" ? "+" : ""}${step.value.toFixed(1)} m`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  container.appendChild(list);
  renderRasterLegends(container);
}

/** Appends one compact swatch row per checked raster that has its own entry
 * in RASTER_LEGENDS, so a raster whose colors don't match the "Color by"
 * legend above (GBA, DSM-DTM, DTM, DSM) always gets its own explanation
 * while it's actually visible on the map. */
function renderRasterLegends(container) {
  const defs = LAYER_DEFS[state.datasetId];
  for (const def of defs) {
    const info = RASTER_LEGENDS[def.id];
    if (!info || !state.layers[def.id]?.checked) continue;

    const section = document.createElement("div");
    section.className = "raster-legend";
    const heading = document.createElement("h3");
    heading.textContent = info.label;
    section.appendChild(heading);

    const bar = document.createElement("div");
    bar.className = "raster-legend-bar";
    bar.style.background = `linear-gradient(90deg, ${info.steps.join(",")})`;
    section.appendChild(bar);

    const labelsRow = document.createElement("div");
    labelsRow.className = "raster-legend-labels";
    if (info.numericMax !== undefined) {
      labelsRow.innerHTML = `<span>0 ${info.unit}</span><span>${info.numericMax} ${info.unit}</span>`;
    } else {
      labelsRow.innerHTML = `<span>Low</span><span>High</span>`;
    }
    section.appendChild(labelsRow);

    container.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Height distribution chart -- buildings bucketed by estimated floor count
// (ceil(height / 3)), 1..9 then "10+". Plain inline SVG, same pattern as the
// roof map's charts (no charting library).
const CHART_WIDTH = 280;
const CHART_HEIGHT = 190;
const CHART_MARGIN = { top: 10, right: 6, bottom: 26, left: 30 };
const FLOOR_BUCKETS = ["1", "2", "3", "4", "5", "6+"];

function renderFloorCountChart() {
  const container = document.getElementById("floor-count-chart");
  const counts = new Array(FLOOR_BUCKETS.length).fill(0);
  for (const f of state.data.features) {
    const h = f.properties?.height;
    if (typeof h !== "number") continue;
    const floors = Math.max(1, Math.ceil(h / 3));
    counts[Math.min(floors, FLOOR_BUCKETS.length) - 1] += 1;
  }
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const barGap = 4;
  const barWidth = (plotWidth - barGap * (counts.length - 1)) / counts.length;

  let bars = "";
  let labels = "";
  counts.forEach((count, i) => {
    const barHeight = (count / maxCount) * plotHeight;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = CHART_MARGIN.top + (plotHeight - barHeight);
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#3987e5" rx="2"></rect>`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" class="chart-bar-label" style="font-size:0.55rem">${pct}%</text>`;
    labels += `<text x="${x + barWidth / 2}" y="${CHART_HEIGHT - CHART_MARGIN.bottom + 14}" text-anchor="middle" class="chart-axis-label">${FLOOR_BUCKETS[i]}</text>`;
  });

  const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;
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
// Height-error (vs survey) distribution -- height minus n_floors*3, bucketed
// into 2m-wide bins centered on 0, plus the dataset's RMSE below the chart.
const ERROR_BUCKET_WIDTH_M = 2;
const ERROR_BUCKET_COUNT = 11; // covers +/-11m in 2m steps, clamping outliers into the end buckets

function renderHeightErrorChart() {
  const container = document.getElementById("height-error-chart");
  const rmseEl = document.getElementById("height-error-rmse");
  const errors = state.data.features.map((f) => heightErrorFor(f)).filter((v) => typeof v === "number");
  if (errors.length === 0) {
    container.innerHTML = '<p class="hint">No data.</p>';
    rmseEl.textContent = "";
    return;
  }

  const halfSpan = (ERROR_BUCKET_COUNT * ERROR_BUCKET_WIDTH_M) / 2;
  const counts = new Array(ERROR_BUCKET_COUNT).fill(0);
  for (const e of errors) {
    const clamped = Math.max(-halfSpan, Math.min(halfSpan - 1e-6, e));
    const idx = Math.min(ERROR_BUCKET_COUNT - 1, Math.floor((clamped + halfSpan) / ERROR_BUCKET_WIDTH_M));
    counts[idx] += 1;
  }

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - 16 - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(1, ...counts);
  const total = errors.length;
  const barGap = 3;
  const barWidth = (plotWidth - barGap * (counts.length - 1)) / counts.length;
  const plotBottom = CHART_MARGIN.top + plotHeight;

  let bars = "";
  let labels = "";
  counts.forEach((count, i) => {
    const barHeight = (count / maxCount) * plotHeight;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const pct = ((count / total) * 100).toFixed(1);
    const bucketStart = -halfSpan + i * ERROR_BUCKET_WIDTH_M;
    const isZeroBucket = bucketStart <= 0 && bucketStart + ERROR_BUCKET_WIDTH_M > 0;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${isZeroBucket ? "#4fbf8f" : "#3987e5"}" rx="2"></rect>`;
    if (count > 0) bars += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" class="chart-bar-label" style="font-size:0.5rem">${pct}%</text>`;
    if (i % 2 === 0) labels += `<text x="${x + barWidth / 2}" y="${plotBottom + 14}" text-anchor="middle" class="chart-axis-label">${bucketStart >= 0 ? "+" : ""}${bucketStart}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.5, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(maxCount * t)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_MARGIN.top + plotHeight + CHART_MARGIN.bottom}">
    <line x1="${CHART_MARGIN.left}" y1="${plotBottom}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${bars}
    ${labels}
  </svg>`;

  const rmse = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  rmseEl.textContent = `RMSE: ${rmse.toFixed(2)} m`;
}

// ---------------------------------------------------------------------------
// Layer controls (checkbox + opacity slider), bottom-to-top per LAYER_DEFS.
function renderLayerControls() {
  const container = document.getElementById("layer-controls");
  container.innerHTML = "";
  container.classList.add("layer-control-list");
  const defs = LAYER_DEFS[state.datasetId];
  for (const def of defs) {
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
      renderLegend();
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
// Building popup -- only the height/floor-count columns this map is about,
// not every column the gpkg happens to carry.
const POPUP_FIELDS = [
  { key: "height", label: "Height (m)" },
  { key: "gba_height", label: "GBA height (m)" },
  { key: "n_floors", label: "N floors" },
  { key: "survey_n_floors", label: "Survey n floors" },
];

function renderBuildingPanel(id, properties) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  content.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = `Building ${id}`;
  content.appendChild(heading);

  const error = heightErrorFor({ properties });
  if (error !== null) {
    const subtitle = document.createElement("p");
    subtitle.className = "building-subtitle";
    subtitle.textContent = `Height error (vs survey): ${error >= 0 ? "+" : ""}${error.toFixed(1)} m`;
    content.appendChild(subtitle);
  }

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
    td.textContent = typeof value === "number" ? String(Math.round(value * 1000) / 1000) : String(value);
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

// ---------------------------------------------------------------------------
// Dataset switching.
let datasetDropdown = null;

async function loadDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const defs = LAYER_DEFS[datasetId];

  state.datasetId = datasetId;
  state.layers = JSON.parse(JSON.stringify(DEFAULT_LAYER_STATE[datasetId]));

  const buildingsPromise = fetch(`${dir}/buildings.geojson`).then((r) => r.json());
  const rasterPromises = defs
    .filter((d) => d.kind === "bitmap")
    .map((d) => fetch(`${dir}/${d.file}.bounds.json`).then((r) => r.json()).then((bounds) => ({ id: d.id, file: d.file, bounds })));

  const [buildings, rasterBoundsList] = await Promise.all([buildingsPromise, Promise.all(rasterPromises)]);

  state.data = buildings;
  state.rasterInfo = {};
  for (const { id, file, bounds } of rasterBoundsList) {
    state.rasterInfo[id] = { url: `${dir}/${file}.png`, bounds: [bounds.west, bounds.south, bounds.east, bounds.north] };
  }

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
  elevationClamp = elevationClampFor(buildings);

  renderLayerControls();
  renderLegend();
  renderFloorCountChart();
  renderHeightErrorChart();
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
// height and height_error. The raster layer stack stays at each dataset's
// own default (see DEFAULT_LAYER_STATE) for the duration -- only the
// building color-by attribute cycles.
let showcaseRotateFrame = null;
let showcaseAttributeTimer = null;
let showcaseIdleTimer = null;
let showcaseAttributeIndex = Math.max(0, ATTRIBUTES.findIndex((a) => a.name === LOCK_ATTRIBUTE));

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
  if (!LOCK_ATTRIBUTE) {
    showcaseAttributeTimer = setInterval(() => {
      showcaseAttributeIndex = (showcaseAttributeIndex + 1) % ATTRIBUTES.length;
      setAttribute(ATTRIBUTES[showcaseAttributeIndex], { fromShowcase: true });
    }, SHOWCASE_ATTRIBUTE_CYCLE_MS);
  }
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
