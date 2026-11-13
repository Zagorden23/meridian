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

`MONGODB_URI` is required (a local `mongod` is fine). In development, email
and phone codes are shown on the sign-in screen instead of being sent, so the
flows can be exercised without Resend or Twilio; that preview never exists in
a production build.

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
| Phone OTP | `SMS_PROVIDER_KEY` `SMS_PROVIDER_SECRET` + `SMS_VERIFY_SERVICE_SID` (Twilio Verify, recommended) or `SMS_FROM` |

## MongoDB setup

Create an Atlas cluster (or local `mongod`), set `MONGODB_URI`, and the app
connects on first request (`connectMongo()`), creating `2dsphere` and lookup
indexes automatically. Collections are created lazily — no migration step.

## Going live with sign-in

A sign-in method is offered to visitors only once its credentials are set on
the server — until then it is left off the sign-in screen rather than shown
broken. Password sign-in needs only MongoDB; everything else needs an account
with the provider:

| Method | Where the credentials come from | Variables |
|---|---|---|
| Google | Google Cloud Console → Credentials → OAuth client ID (Web). Publish the consent screen. | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` |
| Microsoft | Entra admin center → App registrations (Web; any directory + personal accounts) | `MICROSOFT_CLIENT_ID` `MICROSOFT_CLIENT_SECRET` |
| Apple | Apple Developer → Services ID + Sign in with Apple key (.p8). HTTPS domain required. | `APPLE_CLIENT_ID` `APPLE_TEAM_ID` `APPLE_KEY_ID` `APPLE_PRIVATE_KEY` |
| Email codes, password reset | Resend → verify your sending domain (DNS) → API key | `EMAIL_PROVIDER_KEY` `EMAIL_FROM` |
| Phone codes | Twilio → Verify → create a service (6-digit codes) | `SMS_PROVIDER_KEY` `SMS_PROVIDER_SECRET` `SMS_VERIFY_SERVICE_SID` |

1. Set `APP_URL` to the public HTTPS address and register this callback with
   each OAuth provider: `<APP_URL>/api/auth/<provider>/callback`
   (e.g. `https://meridian.example.com/api/auth/google/callback`).
2. Put the variables in the host's dashboard (`render.yaml` declares them all).
3. Check them before and after deploying:

   ```bash
   npm run auth:doctor                        # what is live; tests each credential with its provider
   npm run auth:doctor -- --email you@x.com   # also send a real email through Resend
   npm run auth:doctor -- --sms +14155550123  # also send a real SMS through Twilio
   ```

   It reports, per method, READY / OFF / PROBLEM — including a callback URL
   that is not registered, a sending domain that is not verified, or a Twilio
   trial account that cannot reach real customers.
4. `npm run build && npm run test:auth-e2e` drives every method through the
   production build in a real browser against stand-in providers (no
   credentials needed), so a code change cannot silently break sign-in.

`GET /api/auth/providers` reports the same per-method status (flags only,
never secrets). Provider rejections are written to the server log with the
provider's own reason.

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
npm run auth:doctor     # sign-in readiness: config + live credential checks
npm run test:auth-e2e   # every sign-in method, production build, real browser
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
- One-time codes: scrypt-hashed, single-use, purpose-bound, 5-minute expiry,
  5 attempts, 60s resend cooldown, per-recipient and per-IP limits plus an
  hourly ceiling on codes sent (`OTP_SMS_HOURLY_LIMIT`, `OTP_EMAIL_HOURLY_LIMIT`).
- POST bodies must be `application/json`, so another site cannot drive
  sign-in with a visitor's browser.
- Rate limiting on API + OTP routes, security headers (`nosniff`, `DENY`,
  `no-store`) on API responses, request-body validation, no secret logging.
