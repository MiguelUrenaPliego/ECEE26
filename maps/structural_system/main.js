// Santo Domingo structural-system map -- based on maps/template (same visual
// language / no-backend approach). Shows ML model predictions of building
// "structural system" (ADO/CR/M/W) from the 2026-09-12 experiment_outputs
// re-run (code/ml_structural_system), for the 7 experiments whose
// predictions actually cover Santo Domingo buildings (see EXPERIMENTS below)
// -- the other 6 in results.json are single-city (Guatemala/San José) runs
// with no Santo Domingo rows at all.
//
// Data layout (see data/structural_system/build_structural_system_gpkg.py
// and prepare_structural_system_data.py for the two-stage build):
// - {dataset}/buildings.geojson: geometry + ground truth (survey_structural_system)
//   + height/floors/etc, loaded once per dataset.
// - {dataset}/{experiment}.json: per-experiment predictions, keyed by `id`,
//   fetched lazily per experiment (Naco's ~14k buildings x 5 models x 7
//   experiments made one combined file too large).
// - data/structural_system/results.json: per-experiment metrics (with
//   generalizability confidence intervals), confusion matrices,
//   feature-importance consensus, class distribution, and its own embedded
//   learning curve -- one flat object keyed by experiment name (not nested
//   under an "experiments" key like the old export).
const { GeoJsonLayer } = deck;
const { MapboxOverlay } = deck;

const DATASETS = {
  quisquella: { label: "Ensanche Quisquella", dir: "../../data/structural_system/quisquella" },
  naco: { label: "Naco", dir: "../../data/structural_system/naco" },
};
const DEFAULT_DATASET = "quisquella";
const DATA_ROOT = "../../data/structural_system";

const EXPERIMENTS = [
  { name: "santo_domingo", label: "Santo Domingo" },
  { name: "santo_domingo_no_roof_code_year", label: "No roof, code & year" },
  { name: "ensanche_quisquella_to_naco", label: "Quisquella -> Naco" },
  { name: "loo_santo_domingo", label: "Leave-one-out" },
];
const DEFAULT_EXPERIMENT = "santo_domingo";

// Every experiment is a genuinely different scenario this time (one
// baseline, one ablation, one district-transfer, three leave-one-city-out,
// one pooled) -- no reason to exclude any of them from the comparison.
const COMPARE_EXPERIMENTS = EXPERIMENTS;

const ENSEMBLE_MODEL = "ensemble";
const ENSEMBLE_LABEL = "Ensemble";
const DEFAULT_MODEL = ENSEMBLE_MODEL;

// The pipeline's prior-probability adjustment (a post-hoc recalibration
// using the target domain's own class prior) only really matters for a
// domain-transfer scenario -- so "with prior" is only offered as a second
// ensemble option for the two experiments where source and target
// population differ (district transfer, leave-one-city-out); the baseline
// and ablation experiments only ever show the plain ensemble.
const PRIOR_ADJUSTED_MODEL = "prior_adjusted";
// Quisquella -> Naco's prior-adjusted results were nearly identical to the
// plain ensemble there, so it's not offered for that experiment -- only
// leave-one-out, where the prior domain shift is large enough to matter.
const PRIOR_ADJUSTED_EXPERIMENTS = new Set(["loo_santo_domingo"]);
// Models whose confusion matrix/metrics are always computed live from this
// dataset's own per-building data (never from results.json, which has no
// entry for either of these).
function liveComputedModels(experiment) {
  return PRIOR_ADJUSTED_EXPERIMENTS.has(experiment) ? [ENSEMBLE_MODEL, PRIOR_ADJUSTED_MODEL] : [ENSEMBLE_MODEL];
}

const COLOR_MODES = [
  { name: "predicted", label: "Structural system (predicted)" },
  { name: "truth", label: "Structural system (ground truth)" },
  { name: "error", label: "Error (vs ground truth)" },
  { name: "uncertainty", label: "Uncertainty" },
  { name: "consensus", label: "Consensus (ensemble only)", ensembleOnly: true },
  { name: "split", label: "Train / val / test split" },
];
const DEFAULT_COLOR_MODE = "predicted";
const SPLIT_COLORS = { train: "#3987e5", val: "#8744ad", test: "#e2a33f" };
const SPLIT_ORDER = ["train", "val", "test"];
const SPLIT_LABELS = { train: "Train", val: "Validation", test: "Test" };

// The ML pipeline collapses several raw survey labels into 4 modeling
// classes before training -- ground truth must go through the same collapse
// before comparing to a prediction, or "M" vs "MUR" would wrongly look like
// an error.
const LABEL_REPLACEMENTS = { S_light: "W", S_frame: "CR", MUR: "M", MCF: "M", MR: "M" };
const DROPPED_LABELS = new Set(["I", "None", "none", ""]);
function collapseLabel(raw) {
  if (raw === null || raw === undefined || DROPPED_LABELS.has(raw)) return null;
  return LABEL_REPLACEMENTS[raw] ?? raw;
}

const CLASS_COLORS = { ADO: "#8744ad", CR: "#4299e1", M: "#e2a33f", W: "#4fbf8f" };
const CLASS_ORDER = ["CR", "M", "ADO", "W"];
const CLASS_LABELS = { CR: "Concrete (CR)", M: "Masonry (MR|MCF)", ADO: "Adobe (ADO)", W: "Steel frames (S)" };
// The raw data's class code is "W" (from the pipeline's own label collapse),
// but it's displayed as "S" everywhere in this UI -- short-code display only,
// the underlying key used to read data stays "W".
const CLASS_SHORT_CODE = { CR: "CR", M: "M", ADO: "ADO", W: "S" };
const UNLABELED_COLOR = "#6b7280";
const CORRECT_COLOR = "#4fbf8f";
const INCORRECT_COLOR = "#c0392b";

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
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpColor(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}
const UNCERTAINTY_LOW = hexToRgb("#4fbf8f");
const UNCERTAINTY_HIGH = hexToRgb("#c0392b");

// ---------------------------------------------------------------------------
// URL-selected presentation views (?view=split|metrics|feature_importance|comparison)
// -- each is a single-purpose "slide" of this same map: a restricted
// showcase color-cycle, only the relevant chart card(s) shown (enlarged,
// single-column), and for "comparison" a different default experiment. The
// plain URL with no ?view still shows everything, as before.
const VIEW_PRESETS = {
  split: {
    colorModes: ["split"],
    charts: ["composition"],
  },
  metrics: {
    colorModes: ["truth", "predicted", "error", "uncertainty", "consensus"],
    charts: ["confusion", "metrics"],
  },
  feature_importance: {
    colorModes: ["truth", "predicted", "error", "uncertainty", "consensus"],
    charts: ["feature_importance", "learning_curve"],
  },
  comparison: {
    colorModes: ["truth", "predicted", "error", "uncertainty", "consensus"],
    defaultExperiment: "loo_santo_domingo",
    charts: ["experiment_compare"],
  },
};
const URL_PARAMS = new URLSearchParams(location.search);
const ACTIVE_VIEW = VIEW_PRESETS[URL_PARAMS.get("view")] ? URL_PARAMS.get("view") : null;
const INITIAL_EXPERIMENT = (ACTIVE_VIEW && VIEW_PRESETS[ACTIVE_VIEW].defaultExperiment) || DEFAULT_EXPERIMENT;

