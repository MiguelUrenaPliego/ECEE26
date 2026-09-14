// Santo Domingo roof-material map -- based on maps/template (same visual
// language, same no-backend/frontend-only approach), specialized to one
// fixed attribute (roof_material) with two extra pieces the base template
// doesn't have: raster basemap overlays (the multispectral composite and
// the k-means cluster raster the roof_material column was derived from)
// and two persistent diagnostic charts. See maps/template/README.md for the
// parts shared with every map built from that template (showcase mode,
// mouse controls, panel plumbing).
const { GeoJsonLayer, BitmapLayer } = deck;
const { MapboxOverlay } = deck;

// ---------------------------------------------------------------------------
// Datasets. "naco" is the Random700Sample export, renamed per the brief.
const DATASETS = {
  quisquella: { label: "Ensanche Quisquella", dir: "../../data/roof/quisquella" },
  naco: { label: "Centro", dir: "../../data/roof/naco" },
};
const DEFAULT_DATASET = "quisquella";

// Keep in sync with ROOF_MATERIAL_COLORS in the offline preprocessing
// script (see BerlinConference/data/roof/README.md) -- these are the exact
// colors already baked into clusters.png, so the raster overlay and the
// building fill/legend agree with each other.
const ROOF_MATERIAL_COLORS = {
  asphalt: "#6b7280",
  bright_concrete: "#f2e3b3",
  metallic: "#4299e1",
  dark_shadow: "#8744ad",
  unlabeled: "#c9c9c2",
};
const ROOF_MATERIAL_ORDER = ["metallic", "bright_concrete", "asphalt", "dark_shadow", "unlabeled"];
const ROOF_MATERIAL_LABELS = {
  asphalt: "Asphalt",
  bright_concrete: "Bright concrete",
  metallic: "Metallic",
  dark_shadow: "Dark / shadowed",
  unlabeled: "Unlabeled",
};

const DEFAULT_BUILDING_HEIGHT_M = 8; // fallback for the rare building with no height/n_floors match (see prepare_roof_data.py)
const METRES_PER_FLOOR = 3;
const HEIGHT_EXAGGERATION = 2; // matches maps/template's own exaggeration, for a consistent visual scale across every map built from it
const SHOWCASE_PITCH = 55;
const SHOWCASE_IDLE_RESUME_MS = 30_000;
const SHOWCASE_ROTATE_DEG_PER_SEC = 2.2;

