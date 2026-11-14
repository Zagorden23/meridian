// MERIDIAN authentication core — server-only.
// Persists cleanly to MongoDB via auth-storage.js.
//
// Sessions: 256-bit random tokens, sha256-hashed at rest, HttpOnly cookies.
// Passwords: email+password credential, scrypt-hashed with a unique salt.
// OTP: 6-digit codes, scrypt-hashed, 5-minute expiry, 5 attempts max,
//   60s resend cooldown, hourly request caps, purpose-bound.
// OAuth: authorization-code + PKCE (S256) flow for Google / Microsoft / Apple /
//   Amazon with signed state+nonce+codeVerifier cookies and JWKS id_token
//   verification. Unconfigured providers fail closed with honest 503.
import { loadLocalEnv } from "./load-env.js";
import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { httpError } from "./api-envelope.js";
import {
  CONSUMER_MICROSOFT_TENANT,
  claimIsTrue,
  looksLikeEmail,
  verifyIdToken,
} from "./oidc.js";
import { safeReturnTo } from "./return-to.js";
import {
  AuthSession,
  OtpCode,
  User,
  ensureAuthIndexes,
} from "./auth-models.js";
import { mongoConfigured } from "./mongo.js";
import {
  authBackend,
  createAuthSession,
  createUser,
  deleteAuthSessionById,
  deleteAuthSessionByTokenHash,
  findAuthSessionByTokenHash,
  findUserByEmail,
  findUserById,
  findUserByProvider,
  revokeUserAuthSessions,
  saveUser,
  touchUserLogin,
  userExistsWithEmail,
} from "./auth-storage.js";

export { AuthSession, OtpCode, User, ensureAuthIndexes, authBackend };

const globalSecretRef = globalThis;

function requireSecret() {
  for (const key of ["SESSION_SECRET", "AUTH_SECRET", "BETTER_AUTH_SECRET"]) {
    const val = process.env[key];
    if (val && String(val).trim().length >= 32) {
      return String(val).trim();
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw httpError(500, "SESSION_SECRET_MISSING", "Server session secret is not configured.");
  }
  // Local dev/test fallback: process-stable random key so OAuth state sealing
  // never fails out-of-the-box without a `.env` file.
  globalSecretRef.__meridianDevSessionSecret__ ??= randomBytes(32).toString("hex");
  return globalSecretRef.__meridianDevSessionSecret__;
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
  const raw = String(input ?? "").trim();
  let combined;
  if (!raw.startsWith("+") && countryCode) {
    let national = raw.replace(/[^\d]/g, "");
    const cc = String(countryCode).trim();
    // Strip a single national trunk '0' when user types e.g. 07700 900123 under +44.
    if (cc !== "+39" && national.startsWith("0") && national.length >= 8) {
      national = national.slice(1);
    }
    combined = `${cc}${national}`;
  } else {
    combined = raw.replace(/[()\s.-]/g, "");
  }
  if (!/^\+[1-9]\d{6,14}$/.test(combined)) {
    throw httpError(400, "INVALID_PHONE", "Enter a valid phone number with country code.");
  }
  return combined;
}

export function validateName(input) {
  return String(input ?? "").trim().slice(0, 120);
}

// --- OTP crypto (scrypt hash, constant-time verify) ---------------------------
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
  return mongoConfigured();
}

// --- Delivery (Resend for email, Twilio for SMS; dev-only local sandbox) ------
const envValue = (...keys) => {
  for (const key of keys) {
    const v = String(process.env[key] ?? "").trim();
    if (v) return v;
  }
  return "";
};

const emailApiKey = () => envValue("EMAIL_PROVIDER_KEY", "RESEND_API_KEY");
const emailFromAddress = () => envValue("EMAIL_FROM", "RESEND_FROM");
const smsAccountSid = () => envValue("SMS_PROVIDER_KEY", "TWILIO_ACCOUNT_SID");
const smsAuthToken = () => envValue("SMS_PROVIDER_SECRET", "TWILIO_AUTH_TOKEN");
const smsFromNumber = () => envValue("SMS_FROM", "TWILIO_FROM", "TWILIO_PHONE_NUMBER");

export function emailConfigured() {
  loadLocalEnv();
  return Boolean(emailApiKey() && emailFromAddress());
}

/**
 * Twilio Verify service (`VA…`). When set, Twilio generates, delivers and
 * checks the code itself — it picks a compliant sender per destination country
 * and applies its own fraud protection, which a single `SMS_FROM` number
 * cannot do worldwide. Without it, codes go out through the Messages API from
 * `SMS_FROM` (an E.164 number or a Messaging Service SID, `MG…`).
 */