// ---------------------------------------------------------------------------
// State.
const state = {
  datasetId: DEFAULT_DATASET,
  data: { type: "FeatureCollection", features: [] },
  byUid: new Map(), // building id -> feature, for O(1) merge of experiment data
  datasetCenter: null,
  experiment: INITIAL_EXPERIMENT,
  model: DEFAULT_MODEL,
  colorMode: DEFAULT_COLOR_MODE,
  results: null, // data/structural_system/results.json, fetched once -- flat, keyed by experiment name
  expCache: {}, // `${datasetId}:${experiment}` -> parsed per-experiment json
  is3D: true,
  selectedBuildingId: null,
  showcaseActive: false,
};

function currentModelsForExperiment() {
  const models = state.results ? Object.keys(state.results[state.experiment].models) : [];
  return [...models, ...liveComputedModels(state.experiment)];
}
function modelLabel(model) {
  if (model === ENSEMBLE_MODEL) return ENSEMBLE_LABEL;
  if (model === PRIOR_ADJUSTED_MODEL) return "Ensemble (with prior)";
  return model;
}
const SHORT_MODEL_LABELS = {
  LogisticRegression: "LogReg",
  RandomForest: "RandForest",
  HistGradientBoosting: "HistGB",
  [ENSEMBLE_MODEL]: "Ensemble",
  [PRIOR_ADJUSTED_MODEL]: "Ens+Prior",
};
function shortModelLabel(model) {
  return SHORT_MODEL_LABELS[model] ?? modelLabel(model);
}

// ---------------------------------------------------------------------------
// Map + deck.gl overlay.
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

map.setMaxPitch(85);

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
let elevationClamp = Infinity;
function elevationClampFor(data) {
  if (data.features.length === 0) return Infinity;
  const heights = data.features.map(rawHeightMetres).sort((a, b) => a - b);
  return heights[Math.floor(0.95 * (heights.length - 1))];
}
function getElevation(feature) {
  return Math.min(rawHeightMetres(feature), elevationClamp) * HEIGHT_EXAGGERATION;
}

// ---------------------------------------------------------------------------
// Per-building ML fields -- reads from the merged experiment data attached
// as feature.properties.__exp (see loadExperiment). Field names have the
// "{experiment}_" prefix already stripped in the prep script.
function expField(feature, suffix) {
  return feature.properties?.__exp?.[suffix] ?? null;
}
function truthOf(feature) {
  return collapseLabel(feature.properties?.survey_structural_system);
}
function predictionOf(feature, model = state.model) {
  return expField(feature, `${model}_prediction`);
}
// The ensemble carries two distinct uncertainty read-outs (entropy-based and
// consensus-based); entropy is the one used everywhere else uncertainty is
// shown, so that's what "Uncertainty" mode and the popup use for it too.
function uncertaintyOf(feature, model = state.model) {
  if (model === ENSEMBLE_MODEL) return expField(feature, "ensemble_entropy_uncertainty");
  return expField(feature, `${model}_uncertainty`);
}
function splitOf(feature) {
  return expField(feature, "split");
}
// Already computed per-building by the pipeline: what fraction of the
// models that went into the ensemble agree with its own final prediction.
function consensusOf(feature) {
  const ratio = expField(feature, "ensemble_agreement_ratio");
  const usedStr = expField(feature, "ensemble_models_used");
  if (typeof ratio !== "number" || !usedStr) return null;
  const total = usedStr.split(",").filter(Boolean).length;
  return { ratio, agree: Math.round(ratio * total), total };
}

// ---------------------------------------------------------------------------
// Coloring.
// "truth" and "error" already gray out every building with no ground truth
// at all -- glowing every ground-truthed building there would be redundant
// (it's already the colored-vs-gray split). What's actually informative
// there is which of those labeled buildings were held out for evaluation
// (test/val) vs used for training. Modes that don't already encode ground
// truth in their base color (predicted/uncertainty/consensus) glow every
// ground-truthed building instead, same as before.
const GRAY_FOR_UNLABELED_MODES = new Set(["truth", "error"]);
function shouldGlow(feature) {
  if (!truthOf(feature)) return false;
  if (GRAY_FOR_UNLABELED_MODES.has(state.colorMode)) {
    const split = splitOf(feature);
    return split === "test" || split === "val";
  }
  return true;
}

function baseFillColor(feature) {
  if (state.colorMode === "truth") {
    const truth = truthOf(feature);
    return truth ? [...hexToRgb(CLASS_COLORS[truth] ?? UNLABELED_COLOR), 210] : [...hexToRgb(UNLABELED_COLOR), 90];
  }
  if (state.colorMode === "error") {
    const truth = truthOf(feature);
    if (!truth) return [...hexToRgb(UNLABELED_COLOR), 40];
    const pred = predictionOf(feature);
    if (!pred) return [...hexToRgb(UNLABELED_COLOR), 90];
    return pred === truth ? [...hexToRgb(CORRECT_COLOR), 220] : [...hexToRgb(INCORRECT_COLOR), 220];
  }
  if (state.colorMode === "uncertainty") {
    const u = uncertaintyOf(feature);
    if (typeof u !== "number") return [...hexToRgb(UNLABELED_COLOR), 90];
    return [...lerpColor(UNCERTAINTY_LOW, UNCERTAINTY_HIGH, Math.max(0, Math.min(1, u))), 210];
  }
  if (state.colorMode === "consensus") {
    const c = consensusOf(feature);
    if (!c) return [...hexToRgb(UNLABELED_COLOR), 90];
    return [...lerpColor(UNCERTAINTY_HIGH, UNCERTAINTY_LOW, c.ratio), 210];
  }
  if (state.colorMode === "split") {
    const split = splitOf(feature);
    return split && SPLIT_COLORS[split] ? [...hexToRgb(SPLIT_COLORS[split]), 210] : [...hexToRgb(UNLABELED_COLOR), 70];
  }
  // predicted
  const pred = predictionOf(feature);
  return pred ? [...hexToRgb(CLASS_COLORS[pred] ?? UNLABELED_COLOR), 210] : [...hexToRgb(UNLABELED_COLOR), 90];
}

// A real bloom/glow halo isn't achievable here: deck.gl's plain UMD bundle
// (loaded straight from a CDN, no build step, per this whole project's
// design) doesn't include the post-processing/bloom extensions, and a
// selective per-building glow would need a custom multi-pass WebGL shader
// setup -- a poor fit for a no-build frontend-only map. Ground-truthed
// buildings "shine" via full opacity instead; every other building is
// dimmed down, so the contrast reads clearly in both 2D and 3D without
// depending on an outline that a 3D extrusion mostly hides anyway.
const DIM_ALPHA_SCALE = 0.72;
function getFillColor(feature) {
  const [r, g, b, a] = baseFillColor(feature);
  return shouldGlow(feature) ? [r, g, b, a] : [r, g, b, Math.round(a * DIM_ALPHA_SCALE)];
}
function getLineColor(feature) {
  if (isSelected(feature)) return [...hexToRgb("#e2a33f"), 255];
  return [235, 235, 235, 70];
}
function getLineWidth(feature) {
  if (isSelected(feature)) return 3;
  return 0.8;
}

let onBuildingClick = () => {};

