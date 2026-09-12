// Santo Domingo — cinematic intro map.
//
// Ambient/presentation sequence with the same standard controls as every
// other map (reorient / auto-tour play-pause / 3D toggle / settings /
// legend): starts on a whole-world light basemap with a single "Santo
// Domingo, Dominican Republic" marker, flies into the two Santo Domingo
// survey datasets (Ensanche Quisquella + Naco) once tiles are pre-warmed,
// holds a flat 2D view of both with their real (concave-hull) bounds
// outlined and labeled, then tilts hard into 3D and orbits the combined
// centroid forever, spotlighting one dataset at a time (colored by
// surveyed/not-surveyed).
//
// A second mode, ?view=attributes, skips straight into 3D and instead tours
// one dataset at a time -- its own camera, its own rotation, extruded,
// while the other dataset sits flat and dimmed -- cycling through six
// coloring attributes every 2s (12s per dataset).
//
// Buildings are clickable in both modes -- see renderBuildingPanel.
//
// Data: structural_system's buildings.geojson (id, survey_structural_system,
// height, n_floors, code_quality, roof_material, year, relativePosition,
// geometry) joined client-side, by rounded first-coordinate, onto
// shape_parameters' buildings.geojson (EC8/ASCE7/slenderness fields used for
// the shape index) -- the two pipelines don't share a common id/index, so
// geometry is the only reliable join key (see shapeIndexOf below, lifted
// from maps/shape_parameters/main.js). Dataset bounds are a concave hull
// (turf.concave, falling back to convex) over building centroids, not a
// bounding box, so the outline actually follows the survey footprint.
const { GeoJsonLayer, TextLayer } = deck;
const { MapboxOverlay } = deck;

const STRUCTURAL_ROOT = "../../data/structural_system";
const SHAPE_ROOT = "../../data/shape_parameters";
const DATASETS = [
  { id: "quisquella", label: "Ensanche Quisquella", short: "Quisquella", accent: "#e2a33f" },
  { id: "naco", label: "Naco", short: "Naco", accent: "#43b6c9" },
];
const COUNTRY_LABEL = "Santo Domingo, Dominican Republic";

// URL params (attributes view only): ?view=attributes[&theme=dark][&plots=0]
// -- theme and plots are independent toggles so any combination is
// linkable; ?view=attributes_noplot is kept as a shorthand alias for
// &plots=0 (a bare, presentation-clean view for a slide).
const URL_PARAMS = new URLSearchParams(location.search);
const VIEW_PARAM = URL_PARAMS.get("view");
const ATTRIBUTES_VIEW = VIEW_PARAM === "attributes" || VIEW_PARAM === "attributes_noplot";
const DARK_THEME = ATTRIBUTES_VIEW && URL_PARAMS.get("theme") === "dark";
const SHOW_CHARTS = !ATTRIBUTES_VIEW || (VIEW_PARAM !== "attributes_noplot" && URL_PARAMS.get("plots") !== "0");
const CLEAN_VIEW = ATTRIBUTES_VIEW && !SHOW_CHARTS;
const SHOW_LEGEND = !CLEAN_VIEW;

// ---------------------------------------------------------------------------
// Timing (all ms).
const WORLD_HOLD_MS = 2_000; // sit on the world view (just the country marker) before zooming in
const PHASE_ZOOM_MS = 7_000; // world -> Santo Domingo flyTo
const PHASE_2D_MS = 5_000; // hold flat, both datasets
const PHASE_SPOTLIGHT_MS = 6_000; // default view: dataset switch cadence
const ATTR_TICK_MS = 2_000; // attributes view: attribute switch cadence (6 attrs x 2s = 12s/dataset)
const TILT_TRANSITION_MS = 1_000;
const ORBIT_DEG_PER_SEC = 3;
const TILT_PITCH = 58; // same hard-but-not-extreme tilt for both the default view's 2D->3D transition and the attributes tour
const SHOWCASE_IDLE_RESUME_MS = 30_000;
const LABEL_ZOOM_THRESHOLD = 13; // below this, show the country marker instead of per-dataset labels/outlines

const WORLD_CENTER = { lng: 10, lat: 20 };
const WORLD_ZOOM = 1.3;

// Every coloring scheme below matches the palette the corresponding
// standalone map uses, so the attributes tour reads as "the same maps,
// zoomed into one story" rather than inventing new colors.
// CR and M dominate the survey; ADO/W are rare enough that the map/legend/
// charts bucket them into "Other" (the building popup still shows the
// precise class -- only the aggregate views simplify).
const DISPLAY_COLORS = { CR: "#4299e1", M: "#e2a33f", Other: "#7a6ff0" };
const DISPLAY_ORDER = ["CR", "M", "Other"];
function displayClass(surveyValue) {
  if (surveyValue === "CR" || surveyValue === "M") return surveyValue;
  return surveyValue ? "Other" : null;
}
const ROOF_MATERIAL_COLORS = { asphalt: "#6b7280", bright_concrete: "#f2e3b3", metallic: "#4299e1", dark_shadow: "#8744ad", unlabeled: "#c9c9c2" };
const ROOF_MATERIAL_ORDER = ["metallic", "bright_concrete", "asphalt", "dark_shadow", "unlabeled"];
const FSI_COLORS = { regular: "#4fbf8f", shape: "#e2793f", eccentricity: "#e2c23f", slenderness: "#c0392b" };
const FSI_ORDER = ["regular", "shape", "eccentricity", "slenderness"];
const UNLABELED_COLOR = "#9aa5ac";
// maps/height's blue ramp (also reused for area, which has no dedicated map of its own).
const HEIGHT_STEPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"].map(hexToRgb);
// maps/year's ramp, matching first_construction.png's YEAR_RAMP.
const YEAR_STEPS = ["#59305c", "#564c8c", "#568c9e", "#8cbf6e", "#e8c547"].map(hexToRgb);

