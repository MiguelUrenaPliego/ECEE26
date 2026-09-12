// Santo Domingo building viewer — frontend-only template.
//
// Deliberately no backend and no model predictions here: this only ever
// renders the raw building database (data/santo_domingo_buildings.geojson)
// with whatever recorded attributes it carries, colored by one attribute at
// a time. Visual language (glass panels, amber accent, dark basemap, deck.gl
// tooltip) is lifted from visor/city_risk_visor/risk_viewer/frontend so a
// real map built from this template reads as the same family of tool — see
// that project's mapLayers.ts/ui.ts/colors.ts for the fuller versions of the
// helpers reimplemented in miniature below.
//
// No build step on purpose: maplibre-gl and deck.gl load as plain <script>
// tags from a CDN (see index.html) as the `maplibregl`/`deck` UMD globals,
// and this file is loaded as a plain (module, for top-level scoping) script
// on top of them — so the whole template is just "open index.html" (via a
// static server, for the fetch() below) with nothing to npm install.
const { GeoJsonLayer } = deck;
const { MapboxOverlay } = deck;

const DATA_URL = "data/santo_domingo_buildings.geojson";

// ---------------------------------------------------------------------------
// Parameter list — EDIT THIS to change what the map cycles through and what
// shows up in the "Color by" dropdown.
//
// `name` must match a GeoJSON feature property. Entries whose property isn't
// actually present anywhere in the loaded data are dropped automatically
// (see filterAvailableParams) with a console note, rather than breaking the
// map — this list intentionally includes a few geometric shape indices
// (EC8 eccentricity, slenderness, compactness...) that this project computes
// in PaperFootrpints/ but hasn't yet been joined onto the survey database
// this template loads. Add the real column name here once it's available
// and it'll pick up automatically, no other code changes needed.
const PARAMS = [
  { name: "structural_system", label: "Structural system", kind: "categorical" },
  { name: "llrs", label: "Lateral load-resisting system", kind: "categorical" },
  { name: "relative_position", label: "Relative position", kind: "categorical" },
  { name: "plan_regularity", label: "Plan regularity", kind: "categorical" },
  { name: "elevation_regularity", label: "Elevation regularity", kind: "categorical" },
  { name: "soil_type", label: "Soil type", kind: "categorical" },
  { name: "building_condition", label: "Building condition", kind: "categorical" },
  { name: "occupancy", label: "Occupancy", kind: "categorical" },
  { name: "n_floors", label: "Number of floors", kind: "numeric" },
  { name: "construction_year", label: "Construction year", kind: "numeric" },
  // Not present in data/santo_domingo_buildings.geojson yet — join these in
  // from PaperFootrpints' shape/position validation outputs and they'll
  // start showing up in the dropdown and the showcase cycle automatically.
  { name: "ec8_eccentricity", label: "EC8 eccentricity", kind: "numeric" },
  { name: "slenderness", label: "Slenderness", kind: "numeric" },
  { name: "compactness", label: "Compactness", kind: "numeric" },
  { name: "fsi", label: "Floor space index (FSI)", kind: "numeric" },
];

// ---------------------------------------------------------------------------
// Showcase (map-idle) mode config.
const SHOWCASE_PARAM_CYCLE_MS = 10_000; // switch to the next param this often
const SHOWCASE_IDLE_RESUME_MS = 30_000; // steady-for-this-long -> restart showcase
const SHOWCASE_ROTATE_DEG_PER_SEC = 2.2; // camera bearing drift speed
const SHOWCASE_PITCH = 55;

const UNLABELED_COLOR = "#9e9d94";
const METRES_PER_FLOOR = 3.0;
const DEFAULT_HEIGHT_M = 6.0;
const HEIGHT_EXAGGERATION = 2;

// Small fixed categorical palette (visor's colors.py assigns these server
// side; reimplemented here as a flat client-side list since this template
// has no backend to hand them out from). Cycles if a field has more distinct
// values than colors.
const CATEGORICAL_PALETTE = [
  "#3987e5", // blue
  "#e2a33f", // amber
  "#4fbf8f", // green
  "#c14fb8", // magenta
  "#e0776b", // red
  "#f2d43d", // gold
  "#7a6ff0", // violet
  "#43b6c9", // teal
];

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const SEQUENTIAL_STEPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"].map(hexToRgb);