function buildingTooltip({ object, layer }) {
  if (!object || layer?.id !== "buildings") return null;
  const pred = predictionOf(object);
  const truth = truthOf(object);
  const lines = [`<strong>Predicted:</strong> ${pred ? CLASS_LABELS[pred] ?? pred : "n/a"}`];
  if (truth) lines.push(`<strong>Ground truth:</strong> ${CLASS_LABELS[truth] ?? truth}`);
  return { html: `<div>${lines.join("<br>")}</div><div class="hint" style="margin-top:4px">Click for full details</div>`, className: "deck-tooltip" };
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
      getFillColor: [state.colorMode, state.model, state.experiment],
      getLineColor: [state.selectedBuildingId, state.experiment, state.colorMode],
      getLineWidth: [state.selectedBuildingId, state.experiment, state.colorMode],
      getElevation: [state.is3D],
    },
    onClick: (info) => {
      const id = info.object?.properties?.id;
      if (id !== undefined && id !== null) onBuildingClick(String(id), info.object);
    },
  });

  // A second unfilled layer over the glow-eligible buildings only -- a
  // bright, thick outline on top of the opacity contrast above. In 2D
  // (extruded:false) this is just the footprint outline; in 3D `wireframe`
  // draws the full cage (top ring, bottom ring, verticals), so the
  // base/top edges read as a clear bright rim around the whole shape.
  const glowFeatures = state.data.features.filter(shouldGlow);
  const glowElevation = (f) => getElevation(f) + 1.2;
  const glow = new GeoJsonLayer({
    id: "buildings-glow",
    data: { type: "FeatureCollection", features: glowFeatures },
    filled: false,
    stroked: true,
    extruded: state.is3D,
    wireframe: true,
    getElevation: glowElevation,
    getLineColor: state.is3D ? [255, 214, 120, 255] : [255, 255, 255, 220],
    getLineWidth: state.is3D ? 5 : 2,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: state.is3D ? 3 : 1.5,
    lineWidthMaxPixels: state.is3D ? 7 : 3,
    updateTriggers: {
      getElevation: [state.is3D],
    },
  });

  overlay.setProps({ layers: [buildings, glow], getTooltip: buildingTooltip });
}

// ---------------------------------------------------------------------------
// Legend.
function renderLegend() {
  const container = document.getElementById("legend");
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = COLOR_MODES.find((c) => c.name === state.colorMode)?.label ?? "";
  container.appendChild(heading);

  if (state.colorMode === "uncertainty") {
    const gradient = document.createElement("div");
    gradient.className = "norm-gradient";
    gradient.style.background = "linear-gradient(90deg, #4fbf8f 0%, #c0392b 100%)";
    container.appendChild(gradient);
    const ticks = document.createElement("div");
    ticks.className = "norm-gradient-ticks";
    ticks.innerHTML = "<span>Confident (0.0)</span><span>Uncertain (1.0)</span>";
    container.appendChild(ticks);
    return;
  }

  if (state.colorMode === "consensus") {
    const gradient = document.createElement("div");
    gradient.className = "norm-gradient";
    gradient.style.background = "linear-gradient(90deg, #c0392b 0%, #4fbf8f 100%)";
    container.appendChild(gradient);
    const ticks = document.createElement("div");
    ticks.className = "norm-gradient-ticks";
    ticks.innerHTML = "<span>Low agreement</span><span>All models agree</span>";
    container.appendChild(ticks);
    return;
  }

  if (state.colorMode === "split") {
    const counts = {};
    for (const f of state.data.features) {
      const split = splitOf(f);
      if (split && SPLIT_COLORS[split]) counts[split] = (counts[split] ?? 0) + 1;
    }
    const list = document.createElement("ul");
    list.className = "legend-list";
    for (const key of SPLIT_ORDER) {
      if (!counts[key]) continue;
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = SPLIT_COLORS[key];
      const span = document.createElement("span");
      span.textContent = `${SPLIT_LABELS[key]} (${counts[key]})`;
      item.append(swatch, span);
      list.appendChild(item);
    }
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = UNLABELED_COLOR;
    const span = document.createElement("span");
    span.textContent = "Inference (no split)";
    item.append(swatch, span);
    list.appendChild(item);
    container.appendChild(list);
    return;
  }

  if (state.colorMode === "error") {
    const list = document.createElement("ul");
    list.className = "legend-list";
    for (const [key, label, color] of [
      ["correct", "Correct", CORRECT_COLOR],
      ["incorrect", "Incorrect", INCORRECT_COLOR],
      ["none", "No ground truth", UNLABELED_COLOR],
    ]) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = color;
      const span = document.createElement("span");
      span.textContent = label;
      item.append(swatch, span);
      list.appendChild(item);
    }
    container.appendChild(list);
    return;
  }

  const counts = {};
  for (const f of state.data.features) {
    const key = state.colorMode === "truth" ? truthOf(f) : predictionOf(f);
    counts[key ?? "unlabeled"] = (counts[key ?? "unlabeled"] ?? 0) + 1;
  }
  const list = document.createElement("ul");
  list.className = "legend-list";
  for (const key of CLASS_ORDER) {
    if (!counts[key]) continue;
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = CLASS_COLORS[key];
    const span = document.createElement("span");
    span.textContent = `${CLASS_LABELS[key] ?? key} (${counts[key]})`;
    item.append(swatch, span);
    list.appendChild(item);
  }
  if (counts.unlabeled) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = UNLABELED_COLOR;
    const span = document.createElement("span");
    span.textContent = `Unlabeled (${counts.unlabeled})`;
    item.append(swatch, span);
    list.appendChild(item);
  }
  container.appendChild(list);
}

// ---------------------------------------------------------------------------
// Chart helpers (plain inline SVG, no charting library -- same pattern as
// every other map in this project).
const CHART_WIDTH = 280;
const CHART_HEIGHT = 190;
const CHART_MARGIN = { top: 26, right: 10, bottom: 46, left: 34 };

