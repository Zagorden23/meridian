// MERIDIAN authentication core — server-only, MongoDB/Mongoose only.
// No SQL, no passwords (OTP + OAuth only), no secrets in the browser.
//
// Sessions: 256-bit random tokens, sha256-hashed at rest, HttpOnly cookies.
// OTP: 6-digit codes, scrypt-hashed, 5-minute expiry, 5 attempts max,
//   60s resend cooldown, hourly request caps. Codes are NEVER logged.
// OAuth: authorization-code flow for Google / Microsoft / Apple / Amazon with
//   signed state+nonce cookies and server-side token exchange + verification.
//   Every provider returns HTTP 503 with a clear message until its credentials
//   are configured — OAuth is never faked.
import "./load-env.js";
import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import mongoose from "mongoose";
import { SignJWT, importPKCS8 } from "jose";
import { connectMongo } from "./mongo.js";
import { httpError } from "./api-envelope.js";
import { verifyIdToken } from "./oidc.js";

function requireSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || String(s).trim().length < 32) {
    throw httpError(500, "SESSION_SECRET_MISSING", "Server session secret is not configured.");
  }
  return String(s);
}

function model(name, schema) {
  if (mongoose.models[name]) return mongoose.models[name];
  return mongoose.model(name, schema);
}

// --- Models (users collection + supporting auth collections) -----------------
export const User = () => model("MeridianUser", new mongoose.Schema({
  email: { type: String, lowercase: true, trim: true, index: true },
  emailVerified: { type: Boolean, default: false },
  // Apple hands out a @privaterelay.appleid.com address unless the person
  // chooses to share their own. It is a real, deliverable contact address, so
  // it is stored — and flagged, so the UI never presents it as their mailbox.
  emailIsPrivateRelay: { type: Boolean, default: false },
  phone: { type: String, trim: true, index: true },
  phoneVerified: { type: Boolean, default: false },
  name: String,
  avatar: String,
  authProviders: [{
    provider: { type: String, required: true },
    providerUserId: { type: String, required: true },
    email: String,
    linkedAt: { type: Date, default: Date.now },
    _id: false,
  }],
  // Email+password credential (commercial fallback that works without any
  // external provider). scrypt hash + unique salt; never selected by default.
  passwordHash: { type: String, select: false },
  passwordSalt: { type: String, select: false },
  passwordUpdatedAt: Date,
  role: { type: String, default: "user" },
  accountStatus: { type: String, default: "active" },
  preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastLoginAt: Date,
}, { collection: "users" }));

export const OtpCode = () => model("MeridianOtp", new mongoose.Schema({
  identifier: { type: String, required: true, index: true }, // normalized email or E.164 phone
  channel: { type: String, enum: ["email", "phone"], required: true },
  codeHash: { type: String, required: true },
  salt: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }, // TTL at absolute time
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  resendAvailableAt: Date,
  consumedAt: Date,
  createdAt: { type: Date, default: Date.now },
}, { collection: "otpCodes" }));

export const AuthSession = () => model("MeridianSession", new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, expires: 0 }, // 30-day TTL
  userAgent: String,
}, { collection: "authSessions" }));

export async function ensureAuthIndexes() {
  await connectMongo();
  const u = User().collection;
  await u.createIndex({ email: 1 }, { unique: true, sparse: true }).catch(() => {});
  await u.createIndex({ phone: 1 }, { unique: true, sparse: true }).catch(() => {});
  // Compound provider index keeps linking possible: uniqueness is per
  // (provider, providerUserId), never on bare email, so multi-provider
  // accounts and same-email conflicts stay representable.
  await u.createIndex(
    { "authProviders.provider": 1, "authProviders.providerUserId": 1 },
    { unique: true, sparse: true },
  ).catch(() => {});
}

// --- Normalizers / validators -------------------------------------------------
export function normalizeEmail(input) {
  const email = String(input ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    throw httpError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

export function normalizePhone(input, countryCode) {
  let raw = String(input ?? "").trim();
  if (countryCode && !raw.startsWith("+")) raw = `${countryCode} ${raw}`;
  const e164 = raw.replace(/[()\s.-]/g, "");
  if (!/^\+\d{7,15}$/.test(e164)) {
    throw httpError(400, "INVALID_PHONE", "Enter a valid phone number with country code.");
  }
  return e164;
}

export function validateName(input) {
  const name = String(input ?? "").trim().slice(0, 120);
  return name;
}

// --- OTP crypto (scrypt hash, constant-time verify, never logged) --------------
const scryptAsync = (pw, salt) => new Promise((res, rej) =>
  scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));

export function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

export async function hashOtp(code) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(code, salt);
  return { salt, codeHash: derived.toString("hex") };
}