const METRES_PER_FLOOR = 3.0;
const DEFAULT_HEIGHT_M = 6.0;
const HEIGHT_EXAGGERATION = 2;

const ATTRS = ["structural_system", "height", "area_m2", "year", "roof_material", "shape_index"];
const ATTR_LABELS = {
  structural_system: "Structural system",
  height: "Height",
  area_m2: "Area",
  year: "Year",
  roof_material: "Roof material",
  shape_index: "Shape index",
};
const STRUCTURAL_LABELS = { CR: "Concrete (CR)", M: "Masonry (MR|MCF)", ADO: "Adobe (ADO)", W: "Steel frames (S)" };
const ROOF_LABELS = { asphalt: "Asphalt", bright_concrete: "Bright concrete", metallic: "Metallic", dark_shadow: "Dark / shadowed", unlabeled: "Unlabeled" };
const FSI_LABELS = { regular: "Regular", shape: "Irregular: shape", eccentricity: "Irregular: eccentricity", slenderness: "Irregular: slenderness" };

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function sequentialColor(steps, value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) return hexToRgb(UNLABELED_COLOR);
  if (max === min) return steps[steps.length - 1];
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const scaled = t * (steps.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(steps.length - 1, lo + 1);
  const frac = scaled - lo;
  const [r1, g1, b1] = steps[lo];
  const [r2, g2, b2] = steps[hi];
  return [Math.round(r1 + (r2 - r1) * frac), Math.round(g1 + (g2 - g1) * frac), Math.round(b1 + (b2 - b1) * frac)];
}

// ---------------------------------------------------------------------------
// Shape index classification -- identical thresholds to
// maps/shape_parameters/main.js::shapeIndexOf, kept in sync by hand since
// this map has no shared module to import it from.
function shapeIndexOf(feature) {
  const p = feature.properties ?? {};
  let key = "regular";
  if (typeof p.EC8_eccentricityRatio === "number" && p.EC8_eccentricityRatio > 0.3) key = "eccentricity";
  if (typeof p.ASCE7_setbackRatio === "number" && p.ASCE7_setbackRatio > 0.2) key = "shape";
  if (typeof p.slenderness_inertia === "number" && p.slenderness_inertia > 4.0) key = "slenderness";
  return key;
}

// ---------------------------------------------------------------------------
// Footprint area, planar-projected around each polygon's own centroid
// latitude -- plenty accurate at building scale, no turf dependency needed
// (turf is loaded for the hull below, but its area functions assume a
// slightly different winding/validity contract than these footprints
// always guarantee, so this stays a small local implementation).
function shoelaceArea(ring, mPerDegLon, mPerDegLat) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLon, y1 = ring[i][1] * mPerDegLat;
    const x2 = ring[i + 1][0] * mPerDegLon, y2 = ring[i + 1][1] * mPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function polygonAreaM2(geometry) {
  if (!geometry) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!polygons) return null;
  const mPerDegLat = 111_320;
  let total = 0;
  for (const rings of polygons) {
    const outer = rings[0];
    const lat0 = outer.reduce((sum, c) => sum + c[1], 0) / outer.length;
    const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
    let area = Math.abs(shoelaceArea(outer, mPerDegLon, mPerDegLat));
    for (let i = 1; i < rings.length; i++) area -= Math.abs(shoelaceArea(rings[i], mPerDegLon, mPerDegLat));
    total += area;
  }
  return total;
}

function centroidOfGeometry(geometry) {
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
  let sx = 0, sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

// Descends into Polygon/MultiPolygon coordinate nesting to find the very
// first [lon, lat] pair, rounded -- used as the join key against
// shape_parameters' buildings.geojson (see module comment: no shared id).
function firstCoordKey(geometry) {
  let c = geometry?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (!Array.isArray(c) || typeof c[0] !== "number") return null;
  return `${c[0].toFixed(7)},${c[1].toFixed(7)}`;
}

// A concave hull over building centroids reads as "the real shape of the
// surveyed area", unlike a bounding box. turf.concave can fail (returns
// null) when maxEdge is too tight for how sparse the data is at the edges,
// so widen progressively and fall back to a convex hull as a last resort.
function computeHull(collection) {
  const points = turf.featureCollection(collection.features.map((f) => turf.point(centroidOfGeometry(f.geometry))));
  // A tight maxEdge traces every street-width gap between blocks, producing
  // a spiky mess of little fingers rather than a clean outline -- start
  // wide enough to skip over street gaps, and require a single (not multi-)
  // polygon with a sane vertex count before accepting it.
  for (const maxEdge of [0.25, 0.4, 0.6, 1.0, 1.8]) {
    try {
      const hull = turf.concave(points, { maxEdge, units: "kilometers" });
      if (hull && hull.geometry.type === "Polygon" && hull.geometry.coordinates[0].length <= 150) {
        const simplified = turf.simplify(hull, { tolerance: 0.0004, highQuality: true });
        return simplified.geometry;
      }
    } catch (error) {
      // try the next, wider maxEdge
    }
  }
  const convex = turf.convex(points);
  return convex ? convex.geometry : null;
}

function bboxPolygonFeature(id) {
  const [[minX, minY], [maxX, maxY]] = state.bounds[id];
  return {
    type: "Feature",
    properties: { id },
    geometry: { type: "Polygon", coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]] },
  };
}

