# MERIDIAN — Architecture Audit & Evolution Plan

> Phase 0 deliverable. Written after inspecting the working project at
> `http://localhost:8080/`. Nothing here rebuilds the app — it records what
> exists, what stays, and how the platform layers attach without regressions.

## 1. Current architecture

- **Stack (JS-only):** React 19 + TanStack Start/Router (`src/router.jsx`,
  `src/routes/__root.jsx`, `src/routes/index.jsx`) + Vite 8 + Tailwind v4.
  State in `zustand` (`src/store/globe-store.js`). 3D via `three` +
  `@react-three/fiber` + `@react-three/drei` + `camera-controls`.
- **Entry:** `src/routes/index.jsx` renders `<GlobeExperience/>` (lazy
  `globe-canvas.jsx` → R3F `<Canvas>`) plus `<Hud/>` overlay. Document shell in
  `__root.jsx` keeps `<AuthProvider>` + `<PreviewHostBridge/>` (platform
  chrome — never remove).
- **DB:** MongoDB via Mongoose (`src/lib/meridian/mongo.js` & `auth-models.js`)
  with `2dsphere` geospatial indexes on `cities`, `airports`, `countries`, and
  `pois`, plus TTL indexes on `weatherSnapshots`, `otpCodes`, and `authSessions`.
- **Server surface:** REST API routes under `src/routes/api/` backed purely by
  MongoDB. Dev on `0.0.0.0:8080` via `scripts/with-app-env.mjs`; `startup.sh`
  owns the restart contract.
- **Deploy target:** Render web service (`render.yaml`).
  Never writes `.env`; only `VITE_`-prefixed vars reach the browser.

## 2. Existing components (retain as-is)

| Component | File | Status |
|---|---|---|
| `GlobeExperience` / `GlobeCanvas` | `components/globe/*` | working — KDOP |
| `Earth` (day/normal/specular + clouds + atmosphere) | `earth.jsx` | working |
| `Markers` (12 featured, pulsing sprites) | `markers.jsx` | working |
| `Routes` (nearest-neighbour arcs + pulses) | `routes.jsx` | working, keep for ambient network |
| `CameraRig` (drag/zoom/WASD/`[]`/tour) | `camera-rig.jsx` | working |
| `Hud` (brand, orbit toggle, place card, featured list) | `overlay/hud.jsx` | working, extend don't replace |
| `useGlobeStore` (selectedId/hovered/autoRotate/focusNonce) | `store/globe-store.js` | working, extend additively |
| `latLonToVector3`, `outwardQuaternion`, `greatCirclePoints` | `lib/geo.js` | working WGS84 helpers, reuse everywhere |
| `PLACES` (12 curated) + `ROUTES` | `data/*` | working, keep as fallback/featured layer |
| Textures `earth-day/normal/specular/clouds` | `public/textures/` | working |

## 3. Existing dependencies

`three`, `@react-three/fiber`, `@react-three/drei`, `camera-controls`,
`zustand`, `@tanstack/*`, `mongoose`, `mongodb`, `zod`,
`lucide-react`, Radix set, `recharts`. **No new runtime deps required** for
the platform layers below (2D map is dependency-free canvas; weather uses
`fetch`; OpenSky needs no SDK). Keep it that way.

## 4. Existing data flow

`PLACES` (static JS) → `Markers`/`Routes`/`Hud` via `useGlobeStore`;
camera follows `selectedId` through `focusNonce`. No backend, no fetch, no
cache. This flow stays intact as the **featured layer**; DB-backed places
arrive as a parallel **catalog layer** through repositories (never imported
directly by components).

## 5. Existing APIs

None (app routes only). New surface follows the envelope in §8 and lives in
`src/routes/api/**` as thin wrappers over `src/lib/meridian/*` services.

## 6. What is retained

Everything in §2, the MERIDIAN identity (cinematic/observatory/dark/editorial
tokens in `styles.css` + `lib/theme.js`), JS-only rule (no TS/TSX), globe as
visual centerpiece, orbit/drag/zoom/tour/keyboard behavior, MongoDB geo
queries (`$geoNear` + bounding box), `startup.sh` + preview contracts.

## 7. What must be extended

DB schema → geo catalog → search → location panel → weather → 2D map + sync →
airports/airlines → domestic/international travel → flight search/status/track
→ 3D routes → POI → timezone/day-night → AI tools → favorites → security →
perf → tests → Render deploy. Gated order per spec (GATE 1 → GATE 14).

## 8. New architecture

```text
3D Globe (three, kept) ⇄ MapAdapter ⇄ 2D Map (canvas, new)
            ⇄ React UI (sidebar/search/panels, new) ⇄ /api/* (new)
            ⇄ services (src/lib/meridian/*) ⇄ MongoDB (Mongoose models + 2dsphere)
            ⇄ providers: Open-Meteo (weather, keyless) / OpenSky (live
               positions, keyless, coverage-limited) / licensed schedule
               APIs (key-gated, honest "unavailable" states)
```

- **Envelope:** `{ success, data, meta: { source, fetchedAt, cached,
  requestId } }`; errors `{ success:false, error:{code,message}, requestId }`.
- **Spatial decision:** Geo queries use MongoDB native `$geoNear` (`2dsphere`
  indexed `location` GeoJSON points) paired with viewport bounding-box
  range queries and pure-JS Haversine math (`geo-math.js`).
- **No fake data:** every dynamic panel shows `source · updated X ago`; missing
  provider coverage renders explicit unavailable states, never invented values.
- **Perf:** LOD markers (featured → capitals → viewport query), debounced
  search, short-TTL weather cache, one polling loop per tracked flight shared
  across clients, no WS server (poll + interpolate; upgrade path documented).

## 9. Seeding & collection strategy

1. Additive only: new files under `src/lib/meridian/`, `src/routes/api/`,
   `src/components/meridian/`; store extended with new slices (old keys
   untouched). `PLACES` remains the featured fallback while loading.
2. MongoDB collections + `2dsphere` / TTL indexes initialize automatically;
   `GeoRepository` auto-seeds curated real-coordinate data when empty and
   `scripts/import-geodata.js --geonames` ingests GeoNames dumps idempotently.
3. After every gate: run app, exercise old + new paths, check console/network,
   fix regressions before continuing. `npm run build` + smoke before deploy.