export function smsVerifyServiceSid() {
  return envValue("SMS_VERIFY_SERVICE_SID", "TWILIO_VERIFY_SERVICE_SID");
}

/** Server variables phone codes are still waiting for (empty when ready). */
export function smsMissingEnv() {
  loadLocalEnv();
  const missing = [];
  if (!smsAccountSid()) missing.push("SMS_PROVIDER_KEY");
  if (!smsAuthToken()) missing.push("SMS_PROVIDER_SECRET");
  if (!smsVerifyServiceSid() && !smsFromNumber()) missing.push("SMS_VERIFY_SERVICE_SID or SMS_FROM");
  return missing;
}

export function smsConfigured() {
  return smsMissingEnv().length === 0;
}

/** A provider's own explanation for a rejected send — logged, never shown to users. */
async function providerErrorDetail(res) {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return [json.name ?? json.code, json.message ?? json.error].filter((v) => v != null && v !== "").join(": ").slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Local developer sandbox is strictly disabled in compiled production bundles
 * (where Vite replaces `import.meta.env.DEV` with `false`) and whenever
 * NODE_ENV is `"production"` or cloud deployment vars are set.
 */
export function isDevOtpSandbox() {
  return Boolean(import.meta.env?.DEV)
    && process.env.NODE_ENV !== "production"
    && !process.env.VERCEL
    && !process.env.RENDER;
}

export function emailCanDeliver() {
  return emailConfigured() || isDevOtpSandbox();
}

export function smsCanDeliver() {
  return smsConfigured() || isDevOtpSandbox();
}

function otpEmailCopy(code, purpose) {
  if (purpose === "reset_password") {
    return {
      subject: `Reset your MERIDIAN password — code ${code}`,
      heading: "Reset your password",
      detail: "Use this one-time verification code to choose a new password for your Meridian account.",
    };
  }
  if (purpose === "verify_email" || purpose === "link_email") {
    return {
      subject: `Confirm your email for MERIDIAN — code ${code}`,
      heading: "Confirm your email address",
      detail: "Enter this verification code to confirm your email address on Meridian.",
    };
  }
  return {
    subject: `Your MERIDIAN sign-in code is ${code}`,
    heading: "Sign in to Meridian",
    detail: "Use this one-time code to continue to your Meridian account.",
  };
}

export async function sendEmailOtp(email, code, { purpose = "auth" } = {}) {
  if (emailConfigured()) {
    const copy = otpEmailCopy(code, purpose);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${emailApiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: emailFromAddress(),
        to: email,
        subject: copy.subject,
        text: `${copy.heading}\n\nYour MERIDIAN verification code is ${code}. It expires in 5 minutes.\n\nIf you did not request this code, you can safely ignore this message.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 24px; color: #111827;">
            <p style="font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: #6b7280; margin: 0 0 8px;">Meridian Observatory</p>
            <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 12px;">${copy.heading}</h1>
            <p style="font-size: 14px; line-height: 1.5; color: #374151; margin: 0 0 20px;">${copy.detail}</p>
            <div style="background: #f3f4f6; border-radius: 10px; padding: 16px; text-align: center; font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #111827;">${code}</div>
            <p style="font-size: 12px; color: #6b7280; margin: 16px 0 0;">This code expires in 5 minutes. If you didn't request it, ignore this email.</p>
          </div>
        `.trim(),
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      // Usually an unverified sending domain or a revoked key — say so in the
      // server log, where the operator can act on it.
      console.error(`[auth] Resend rejected the ${purpose} email (HTTP ${res.status}): ${await providerErrorDetail(res)}`);
      throw httpError(502, "EMAIL_SEND_FAILED", "The verification email could not be sent. Try again shortly.");
    }
    return { delivery: "resend" };
  }
  if (isDevOtpSandbox()) {
    console.info(`[meridian-dev-otp] Email (${purpose}) -> ${email} : ${code}`);
    return { delivery: "dev-sandbox", devCode: code };
  }
  throw httpError(503, "EMAIL_PROVIDER_UNCONFIGURED",
    "Email delivery is not configured on this server. Set EMAIL_PROVIDER_KEY and EMAIL_FROM.");
}

const TWILIO_VERIFY = "twilio-verify";

function twilioHeaders() {
  const basic = Buffer.from(`${smsAccountSid()}:${smsAuthToken()}`).toString("base64");
  return { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" };
}

async function twilioPost(url, params, unreachable = ["SMS_SEND_FAILED", "The verification SMS could not be sent. Try again shortly."]) {
  try {
    return await fetch(url, {
      method: "POST",
      headers: twilioHeaders(),
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("[auth] Twilio request failed:", err?.message ?? err);
    throw httpError(502, ...unreachable);
  }
}

export async function sendPhoneOtp(phone, code, { purpose = "auth" } = {}) {
  if (smsConfigured()) {
    const verifySid = smsVerifyServiceSid();
    if (verifySid) {
      // Twilio Verify issues its own code; ours is never sent and stays unusable.
      const res = await twilioPost(
        `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifySid)}/Verifications`,
        { To: phone, Channel: "sms" },
      );
      if (!res.ok) {
        console.error(`[auth] Twilio Verify rejected the ${purpose} SMS (HTTP ${res.status}): ${await providerErrorDetail(res)}`);
        if (res.status === 429) {
          throw httpError(429, "RATE_LIMITED", "Too many codes requested for this number. Please wait and try again.");
        }
        if (res.status === 400) {
          throw httpError(400, "INVALID_PHONE", "This phone number can't receive text message codes. Check the number and try again.");
        }
        throw httpError(502, "SMS_SEND_FAILED", "The verification SMS could not be sent. Try again shortly.");
      }
      return { delivery: TWILIO_VERIFY, external: TWILIO_VERIFY };
    }
    const from = smsFromNumber();
    const res = await twilioPost(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(smsAccountSid())}/Messages.json`,
      {
        ...(/^MG[0-9a-fA-F]{32}$/.test(from) ? { MessagingServiceSid: from } : { From: from }),
        To: phone,
        Body: `Your MERIDIAN verification code is ${code}. It expires in 5 minutes.`,
      },
    );
    if (!res.ok) {
      // Unregistered sender, blocked destination country, trial-account limits…
      console.error(`[auth] Twilio rejected the ${purpose} SMS (HTTP ${res.status}): ${await providerErrorDetail(res)}`);
      throw httpError(502, "SMS_SEND_FAILED", "The verification SMS could not be sent. Try again shortly.");
    }
    return { delivery: "twilio" };
  }
  if (isDevOtpSandbox()) {
    console.info(`[meridian-dev-otp] SMS (${purpose}) -> ${phone} : ${code}`);
    return { delivery: "dev-sandbox", devCode: code };
  }
  throw httpError(503, "SMS_PROVIDER_UNCONFIGURED",
    "SMS delivery is not configured on this server. Set SMS_PROVIDER_KEY, SMS_PROVIDER_SECRET and SMS_VERIFY_SERVICE_SID (or SMS_FROM).");
}

/**
 * Check a code that an outside verifier issued (see `sendPhoneOtp`). Resolves
 * true/false for a right/wrong code and throws when the verifier no longer
 * holds a pending verification for this number.
 */
export async function checkExternalOtp(verifier, identifier, code) {
  if (verifier !== TWILIO_VERIFY) {
    throw httpError(400, "OTP_NOT_FOUND", "No active code. Request a new one.");
  }
  const verifySid = smsVerifyServiceSid();
  if (!verifySid || !smsConfigured()) {
    throw httpError(503, "SMS_PROVIDER_UNCONFIGURED", "SMS verification is not configured on this server.");
  }
  const checkFailed = ["OTP_CHECK_FAILED", "The code could not be checked. Try again shortly."];
  const res = await twilioPost(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifySid)}/VerificationCheck`,
    { To: identifier, Code: code },
    checkFailed,
  );
  if (res.status === 404) {
    // Twilio drops a verification once it expires, is approved, or is exhausted.
    throw httpError(400, "OTP_EXPIRED", "This code has expired. Request a new one.");
  }
  if (res.status === 429) {
    throw httpError(429, "OTP_LOCKED", "Too many incorrect attempts. Request a new code.");
  }
  if (!res.ok) {
    console.error(`[auth] Twilio Verify check failed (HTTP ${res.status}): ${await providerErrorDetail(res)}`);
    throw httpError(502, ...checkFailed);
  }
  const body = await res.json().catch(() => ({}));
  return body?.status === "approved";
}

// --- Sessions + cookies + origin ----------------------------------------------
export const SESSION_COOKIE = "meridian_session";
export const OAUTH_COOKIE = "meridian_oauth";
export const AUTH_NOTICE_COOKIE = "meridian_auth_notice";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(request) {
  const out = {};
  for (const part of String(request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(secure, maxAge, { httpOnly = true } = {}) {
  return `Path=/;${httpOnly ? " HttpOnly;" : ""} SameSite=Lax${secure ? "; Secure" : ""}${maxAge != null ? `; Max-Age=${maxAge}` : ""}`;
}

export function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(secure, Math.floor(SESSION_TTL_MS / 1000))}`;
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

export function authNoticeCookie(notice, secure) {
  return `${AUTH_NOTICE_COOKIE}=${encodeURIComponent(notice)}; ${cookieAttrs(secure, 60, { httpOnly: false })}`;
}

/**
 * Determine the public origin for OAuth redirect_uri construction behind
 * reverse proxies (Render, Vercel, Nginx, Vite preview) without hard-coding.
 */
export function publicOrigin(request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch { /* fall through */ }
  }
  const url = new URL(request.url);
  const fwdProto = String(request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const fwdHost = String(request.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  if (fwdHost && !/[\\/\s]/.test(fwdHost)) {
    const proto = fwdProto === "https" || fwdProto === "http" ? fwdProto : url.protocol.replace(":", "");
    return `${proto}://${fwdHost}`;
  }
  const host = String(request.headers.get("host") ?? "").trim();
  if (host && !/[\\/\s]/.test(host)) {
    const proto = fwdProto === "https" || fwdProto === "http" ? fwdProto : url.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return url.origin;
}

const isSecureRequest = (request) => {
  const forwarded = String(request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).protocol === "https:";
    } catch { /* noop */ }
  }
  return false;
};

export function secureContext(request) {
  return isSecureRequest(request);
}

export async function createSession(userId, request, { method = null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await createAuthSession({
    tokenHash,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 200),
    method: method ? String(method).slice(0, 32) : null,
  });
  return { token, cookie: sessionCookie(token, secureContext(request)) };
}

export async function revokeUserSessions(userId, { exceptSessionId = null } = {}) {
  return revokeUserAuthSessions(userId, { exceptSessionId });
}

export async function getSessionUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sess = await findAuthSessionByTokenHash(tokenHash);
  if (!sess || sess.expiresAt < new Date()) {
    if (sess) await deleteAuthSessionById(sess._id);
    return null;
  }
  const user = await findUserById(sess.userId, { includeSecrets: false });
  if (!user || user.accountStatus !== "active") return null;
  return { user: publicUser(user), sessionId: sess._id, method: sess.method ?? null };
}

export async function destroySession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await deleteAuthSessionByTokenHash(tokenHash);
  }
  return clearSessionCookie(secureContext(request));
}

