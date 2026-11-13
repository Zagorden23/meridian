# MERIDIAN — Global Travel Intelligence

MERIDIAN is a premium, globally oriented travel / geospatial intelligence web
application: a cinematic 3D globe and 2D map, worldwide place search, real
weather, airport and flight intelligence, timezone resolution, saved places,
and multi-provider authentication — in one continuous app shell.

> No fake data: every live field comes from a real provider or is honestly
> labelled unavailable. No fake auth: unconfigured providers return clear
> errors instead of pretend sessions.

## Architecture

```
React + JSX (TanStack Start, single service)
        ↓  same-origin /api/* (no frontend API keys)
Node server functions (JS only)
        ↓
MongoDB via Mongoose (exclusive primary store for geo catalog, weather cache, accounts, OTPs, sessions, saved places)
        ↓
External providers (server-side only — secrets never reach the browser)
```

- **Frontend:** `src/components/` (globe, meridian modules, auth, landing),
  `src/store/` (zustand: auth, meridian, globe), `src/routes/` (file routes).
- **Backend:** `src/routes/api/**` thin routes → `src/lib/meridian/*` services
  (auth, weather, flights, geocoding, timezone, rate-limit, OTP).
- **Globe:** Three.js / `@react-three/fiber` canvas that stays mounted while
  sections switch; a 2D Leaflet map shares the same selection state.
- **Database:** MongoDB collections (`users`, `authSessions`, `otpCodes`,
  `countries`, `states`, `cities`, `airports`, `airlines`, `flightStatuses`,
  `flightPositions` (7-day TTL), `flightTracks` (30-day TTL),
  `weatherSnapshots` (30-min TTL), `pois`, `savedLocations`, `searchHistory`)
  with `2dsphere` indexes on every `location` field (GeoJSON `[lon, lat]`).

## Features

- **Explore / Weather / Travel / Maps / Discover / Tools / Saved / AI / Settings**
  as URL-addressable sections (`/app?m=travel`) sharing one globe shell.
- **Global search:** cities, countries, airports, POIs, `lat,lon` coordinates.
- **Weather:** real Open-Meteo current + 5-day forecast with short-TTL caching
  and honest stale-cache fallback.
- **Flights:** licensed-provider abstraction (schedule/status/boards activate
  with `FLIGHT_API_KEY`) + keyless OpenSky live positions where ADS-B coverage
  exists. Planned routes are always visually distinct from flown tracks.
- **Location flow:** browser geolocation → reverse geocode → timezone →
  nearest airport → weather, as one progressive interaction.
- **Auth:** Google / Microsoft / Apple / Amazon OAuth (OIDC `id_token`
  verification: JWKS signature, issuer, audience, nonce) + email OTP (Resend)
  + phone OTP (Twilio) + guest mode. Sessions are 256-bit tokens, sha256 at
  rest, HttpOnly `SameSite=Lax` cookies (`Secure` in production).

## Technology stack

React 19 · TanStack Start/Router/Query · Three.js + @react-three/fiber/drei ·
Leaflet · Tailwind v4 · Radix · zustand · Mongoose · jose (OIDC) · sonner ·
Node 22 · JavaScript only (no TypeScript, no SQL in app code).

## Local setup

```bash
npm install
cp .env.example .env   # then fill in values (never commit .env)
npm run dev            # serves on 0.0.0.0:8080
```

Without `MONGODB_URI` the app runs on the embedded fallback DB; auth
endpoints return honest `503` until their credentials are configured.

## Environment variables

See `.env.example` (every variable documented there). Summary:

| Group | Vars |
|---|---|
| App | `NODE_ENV` `PORT` `APP_URL` `FRONTEND_URL` `API_URL` |
| MongoDB | `MONGODB_URI` |
| Security | `SESSION_SECRET` (≥32 chars) |
| Google | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` (`GOOGLE_CALLBACK_URL` optional) |
| Microsoft | `MICROSOFT_CLIENT_ID` `MICROSOFT_CLIENT_SECRET` `MICROSOFT_TENANT_ID` (`MICROSOFT_CALLBACK_URL` optional) |
| Apple | `APPLE_CLIENT_ID` `APPLE_TEAM_ID` `APPLE_KEY_ID` `APPLE_PRIVATE_KEY` (`APPLE_CALLBACK_URL` optional) |
| Weather | `WEATHER_PROVIDER=open-meteo` (keyless) |
| Flights | `FLIGHT_API_KEY`, optional `OPENSKY_CLIENT_ID/SECRET` |
| Email OTP | `EMAIL_PROVIDER_KEY` `EMAIL_FROM` (Resend) |
| Phone OTP | `SMS_PROVIDER_KEY` `SMS_PROVIDER_SECRET` `SMS_FROM` (Twilio) |

## MongoDB setup

Create an Atlas cluster (or local `mongod`), set `MONGODB_URI`, and the app
connects on first request (`connectMongo()`), creating `2dsphere` and lookup
indexes automatically. Collections are created lazily — no migration step.

## OAuth setup

1. In each provider console, register the callback
   `<APP_URL>/api/auth/<provider>/callback`
   (e.g. `https://meridian.example.com/api/auth/google/callback`).
   Apple additionally needs the Services ID, Team ID, Key ID and private key.
2. Set the corresponding env vars and redeploy.
3. `GET /api/auth/providers` reports per-provider status (flags only, never
   secrets); the sign-in screen enables each button only when configured.

## API provider setup

- **Weather (Open-Meteo):** no key. `GET /api/weather?lat=..&lon=..`.
- **Flights:** without `FLIGHT_API_KEY`, search/status/boards return typed
  `503 PROVIDER_UNAVAILABLE`; live traffic (`GET /api/flights/live`) uses
  OpenSky (anonymous or OAuth client). Wire a licensed schedule API into
  `src/lib/meridian/flight-providers.js` to light up search/status.
- **Geocoding/timezone:** `GET /api/locations/search|reverse|nearby`,
  `GET /api/timezone`.
- **Health:** `GET /api/health` (`{status, service, db, version, time}`),
  `GET /api/providers/health` (db, mongo, flight coverage, weather).

## Commands

```bash
npm run dev      # dev server (0.0.0.0:8080)
npm run build    # production build (Vite + Nitro)
npm start        # serve production build (Render / any Node host)
npm run lint     # eslint
npm test         # node:test suites (auth, geo-math, flights, timezone, …)
```

## Deployment (Render)

`render.yaml` defines one web service (`npm ci --include=dev && npm run build` →
`npm start`, health check `/api/health`) backed by MongoDB. Set `MONGODB_URI`,
`SESSION_SECRET` and any provider keys in the Render dashboard. The backend
listens on `process.env.PORT`; the frontend calls same-origin `/api/*`, so no
production URL juggling and no CORS wildcard (authenticated APIs never use
`origin: "*"`).

## Security notes

- Secrets live only in server env; `VITE_*` is the only prefix reaching the browser.
- OAuth: authorization-code flow, signed `state`+`nonce` HttpOnly cookies,
  server-side code exchange, JWKS `id_token` verification, open-redirect-safe
  `returnTo`, no auto-merge on bare email (explicit link flow, `409` otherwise).
- Rate limiting on API + OTP routes, security headers (`nosniff`, `DENY`,
  `no-store`) on API responses, request-body validation, no secret logging.