function hullFeature(id) {
  return state.hulls[id] ? { type: "Feature", properties: { id }, geometry: state.hulls[id] } : bboxPolygonFeature(id);
}

// Label position sits well above the tallest building in the dataset (in
// 3D, deck.gl positions are real 3D points, so a ground-level label would
// be occluded by any extruded building in front of it) and, since Naco's
// hull nearly surrounds Quisquella's, is biased toward whichever point on
// its own hull sits farthest from the other dataset's centroid -- a plain
// centroid/pointOnFeature pick for both tends to land close together and
// the two labels collide once the camera is orbiting.
function labelPosition3D(id) {
  const feature = hullFeature(id);
  const ownCentroid = turf.centroid(feature).geometry.coordinates;
  const other = DATASETS.find((d) => d.id !== id);
  let anchor = ownCentroid;
  if (other && state.hulls[other.id]) {
    const otherCentroid = turf.centroid(hullFeature(other.id)).geometry.coordinates;
    const ring = feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
    let best = ownCentroid;
    let bestDist = -Infinity;
    for (const c of ring) {
      const d = turf.distance(turf.point(c), turf.point(otherCentroid));
      if (d > bestDist) {
        bestDist = d;
        best = c;
      }
    }
    anchor = [best[0] * 0.7 + ownCentroid[0] * 0.3, best[1] * 0.7 + ownCentroid[1] * 0.3];
  }
  const z = state.is3D ? (state.maxElevation[id] ?? 0) + 40 : 0;
  return [anchor[0], anchor[1], z];
}

// ---------------------------------------------------------------------------
const state = {
  datasets: {}, // id -> FeatureCollection (structural_system properties + joined shape fields + area_m2)
  bounds: {}, // id -> [[minX,minY],[maxX,maxY]]
  hulls: {}, // id -> GeoJSON geometry
  centroids: {}, // id -> [lng, lat], mean of every building's own centroid
  maxElevation: {}, // id -> number (metres, exaggerated) -- for label placement above the tallest building
  numericRange: {}, // attrName -> [min, max], computed across both datasets
  phase: "loading", // loading -> zoom -> flat -> orbit
  spotlightIndex: 0,
  attrTick: 0,
  is3D: false,
  labelsVisible: false,
  showcaseActive: false,
  chartsHidden: false,
};

if (DARK_THEME) document.body.classList.add("theme-dark");

const map = new maplibregl.Map({
  container: "map",
  style: DARK_THEME ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron",
  center: WORLD_CENTER,
  zoom: WORLD_ZOOM,
  pitch: 0,
  bearing: 0,
  attributionControl: false,
});

map.addControl(new maplibregl.AttributionControl({ compact: true }));
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
map.setMaxPitch(85);

// "On 2D view do not rotate": native drag/touch rotation is only enabled
// while state.is3D is true (see setIs3D below); the custom middle-mouse
// handler below checks the same flag.
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

map.getCanvas().addEventListener("mousedown", (event) => {
  if (event.button !== 1 || !state.is3D) return;
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
    map.setPitch(Math.min(85, Math.max(0, map.getPitch() - dy * 0.5)));
  };
  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
});

function setIs3D(value) {
  state.is3D = value;
  if (value) {
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
  } else {
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
  }
}

// ---------------------------------------------------------------------------
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

function combinedBbox() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of Object.keys(state.bounds)) {
    const [[bMinX, bMinY], [bMaxX, bMaxY]] = state.bounds[id];
    minX = Math.min(minX, bMinX);
    minY = Math.min(minY, bMinY);
    maxX = Math.max(maxX, bMaxX);
    maxY = Math.max(maxY, bMaxY);
  }
  return [[minX, minY], [maxX, maxY]];
}