/**
 * An address is only owned once its holder proves it — by entering an emailed
 * code, or through a provider that vouches for it. Anything attached before
 * that proof may belong to whoever typed the address first, not to its owner.
 * So when the owner proves it, earlier credentials are cleared and open
 * sessions revoked.
 */
export function claimUnverifiedAccount(user, proof) {
  const hadPassword = Boolean(user.passwordHash);
  const droppedProviders = (user.authProviders ?? [])
    .filter((p) => !(p.provider === proof.provider && p.providerUserId === proof.providerUserId))
    .map((p) => p.provider);
  user.passwordHash = undefined;
  user.passwordSalt = undefined;
  user.passwordUpdatedAt = undefined;
  user.authProviders = [{
    provider: proof.provider,
    providerUserId: proof.providerUserId,
    ...(proof.email ? { email: proof.email } : {}),
  }];
  user.emailVerified = true;
  user.updatedAt = new Date();
  return { hadPassword, droppedProviders };
}

export function publicUser(user) {
  if (!user) return null;
  const providerEmail = (user.authProviders ?? []).find((p) => p.email)?.email ?? null;
  return {
    id: String(user._id),
    email: user.email ?? providerEmail,
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
    extraParams: { prompt: "select_account" },
    pkce: true,
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
  },
  microsoft: {
    label: "Microsoft",
    tenant: () => (process.env.MICROSOFT_TENANT_ID || "common").trim(),
    authorize: () => `https://login.microsoftonline.com/${OAUTH_PROVIDERS.microsoft.tenant()}/oauth2/v2.0/authorize`,
    token: () => `https://login.microsoftonline.com/${OAUTH_PROVIDERS.microsoft.tenant()}/oauth2/v2.0/token`,
    userinfo: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid profile email",
    extraParams: { prompt: "select_account" },
    pkce: true,
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
    pkce: true,
    idEnv: "APPLE_CLIENT_ID",
    secretEnv: null,
  },
  amazon: {
    label: "Amazon",
    authorize: "https://www.amazon.com/ap/oa",
    token: "https://api.amazon.com/auth/o2/token",
    profile: "https://api.amazon.com/user/profile",
    scope: "profile",
    pkce: true,
    idEnv: "AMAZON_CLIENT_ID",
    secretEnv: "AMAZON_CLIENT_SECRET",
  },
};

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