function sequentialColor(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return hexToRgb(UNLABELED_COLOR);
  if (max === min) return SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1];
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const scaled = t * (SEQUENTIAL_STEPS.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(SEQUENTIAL_STEPS.length - 1, lo + 1);
  const frac = scaled - lo;
  const [r1, g1, b1] = SEQUENTIAL_STEPS[lo];
  const [r2, g2, b2] = SEQUENTIAL_STEPS[hi];
  return [Math.round(r1 + (r2 - r1) * frac), Math.round(g1 + (g2 - g1) * frac), Math.round(b1 + (b2 - b1) * frac)];
}

// ---------------------------------------------------------------------------
// App state.
const state = {
  data: { type: "FeatureCollection", features: [] },
  availableParams: [],
  attribute: null,
  categoricalDomain: {}, // name -> string[]
  categoricalLegend: {}, // name -> { value: hexColor }
  numericRange: {}, // name -> [min, max]
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
};

// ---------------------------------------------------------------------------
// Map + deck.gl overlay setup.
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: [-70.85, 18.62], // rough Santo Domingo fallback; overwritten by fitBounds once data loads
  zoom: 14,
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

function centerOf(collection) {
  const [[minX, minY], [maxX, maxY]] = computeBbox(collection);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function rawHeightMetres(feature) {
  const p = feature.properties ?? {};
  const floors = typeof p.n_floors === "number" ? p.n_floors : null;
  return floors !== null ? floors * METRES_PER_FLOOR : DEFAULT_HEIGHT_M;
}

function getElevation(feature) {
  return rawHeightMetres(feature) * HEIGHT_EXAGGERATION;
}

function isSelected(feature) {
  return feature.properties?.id === state.selectedBuildingId;
}

function getFillColor(feature) {
  const attribute = state.attribute;
  if (!attribute) return [...hexToRgb(UNLABELED_COLOR), 200];
  const value = feature.properties?.[attribute.name];
  if (attribute.kind === "categorical") {
    const key = value === null || value === undefined || value === "" ? "unlabeled" : String(value);
    const hex = state.categoricalLegend[attribute.name]?.[key] ?? UNLABELED_COLOR;
    return [...hexToRgb(hex), 200];
  }
  const [min, max] = state.numericRange[attribute.name] ?? [0, 1];
  return [...sequentialColor(typeof value === "number" ? value : null, min, max), 200];
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
  const attribute = state.attribute;
  const value = attribute ? object.properties?.[attribute.name] : undefined;
  const label = attribute ? attribute.label : "Building";
  const shown = value === null || value === undefined || value === "" ? "—" : String(value);
  return {
    html: `<div><strong>${label}:</strong> ${shown}</div><div class="hint" style="margin-top:4px">Click for full details</div>`,
    className: "deck-tooltip",
  };
}

function renderLayer() {
  const layer = new GeoJsonLayer({
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
      getFillColor: [state.attribute?.name, state.selectedBuildingId],
      getLineColor: [state.selectedBuildingId],
      getLineWidth: [state.selectedBuildingId],
      getElevation: [state.is3D],
    },
    onClick: (info) => {
      const id = info.object?.properties?.id;
      if (id !== undefined && id !== null) onBuildingClick(String(id), info.object.properties);
    },
  });
  overlay.setProps({ layers: [layer], getTooltip: buildingTooltip });
}

// ---------------------------------------------------------------------------
// Attribute domains / ranges, computed client-side from the loaded data
// (mirrors state.ts::numericRangeOf/categoricalDomainOf in the visor, which
// gets the same numbers from a backend endpoint instead).
function computeDomains() {
  for (const attribute of state.availableParams) {
    const values = state.data.features.map((f) => f.properties?.[attribute.name]);
    if (attribute.kind === "categorical") {
      const domain = Array.from(new Set(values.map((v) => (v === null || v === undefined || v === "" ? "unlabeled" : String(v))))).sort();
      state.categoricalDomain[attribute.name] = domain;
      const legend = {};
      domain.forEach((value, index) => {
        legend[value] = value === "unlabeled" ? UNLABELED_COLOR : CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
      });
      state.categoricalLegend[attribute.name] = legend;
    } else {
      const numeric = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
      const min = numeric.length ? Math.min(...numeric) : 0;
      const max = numeric.length ? Math.max(...numeric) : 1;
      state.numericRange[attribute.name] = [min, max];
    }
  }
}