function combinedCentroid() {
  const [[minX, minY], [maxX, maxY]] = combinedBbox();
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function perDatasetCamera(dataset) {
  const bounds = new maplibregl.LngLatBounds(...state.bounds[dataset.id]);
  const cam = map.cameraForBounds(bounds, { padding: 80, pitch: TILT_PITCH, bearing: 0 });
  // Zoom comes from fitting the bbox; center is overridden to the dataset's
  // real building centroid so the orbit pivots over the buildings themselves.
  const centroid = state.centroids[dataset.id];
  return centroid ? { ...cam, center: { lng: centroid[0], lat: centroid[1] } } : cam;
}

// ---------------------------------------------------------------------------
function rawHeightMetres(feature) {
  const p = feature.properties ?? {};
  const floors = typeof p.n_floors === "number" ? p.n_floors : null;
  return floors !== null ? floors * METRES_PER_FLOOR : DEFAULT_HEIGHT_M;
}

function getElevation(feature) {
  return rawHeightMetres(feature) * HEIGHT_EXAGGERATION;
}

function spotlightDatasetId() {
  return state.phase === "orbit" ? DATASETS[state.spotlightIndex].id : null;
}

// The non-active dataset renders flat (2D) even while the active one is
// extruded, so the spotlighted dataset reads clearly without the other
// dataset's skyline competing for attention.
function isExtrudedDataset(datasetId) {
  if (!state.is3D) return false;
  const spotlight = spotlightDatasetId();
  return !spotlight || spotlight === datasetId;
}

function datasetOpacity(datasetId) {
  const spotlight = spotlightDatasetId();
  if (!spotlight) return 220;
  return datasetId === spotlight ? 235 : 60;
}

function currentAttr() {
  return ATTRS[state.attrTick % ATTRS.length];
}

function colorForAttribute(feature, attrName) {
  const p = feature.properties ?? {};
  switch (attrName) {
    case "structural_system": {
      const cls = displayClass(p.survey_structural_system);
      return cls ? hexToRgb(DISPLAY_COLORS[cls]) : hexToRgb(UNLABELED_COLOR);
    }
    case "roof_material":
      return hexToRgb(ROOF_MATERIAL_COLORS[p.roof_material] ?? ROOF_MATERIAL_COLORS.unlabeled);
    case "shape_index":
      return hexToRgb(FSI_COLORS[shapeIndexOf(feature)]);
    case "height":
      return sequentialColor(HEIGHT_STEPS, p.height, ...(state.numericRange.height ?? [0, 1]));
    case "area_m2":
      return sequentialColor(HEIGHT_STEPS, p.area_m2, ...(state.numericRange.area_m2 ?? [0, 1]));
    case "year":
      return sequentialColor(YEAR_STEPS, p.year, ...(state.numericRange.year ?? [0, 1]));
    default:
      return hexToRgb(UNLABELED_COLOR);
  }
}

function getFillColor(feature) {
  const alpha = datasetOpacity(feature.properties?.__dataset);
  if (ATTRIBUTES_VIEW && state.phase === "orbit") {
    return [...colorForAttribute(feature, currentAttr()), alpha];
  }
  const cls = displayClass(feature.properties?.survey_structural_system);
  const hex = cls ? DISPLAY_COLORS[cls] : UNLABELED_COLOR;
  return [...hexToRgb(hex), alpha];
}

function outlineColor(datasetId) {
  const dataset = DATASETS.find((d) => d.id === datasetId);
  const spotlight = spotlightDatasetId();
  const alpha = !spotlight || spotlight === datasetId ? 255 : 90;
  return [...hexToRgb(dataset.accent), alpha];
}

// ---------------------------------------------------------------------------
// Building click -> parameter popup (roof, height, structural system, shape
// index, relative position, year, area).
function formatValue(attrName, feature) {
  const p = feature.properties ?? {};
  switch (attrName) {
    case "roof": {
      const v = p.roof_material;
      return v ? ROOF_LABELS[v] ?? v : "Unlabeled";
    }
    case "height":
      return typeof p.height === "number" ? `${p.height.toFixed(1)} m` : "—";
    case "structural_system": {
      const v = p.survey_structural_system;
      return v ? STRUCTURAL_LABELS[v] ?? v : "Not surveyed";
    }
    case "shape_index":
      return FSI_LABELS[shapeIndexOf(feature)];
    case "relative_position":
      return p.relativePosition ? p.relativePosition.replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
    case "year":
      return typeof p.year === "number" ? String(p.year) : "—";
    case "area":
      return typeof p.area_m2 === "number" ? `${Math.round(p.area_m2)} m²` : "—";
    default:
      return "—";
  }
}

function renderBuildingPanel(feature) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  const dataset = DATASETS.find((d) => d.id === feature.properties?.__dataset);

  const rows = [
    ["Structural system", formatValue("structural_system", feature)],
    ["Roof material", formatValue("roof", feature)],
    ["Height", formatValue("height", feature)],
    ["Area", formatValue("area", feature)],
    ["Shape index", formatValue("shape_index", feature)],
    ["Relative position", formatValue("relative_position", feature)],
    ["Year", formatValue("year", feature)],
  ];

  content.innerHTML = `
    <h2>Building ${feature.properties?.id ?? ""}</h2>
    <p class="building-subtitle">${dataset ? dataset.label : ""}</p>
    <table class="building-summary"><tbody>
      ${rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("")}
    </tbody></table>`;
  panel.classList.remove("hidden");
}

function closeBuildingPanel() {
  document.getElementById("building-panel").classList.add("hidden");
}