function barChartSvg({ entries, colorFor, maxOverride, marginBottom = CHART_MARGIN.bottom, rotateLabels = true, topLabelFor, yFormat = (v) => Math.round(v) }) {
  const margin = { ...CHART_MARGIN, bottom: marginBottom };
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const plotHeight = CHART_HEIGHT - margin.top - margin.bottom;
  const maxCount = maxOverride ?? Math.max(1, ...entries.map((e) => e.count));
  const barGap = 8;
  const barWidth = (plotWidth - barGap * (entries.length - 1)) / Math.max(1, entries.length);
  const plotBottom = margin.top + plotHeight;

  let bars = "";
  let labels = "";
  entries.forEach((entry, i) => {
    const barHeight = maxCount > 0 ? (entry.count / maxCount) * plotHeight : 0;
    const x = margin.left + i * (barWidth + barGap);
    const y = plotBottom - barHeight;
    const cx = x + barWidth / 2;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${colorFor(entry, i)}" rx="3"></rect>`;
    if (entry.count > 0) {
      bars += topLabelFor
        ? `<text x="${cx}" y="${y - 8}" text-anchor="middle" class="chart-bar-label">${topLabelFor(entry)}</text>`
        : `<text x="${cx}" y="${y - 22}" text-anchor="middle" class="chart-bar-label"><tspan x="${cx}" dy="0">${entry.count}</tspan><tspan x="${cx}" dy="14">${entry.pct}%</tspan></text>`;
    }
    if (rotateLabels) {
      labels += `<text x="${cx + 4}" y="${plotBottom + 12}" text-anchor="end" class="chart-axis-label" transform="rotate(-40 ${cx + 4} ${plotBottom + 12})">${entry.label}</text>`;
    } else {
      labels += `<text x="${cx}" y="${plotBottom + 14}" text-anchor="middle" class="chart-axis-label">${entry.label}</text>`;
    }
  });

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${margin.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${yFormat(maxCount * t)}</text>`;
  }

  return `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${margin.left}" y1="${plotBottom}" x2="${CHART_WIDTH - margin.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${bars}
    ${labels}
  </svg>`;
}

// ---------------------------------------------------------------------------
// 1. Composition chart: the main bar is the PREDICTED label distribution
// (all buildings, active model) -- always fully populated, no "unlabeled"
// category. The other two, smaller bars are the actual ground-truth
// composition of the active experiment's train split and val+test split
// (the real labeled samples the models were trained/evaluated on). Bar
// height is driven by % (so all 3 series are comparable regardless of how
// many buildings are in each group); count+% are still shown as the label.
// CR/M dominate every experiment's composition; bucketing ADO/W into
// "Other" keeps the chart legible everywhere except the leave-one-out
// experiment, which specifically exists to look at how those rarer classes
// generalize -- there the chart names them individually instead.
const COMPOSITION_OTHER_CLASSES = ["ADO", "W"];
function compositionBucket(cls) {
  return COMPOSITION_OTHER_CLASSES.includes(cls) ? "Other" : cls;
}

function renderCompositionChart() {
  const container = document.getElementById("composition-chart");
  const bucketClass = state.experiment === "loo_santo_domingo" ? (c) => c : compositionBucket;
  const compositionOrder = state.experiment === "loo_santo_domingo" ? CLASS_ORDER : [...CLASS_ORDER.filter((c) => !COMPOSITION_OTHER_CLASSES.includes(c)), "Other"];
  const total = state.data.features.length;
  const predCounts = {};
  for (const f of state.data.features) {
    const pred = predictionOf(f);
    if (pred) predCounts[bucketClass(pred)] = (predCounts[bucketClass(pred)] ?? 0) + 1;
  }
  // Train composition comes straight from the experiment's own
  // class_distribution (results.json) -- the real training set the active
  // model was fit on, which for a pooled experiment spans both datasets at
  // once (that's genuinely how it was trained, so it's correct to leave
  // un-filtered). Test composition, though, must be THIS dataset's own
  // test-split buildings specifically (results.json's version pools both
  // datasets together and doesn't reflect "the active dataset" the actual
  // per-building evaluation ran on) -- computed live from the same
  // per-building split/truth data already merged into state.data.
  const dist = state.results[state.experiment].class_distribution ?? {};
  const trainCounts = {};
  for (const [cls, count] of Object.entries(dist.train ?? {})) {
    const bucket = bucketClass(cls);
    trainCounts[bucket] = (trainCounts[bucket] ?? 0) + count;
  }
  const trainTotal = Object.values(trainCounts).reduce((a, b) => a + b, 0);
  const testCounts = {};
  let testTotal = 0;
  for (const f of state.data.features) {
    const split = splitOf(f);
    if (split !== "val" && split !== "test") continue;
    const truth = truthOf(f);
    if (!truth) continue;
    const bucket = bucketClass(truth);
    testCounts[bucket] = (testCounts[bucket] ?? 0) + 1;
    testTotal += 1;
  }
  const keys = compositionOrder.filter((k) => predCounts[k] || trainCounts[k] || testCounts[k]);

  const margin = { ...CHART_MARGIN };
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const plotHeight = CHART_HEIGHT - margin.top - margin.bottom;
  const groupGap = 10;
  const groupWidth = (plotWidth - groupGap * (keys.length - 1)) / keys.length;
  const barGap = 2;
  const barWidth = (groupWidth - barGap * 2) / 3;
  const plotBottom = margin.top + plotHeight;
  const maxPct = Math.max(
    0.001,
    ...keys.map((k) => (predCounts[k] ?? 0) / (total || 1)),
    ...keys.map((k) => (trainCounts[k] ?? 0) / (trainTotal || 1)),
    ...keys.map((k) => (testCounts[k] ?? 0) / (testTotal || 1)),
  );

  const series = [
    { counts: predCounts, denom: total, opacity: 1, tag: "Predict" },
    { counts: trainCounts, denom: trainTotal, opacity: 0.55, tag: "Train" },
    { counts: testCounts, denom: testTotal, opacity: 0.28, tag: "Test" },
  ];
  // With up to 4 classes x 3 series (12 skinny bars), per-bar text -- count,
  // %, and a rotated series tag -- overlapped badly. Numbers only show when
  // a bar is wide enough to hold them; the series legend moved out of the
  // bars entirely, into a fixed row below the chart (see the opacity
  // swatches appended to `container.innerHTML` further down).
  const MIN_LABEL_BAR_WIDTH = 16;

  let bars = "";
  let labels = "";
  keys.forEach((key, i) => {
    const gx = margin.left + i * (groupWidth + groupGap);
    const color = key === "Other" ? "#7a6ff0" : CLASS_COLORS[key];
    series.forEach((s, si) => {
      const count = s.counts[key] ?? 0;
      const pct = s.denom > 0 ? count / s.denom : 0;
      const h = (pct / maxPct) * plotHeight;
      const x = gx + si * (barWidth + barGap);
      const y = plotBottom - h;
      bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="${color}" opacity="${s.opacity}" rx="2"></rect>`;
      if (count > 0 && barWidth >= MIN_LABEL_BAR_WIDTH) {
        bars += `<text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" class="chart-bar-label" style="font-size:0.6rem">${(pct * 100).toFixed(0)}%</text>`;
      }
    });
    const cx = gx + groupWidth / 2;
    labels += `<text x="${cx}" y="${plotBottom + 16}" text-anchor="middle" class="chart-axis-label">${CLASS_SHORT_CODE[key] ?? key}</text>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = plotBottom - t * plotHeight;
    yAxisLabels += `<text x="${margin.left - 6}" y="${y + 3}" text-anchor="end" class="chart-axis-label">${Math.round(maxPct * t * 100)}%</text>`;
  }

  const seriesLegend = series
    .map((s) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="width:10px;height:10px;border-radius:2px;background:#9aa5ac;opacity:${s.opacity};display:inline-block"></span>${s.tag}</span>`)
    .join("");
  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${margin.left}" y1="${plotBottom}" x2="${CHART_WIDTH - margin.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    ${yAxisLabels}
    ${bars}
    ${labels}
  </svg>
  <div class="hint" style="margin-top:8px">${seriesLegend}</div>`;
}

// ---------------------------------------------------------------------------
// 2. Confusion matrix -- count + % (of row total), colored by %.
//
// results.json has no "ensemble" metrics/confusion-matrix section at all
// (only per-base-model ones, plus "near_best_ensemble" metadata describing
// how it was built) -- so for the Ensemble "model" this is always computed
// directly from the real per-building ensemble_prediction data this map
// already has loaded, never from results.json. Base models
// (LogisticRegression, RandomForest, ...) still read their own numbers from
// results.json directly.
// A class with fewer than this many ground-truth buildings in the active
// dataset is too small to say anything meaningful about (e.g. Santo
// Domingo's "W" (wood/light) class is a handful of buildings) -- excluded
// from the confusion matrix/metrics, though it's still colorable on the map.
const MIN_CLASS_SAMPLES = 10;

function computeConfusionMatrixFromRecords(getPrediction) {
  const classCounts = {};
  for (const f of state.data.features) {
    const truth = truthOf(f);
    if (truth) classCounts[truth] = (classCounts[truth] ?? 0) + 1;
  }
  const labels = CLASS_ORDER.filter((c) => (classCounts[c] ?? 0) >= MIN_CLASS_SAMPLES);
  if (labels.length === 0) return null;
  const idx = Object.fromEntries(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const f of state.data.features) {
    const truth = truthOf(f);
    if (!truth || !(truth in idx)) continue;
    const pred = getPrediction(f);
    if (!pred || !(pred in idx)) continue;
    matrix[idx[truth]][idx[pred]] += 1;
  }
  return { labels, matrix };
}
function metricsFromMatrix(matrix) {
  const n = matrix.length;
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return { macroF1: null, accuracy: null, kappa: null };
  const rowSums = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: n }, (_, c) => matrix.reduce((s, r) => s + r[c], 0));
  const f1s = matrix.map((row, i) => {
    const tp = row[i];
    const precision = colSums[i] > 0 ? tp / colSums[i] : 0;
    const recall = rowSums[i] > 0 ? tp / rowSums[i] : 0;
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  });
  const macroF1 = f1s.reduce((a, b) => a + b, 0) / n;
  const accuracy = matrix.reduce((s, row, i) => s + row[i], 0) / total;
  return { macroF1, accuracy, kappa: kappaFromMatrix(matrix) };
}
// Always computed live from this dataset's own per-building data -- never
// from results.json's confusion_matrix, which is pooled across BOTH
// datasets and therefore doesn't reflect "the active dataset" the brief
// calls for. Only meaningful for the currently-loaded experiment, since
// that's the only one whose per-building predictions are merged into
// state.data.
function confusionMatrixFor(experiment, model) {
  if (experiment !== state.experiment) return null;
  return computeConfusionMatrixFromRecords((f) => predictionOf(f, model));
}
function renderConfusionMatrix() {
  const container = document.getElementById("confusion-matrix");
  const cm = confusionMatrixFor(state.experiment, state.model);
  if (!cm) {
    container.innerHTML = '<p class="hint">No confusion matrix for this model.</p>';
    return;
  }
  const { labels, matrix } = cm;
  const n = labels.length;
  const cellSize = Math.min(56, Math.floor((CHART_WIDTH - 60) / n));
  const originX = 60;
  const originY = 38;
  const CM_LOW = hexToRgb("#14181d"); // panel-solid, "0%"
  const CM_HIGH = hexToRgb("#e2a33f"); // amber, "100%"
  let cells = "";
  for (let r = 0; r < n; r++) {
    const rowTotal = matrix[r].reduce((a, b) => a + b, 0) || 1;
    for (let c = 0; c < n; c++) {
      const count = matrix[r][c];
      const pct = (count / rowTotal) * 100;
      const t = pct / 100;
      const [cr, cg, cb] = lerpColor(CM_LOW, CM_HIGH, t);
      const color = `rgb(${cr},${cg},${cb})`;
      const textColor = t > 0.55 ? "#241804" : "#edf1f3";
      const x = originX + c * cellSize;
      const y = originY + r * cellSize;
      cells += `<rect x="${x}" y="${y}" width="${cellSize - 2}" height="${cellSize - 2}" fill="${color}" rx="3"></rect>`;
      cells += `<text x="${x + (cellSize - 2) / 2}" y="${y + (cellSize - 2) / 2 - 3}" text-anchor="middle" class="chart-bar-label" fill="${textColor}">${count}</text>`;
      cells += `<text x="${x + (cellSize - 2) / 2}" y="${y + (cellSize - 2) / 2 + 12}" text-anchor="middle" class="chart-axis-label" fill="${textColor}">${pct.toFixed(0)}%</text>`;
    }
  }
  let rowLabels = "";
  let colLabels = "";
  labels.forEach((l, i) => {
    const short = CLASS_SHORT_CODE[l] ?? l;
    rowLabels += `<text x="${originX - 6}" y="${originY + i * cellSize + (cellSize - 2) / 2 + 4}" text-anchor="end" class="chart-axis-label">${short}</text>`;
    colLabels += `<text x="${originX + i * cellSize + (cellSize - 2) / 2}" y="${originY - 8}" text-anchor="middle" class="chart-axis-label">${short}</text>`;
  });
  const totalHeight = originY + n * cellSize + 10;
  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${totalHeight}">
    <text x="${originX + (n * cellSize) / 2}" y="10" text-anchor="middle" class="chart-axis-label">Predicted</text>
    ${colLabels}
    ${rowLabels}
    ${cells}
  </svg>`;
}