// Only cycle/offer params that actually exist somewhere in the dataset —
// see the PARAMS comment above for why the full wishlist can be longer than
// what's currently joined onto the data.
function filterAvailableParams() {
  const available = PARAMS.filter((p) => state.data.features.some((f) => f.properties && p.name in f.properties));
  const missing = PARAMS.filter((p) => !available.includes(p));
  if (missing.length) {
    console.info(
      "[template] skipping params not present in the loaded dataset (add the column to data/santo_domingo_buildings.geojson to enable):",
      missing.map((p) => p.name),
    );
  }
  state.availableParams = available;
}

// ---------------------------------------------------------------------------
// Legend + "Color by" dropdown UI.
function renderLegend() {
  const container = document.getElementById("legend");
  const attribute = state.attribute;
  container.innerHTML = "";
  if (!attribute) return;

  const heading = document.createElement("h2");
  heading.textContent = attribute.label;
  container.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "legend-list";

  if (attribute.kind === "categorical") {
    const domain = state.categoricalDomain[attribute.name] ?? [];
    const legend = state.categoricalLegend[attribute.name] ?? {};
    // Cap the list so a high-cardinality field (e.g. free-text street) can't
    // blow up the panel — the map coloring itself still uses the full domain.
    for (const value of domain.slice(0, 12)) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = legend[value] ?? UNLABELED_COLOR;
      const label = document.createElement("span");
      label.textContent = value;
      item.append(swatch, label);
      list.appendChild(item);
    }
    if (domain.length > 12) {
      const more = document.createElement("li");
      more.className = "hint";
      more.style.margin = "0";
      more.textContent = `+${domain.length - 12} more values`;
      list.appendChild(more);
    }
  } else {
    const [min, max] = state.numericRange[attribute.name] ?? [0, 1];
    for (const step of [0, 0.25, 0.5, 0.75, 1]) {
      const value = min + (max - min) * step;
      const [r, g, b] = SEQUENTIAL_STEPS[Math.round(step * (SEQUENTIAL_STEPS.length - 1))];
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = `rgb(${r},${g},${b})`;
      const label = document.createElement("span");
      label.textContent = Number.isFinite(value) ? value.toFixed(1) : "—";
      item.append(swatch, label);
      list.appendChild(item);
    }
  }
  container.appendChild(list);
}

let attributeDropdownEls = null;