// ---------------------------------------------------------------------------
function renderLayers() {
  const buildingLayers = DATASETS.map(
    (dataset) =>
      new GeoJsonLayer({
        id: `buildings-${dataset.id}`,
        data: state.datasets[dataset.id],
        filled: true,
        stroked: false,
        pickable: true,
        extruded: isExtrudedDataset(dataset.id),
        getElevation,
        getFillColor,
        onClick: (info) => {
          if (info.object) renderBuildingPanel(info.object);
        },
        updateTriggers: {
          getFillColor: [state.phase, state.spotlightIndex, state.attrTick],
        },
      }),
  );

  const layers = [...buildingLayers];

  if (state.labelsVisible) {
    layers.push(
      ...DATASETS.map(
        (dataset) =>
          new GeoJsonLayer({
            id: `bounds-${dataset.id}`,
            data: { type: "FeatureCollection", features: [hullFeature(dataset.id)] },
            filled: false,
            stroked: true,
            getLineColor: outlineColor(dataset.id),
            getLineWidth: 3,
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 2,
            updateTriggers: { getLineColor: [state.phase, state.spotlightIndex] },
          }),
      ),
    );
    layers.push(
      new TextLayer({
        id: "dataset-labels",
        data: DATASETS.map((dataset) => ({ position: labelPosition3D(dataset.id), text: dataset.label, color: outlineColor(dataset.id) })),
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: (d) => d.color,
        getSize: 26,
        sizeUnits: "pixels",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontWeight: 700,
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        background: true,
        backgroundPadding: [8, 4],
        getBackgroundColor: [255, 255, 255, 210],
        updateTriggers: { getColor: [state.phase, state.spotlightIndex], getPosition: [state.is3D] },
      }),
    );
  } else {
    layers.push(
      new TextLayer({
        id: "country-label",
        data: [{ position: combinedCentroid(), text: COUNTRY_LABEL }],
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getColor: [20, 24, 28, 255],
        getSize: 22,
        sizeUnits: "pixels",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontWeight: 700,
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        background: true,
        backgroundPadding: [10, 6],
        getBackgroundColor: [255, 255, 255, 220],
      }),
    );
  }

  overlay.setProps({ layers });
}

function updateSubtitle() {
  const el = document.getElementById("title-subtitle");
  if (state.phase !== "orbit") {
    el.textContent = "Building surveys";
    return;
  }
  const datasetLabel = DATASETS[state.spotlightIndex].label;
  el.textContent = ATTRIBUTES_VIEW ? `${datasetLabel} — ${ATTR_LABELS[currentAttr()]}` : datasetLabel;
}

// ---------------------------------------------------------------------------
// Legend: default view always shows the structural-system truth palette
// (the coloring it actually uses); the attributes view shows whichever of
// the six palettes is currently active, matching the standalone map that
// owns that attribute.
function legendSwatchList(entries) {
  return `<ul class="legend-list">${entries.map(([color, label]) => `<li><span class="legend-swatch" style="background:${color}"></span><span>${label}</span></li>`).join("")}</ul>`;
}

function numericLegendEntries(steps, min, max) {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const [r, g, b] = steps[Math.round(t * (steps.length - 1))];
    const value = min + (max - min) * t;
    return [`rgb(${r},${g},${b})`, Number.isFinite(value) ? value.toFixed(0) : "—"];
  });
}

function renderLegend() {
  // Gated on 3D specifically (not just SHOW_LEGEND): the default view's
  // zoom/flat lead-in has nothing worth captioning yet, so the legend only
  // appears once orbit mode actually activates 3D.
  if (!SHOW_LEGEND || !state.is3D) {
    document.getElementById("legend").innerHTML = "";
    return;
  }
  const legend = document.getElementById("legend");
  const attrName = ATTRIBUTES_VIEW && state.phase === "orbit" ? currentAttr() : "structural_system";
  const heading = ATTR_LABELS[attrName] ?? "Structural system";

  let body;
  if (attrName === "structural_system") {
    body = legendSwatchList([...DISPLAY_ORDER.map((c) => [DISPLAY_COLORS[c], c === "Other" ? "Other" : STRUCTURAL_LABELS[c]]), [UNLABELED_COLOR, "Not surveyed"]]);
  } else if (attrName === "roof_material") {
    body = legendSwatchList(ROOF_MATERIAL_ORDER.map((k) => [ROOF_MATERIAL_COLORS[k], ROOF_LABELS[k]]));
  } else if (attrName === "shape_index") {
    body = legendSwatchList(FSI_ORDER.map((k) => [FSI_COLORS[k], FSI_LABELS[k]]));
  } else {
    const steps = attrName === "year" ? YEAR_STEPS : HEIGHT_STEPS;
    const [min, max] = state.numericRange[attrName] ?? [0, 1];
    const unit = attrName === "area_m2" ? " m²" : attrName === "height" ? " m" : "";
    body = legendSwatchList(numericLegendEntries(steps, min, max).map(([color, value]) => [color, `${value}${unit}`]));
  }

  legend.innerHTML = `<h2>${heading}</h2>${body}`;
}

// ---------------------------------------------------------------------------
// Comparison charts: always one bar per dataset (never per raw building
// count in the bar length itself -- Quisquella's 1.5k buildings and Naco's
// 14k are only comparable as percentages), with the actual count still
// printed alongside every percentage. The current-attribute chart colors
// its bars with the exact legend/map palette for that attribute (numeric
// attributes are bucketed into the same 5 bins the legend swatches show),
// so a "Quisquella"/"Naco" text tag next to each bar is what tells the two
// datasets apart, not color -- color says what the bar's category is.
function renderBarGroups(containerId, groups) {
  const labelWidth = 128, tagWidth = 84, barWidth = 130, barHeight = 18, barGap = 6, groupGap = 20;
  let y = 6;
  let rows = "";
  for (const group of groups) {
    rows += `<text x="0" y="${y + 13}" font-size="15" fill="var(--muted)">${group.label}</text>`;
    let by = y;
    for (const bar of group.bars) {
      const w = Math.max(2, bar.pct * barWidth);
      rows += `<text x="${labelWidth}" y="${by + barHeight - 4}" font-size="13" fill="var(--faint)">${bar.tag}</text>`;
      rows += `<rect x="${labelWidth + tagWidth}" y="${by}" width="${w}" height="${barHeight}" rx="3" fill="${bar.color}"></rect>`;
      rows += `<text x="${labelWidth + tagWidth + w + 8}" y="${by + barHeight - 4}" font-size="14" fill="var(--text)">${bar.count} (${Math.round(bar.pct * 100)}%)</text>`;
      by += barHeight + barGap;
    }
    y = by + groupGap - barGap;
  }
  document.getElementById(containerId).innerHTML = `<svg width="100%" viewBox="0 0 ${labelWidth + tagWidth + barWidth + 130} ${y}">${rows}</svg>`;
}

