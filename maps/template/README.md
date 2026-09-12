# Santo Domingo building viewer — template

Frontend-only template (no backend, no model predictions) for showing the
Santo Domingo building survey database on a 3D map, styled after
`visor/city_risk_visor`. It only ever displays raw dataset values — nothing
computed or predicted.

## Run it

Needs to be served over HTTP (the building data loads via `fetch()`, which
`file://` won't allow):

```bash
cd BerlinConference/maps/template
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## What it does

- Loads `data/santo_domingo_buildings.geojson` (exported from
  `Data/Datasets/footprints_santo_domingo.gpkg`) and renders every building
  as an extruded 3D footprint (deck.gl `GeoJsonLayer` over a MapLibre dark
  basemap).
- Colors buildings by one attribute at a time ("Color by" dropdown + legend,
  top-left panel).
- Clicking a building opens a right-side panel listing every non-empty
  property recorded for it (generic key/value table — see
  `renderBuildingPanel` in `main.js`).
- **Showcase mode**: on load, the camera orbits the city center in 3D while
  the coloring attribute cycles through the list every 10s. Any click/drag/
  zoom/rotate on the map stops it immediately; if the map then sits idle for
  30s, showcase mode restarts automatically.

## Things you'll want to change

All in `main.js`, near the top:

- `PARAMS` — the list of attributes offered in the dropdown and cycled
  through in showcase mode. Entries not present in the loaded GeoJSON are
  skipped automatically (with a console note) rather than breaking the map —
  a few geometric shape indices (EC8 eccentricity, slenderness, compactness,
  FSI) are listed but commented as "not yet joined onto the data"; add the
  matching column to the GeoJSON and they'll appear on their own.
- `SHOWCASE_PARAM_CYCLE_MS` / `SHOWCASE_IDLE_RESUME_MS` /
  `SHOWCASE_ROTATE_DEG_PER_SEC` — the 10s/30s/rotation-speed knobs from the
  brief.
- `DATA_URL` — swap in a different city's exported GeoJSON to reuse this
  template elsewhere; keep an `id` property on every feature (used as the
  popup title and click-selection key).

## Prepared for expansion, kept simple

This template deliberately does only the one job above. It already carries
the hooks a fuller map (more panels, tabs, per-field formatting, real
settings) would need, without building any of that out yet:

- `#settings-panel` (index.html) is a working glass-panel flyout, wired to
  its own toggle/close buttons, with no content — drop controls into
  `#settings-panel-content` the way `visor/.../settingsPanel.ts` does.
- `renderBuildingPanel` in `main.js` is a single generic table. A real map
  can replace its body with curated sections/tabs (see the visor's
  `buildingController.ts` / `vulnerabilityPanel.ts` for that pattern) while
  keeping the same open/close/select plumbing already here
  (`selectBuilding`, `closeBuildingPanel`, `#building-panel-close`).
- `style.css` reuses the visor's exact color tokens (`--bg`, `--panel`,
  `--amber`, etc.) and `.glass-panel`/`.dropdown`/`.legend-list` classes, so
  a panel copied in from the visor keeps its look with no restyling.