export async function verifyOtp(code, salt, codeHash) {
  try {
    const derived = await scryptAsync(String(code).trim(), salt);
    const a = Buffer.from(derived.toString("hex"), "hex");
    const b = Buffer.from(codeHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Password credential (scrypt hash, constant-time verify) -------------------
// Commercial fallback: works offline with only MongoDB, no Resend/Twilio/OAuth.
export function validatePassword(input) {
  const pw = String(input ?? "");
  if (pw.length < 8 || pw.length > 128) {
    throw httpError(400, "WEAK_PASSWORD", "Use a password with at least 8 characters.");
  }
  return pw;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt);
  return { salt, passwordHash: derived.toString("hex") };
}

export async function verifyPassword(password, salt, passwordHash) {
  try {
    const derived = await scryptAsync(String(password ?? ""), salt);
    const a = Buffer.from(derived.toString("hex"), "hex");
    const b = Buffer.from(String(passwordHash), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function passwordConfigured() {
  return Boolean(process.env.MONGODB_URI && String(process.env.MONGODB_URI).trim());
}

// --- Delivery (Resend for email, Twilio for SMS; honest 503 otherwise) ---------
export function emailConfigured() {
  return Boolean(process.env.EMAIL_PROVIDER_KEY && process.env.EMAIL_FROM);
}

export function smsConfigured() {
  return Boolean(process.env.SMS_PROVIDER_KEY && process.env.SMS_PROVIDER_SECRET && process.env.SMS_FROM);
}

export async function sendEmailOtp(email, code) {
  if (!emailConfigured()) {
    throw httpError(503, "EMAIL_PROVIDER_UNCONFIGURED",
      "Email delivery is not configured on this server. Set EMAIL_PROVIDER_KEY and EMAIL_FROM.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.EMAIL_PROVIDER_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `Your MERIDIAN code is ${code}`,
      text: `Your MERIDIAN verification code is ${code}. It expires in 5 minutes. If you did not request it, ignore this message.`,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw httpError(502, "EMAIL_SEND_FAILED", "The verification email could not be sent. Try again shortly.");
  }
}

export async function sendPhoneOtp(phone, code) {
  if (!smsConfigured()) {
    throw httpError(503, "SMS_PROVIDER_UNCONFIGURED",
      "SMS delivery is not configured on this server. Set SMS_PROVIDER_KEY, SMS_PROVIDER_SECRET and SMS_FROM.");
  }
  const sid = process.env.SMS_PROVIDER_KEY;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const basic = Buffer.from(`${sid}:${process.env.SMS_PROVIDER_SECRET}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: process.env.SMS_FROM, To: phone, Body: `Your MERIDIAN code is ${code}. It expires in 5 minutes.` }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw httpError(502, "SMS_SEND_FAILED", "The verification SMS could not be sent. Try again shortly.");
  }
}

// --- Sessions + cookies --------------------------------------------------------
export const SESSION_COOKIE = "meridian_session";
export const OAUTH_COOKIE = "meridian_oauth";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(request) {
  const out = {};
  for (const part of String(request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(secure, maxAge) {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${maxAge != null ? `; Max-Age=${maxAge}` : ""}`;
}

export function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(secure, Math.floor(SESSION_TTL_MS / 1000))}`;
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

const isSecureRequest = (request) => {
  const forwarded = String(request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  return new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
};

export function secureContext(request) {
  return isSecureRequest(request);
}

export async function createSession(userId, request) {
  await connectMongo();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await AuthSession().create({
    tokenHash,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 200),
  });
  return { token, cookie: sessionCookie(token, secureContext(request)) };
}

export async function getSessionUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  await connectMongo();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sess = await AuthSession().findOne({ tokenHash }).lean();
  if (!sess || sess.expiresAt < new Date()) {
    if (sess) await AuthSession().deleteOne({ _id: sess._id }).catch(() => {});
    return null;
  }
  const user = await User().findOne({ _id: sess.userId, accountStatus: "active" }).select("+passwordHash").lean();
  if (!user) return null;
  return { user: publicUser(user), sessionId: sess._id };
}

export async function destroySession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    await connectMongo().catch(() => {});
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await AuthSession().deleteOne({ tokenHash }).catch(() => {});
  }
  return clearSessionCookie(secureContext(request));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerified),
    emailIsPrivateRelay: Boolean(user.emailIsPrivateRelay),
    phone: user.phone ?? null,
    phoneVerified: Boolean(user.phoneVerified),
    name: user.name ?? null,
    avatar: user.avatar ?? null,
    providers: (user.authProviders ?? []).map((p) => p.provider),
    hasPassword: Boolean(user.passwordHash),
    role: user.role ?? "user",
    createdAt: user.createdAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

// --- OAuth providers -----------------------------------------------------------
export const OAUTH_PROVIDERS = {
  google: {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    label: "Microsoft",
    tenant: () => process.env.MICROSOFT_TENANT_ID || "common",
    authorize: () => `https://login.microsoftonline.com/${OAUTH_PROVIDERS.microsoft.tenant()}/oauth2/v2/authorize`,
    token: () => `https://login.microsoftonline.com/${OAUTH_PROVIDERS.microsoft.tenant()}/oauth2/v2/token`,
    userinfo: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid profile email",
    idEnv: "MICROSOFT_CLIENT_ID",
    secretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  apple: {
    label: "Apple",
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    jwks: "https://appleid.apple.com/auth/keys",
    scope: "name email",
    responseMode: "form_post",
    idEnv: "APPLE_CLIENT_ID", // Services ID
    secretEnv: null, // client_secret is a signed JWT (TEAM_ID/KEY_ID/PRIVATE_KEY)
  },
  amazon: {
    label: "Amazon",
    authorize: "https://www.amazon.com/ap/oa",
    token: "https://api.amazon.com/auth/o2/token",
    profile: "https://api.amazon.com/user/profile",
    scope: "profile",
    idEnv: "AMAZON_CLIENT_ID",
    secretEnv: "AMAZON_CLIENT_SECRET",
  },
};

// Explicit callback-URL overrides. Production deployments behind a proxy can
// publish a different public origin than the incoming request carries; when the
// variable is unset the callback is derived from the request origin (which is
// what the preview and single-host deploys need — never a hard-coded host).
const CALLBACK_ENV = {
  google: "GOOGLE_CALLBACK_URL",
  microsoft: "MICROSOFT_CALLBACK_URL",
  apple: "APPLE_CALLBACK_URL",
  amazon: "AMAZON_CALLBACK_URL",
};

export function oauthRedirectUri(providerId, origin) {
  const configured = process.env[CALLBACK_ENV[providerId]];
  if (configured && String(configured).trim()) return String(configured).trim();
  return `${origin}/api/auth/${providerId}/callback`;
}

// Where the user lands after a successful sign-in. Only a same-origin,
// path-like destination is ever accepted: an absolute or protocol-relative URL
// arriving from a query string would otherwise turn sign-in into an open
// redirect, and a backslash would be normalised into a host by some browsers.
export function safeReturnTo(value, fallback = "/app") {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || /[\r\n]/.test(raw)) return fallback;
  return raw.slice(0, 512);
}

export function providerStatus() {
  return Object.entries(OAUTH_PROVIDERS).map(([id, p]) => {
    const missing = [];
    if (!process.env[p.idEnv]) missing.push(p.idEnv);
    if (id === "apple") {
      if (!process.env.APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
      if (!process.env.APPLE_KEY_ID) missing.push("APPLE_KEY_ID");
      if (!process.env.APPLE_PRIVATE_KEY) missing.push("APPLE_PRIVATE_KEY");
    } else if (p.secretEnv && !process.env[p.secretEnv]) missing.push(p.secretEnv);
    return { id, label: p.label, configured: missing.length === 0, missing };
  });
}

export function requireProvider(id) {
  const cfg = OAUTH_PROVIDERS[id];
  if (!cfg) throw httpError(404, "UNKNOWN_PROVIDER", "Unknown authentication provider.");
  const status = providerStatus().find((p) => p.id === id);
  if (!status.configured) {
    throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED",
      `${cfg.label} sign-in is not configured on this server (${status.missing.join(", ")}).`);
  }
  return cfg;
}

// Signed OAuth state (state + nonce + intent), sealed in an HttpOnly cookie.
export function sealOAuthState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const sig = createHmac("sha256", requireSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function openOAuthState(sealed) {
  const [body, sig] = String(sealed ?? "").split(".");
  if (!body || !sig) throw httpError(400, "OAUTH_STATE_INVALID", "Sign-in request expired. Try again.");
  const expect = createHmac("sha256", requireSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw httpError(400, "OAUTH_STATE_INVALID", "Sign-in request expired. Try again.");
  }
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (data.exp < Date.now()) throw httpError(400, "OAUTH_STATE_INVALID", "Sign-in request expired. Try again.");
  return data;
}

export function oauthCookie(sealed, secure) {
  return `${OAUTH_COOKIE}=${encodeURIComponent(sealed)}; ${cookieAttrs(secure, 600)}`;
}

export function clearOAuthCookie(secure) {
  return `${OAUTH_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

export function startOAuthUrl(providerId, origin, intent = "login", returnTo = "/app") {
  const cfg = requireProvider(providerId);
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  // The destination travels inside the signed, HttpOnly state cookie — never in
  // a query string the callback would have to trust.
  const sealed = sealOAuthState({ state, nonce, provider: providerId, intent, returnTo: safeReturnTo(returnTo) });
  const redirectUri = oauthRedirectUri(providerId, origin);
  const clientId = process.env[cfg.idEnv];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
    nonce,
  });
  if (cfg.responseMode) params.set("response_mode", cfg.responseMode);
  const authorize = typeof cfg.authorize === "function" ? cfg.authorize() : cfg.authorize;
  return { url: `${authorize}?${params}`, sealed };
}

async function exchangeCode(providerId, code, redirectUri) {
  const cfg = OAUTH_PROVIDERS[providerId];
  const tokenUrl = typeof cfg.token === "function" ? cfg.token() : cfg.token;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: process.env[cfg.idEnv],
  });
  if (providerId === "apple") {
    body.set("client_secret", await appleClientSecret());
  } else {
    body.set("client_secret", process.env[cfg.secretEnv]);
  }
  let res;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error(`[oauth] ${providerId} token exchange network failed:`, err?.message ?? err);
    throw httpError(502, "OAUTH_EXCHANGE_FAILED", "The provider rejected the sign-in. Try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // Log status + provider error code only — never tokens or secrets.
    console.error(`[oauth] ${providerId} token exchange rejected:`, {
      status: res.status,
      error: json?.error ?? null,
      errorDescription: json?.error_description ?? null,
    });
    // Surface the provider's own error when it is safe to show (most common:
    // redirect_uri mismatch because the callback URL was not registered).
    const hint = String(json?.error_description ?? json?.error ?? "").slice(0, 200);
    const message = hint && /redirect_uri|redirect|client|authorized/i.test(hint)
      ? `The provider rejected the sign-in (${hint}). Check the callback URL registered in the provider console matches this app's origin.`
      : "The provider rejected the sign-in. Try again.";
    throw httpError(502, "OAUTH_EXCHANGE_FAILED", message);
  }
  return json;
}

function applePrivateKey() {
  const raw = process.env.APPLE_PRIVATE_KEY;
  if (!raw) throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED", "Apple sign-in is not configured.");
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

async function appleClientSecret() {
  // Apple requires the client_secret to be an ES256-signed JWT (JWS compact
  // serialization with a RAW R||S signature). Node's crypto.sign() returns a
  // DER-encoded EC signature, which Apple rejects with invalid_client — so
  // this uses jose, which emits the correct JWS encoding.
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!teamId || !keyId || !clientId) {
    throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED", "Apple sign-in is not configured.");
  }
  let key;
  try {
    key = await importPKCS8(applePrivateKey(), "ES256");
  } catch (err) {
    console.error("[oauth] apple private key import failed:", err?.message ?? err);
    throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED", "Apple sign-in key is invalid. Check APPLE_PRIVATE_KEY.");
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    return await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setAudience("https://appleid.apple.com")
      .setSubject(clientId)
      .sign(key);
  } catch (err) {
    console.error("[oauth] apple client_secret signing failed:", err?.message ?? err);
    throw httpError(502, "OAUTH_EXCHANGE_FAILED", "Apple sign-in could not start. Try again.");
  }
}

// Server-side identity resolution per provider (exchange already authenticated
// the client; identity is established from the verified id_token whenever the
// provider returns one, with userinfo as the fallback for Google/Microsoft).
// The nonce bound into the authorization request is verified against the token
// so a captured token from another session cannot be replayed here.
export async function resolveOAuthIdentity(providerId, code, redirectUri, { nonce = null, appleUser = null } = {}) {
  const tokens = await exchangeCode(providerId, code, redirectUri);
  if (providerId === "apple") {
    // Apple always returns an id_token — verified against Apple's JWKS with
    // issuer + audience + nonce checks. Verified claims are the identity.
    const claims = await verifyIdToken("apple", tokens.id_token, { nonce });
    let name = null;
    if (appleUser) {
      try {
        const parsed = typeof appleUser === "string" ? JSON.parse(appleUser) : appleUser;
        const full = parsed?.name ?? parsed;
        const given = full?.firstName ?? full?.givenName ?? "";
        const family = full?.lastName ?? full?.familyName ?? "";
        name = `${given} ${family}`.trim() || null;
        // Apple sends this payload exactly once (first authorization) — it is
        // display metadata, never identity. Email still comes from claims.
      } catch { /* display name is optional */ }
    }
    return {
      providerUserId: String(claims.sub),
      // Apple may withhold the real address behind a private relay — accept it
      // as the contact address but only mark verified when Apple says so.
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
      name,
      avatar: null,
    };
  }
  if (providerId === "amazon") {
    const res = await fetch(OAUTH_PROVIDERS.amazon.profile, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.error("[oauth] amazon profile verification failed:", res.status);
      throw httpError(502, "OAUTH_VERIFY_FAILED", "Amazon verification failed.");
    }
    const p = await res.json();
    return {
      providerUserId: String(p.user_id),
      email: p.email ?? null,
      emailVerified: Boolean(p.email),
      name: p.name ?? null,
      avatar: null,
    };
  }
  const cfg = OAUTH_PROVIDERS[providerId];
  // Google and Microsoft return an id_token alongside the access token.
  // Its signature, issuer, audience and nonce are verified against the
  // provider's JWKS — the verified claims are the identity. Userinfo is the
  // fallback only when no id_token was issued.
  if ((providerId === "google" || providerId === "microsoft") && tokens.id_token) {
    const claims = await verifyIdToken(providerId, tokens.id_token, { nonce });
    return {
      providerUserId: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true,
      name: claims.name ?? null,
      avatar: claims.picture ?? null,
    };
  }
  const res = await fetch(cfg.userinfo, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw httpError(502, "OAUTH_VERIFY_FAILED", `${cfg.label} verification failed.`);
  const p = await res.json();
  return {
    providerUserId: String(p.sub ?? p.id ?? ""),
    email: p.email ?? null,
    emailVerified: p.email_verified === true,
    name: p.name ?? null,
    avatar: p.picture ?? null,
  };
}

// --- Account resolution + safe linking ----------------------------------------
// Never auto-merge on bare email: a verified-email match to an existing
// account requires the user to sign in first, then link explicitly.
export async function resolveOAuthAccount(identity, providerId, sessionUserId = null) {
  await connectMongo();
  await ensureAuthIndexes().catch(() => {});
  const byProvider = await User().findOne({
    "authProviders.provider": providerId,
    "authProviders.providerUserId": identity.providerUserId,
  });
  if (byProvider) {
    if (byProvider.accountStatus !== "active") throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
    // Link flow must never silently switch to a DIFFERENT account that already
    // owns this provider — that would hand the session to someone else's user.
    if (sessionUserId && String(byProvider._id) !== String(sessionUserId)) {
      throw httpError(409, "ACCOUNT_LINK_CONFLICT",
        "This provider is already linked to another account. Sign in with it directly instead.");
    }
    return { user: byProvider, created: false };
  }
  if (sessionUserId && identity.email) {
    // Explicit link flow: authenticated user attaching a new provider.
    const me = await User().findById(sessionUserId);
    if (!me) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
    me.authProviders.push({ provider: providerId, providerUserId: identity.providerUserId, email: identity.email });
    if (identity.emailVerified && !me.email) {
      me.email = identity.email;
      me.emailVerified = true;
    }
    if (identity.name && !me.name) me.name = identity.name;
    if (identity.avatar && !me.avatar) me.avatar = identity.avatar;
    me.updatedAt = new Date();
    await me.save();
    return { user: me, created: false, linked: true };
  }
  const email = identity.email ? String(identity.email).toLowerCase() : null;
  if (email && identity.emailVerified) {
    const byEmail = await User().findOne({ email });
    if (byEmail && !(byEmail.authProviders ?? []).some((p) => p.provider === providerId)) {
      throw httpError(409, "ACCOUNT_LINK_REQUIRED",
        "An account already exists with this email. Sign in using the existing method, then link this provider from your profile.");
    }
    if (byEmail) {
      byEmail.authProviders.push({ provider: providerId, providerUserId: identity.providerUserId, email });
      byEmail.updatedAt = new Date();
      await byEmail.save();
      return { user: byEmail, created: false };
    }
  }
  const user = await User().create({
    email,
    emailVerified: Boolean(email && identity.emailVerified),
    name: identity.name,
    avatar: identity.avatar,
    authProviders: [{ provider: providerId, providerUserId: identity.providerUserId, email }],
    lastLoginAt: new Date(),
  });
  return { user, created: true };
}

export async function touchLogin(userId) {
  await User().updateOne({ _id: userId }, { $set: { lastLoginAt: new Date(), updatedAt: new Date() } }).catch(() => {});
}