function countGroups(categories, labelOf, colorOf, valueOf) {
  return categories.map((cat) => ({
    label: labelOf[cat] ?? cat,
    bars: DATASETS.map((d) => {
      const feats = state.datasets[d.id].features;
      const total = feats.length;
      const count = feats.filter((f) => valueOf(f) === cat).length;
      return { tag: d.short, pct: total ? count / total : 0, count, color: colorOf[cat] };
    }),
  }));
}

// Bins a numeric attribute into the same 5 steps the legend's gradient
// swatches use, so the chart's bar colors are literally the legend colors.
function numericAttrGroups(attrName) {
  const steps = attrName === "year" ? YEAR_STEPS : HEIGHT_STEPS;
  const [min, max] = state.numericRange[attrName] ?? [0, 1];
  const unit = attrName === "area_m2" ? " m²" : attrName === "height" ? " m" : "";
  const n = steps.length;
  const edges = Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
  return edges.slice(0, n).map((lo, i) => {
    const hi = edges[i + 1];
    const [r, g, b] = steps[i];
    return {
      label: `${Math.round(lo)}–${Math.round(hi)}${unit}`,
      bars: DATASETS.map((d) => {
        const feats = state.datasets[d.id].features;
        const total = feats.length;
        const count = feats.filter((f) => {
          const v = f.properties[attrName];
          if (typeof v !== "number") return false;
          return i === n - 1 ? v >= lo && v <= hi : v >= lo && v < hi;
        }).length;
        return { tag: d.short, pct: total ? count / total : 0, count, color: `rgb(${r},${g},${b})` };
      }),
    };
  });
}

function renderSurveyChart() {
  renderBarGroups(
    "chart-survey-body",
    countGroups(["Surveyed", "Not surveyed"], { Surveyed: "Surveyed", "Not surveyed": "Not surveyed" }, { Surveyed: "#4fbf8f", "Not surveyed": UNLABELED_COLOR }, (f) =>
      f.properties.survey_structural_system ? "Surveyed" : "Not surveyed",
    ),
  );
}

function renderAttributeChart() {
  const attrName = ATTRIBUTES_VIEW && state.phase === "orbit" ? currentAttr() : "structural_system";
  document.getElementById("chart-attribute-title").textContent = ATTR_LABELS[attrName] ?? "Structural system";

  let groups;
  if (attrName === "structural_system") {
    // The chart keeps the plain "M" short code -- STRUCTURAL_LABELS.M is the
    // fuller "Masonry (MR|MCF)" used on the map/legend/popups, which is too
    // wide for a bar-chart category label.
    const labelOf = { CR: STRUCTURAL_LABELS.CR, M: "M", Other: "Other", unlabeled: "Not surveyed" };
    const colorOf = { ...DISPLAY_COLORS, unlabeled: UNLABELED_COLOR };
    groups = countGroups([...DISPLAY_ORDER, "unlabeled"], labelOf, colorOf, (f) => displayClass(f.properties.survey_structural_system) ?? "unlabeled");
  } else if (attrName === "roof_material") {
    groups = countGroups(ROOF_MATERIAL_ORDER, ROOF_LABELS, ROOF_MATERIAL_COLORS, (f) => f.properties.roof_material ?? "unlabeled");
  } else if (attrName === "shape_index") {
    groups = countGroups(FSI_ORDER, FSI_LABELS, FSI_COLORS, shapeIndexOf);
  } else {
    groups = numericAttrGroups(attrName);
  }
  renderBarGroups("chart-attribute-body", groups);
}

// Same "nothing worth showing yet" gate as the legend: the default view's
// zoom/flat lead-in has no per-dataset story to compare, so the whole
// charts panel stays hidden until 3D/orbit actually starts, independent of
// whether the user has manually toggled it off with the charts-toggle
// button (state.chartsHidden).
function renderCharts() {
  const panel = document.getElementById("charts-panel");
  if (!SHOW_CHARTS) {
    panel.classList.add("hidden");
    return;
  }
  const visible = state.is3D && !state.chartsHidden;
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;
  renderSurveyChart();
  renderAttributeChart();
}

// ---------------------------------------------------------------------------
// Sequence: world -> fly into Santo Domingo (flat) -> hold flat -> tilt +
// orbit forever. Default view spotlights one dataset every
// PHASE_SPOTLIGHT_MS, colored surveyed/not-surveyed. The attributes view
// instead ticks every ATTR_TICK_MS, switching dataset every 6 ticks (12s,
// re-framing the camera on that dataset's own bounds) and coloring
// attribute every tick (2s).
let orbitFrame = null;
let cycleTimer = null;
let idleTimer = null;