// ---------------------------------------------------------------------------
// 3. Evaluation metrics table -- one row per base model + Ensemble, active
// model in bold.
// Cohen's kappa from a raw confusion matrix -- the ensemble's own metrics
// object (unlike every base model's) doesn't carry a pre-computed kappa, but
// its confusion matrix is enough to derive one with the standard formula.
function kappaFromMatrix(matrix) {
  const n = matrix.length;
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rowSums = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums = Array.from({ length: n }, (_, c) => matrix.reduce((sum, row) => sum + row[c], 0));
  const po = matrix.reduce((sum, row, i) => sum + row[i], 0) / total;
  const pe = rowSums.reduce((sum, rs, i) => sum + (rs * colSums[i]) / (total * total), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

function renderMetricsTable() {
  const container = document.getElementById("metrics-table");
  const exp = state.results[state.experiment];
  const rows = [];
  for (const [model, data] of Object.entries(exp.models)) {
    const gen = data.generalizability;
    const ciLower = gen?.test_f1_ci_lower;
    const ciUpper = gen?.test_f1_ci_upper;
    rows.push({
      model,
      macroF1: data.metrics.macro_f1,
      accuracy: data.metrics.accuracy,
      kappa: data.metrics.cohen_kappa,
      ci: typeof ciLower === "number" && typeof ciUpper === "number" ? `±${Math.round(((ciUpper - ciLower) / 2) * 100)}%` : "-",
    });
  }
  for (const model of liveComputedModels(state.experiment)) {
    const cm = confusionMatrixFor(state.experiment, model);
    const metrics = cm ? metricsFromMatrix(cm.matrix) : { macroF1: null, accuracy: null, kappa: null };
    rows.push({ model, ...metrics, ci: "-" });
  }

  rows.sort((a, b) => (b.macroF1 ?? -Infinity) - (a.macroF1 ?? -Infinity));

  const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : "-");
  const body = rows
    .map((r) => {
      const isActive = r.model === state.model;
      const style = isActive ? ' style="font-weight:700;color:var(--amber-ink)"' : "";
      const ciText = r.ci !== "-" ? ` <span class="hint" style="font-size:0.75em">${r.ci}</span>` : "";
      return `<tr${style}><td>${shortModelLabel(r.model)}</td><td>${fmt(r.macroF1)}${ciText}</td><td>${fmt(r.accuracy)}</td><td>${fmt(r.kappa)}</td></tr>`;
    })
    .join("");
  container.innerHTML = `<table class="metrics-table"><thead><tr><th>Model</th><th>F1 ±95%CI</th><th>Acc</th><th>κ</th></tr></thead><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// 4. Feature importance -- consensus ranking across models for the active
// experiment (lower = more important); no per-model importances exist.
// Shortens the raw feature-column names for a legible axis label -- these
// come straight from the ML pipeline's own column names (verbose norm/code
// prefixes, camelCase suffixes), not written for display.
const FEATURE_NAME_SHORTENINGS = [
  [/^GNDTII_/, "GNDT "],
  [/^ASCE7_/, "ASCE7 "],
  [/^EC8_/, "EC8 "],
  [/^NTC23_/, "NTC23 "],
  [/^CSCR2010_/, "CSCR "],
  [/^roof_material_/, "roof: "],
  [/^relativePosition_/, "pos: "],
  [/^contact_/, "cont "],
  [/setbackSlenderness/i, "setbkSlend"],
  [/eccentricityRatio/i, "eccRatio"],
  [/irregularity/i, "irreg"],
  [/Slenderness/i, "Slend"],
  [/_/g, " "],
];
function shortenFeatureName(name) {
  let s = name;
  for (const [pattern, replacement] of FEATURE_NAME_SHORTENINGS) s = s.replace(pattern, replacement);
  return s.length > 13 ? s.slice(0, 12) + "…" : s;
}

function renderFeatureImportance() {
  const container = document.getElementById("feature-importance-chart");
  document.getElementById("feature-importance-title").textContent = "Feature importance (consensus rank)";
  const consensus = state.results[state.experiment].feature_importance_consensus;
  const entries = Object.entries(consensus)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10);
  const maxRank = Math.max(...entries.map(([, v]) => v));

  const margin = { top: 10, right: 34, bottom: 10, left: 92 };
  const rowHeight = 20;
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const height = margin.top + entries.length * rowHeight + margin.bottom;

  let bars = "";
  entries.forEach(([name, rank], i) => {
    const barWidth = Math.max(2, plotWidth * (1 - rank / (maxRank * 1.1)));
    const y = margin.top + i * rowHeight;
    bars += `<text x="${margin.left - 6}" y="${y + rowHeight / 2 + 4}" text-anchor="end" class="chart-axis-label">${shortenFeatureName(name)}</text>`;
    bars += `<rect x="${margin.left}" y="${y + 3}" width="${barWidth}" height="${rowHeight - 7}" fill="#3987e5" rx="2"></rect>`;
    bars += `<text x="${margin.left + barWidth + 4}" y="${y + rowHeight / 2 + 4}" text-anchor="start" class="chart-axis-label">${rank.toFixed(1)}</text>`;
  });
  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${height}">${bars}</svg>`;
}

// ---------------------------------------------------------------------------
// 5. Learning curve -- embedded per-experiment in results.json now (not a
// separate city-wide CSV), one line per model, x=n_train, y=val_f1_mean.
const LEARNING_CURVE_COLORS = ["#3987e5", "#e2a33f", "#4fbf8f", "#c14fb8", "#e0776b", "#f2d43d", "#7a6ff0"];
function renderLearningCurve() {
  const container = document.getElementById("learning-curve-chart");
  const rows = state.results[state.experiment]?.learning_curve;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<p class="hint">No data.</p>';
    return;
  }
  const availableModels = [...new Set(rows.map((r) => r.model))];
  // Only the active model's own curve -- or, for the ensemble, every base
  // model that has a learning curve at all, since the ensemble is built
  // from several.
  const models = state.model === ENSEMBLE_MODEL ? availableModels : availableModels.filter((m) => m === state.model);
  if (models.length === 0) {
    container.innerHTML = `<p class="hint">No learning curve for ${modelLabel(state.model)}.</p>`;
    return;
  }
  const maxN = Math.max(...rows.map((r) => r.n_train));
  const margin = { top: 22, right: 14, bottom: 26, left: 34 };
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const plotHeight = CHART_HEIGHT - margin.top - margin.bottom;
  const plotBottom = margin.top + plotHeight;
  const x = (n) => margin.left + (n / maxN) * plotWidth;
  const y = (f1) => margin.top + (1 - Math.max(0, Math.min(1, f1))) * plotHeight;

  let paths = "";
  let legend = "";
  models.forEach((model, i) => {
    const color = LEARNING_CURVE_COLORS[availableModels.indexOf(model) % LEARNING_CURVE_COLORS.length];
    const pts = rows.filter((r) => r.model === model).sort((a, b) => a.n_train - b.n_train);
    const d = pts.map((p, j) => `${j === 0 ? "M" : "L"}${x(p.n_train).toFixed(1)},${y(p.val_f1_mean).toFixed(1)}`).join(" ");
    paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"></path>`;
    legend += `<span style="white-space:nowrap;display:inline-block;margin-right:8px"><span style="color:${color}">&#9632;</span> ${shortModelLabel(model)}</span>`;
  });

  let yAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    yAxisLabels += `<text x="${margin.left - 6}" y="${plotBottom - t * plotHeight + 3}" text-anchor="end" class="chart-axis-label">${t.toFixed(2)}</text>`;
  }
  let xAxisLabels = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    xAxisLabels += `<text x="${margin.left + t * plotWidth}" y="${plotBottom + 14}" text-anchor="middle" class="chart-axis-label">${Math.round(t * maxN)}</text>`;
  }

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <line x1="${margin.left}" y1="${plotBottom}" x2="${CHART_WIDTH - margin.right}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${plotBottom}" stroke="rgba(255,255,255,0.18)"></line>
    <text x="${margin.left}" y="12" text-anchor="start" class="chart-axis-label">F1</text>
    <text x="${CHART_WIDTH - margin.right}" y="${plotBottom + 26}" text-anchor="end" class="chart-axis-label">Training size</text>
    ${yAxisLabels}
    ${xAxisLabels}
    ${paths}
  </svg>
  <p class="hint" style="margin-top:6px;font-size:0.68rem;line-height:1.6">${legend}</p>`;
}

// ---------------------------------------------------------------------------
// 6. Cross-experiment F1 comparison for the active model.
// Base-model F1s come straight from results.json (unaffected by the
// ensemble margin, still correct for any experiment). The ensemble's F1 is
// computed from real per-building ensemble_prediction data (see
// confusionMatrixFor's note above) -- for the *active* experiment that data
// is already loaded; for the others this fetches+caches their small
// per-experiment JSON (same file loadExperiment() would load) without
// switching the map's current view.
function macroF1ForBaseModel(experiment, model) {
  const exp = state.results[experiment];
  return exp.models[model]?.metrics.macro_f1 ?? null;
}
// Works for either live-computed model (the plain ensemble or its
// prior-adjusted variant) against any experiment -- for the currently
// loaded one the per-building data is already merged into state.data; for
// any other, this fetches+caches its small per-experiment JSON (same file
// loadExperiment() would load) without switching the map's current view.
async function liveMacroF1For(experiment, model) {
  if (experiment === state.experiment) {
    const cm = confusionMatrixFor(experiment, model);
    return cm ? metricsFromMatrix(cm.matrix).macroF1 : null;
  }
  const cacheKey = `${state.datasetId}:${experiment}`;
  let expData = state.expCache[cacheKey];
  if (!expData) {
    expData = await fetch(`${DATA_ROOT}/${state.datasetId}/${experiment}.json`).then((r) => r.json());
    state.expCache[cacheKey] = expData;
  }
  const cm = computeConfusionMatrixFromRecords((f) => expData[f.properties.id]?.[`${model}_prediction`] ?? null);
  return cm ? metricsFromMatrix(cm.matrix).macroF1 : null;
}

let experimentCompareRequestId = 0;
async function renderExperimentCompareChart() {
  const container = document.getElementById("experiment-compare-chart");
  const requestId = ++experimentCompareRequestId;
  container.innerHTML = '<p class="hint">Loading…</p>';

  const isEnsembleFamily = state.model === ENSEMBLE_MODEL || state.model === PRIOR_ADJUSTED_MODEL;
  // For the ensemble family, the two experiments with a prior-adjusted
  // variant get split into "no prior" + "with prior" bars; everything else
  // (and every non-ensemble model) gets a single bar for whichever model is
  // active.
  const rows = COMPARE_EXPERIMENTS.flatMap((e) => {
    if (isEnsembleFamily && PRIOR_ADJUSTED_EXPERIMENTS.has(e.name)) {
      return [
        { key: e.name, model: ENSEMBLE_MODEL, label: e.label, sublabel: "no prior" },
        { key: e.name, model: PRIOR_ADJUSTED_MODEL, label: e.label, sublabel: "with prior" },
      ];
    }
    return [{ key: e.name, model: isEnsembleFamily ? ENSEMBLE_MODEL : state.model, label: e.label, sublabel: null }];
  });
  const f1s = await Promise.all(rows.map((r) => (isEnsembleFamily ? liveMacroF1For(r.key, r.model) : Promise.resolve(macroF1ForBaseModel(r.key, r.model)))));
  if (requestId !== experimentCompareRequestId) return; // a newer selection superseded this fetch

  const activeRowIndex = rows.findIndex((r) => r.key === state.experiment && r.model === state.model);
  const activeF1 = activeRowIndex >= 0 ? f1s[activeRowIndex] : null;
  const entries = rows.map((r, i) => {
    const f1 = f1s[i];
    return { key: r.key, model: r.model, label: r.label, sublabel: r.sublabel, count: f1 === null ? 0 : f1, pct: f1 === null ? "n/a" : (f1 * 100).toFixed(1), f1 };
  }).filter((e) => e.f1 !== null);

  const colorFor = (e) => {
    if (e.key === state.experiment && e.model === state.model) return "#e2a33f";
    if (activeF1 === null) return "#3987e5";
    return e.f1 >= activeF1 ? "#4fbf8f" : "#c0392b";
  };
  // Horizontal bars -- with full experiment names (not truncated/rotated),
  // a vertical layout gives each one all the width it needs for its label.
  // A "no prior"/"with prior" sublabel goes on its own line below the
  // experiment name rather than appended inline, which was overflowing.
  const hasSublabels = entries.some((e) => e.sublabel);
  const margin = { top: 6, right: 40, bottom: 6, left: 118 };
  const plotWidth = CHART_WIDTH - margin.left - margin.right;
  const rowHeight = hasSublabels ? 40 : 30;
  const barGap = 8;
  const height = margin.top + entries.length * rowHeight + margin.bottom;

  let bars = "";
  entries.forEach((e, i) => {
    const y = margin.top + i * rowHeight;
    const barHeight = rowHeight - barGap;
    const barWidth = Math.max(2, plotWidth * e.f1);
    const labelY = e.sublabel ? y + barHeight / 2 - 3 : y + barHeight / 2 + 4;
    bars += `<text x="${margin.left - 8}" y="${labelY}" text-anchor="end" class="chart-axis-label">${e.label}</text>`;
    if (e.sublabel) {
      bars += `<text x="${margin.left - 8}" y="${labelY + 13}" text-anchor="end" class="chart-axis-label" style="opacity:0.75">${e.sublabel}</text>`;
    }
    bars += `<rect x="${margin.left}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${colorFor(e)}" rx="3"></rect>`;
    bars += `<text x="${margin.left + barWidth + 6}" y="${y + barHeight / 2 + 4}" text-anchor="start" class="chart-bar-label">${e.pct}%</text>`;
  });

  container.innerHTML = `<svg viewBox="0 0 ${CHART_WIDTH} ${height}">${bars}</svg>`;
}

// ---------------------------------------------------------------------------
// Building popup.
function renderBuildingPanel(id, object) {
  const panel = document.getElementById("building-panel");
  const content = document.getElementById("building-panel-content");
  content.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = `Building ${id}`;
  content.appendChild(heading);

  const truth = truthOf(object);
  const subtitle = document.createElement("p");
  subtitle.className = "building-subtitle";
  subtitle.textContent = truth ? `Ground truth: ${CLASS_LABELS[truth] ?? truth}` : "No ground truth for this building";
  content.appendChild(subtitle);

  const models = currentModelsForExperiment();
  const table = document.createElement("table");
  table.className = "building-summary";
  const tbody = document.createElement("tbody");
  for (const model of models) {
    const pred = predictionOf(object, model);
    const unc = uncertaintyOf(object, model);
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = modelLabel(model);
    const td = document.createElement("td");
    td.textContent = pred ? `${pred}${typeof unc === "number" ? ` (uncertainty ${unc.toFixed(2)})` : ""}` : "n/a";
    if (model === state.model) {
      th.style.fontWeight = "700";
      th.style.color = "var(--amber-ink)";
      td.style.fontWeight = "700";
      td.style.color = "var(--amber-ink)";
    }
    if (truth && pred) {
      td.style.color = pred === truth ? CORRECT_COLOR : INCORRECT_COLOR;
    }
    row.append(th, td);
    tbody.appendChild(row);
  }
  const splitRow = document.createElement("tr");
  const splitTh = document.createElement("th");
  splitTh.textContent = "Split (active experiment)";
  const splitTd = document.createElement("td");
  splitTd.textContent = splitOf(object) ?? "n/a";
  splitRow.append(splitTh, splitTd);
  tbody.appendChild(splitRow);
  table.appendChild(tbody);
  content.appendChild(table);

  // Probability distribution for the active model (every model, including
  // the ensemble, carries its own per-class probability columns now). Uses
  // every class the pipeline scored (not confusionMatrixFor's list, which
  // drops classes with too few ground-truth samples for reliable metrics --
  // a real per-building probability, unlike a metric, exists regardless),
  // then rescales so the bar always reads as a full 100% for this building.
  {
    const rawProbs = CLASS_ORDER.map((c) => ({ label: c, value: expField(object, `${state.model}_${c}_probability`) })).filter((p) => typeof p.value === "number");
    const probSum = rawProbs.reduce((sum, p) => sum + p.value, 0);
    const probs = probSum > 0 ? rawProbs.map((p) => ({ ...p, value: p.value / probSum })) : rawProbs;
    if (probs.length > 0) {
      const probHeading = document.createElement("h3");
      probHeading.textContent = `${modelLabel(state.model)} probability distribution`;
      probHeading.style.margin = "10px 0 4px";
      probHeading.style.fontSize = "0.9rem";
      content.appendChild(probHeading);
      const bar = document.createElement("div");
      bar.className = "prob-bar";
      for (const p of probs) {
        const seg = document.createElement("div");
        seg.className = "prob-seg";
        seg.style.width = `${(p.value * 100).toFixed(1)}%`;
        seg.style.background = CLASS_COLORS[p.label] ?? UNLABELED_COLOR;
        seg.title = `${CLASS_SHORT_CODE[p.label] ?? p.label}: ${(p.value * 100).toFixed(1)}%`;
        bar.appendChild(seg);
      }
      content.appendChild(bar);
      const probLegend = document.createElement("p");
      probLegend.className = "hint";
      probLegend.style.marginTop = "4px";
      probLegend.textContent = probs.map((p) => `${CLASS_SHORT_CODE[p.label] ?? p.label}: ${(p.value * 100).toFixed(1)}%`).join("  ·  ");
      content.appendChild(probLegend);
    }
  }

  panel.classList.remove("hidden");
}
function closeBuildingPanel() {
  document.getElementById("building-panel").classList.add("hidden");
  state.selectedBuildingId = null;
  renderLayer();
}
function selectBuilding(id, object) {
  state.selectedBuildingId = id;
  renderLayer();
  renderBuildingPanel(id, object);
}
onBuildingClick = selectBuilding;

// ---------------------------------------------------------------------------
// Dropdowns.
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
    setOptions(newOptions, current) {
      options = newOptions;
      renderOptions(current);
      const found = options.find((o) => o.value === current);
      if (found) valueEl.textContent = found.label;
    },
    setValue(value) {
      const option = options.find((o) => o.value === value);
      if (option) valueEl.textContent = option.label;
      renderOptions(value);
    },
  };
}

let datasetDropdown = null;
let experimentDropdown = null;
let modelDropdown = null;
let attributeDropdown = null;

function mergeExperimentData(expData) {
  for (const [uid, record] of Object.entries(expData)) {
    const feature = state.byUid.get(uid);
    if (feature) feature.properties.__exp = record;
  }
}

async function loadExperiment(experiment, { fromShowcase = false } = {}) {
  const cacheKey = `${state.datasetId}:${experiment}`;
  let expData = state.expCache[cacheKey];
  if (!expData) {
    expData = await fetch(`${DATA_ROOT}/${state.datasetId}/${experiment}.json`).then((r) => r.json());
    state.expCache[cacheKey] = expData;
  }
  state.experiment = experiment;
  experimentDropdown?.setValue(experiment);
  mergeExperimentData(expData);

  const models = currentModelsForExperiment();
  modelDropdown?.setOptions(
    models.map((m) => ({ value: m, label: modelLabel(m) })),
    models.includes(state.model) ? state.model : DEFAULT_MODEL,
  );
  if (!models.includes(state.model)) state.model = DEFAULT_MODEL;
  refreshColorModeOptions();

  renderLegend();
  renderCompositionChart();
  renderConfusionMatrix();
  renderMetricsTable();
  renderFeatureImportance();
  renderExperimentCompareChart();
  renderLearningCurve();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

function availableColorModes() {
  let modes = COLOR_MODES.filter((c) => !c.ensembleOnly || state.model === ENSEMBLE_MODEL);
  if (ACTIVE_VIEW) {
    const allowed = new Set(VIEW_PRESETS[ACTIVE_VIEW].colorModes);
    modes = modes.filter((c) => allowed.has(c.name));
  }
  return modes;
}
function refreshColorModeOptions() {
  const modes = availableColorModes();
  if (!modes.some((m) => m.name === state.colorMode)) state.colorMode = DEFAULT_COLOR_MODE;
  attributeDropdown?.setOptions(
    modes.map((c) => ({ value: c.name, label: c.label })),
    state.colorMode,
  );
}

function setModel(model, { fromShowcase = false } = {}) {
  state.model = model;
  modelDropdown?.setValue(model);
  refreshColorModeOptions();
  renderLegend();
  renderConfusionMatrix();
  renderMetricsTable();
  renderExperimentCompareChart();
  renderLearningCurve();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

function setColorMode(mode, { fromShowcase = false } = {}) {
  state.colorMode = mode;
  attributeDropdown?.setValue(mode);
  renderLegend();
  renderLayer();
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

async function loadDataset(datasetId) {
  const dir = DATASETS[datasetId].dir;
  const buildings = await fetch(`${dir}/buildings.geojson`).then((r) => r.json());
  state.datasetId = datasetId;
  state.data = buildings;
  // String-keyed: JSON object keys (from the per-experiment files) are
  // always strings even though `id` is numeric in the GeoJSON, so both
  // sides must be coerced the same way or every lookup below silently misses.
  state.byUid = new Map(buildings.features.map((f) => [String(f.properties.id), f]));
  elevationClamp = elevationClampFor(buildings);

  const [[minX, minY], [maxX, maxY]] = computeBbox(buildings);
  state.datasetCenter = { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 };

  await loadExperiment(state.experiment, { fromShowcase: true });
}

async function setDataset(datasetId, { fromShowcase = false } = {}) {
  await loadDataset(datasetId);
  datasetDropdown?.setValue(datasetId);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 60, duration: fromShowcase ? 0 : 500 });
  if (!fromShowcase) stopShowcase({ resumeAfterIdle: true });
}

// ---------------------------------------------------------------------------
// Showcase mode: orbit the dataset center in 3D (unless the map is in 2D,
// in which case it just cycles color-by modes without rotating); every 10s
// advance to the next color-by mode.
let showcaseRotateFrame = null;
let showcaseAttributeTimer = null;
let showcaseIdleTimer = null;
let showcaseAttributeIndex = 0;
const SHOWCASE_ATTRIBUTE_CYCLE_MS = 10_000;

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

  const modes = availableColorModes();
  showcaseAttributeIndex = showcaseAttributeIndex % modes.length;
  setColorMode(modes[showcaseAttributeIndex].name, { fromShowcase: true });
  showcaseAttributeTimer = setInterval(() => {
    const currentModes = availableColorModes();
    showcaseAttributeIndex = (showcaseAttributeIndex + 1) % currentModes.length;
    setColorMode(currentModes[showcaseAttributeIndex].name, { fromShowcase: true });
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

// Shows only the chart card(s) this view cares about, and switches the
// panel to a single-column, larger-plot layout -- these "slide" URLs are
// meant for presenting one thing at a time, not the full 6-card dashboard.
function applyViewPreset() {
  if (!ACTIVE_VIEW) return;
  const keep = new Set(VIEW_PRESETS[ACTIVE_VIEW].charts);
  document.querySelectorAll(".chart-card").forEach((card) => {
    if (!keep.has(card.dataset.chart)) card.classList.add("hidden");
  });
  document.getElementById("charts-panel").classList.add("large-view");
}

async function bootstrap() {
  applyViewPreset();
  state.results = await fetch(`${DATA_ROOT}/results.json`).then((r) => r.json());

  datasetDropdown = createDropdown(
    document.getElementById("dataset-select"),
    Object.entries(DATASETS).map(([value, { label }]) => ({ value, label })),
    (value) => setDataset(value),
  );
  experimentDropdown = createDropdown(
    document.getElementById("experiment-select"),
    EXPERIMENTS.map((e) => ({ value: e.name, label: e.label })),
    (value) => loadExperiment(value),
  );
  experimentDropdown.setValue(state.experiment);
  modelDropdown = createDropdown(document.getElementById("model-select"), [{ value: DEFAULT_MODEL, label: ENSEMBLE_LABEL }], (value) => setModel(value));
  attributeDropdown = createDropdown(
    document.getElementById("attribute-select"),
    availableColorModes().map((c) => ({ value: c.name, label: c.label })),
    (value) => setColorMode(value),
  );
  attributeDropdown.setValue(state.colorMode);

  await loadDataset(DEFAULT_DATASET);
  datasetDropdown.setValue(DEFAULT_DATASET);
  const [[minX, minY], [maxX, maxY]] = computeBbox(state.data);
  // Startup only: this map's charts panel is much wider than every other
  // map's (2-column grid of 6 cards), so a symmetric fitBounds visually
  // centers the data under it -- padding the right side harder here shifts
  // the visible framing left, into the actual free space. Padding the
  // bottom harder than the top shifts the framing up too.
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: { top: 60, bottom: 220, left: 60, right: ACTIVE_VIEW ? 720 : 620 }, duration: 0 });

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