function setAttribute(attribute, { fromShowcase = false } = {}) {
  state.attribute = attribute;
  if (attributeDropdownEls) attributeDropdownEls.setValue(attribute.name);
  renderLegend();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

function createAttributeDropdown() {
  const container = document.getElementById("attribute-select");
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

  function renderOptions() {
    list.innerHTML = "";
    for (const attribute of state.availableParams) {
      const item = document.createElement("li");
      item.textContent = attribute.label;
      if (state.attribute && attribute.name === state.attribute.name) item.classList.add("selected");
      item.addEventListener("click", () => {
        setAttribute(attribute);
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
  renderOptions();

  attributeDropdownEls = {
    setValue(name) {
      const attribute = state.availableParams.find((p) => p.name === name);
      if (attribute) valueEl.textContent = attribute.label;
      renderOptions();
    },
  };
}

// ---------------------------------------------------------------------------
// Building popup — generic key/value dump of every dataset property on the
// clicked feature. Kept deliberately generic (one table, no per-field
// special-casing) since this template has no fixed schema to design a
// bespoke summary around; a real map built from this can replace
// renderBuildingPanel's body with curated sections/tabs the way the visor's
// buildingController.ts/vulnerabilityPanel.ts do, while keeping the same
// open/close plumbing below.
function labelize(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderBuildingPanel(id, properties) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  content.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = `Building ${id}`;
  content.appendChild(heading);

  const subtitle = document.createElement("p");
  subtitle.className = "building-subtitle";
  subtitle.textContent = properties.street ? String(properties.street) : "Santo Domingo pilot region";
  content.appendChild(subtitle);

  const table = document.createElement("table");
  table.className = "building-summary";
  const tbody = document.createElement("tbody");
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined || value === "") continue;
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = labelize(key);
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
// Showcase mode: on load (and again after any sufficiently long idle period)
// the map orbits its own center in 3D, switching the coloring attribute
// every SHOWCASE_PARAM_CYCLE_MS. Any user-initiated interaction with the map
// (drag/zoom/rotate/click) stops it for good until the map has then sat
// still for SHOWCASE_IDLE_RESUME_MS, at which point it restarts.
let showcaseRotateFrame = null;
let showcaseParamTimer = null;
let showcaseIdleTimer = null;
let showcaseCenter = null;
let showcaseParamIndex = 0;

function startShowcase() {
  if (state.showcaseActive || state.availableParams.length === 0) return;
  state.showcaseActive = true;

  map.jumpTo({ center: showcaseCenter });

  if (state.is3D) {
    let lastFrameTime = performance.now();
    const rotate = (now) => {
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      map.setBearing((map.getBearing() + SHOWCASE_ROTATE_DEG_PER_SEC * dt) % 360);
      showcaseRotateFrame = requestAnimationFrame(rotate);
    };
    showcaseRotateFrame = requestAnimationFrame(rotate);
  }

  const cycleParam = () => {
    showcaseParamIndex = (showcaseParamIndex + 1) % state.availableParams.length;
    setAttribute(state.availableParams[showcaseParamIndex], { fromShowcase: true });
  };
  showcaseParamTimer = setInterval(cycleParam, SHOWCASE_PARAM_CYCLE_MS);
}

/** Stops the orbit/param-cycle. `resumeAfterIdle` schedules the 30s idle
 * timer that restarts it; pass false when something else already owns
 * scheduling the restart (there's no such caller today, but keeps the two
 * concerns — "stop now" vs "maybe restart later" — separately controllable). */
function stopShowcase({ resumeAfterIdle = true } = {}) {
  if (showcaseRotateFrame !== null) cancelAnimationFrame(showcaseRotateFrame);
  if (showcaseParamTimer !== null) clearInterval(showcaseParamTimer);
  showcaseRotateFrame = null;
  showcaseParamTimer = null;
  state.showcaseActive = false;

  if (showcaseIdleTimer !== null) clearTimeout(showcaseIdleTimer);
  if (resumeAfterIdle) showcaseIdleTimer = setTimeout(startShowcase, SHOWCASE_IDLE_RESUME_MS);
}

/** Any real user interaction resets the idle clock, whether or not showcase
 * is currently running — a user still poking at the map mid-showcase (rather
 * than a single click) must not let it restart out from under them 30s after
 * their FIRST click. */
function registerUserInteraction() {
  if (state.showcaseActive) stopShowcase({ resumeAfterIdle: true });
  else stopShowcase({ resumeAfterIdle: true }); // just reschedules the idle timer
}

// maplibre only sets originalEvent on user-driven camera moves (mouse/touch/
// wheel), never on our own jumpTo/setBearing calls above — that's what lets
// this distinguish "the showcase animation moved the camera" from "the user
// grabbed the map", without a separate isProgrammatic flag to keep in sync.
["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach((event) => {
  map.on(event, (e) => {
    if (e.originalEvent) registerUserInteraction();
  });
});
map.on("click", () => registerUserInteraction());

// ---------------------------------------------------------------------------
// 3D toggle / reorient — manual controls, same behavior as the visor's
// mapLayers.ts::toggle3D/resetOrientation, simplified (no per-selection
// re-framing since this template has no drawer stealing screen space).
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
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Failed to load ${DATA_URL}: ${response.status}`);
  state.data = await response.json();

  filterAvailableParams();
  computeDomains();

  createAttributeDropdown();
  setAttribute(state.availableParams[0], { fromShowcase: true });
  showcaseParamIndex = 0;

  map.fitBounds(computeBbox(state.data), { padding: 40, duration: 0 });
  const [centerLng, centerLat] = centerOf(state.data);
  showcaseCenter = { lng: centerLng, lat: centerLat };
  renderLayer();

  document.getElementById("controls-toggle").addEventListener("click", (event) => {
    document.getElementById("controls-fields").classList.toggle("hidden");
    event.currentTarget.classList.toggle("collapsed");
  });
  document.getElementById("legend-toggle").addEventListener("click", (event) => {
    document.getElementById("legend").classList.toggle("hidden");
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

  // Start orbiting/cycling immediately on load, per the brief ("on map
  // startup I want map with buildings in 3D view... rotating around the
  // center... switch from one param to the next").
  startShowcase();
}

map.on("load", () => {
  bootstrap().catch((error) => {
    console.error(error);
    const controls = document.getElementById("controls-body");
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = `Failed to load building data: ${error.message}. Serve this folder over HTTP (not file://) so fetch() can read the GeoJSON.`;
    controls.appendChild(message);
  });
});