function startOrbit() {
  let lastFrameTime = performance.now();
  const rotate = (now) => {
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    map.setBearing((map.getBearing() + ORBIT_DEG_PER_SEC * dt) % 360);
    orbitFrame = requestAnimationFrame(rotate);
  };
  orbitFrame = requestAnimationFrame(rotate);

  if (ATTRIBUTES_VIEW) {
    const tick = () => {
      state.attrTick += 1;
      if (state.attrTick % ATTRS.length === 0) {
        state.spotlightIndex = (state.spotlightIndex + 1) % DATASETS.length;
        const cam = perDatasetCamera(DATASETS[state.spotlightIndex]);
        map.easeTo({ center: cam.center, zoom: cam.zoom, pitch: TILT_PITCH, duration: TILT_TRANSITION_MS });
      }
      updateSubtitle();
      renderLegend();
      renderCharts();
      renderLayers();
    };
    cycleTimer = setInterval(tick, ATTR_TICK_MS);
  } else {
    const cycleSpotlight = () => {
      state.spotlightIndex = (state.spotlightIndex + 1) % DATASETS.length;
      updateSubtitle();
      renderLayers();
    };
    cycleTimer = setInterval(cycleSpotlight, PHASE_SPOTLIGHT_MS);
  }
}

function stopOrbit() {
  if (orbitFrame !== null) cancelAnimationFrame(orbitFrame);
  if (cycleTimer !== null) clearInterval(cycleTimer);
  orbitFrame = null;
  cycleTimer = null;
}

function startShowcase() {
  if (state.showcaseActive) return;
  state.showcaseActive = true;
  if (state.phase === "orbit") startOrbit();
}

function stopShowcase({ resumeAfterIdle = true } = {}) {
  stopOrbit();
  state.showcaseActive = false;
  if (idleTimer !== null) clearTimeout(idleTimer);
  if (resumeAfterIdle) idleTimer = setTimeout(startShowcase, SHOWCASE_IDLE_RESUME_MS);
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

// `deferRotationMs`: the orbit's per-frame setBearing() calls otherwise
// interrupt an in-progress pitch easeTo almost immediately (any explicit
// camera mutation cancels MapLibre's current easing), which is why the
// default view's 2D->3D tilt used to visually not happen -- starting the
// rotation only once the tilt easing has actually finished avoids that.
function enterOrbit(deferRotationMs = 0) {
  state.phase = "orbit";
  setIs3D(true);
  state.spotlightIndex = 0;
  state.attrTick = 0;
  updateSubtitle();
  renderLegend();
  renderCharts();
  renderLayers();
  document.getElementById("view-3d-toggle").classList.add("active");
  if (deferRotationMs > 0) setTimeout(startShowcase, deferRotationMs);
  else startShowcase();
}

function runSequence() {
  const bbox = combinedBbox();
  const bounds = new maplibregl.LngLatBounds(bbox[0], bbox[1]);

  // The attributes view is a presentation tour meant to be linked to
  // directly (e.g. for a slide) -- it skips straight into 3D, framed on the
  // first dataset's own bounds, instead of replaying the world-zoom/flat
  // lead-in and the combined-bounds framing every time.
  if (ATTRIBUTES_VIEW) {
    const cam = perDatasetCamera(DATASETS[0]);
    map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: TILT_PITCH, bearing: 0 });
    enterOrbit();
    return;
  }

  const cam3D = map.cameraForBounds(bounds, { padding: 140, pitch: TILT_PITCH, bearing: 0 });
  const cam2D = map.cameraForBounds(bounds, { padding: 80 });

  state.phase = "zoom";
  updateSubtitle();
  renderLegend();
  renderCharts();

  // Sit on the world view for a beat (just the country marker) before the
  // camera starts moving, so the "whole world" framing actually registers.
  setTimeout(() => {
    map.flyTo({ center: cam2D.center, zoom: cam2D.zoom, pitch: 0, bearing: 0, duration: PHASE_ZOOM_MS, essential: true });
  }, WORLD_HOLD_MS);

  setTimeout(() => {
    state.phase = "flat";
    renderLayers();
  }, WORLD_HOLD_MS + PHASE_ZOOM_MS);

  setTimeout(() => {
    map.easeTo({ center: cam3D.center, zoom: cam3D.zoom, pitch: TILT_PITCH, bearing: 0, duration: TILT_TRANSITION_MS });
    enterOrbit(TILT_TRANSITION_MS);
  }, WORLD_HOLD_MS + PHASE_ZOOM_MS + PHASE_2D_MS);
}

// ---------------------------------------------------------------------------
// Tile pre-warming: a fast flyTo across a huge zoom range (world -> city)
// outruns MapLibre's own tile fetches, leaving big blank/gray gaps for the
// first second or two at the destination. Since MapLibre caches tiles per
// source for the lifetime of the map instance, silently visiting every
// camera the sequence will actually use -- while the loading overlay hides
// the map -- warms that cache so the later, visible animation hits already-
// loaded tiles and renders cleanly.
function waitForIdle() {
  return new Promise((resolve) => map.once("idle", resolve));
}

async function prewarmTiles(cameras) {
  for (const cam of cameras) {
    map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch ?? 0, bearing: 0 });
    await waitForIdle();
  }
}

function hideLoadingOverlay() {
  document.getElementById("loading-overlay").classList.add("hidden");
}

