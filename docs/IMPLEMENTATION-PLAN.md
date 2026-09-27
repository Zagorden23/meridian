# MERIDIAN — Implementation Plan (OAuth hardening · UI/UX · Navigation)

> Written after the Phase 0 audit of the working project. Nothing here replaces
> the architecture documented in `ARCHITECTURE.md`; every change is additive and
> preserves the running globe, the PGLite/Neon geo layer, and the honest
> "unconfigured provider" behavior.

## 0. Audit summary (what already exists)

| Area | Where | State |
|---|---|---|
| Auth core (sessions, OTP, OAuth code flow) | `src/lib/meridian/auth.js` | working, Mongo/Mongoose |
| Auth API routes | `src/routes/api/auth/**` | working (`session`, `logout`, `providers`, OTP ×4, `$provider`, `$provider.callback`, `unlink-provider`) |
| Auth UI | `src/components/auth/auth-page.jsx` | working but OAuth buried below the email form |
| App shell + globe | `src/routes/app.jsx` → `components/meridian/meridian-ui.jsx` | working; globe persists across module switches |
| Sections (Explore…Settings) | `store/meridian-store.js` (`activeModule`) | **store-only — no URLs, no deep links, no back/forward** |
| Geo/weather/flight API | `src/routes/api/**` + `src/lib/meridian/*` | working |
| Design tokens | `src/styles.css` | working (observatory palette) |

## 1. Real gaps found (the work)

1. **OAuth does not preserve the intended destination.** Sealed state carries
   `intent` only; the callback always redirects to `/app`.
2. **No ID-token validation for Google/Microsoft.** Only the `userinfo`
   endpoint is called — no JWKS signature check, no `iss`/`aud` check, and the
   `nonce` that is issued is never verified.
3. **Apple is verified by hand** (x5c certificate path), the `nonce` is not
   checked, and the first-authorization `user` payload (name/email) is dropped.
4. **Two dead imports** (`sendError`) in the OAuth route files.
5. **Auth UX** has no provider icons, no primary/secondary hierarchy, no
   in-flight state on the provider buttons, and sends OAuth users to `/app`.
6. **Navigation** has no routes per section; the sidebar is buttons-only.
7. **`.gitignore` does not exclude env files.**
8. No toast/feedback layer (`sonner` is installed but unused).

## 2. Plan

### Phase 1 — auth correctness
- New `src/lib/meridian/oidc.js`: provider metadata (issuer, JWKS, audience) and
  `verifyIdToken()` using `jose` (`createRemoteJWKSet` + `jwtVerify`), with
  explicit `iss`/`aud`/`exp` checks plus manual `nonce` comparison. Microsoft
  uses discovery (multi-tenant `iss` pattern); Apple's JWKS carries `n`/`e` so
  hand-rolled certificate parsing can go.
- `auth.js`: `safeReturnTo()` local-path sanitizer; `startOAuthUrl(..., returnTo)`;
  `resolveOAuthIdentity(providerId, code, redirectUri, { nonce, appleUser })`
  verifies the `id_token` whenever the provider returns one, falls back to
  `userinfo`, and keeps every unconfigured path an honest 503.
- Routes: pass `returnTo` into the sealed cookie, verify `state` + `nonce`,
  consume Apple's `form_post` `user` payload, and redirect to the sanitized
  destination (never an off-site URL — no open redirect).

### Phase 2 — auth UX
- Rebuild the auth screen around one decision: provider buttons first
  (Google / Microsoft / Apple with real brand marks), a divider, then
  "Continue with Email", phone as a secondary tab, guest last.
- In-flight state per button (no double submit), human error copy, and
  `returnTo` plumbed through OTP sign-in and OAuth alike.

### Phase 3 — navigation
- `/app` becomes a layout route; sections become real child routes
  (`/app/explore` … `/app/settings`). The shell (globe, search, status bar)
  lives in the layout, so switching sections never remounts the canvas.
- URL is the source of truth: routes mirror into `activeModule` for the
  existing store readers. Sidebar/account menu become `<Link>`s.
- Deep links and back/forward work; unauthenticated deep links round-trip
  through `/auth?returnTo=…`.

### Phase 4 — polish
- Page-transition wrapper, animated active indicator in the rail, skeleton
  atoms for loading panels, a `sonner` toaster for real success/failure
  feedback, and reduced-motion coverage throughout.

### Phase 5 — verification
- `npm run lint`, `npm run test`, `npm run build`, then browser smoke on the
  dev server and on the built output (desktop + mobile).