// Raster layers, listed bottom-to-top (the order they actually stack on the
// map): satellite imagery underneath, the multispectral composite above it,
// the cluster raster on top. "satellite" is a MapLibre raster tile layer
// (added to the map style directly); the other two are deck.gl BitmapLayers
// sized to that raster's own bounds.json (see setOverlayForDataset).
const LAYER_DEFS = [
  { id: "satellite", label: "Google Satellite", kind: "tile" },
  { id: "multispectral", label: "Multispectral image", kind: "bitmap", file: "multispectral" },
  { id: "clusters", label: "Cluster raster", kind: "bitmap", file: "clusters" },
];
const DEFAULT_LAYER_STATE = {
  satellite: { checked: false, opacity: 80 },
  multispectral: { checked: true, opacity: 80 },
  clusters: { checked: true, opacity: 50 },
};

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------------------------------------------------------------------
// State.
const state = {
  datasetId: DEFAULT_DATASET,
  data: { type: "FeatureCollection", features: [] },
  pixelsPerCluster: {},
  spectralCentroids: null,
  clusterMapping: {},
  datasetCenter: null,
  is3D: true,
  selectedBuildingId: null,
  layers: JSON.parse(JSON.stringify(DEFAULT_LAYER_STATE)), // id -> {checked, opacity}
  rasterInfo: {}, // id -> {url, bounds:[w,s,e,n]}
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
// the clamp, this map's real-height outliers (a few 100m+ buildings) would
// make every ordinary low-rise building nearly flat by comparison.
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
  const value = feature.properties?.roof_material;
  const key = value && ROOF_MATERIAL_COLORS[value] ? value : "unlabeled";
  return [...hexToRgb(ROOF_MATERIAL_COLORS[key]), 210];
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
  const value = object.properties?.roof_material;
  const label = value ? ROOF_MATERIAL_LABELS[value] ?? value : "Unlabeled";
  return { html: `<div><strong>Roof material:</strong> ${label}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
}

// Multispectral/cluster raster overlays -- BitmapLayers sized to each
// dataset's own bounds.json, in the same bottom-to-top order as LAYER_DEFS.
function rasterOverlayLayers() {
  const layers = [];
  for (const def of LAYER_DEFS) {
    if (def.kind !== "bitmap") continue;
    const layerState = state.layers[def.id];
    const info = state.rasterInfo[def.id];
    if (!layerState?.checked || !info) continue;
    layers.push(new BitmapLayer({ id: `raster-${def.id}`, image: info.url, bounds: info.bounds, opacity: layerState.opacity / 100 }));
  }
  return layers;
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
  heading.textContent = "Roof material";
  container.appendChild(heading);

  const counts = {};
  for (const f of state.data.features) {
    const value = f.properties?.roof_material;
    const key = value && ROOF_MATERIAL_COLORS[value] ? value : "unlabeled";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const list = document.createElement("ul");
  list.className = "legend-list";
  for (const key of ROOF_MATERIAL_ORDER) {
    if (!counts[key]) continue;
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = ROOF_MATERIAL_COLORS[key];
    const label = document.createElement("span");
    label.textContent = `${ROOF_MATERIAL_LABELS[key]} (${counts[key]})`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  container.appendChild(list);
}

// ---------------------------------------------------------------------------
// Charts -- plain inline SVG, no charting library (consistent with this
// project's no-build-step templates). Both read straight off the JSON
// files copied alongside each dataset's rasters.
const CHART_WIDTH = 360;
const CHART_HEIGHT = 175;
const CHART_MARGIN = { top: 10, right: 10, bottom: 34, left: 36 };

function renderPixelCountChart() {
  const container = document.getElementById("pixel-count-chart");
  const entries = Object.entries(state.pixelsPerCluster).map(([clusterId, count]) => ({
    material: state.clusterMapping[clusterId] ?? `cluster ${clusterId}`,
    count,
  }));
  if (entries.length === 0) {
    container.innerHTML = '<p class="hint">No cluster data for this dataset.</p>';
    return;
  }
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maxCount = Math.max(...entries.map((e) => e.count));
  const barGap = 14;
  const barWidth = (plotWidth - barGap * (entries.length - 1)) / entries.length;

  let bars = "";
  let labels = "";
  entries.forEach((entry, i) => {
    const height = maxCount > 0 ? (entry.count / maxCount) * plotHeight : 0;
    const x = CHART_MARGIN.left + i * (barWidth + barGap);
    const y = CHART_MARGIN.top + (plotHeight - height);
    const color = ROOF_MATERIAL_COLORS[entry.material] ?? ROOF_MATERIAL_COLORS.unlabeled;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${color}" rx="3"></rect>`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" class="chart-bar-label">${entry.count}</text>`;
    // Two-line label (split on the first space) rather than one long line --
    // "Bright concrete"/"Dark / shadowed" otherwise overlap their neighbors
    // at 4 bars in this chart's width.
    const labelText = ROOF_MATERIAL_LABELS[entry.material] ?? entry.material;
    const words = labelText.split(" ");
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(" ");
    const line2 = words.slice(mid).join(" ");
    const labelX = x + barWidth / 2;
    const labelY = CHART_HEIGHT - CHART_MARGIN.bottom + 16;
    labels += `<text x="${labelX}" y="${labelY}" text-anchor="middle" class="chart-axis-label"><tspan x="${labelX}" dy="0">${line1}</tspan>${line2 ? `<tspan x="${labelX}" dy="12">${line2}</tspan>` : ""}</text>`;
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

function renderSpectralChart() {
  const container = document.getElementById("spectral-chart");
  const legendContainer = document.getElementById("spectral-chart-legend");
  const centroids = state.spectralCentroids;
  if (!centroids) {
    container.innerHTML = '<p class="hint">No spectral data for this dataset.</p>';
    legendContainer.innerHTML = "";
    return;
  }
  const { bands, clusters } = centroids;
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const allValues = Object.values(clusters).flat();
  const maxValue = Math.max(...allValues);
  const minValue = Math.min(0, ...allValues);
  const xStep = plotWidth / (bands.length - 1);

  const yFor = (value) => CHART_MARGIN.top + plotHeight * (1 - (value - minValue) / (maxValue - minValue));
  const xFor = (i) => CHART_MARGIN.left + i * xStep;

  let lines = "";
  let legendHtml = "";
  for (const [clusterId, values] of Object.entries(clusters)) {
    const material = state.clusterMapping[clusterId] ?? `cluster ${clusterId}`;
    const color = ROOF_MATERIAL_COLORS[material] ?? ROOF_MATERIAL_COLORS.unlabeled;
    const points = values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
    lines += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"></polyline>`;
    legendHtml += `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${color}"></span>${ROOF_MATERIAL_LABELS[material] ?? material}</span>`;
  }

  let axisLabels = "";
  bands.forEach((band, i) => {
    if (i % 2 !== 0 && bands.length > 8) return; // thin labels out so they don't overlap at 11 bands
    axisLabels += `<text x="${xFor(i)}" y="${CHART_HEIGHT - CHART_MARGIN.bottom + 18}" text-anchor="middle" class="chart-axis-label">${band}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const value = minValue + (maxValue - minValue) * t;
    const y = yFor(value);
    yAxisLabels += `<text x="${CHART_MARGIN.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${value.toFixed(1)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${CHART_MARGIN.left}" y1="${CHART_HEIGHT - CHART_MARGIN.bottom}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y2="${CHART_HEIGHT - CHART_MARGIN.bottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" x2="${CHART_MARGIN.left}" y2="${CHART_HEIGHT - CHART_MARGIN.bottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${lines}
    ${axisLabels}
    ${yAxisLabels}
  </svg>`;
  legendContainer.innerHTML = legendHtml;
}

// ---------------------------------------------------------------------------
// Building popup -- this map is about roof_material, so that's the only
// column shown (not every column the underlying gpkg happens to carry).
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
  const value = properties.roof_material;
  const row = document.createElement("tr");
  const th = document.createElement("th");
  th.textContent = "Roof material";
  const td = document.createElement("td");
  td.textContent = value ? ROOF_MATERIAL_LABELS[value] ?? value : "Unlabeled";
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
// Raster info per dataset + layer control checkboxes/sliders.
async function setOverlayForDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const [multispectralBounds, clustersBounds] = await Promise.all([
    fetch(`${dir}/multispectral.bounds.json`).then((r) => r.json()),
    fetch(`${dir}/clusters.bounds.json`).then((r) => r.json()),
  ]);
  state.rasterInfo = {
    multispectral: { url: `${dir}/multispectral.png`, bounds: [multispectralBounds.west, multispectralBounds.south, multispectralBounds.east, multispectralBounds.north] },
    clusters: { url: `${dir}/clusters.png`, bounds: [clustersBounds.west, clustersBounds.south, clustersBounds.east, clustersBounds.north] },
  };
}

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
// Dataset switching.
let datasetDropdown = null;

async function loadDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const [buildings, pixelsPerCluster, spectralCentroids, clusterMapping] = await Promise.all([
    fetch(`${dir}/buildings.geojson`).then((r) => r.json()),
    fetch(`${dir}/pixels_per_cluster.json`).then((r) => r.json()),
    fetch(`${dir}/cluster_spectral_centroids.json`).then((r) => r.json()),
    fetch(`${dir}/cluster_mapping.json`).then((r) => r.json()),
  ]);
  state.datasetId = datasetId;
  state.data = buildings;
  state.pixelsPerCluster = pixelsPerCluster;
  state.spectralCentroids = spectralCentroids;
  state.clusterMapping = clusterMapping;

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };
  elevationClamp = elevationClampFor(buildings);

  await setOverlayForDataset(datasetId);
  renderLayerControls();
  renderLegend();
  renderPixelCountChart();
  renderSpectralChart();
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
// Simple dropdown builder shared by the dataset/basemap pickers (same
// pattern as the base template's createAttributeDropdown).
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
// Showcase (map-idle) mode: orbit the current dataset's center in 3D, with
// both rasters visible together at their default opacities (multispectral
// 80%, clusters 50% -- no more cycling one on/off against the other).
// Buildings stay colored by roof_material throughout (that's the only
// attribute this map ever shows -- no cycling needed there, unlike the base
// template). Any click/drag/zoom/rotate stops it; 30s idle restarts it.
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
  if (resumeAfterIdle) {
    showcaseIdleTimer = setTimeout(startShowcase, SHOWCASE_IDLE_RESUME_MS);
  }
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