// ---------------------------------------------------------------------------
async function loadDataset(dataset) {
  const [structural, shape] = await Promise.all([
    fetch(`${STRUCTURAL_ROOT}/${dataset.id}/buildings.geojson`).then((r) => r.json()),
    fetch(`${SHAPE_ROOT}/${dataset.id}/buildings.geojson`).then((r) => r.json()),
  ]);

  const shapeByKey = new Map();
  for (const f of shape.features) {
    const key = firstCoordKey(f.geometry);
    if (key) shapeByKey.set(key, f.properties ?? {});
  }

  for (const f of structural.features) {
    f.properties = f.properties ?? {};
    f.properties.__dataset = dataset.id;
    f.properties.area_m2 = polygonAreaM2(f.geometry);
    const shapeProps = shapeByKey.get(firstCoordKey(f.geometry));
    if (shapeProps) {
      f.properties.EC8_eccentricityRatio = shapeProps.EC8_eccentricityRatio;
      f.properties.ASCE7_setbackRatio = shapeProps.ASCE7_setbackRatio;
      f.properties.slenderness_inertia = shapeProps.slenderness_inertia;
    }
  }
  return structural;
}

function computeNumericRanges() {
  const all = Object.values(state.datasets).flatMap((c) => c.features);
  for (const attr of ["height", "area_m2", "year"]) {
    const values = all.map((f) => f.properties?.[attr]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    state.numericRange[attr] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  }
}

// Mean of every building's own centroid -- the actual center of mass of the
// dataset's buildings, not its bounding box's geometric center. Naco in
// particular is a long diagonal strip, so a bbox-center camera would pivot
// the orbit around empty space off to one side rather than over buildings.
function computeDatasetCentroid(collection) {
  let sx = 0, sy = 0, n = 0;
  for (const f of collection.features) {
    const [x, y] = centroidOfGeometry(f.geometry);
    sx += x;
    sy += y;
    n += 1;
  }
  return n ? [sx / n, sy / n] : null;
}

function computeHullsAndElevations() {
  for (const dataset of DATASETS) {
    const collection = state.datasets[dataset.id];
    state.hulls[dataset.id] = computeHull(collection);
    state.maxElevation[dataset.id] = collection.features.reduce((max, f) => Math.max(max, getElevation(f)), 0);
    state.centroids[dataset.id] = computeDatasetCentroid(collection);
  }
}

async function bootstrap() {
  if (CLEAN_VIEW) document.body.classList.add("clean-view");
  for (const dataset of DATASETS) {
    const collection = await loadDataset(dataset);
    state.datasets[dataset.id] = collection;
    state.bounds[dataset.id] = computeBbox(collection);
  }
  computeNumericRanges();
  computeHullsAndElevations();
  renderLegend();
  renderCharts();

  const bbox = combinedBbox();
  const bounds = new maplibregl.LngLatBounds(bbox[0], bbox[1]);
  const cam2D = map.cameraForBounds(bounds, { padding: 80 });
  const cam3D = map.cameraForBounds(bounds, { padding: 140, pitch: TILT_PITCH, bearing: 0 });
  const attrCameras = DATASETS.map(perDatasetCamera);

  await prewarmTiles(ATTRIBUTES_VIEW ? attrCameras : [cam2D, cam3D]);

  map.jumpTo(ATTRIBUTES_VIEW ? { center: attrCameras[0].center, zoom: attrCameras[0].zoom, pitch: TILT_PITCH, bearing: 0 } : { center: WORLD_CENTER, zoom: WORLD_ZOOM, pitch: 0, bearing: 0 });
  state.labelsVisible = map.getZoom() >= LABEL_ZOOM_THRESHOLD;

  hideLoadingOverlay();
  renderLayers();
  runSequence();

  document.getElementById("building-panel-close").addEventListener("click", closeBuildingPanel);
  document.getElementById("controls-toggle").addEventListener("click", (event) => {
    document.getElementById("controls-fields").classList.toggle("hidden");
    event.currentTarget.classList.toggle("collapsed");
  });
  document.getElementById("charts-toggle").addEventListener("click", (event) => {
    state.chartsHidden = !state.chartsHidden;
    event.currentTarget.classList.toggle("active", !state.chartsHidden);
    renderCharts();
  });
  document.getElementById("settings-toggle").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.toggle("hidden");
  });
  document.getElementById("settings-panel-close").addEventListener("click", () => {
    document.getElementById("settings-panel").classList.add("hidden");
  });
  document.getElementById("view-3d-toggle").addEventListener("click", () => {
    setIs3D(!state.is3D);
    document.getElementById("view-3d-toggle").classList.toggle("active", state.is3D);
    map.easeTo({ pitch: state.is3D ? TILT_PITCH : 0, duration: 500 });
    renderLayers();
    registerUserInteraction();
  });
  document.getElementById("reorient-toggle").addEventListener("click", () => {
    map.easeTo({ bearing: 0, pitch: state.is3D ? TILT_PITCH : 0, duration: 500 });
    registerUserInteraction();
  });
  document.getElementById("resume-showcase-toggle").addEventListener("click", () => {
    if (state.showcaseActive) stopShowcase({ resumeAfterIdle: false });
    else startShowcase();
  });

  map.on("zoom", () => {
    const visible = map.getZoom() >= LABEL_ZOOM_THRESHOLD;
    if (visible !== state.labelsVisible) {
      state.labelsVisible = visible;
      renderLayers();
    }
  });
}

map.on("load", () => {
  bootstrap().catch((error) => {
    console.error(error);
    hideLoadingOverlay();
    const controls = document.getElementById("controls-body");
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = `Failed to load data: ${error.message}. Serve this folder over HTTP so fetch() can read the datasets.`;
    controls.appendChild(message);
  });
});