export { safeReturnTo };

export function providerStatus() {
  loadLocalEnv();
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

export function startOAuthUrl(providerId, origin, intent = "login", returnTo = "/app", { mode = null } = {}) {
  const cfg = requireProvider(providerId);
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const codeVerifier = cfg.pkce ? randomBytes(32).toString("base64url") : null;
  const sealed = sealOAuthState({
    state,
    nonce,
    ...(codeVerifier ? { codeVerifier } : {}),
    provider: providerId,
    intent,
    mode: mode === "signup" ? "signup" : "signin",
    returnTo: safeReturnTo(returnTo),
  });
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
  if (codeVerifier) {
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  if (cfg.responseMode) params.set("response_mode", cfg.responseMode);
  if (cfg.extraParams) {
    for (const [k, v] of Object.entries(cfg.extraParams)) params.set(k, v);
  }
  const authorize = typeof cfg.authorize === "function" ? cfg.authorize() : cfg.authorize;
  return { url: `${authorize}?${params}`, sealed };
}

async function exchangeCode(providerId, code, redirectUri, codeVerifier = null) {
  const cfg = OAUTH_PROVIDERS[providerId];
  const tokenUrl = typeof cfg.token === "function" ? cfg.token() : cfg.token;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: process.env[cfg.idEnv],
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);
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
  const hasToken = providerId === "apple"
    ? Boolean(json.id_token || json.access_token)
    : Boolean(json.access_token || json.id_token);
  if (!res.ok || !hasToken) {
    console.error(`[oauth] ${providerId} token exchange rejected:`, {
      status: res.status,
      error: json?.error ?? null,
      errorDescription: json?.error_description ?? null,
    });
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
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");
  return cleaned.includes("\\n") ? cleaned.replace(/\\n/g, "\n") : cleaned;
}

export async function appleClientSecret() {
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

export async function resolveOAuthIdentity(
  providerId,
  code,
  redirectUri,
  { nonce = null, codeVerifier = null, appleUser = null } = {},
) {
  const tokens = await exchangeCode(providerId, code, redirectUri, codeVerifier);
  if (providerId === "apple") {
    const claims = await verifyIdToken("apple", tokens.id_token, { nonce });
    let name = null;
    if (appleUser) {
      try {
        const parsed = typeof appleUser === "string" ? JSON.parse(appleUser) : appleUser;
        const full = parsed?.name ?? parsed;
        const given = full?.firstName ?? full?.givenName ?? "";
        const family = full?.lastName ?? full?.familyName ?? "";
        name = `${given} ${family}`.trim() || null;
      } catch { /* display name is optional */ }
    }
    return {
      providerUserId: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claimIsTrue(claims.email_verified),
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
  if ((providerId === "google" || providerId === "microsoft") && tokens.id_token) {
    const claims = await verifyIdToken(providerId, tokens.id_token, { nonce });
    if (providerId === "microsoft") {
      const email = claims.email ?? (looksLikeEmail(claims.preferred_username) ? claims.preferred_username : null);
      const isConsumerAccount = String(claims.tid ?? "").toLowerCase() === CONSUMER_MICROSOFT_TENANT;
      // Microsoft omits `email_verified` on many accounts; consumer MSA emails
      // are verified by Microsoft, whereas Entra org accounts require explicit
      // `email_verified` or `xms_edov` (nOAuth mitigation).
      const emailVerified = claimIsTrue(claims.email_verified)
        || claimIsTrue(claims.xms_edov)
        || (Boolean(email) && isConsumerAccount);
      return {
        providerUserId: String(claims.sub),
        email,
        emailVerified,
        name: claims.name ?? null,
        avatar: null,
      };
    }
    return {
      providerUserId: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claimIsTrue(claims.email_verified),
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
    emailVerified: claimIsTrue(p.email_verified),
    name: p.name ?? null,
    avatar: p.picture ?? null,
  };
}

// --- Account resolution + safe linking ----------------------------------------
const APPLE_RELAY = /@privaterelay\.appleid\.com$/i;

export function planOAuthAccount({
  providerId, intent = "login", sessionUserId = null, byProvider = null, me = null, byEmail = null,
}) {
  const label = OAUTH_PROVIDERS[providerId]?.label ?? "provider";
  if (intent === "link" && !sessionUserId) {
    throw httpError(401, "SESSION_REQUIRED", "Sign in first, then link this provider.");
  }
  if (byProvider) {
    if (byProvider.accountStatus && byProvider.accountStatus !== "active") {
      throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
    }
    if (sessionUserId && String(byProvider._id) !== String(sessionUserId)) {
      throw httpError(409, "ACCOUNT_LINK_CONFLICT",
        `This ${label} account is already linked to another Meridian account. Sign in with it directly instead.`);
    }
    return { action: "signin" };
  }
  if (sessionUserId) {
    if (!me) throw httpError(401, "SESSION_REQUIRED", "Sign in first, then link this provider.");
    if ((me.authProviders ?? []).some((p) => p.provider === providerId)) {
      throw httpError(409, "PROVIDER_ALREADY_LINKED",
        `A different ${label} account is already linked. Disconnect it first.`);
    }
    return { action: "link" };
  }
  if (byEmail) {
    if (byEmail.accountStatus && byEmail.accountStatus !== "active") {
      throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
    }
    if (byEmail.emailVerified) {
      throw httpError(409, "ACCOUNT_LINK_REQUIRED",
        "An account already exists with this email. Sign in using the existing method, then link this provider from Settings.");
    }
    return { action: "claim" };
  }
  return { action: "create" };
}

export async function resolveOAuthAccount(identity, providerId, { sessionUserId = null, intent = "login" } = {}) {
  const email = identity.email ? String(identity.email).trim().toLowerCase() : null;
  const verifiedEmail = email && identity.emailVerified ? email : null;
  const byProvider = await findUserByProvider(providerId, identity.providerUserId);
  const me = sessionUserId && !byProvider ? await findUserById(sessionUserId) : null;
  const byEmail = !byProvider && !sessionUserId && verifiedEmail
    ? await findUserByEmail(verifiedEmail, { includeSecrets: true })
    : null;
  const plan = planOAuthAccount({ providerId, intent, sessionUserId, byProvider, me, byEmail });
  const entry = { provider: providerId, providerUserId: identity.providerUserId, ...(email ? { email } : {}) };

  if (plan.action === "signin") {
    let changed = false;
    if (identity.name && !byProvider.name) {
      byProvider.name = identity.name;
      changed = true;
    }
    if (identity.avatar && !byProvider.avatar) {
      byProvider.avatar = identity.avatar;
      changed = true;
    }
    const saved = changed ? await saveUser(byProvider) : byProvider;
    return { user: saved, created: false };
  }

  if (plan.action === "link") {
    me.authProviders = [...(me.authProviders ?? []), entry];
    if (verifiedEmail && me.email === verifiedEmail) {
      me.emailVerified = true;
    } else if (verifiedEmail && !me.email) {
      const taken = await userExistsWithEmail(verifiedEmail, { excludeUserId: me._id });
      if (!taken) {
        me.email = verifiedEmail;
        me.emailVerified = true;
        me.emailIsPrivateRelay = APPLE_RELAY.test(verifiedEmail);
      }
    }
    if (identity.name && !me.name) me.name = identity.name;
    if (identity.avatar && !me.avatar) me.avatar = identity.avatar;
    me.updatedAt = new Date();
    const saved = await saveUser(me);
    return { user: saved, created: false, linked: true };
  }

  if (plan.action === "claim") {
    claimUnverifiedAccount(byEmail, { provider: providerId, providerUserId: identity.providerUserId, email: verifiedEmail });
    if (identity.name && !byEmail.name) byEmail.name = identity.name;
    if (identity.avatar && !byEmail.avatar) byEmail.avatar = identity.avatar;
    const saved = await saveUser(byEmail);
    await revokeUserSessions(saved._id);
    return { user: saved, created: false, claimed: true };
  }

  const user = await createUser({
    ...(verifiedEmail
      ? { email: verifiedEmail, emailVerified: true, emailIsPrivateRelay: APPLE_RELAY.test(verifiedEmail) }
      : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.avatar ? { avatar: identity.avatar } : {}),
    authProviders: [entry],
    lastLoginAt: new Date(),
  });
  return { user, created: true };
}

export async function touchLogin(userId) {
  await touchUserLogin(userId);
}
