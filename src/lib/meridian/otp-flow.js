// Shared OTP request/verify flow for email + phone channels stored in MongoDB.
// Codes are generated, scrypt-hashed and delivered here; plaintext codes are
// never logged in production, never returned in production, and purpose-bound.
import { clientKey, rateLimit } from "./rate-limit.js";
import { checkExternalOtp, generateOtpCode, hashOtp, verifyOtp } from "./auth.js";
import {
  consumeOtpRecord,
  createOtpRecord,
  deleteOtpRecord,
  findLatestActiveOtp,
  incrementOtpAttempts,
  invalidateSiblingOtps,
  setOtpExternal,
} from "./auth-storage.js";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Every code sent costs money, and automated "SMS pumping" spreads requests
// across many numbers and addresses to slip under per-recipient limits. A
// ceiling on codes sent per hour, per channel, bounds the worst case; raise it
// with OTP_SMS_HOURLY_LIMIT / OTP_EMAIL_HOURLY_LIMIT as real traffic grows.
const HOURLY_SEND_CEILING = { phone: ["OTP_SMS_HOURLY_LIMIT", 300], email: ["OTP_EMAIL_HOURLY_LIMIT", 1000] };

function hourlySendCeiling(channel) {
  const [envKey, fallback] = HOURLY_SEND_CEILING[channel] ?? [null, 1000];
  const configured = Number.parseInt(process.env[envKey] ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function limit(key, opts) {
  try {
    rateLimit(key, opts);
  } catch {
    const err = new Error("Too many attempts. Please wait and try again.");
    err.status = 429;
    err.code = "RATE_LIMITED";
    throw err;
  }
}

import { requireMongoConnection } from "./mongo.js";
export async function requireMongo() {
  return requireMongoConnection();
}

export async function requestOtp(request, identifier, channel, send, { purpose = "auth" } = {}) {
  limit(`otp:req:${channel}:${purpose}:${identifier}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  limit(clientKey(request, `POST:/api/auth/request-${channel}-otp`), { limit: 30, windowMs: 60 * 60 * 1000 });
  const recent = await findLatestActiveOtp({ identifier, channel, purpose });
  if (recent && recent.resendAvailableAt && new Date(recent.resendAvailableAt) > new Date()) {
    const wait = Math.max(1, Math.ceil((new Date(recent.resendAvailableAt).getTime() - Date.now()) / 1000));
    const err = new Error(`Wait ${wait}s before requesting a new code.`);
    err.status = 429;
    err.code = "OTP_RESEND_COOLDOWN";
    err.details = { resendInSeconds: wait };
    throw err;
  }
  try {
    rateLimit(`otp:sent:${channel}`, { limit: hourlySendCeiling(channel), windowMs: 60 * 60 * 1000 });
  } catch {
    console.error(`[auth] hourly ${channel} code ceiling reached — refusing further sends this hour`);
    const err = new Error("Too many attempts. Please wait and try again.");
    err.status = 429;
    err.code = "RATE_LIMITED";
    throw err;
  }
  const code = generateOtpCode();
  const { salt, codeHash } = await hashOtp(code);
  const doc = await createOtpRecord({
    identifier,
    channel,
    purpose,
    codeHash,
    salt,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    resendAvailableAt: new Date(Date.now() + OTP_RESEND_COOLDOWN_MS),
  });
  let sent;
  try {
    sent = await send(code); // throws honest 503 in prod when channel has no provider
  } catch (err) {
    // Delivery failed — remove the trigger so the user is not stuck behind
    // a 60s cooldown for a code that was never sent.
    await deleteOtpRecord(doc._id).catch(() => {});
    throw err;
  }
  // The provider issued its own code (Twilio Verify): record who checks it.
  if (sent?.external) await setOtpExternal(doc._id, sent.external);
  await invalidateSiblingOtps({ identifier, channel, purpose, exceptId: doc._id }).catch(() => {});
  return {
    channel,
    purpose,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    resendInSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
    ...(sent?.devCode ? { devSandbox: true, devCode: sent.devCode } : {}),
  };
}

export async function consumeOtp(request, identifier, code, { channel = "email", purpose = "auth" } = {}) {
  const cleanCode = String(code ?? "").replace(/\s+/g, "").trim();
  if (!cleanCode) {
    const err = new Error("Enter the 6-digit code.");
    err.status = 400;
    err.code = "OTP_REQUIRED";
    throw err;
  }
  limit(`otp:verify:${channel}:${purpose}:${identifier}`, { limit: 12, windowMs: 15 * 60 * 1000 });
  const doc = await findLatestActiveOtp({ identifier, channel, purpose });
  if (!doc) {
    const err = new Error("No active code. Request a new one.");
    err.status = 400;
    err.code = "OTP_NOT_FOUND";
    throw err;
  }
  if (new Date(doc.expiresAt) < new Date()) {
    const err = new Error("This code has expired. Request a new one.");
    err.status = 400;
    err.code = "OTP_EXPIRED";
    throw err;
  }
  const maxAttempts = doc.maxAttempts ?? 5;
  if ((doc.attempts ?? 0) >= maxAttempts) {
    const err = new Error("Too many incorrect attempts. Request a new code.");
    err.status = 429;
    err.code = "OTP_LOCKED";
    throw err;
  }
  const valid = doc.external
    ? await checkExternalOtp(doc.external, identifier, cleanCode)
    : await verifyOtp(cleanCode, doc.salt, doc.codeHash);
  if (!valid) {
    const nextAttempts = await incrementOtpAttempts(doc._id);
    const remaining = maxAttempts - nextAttempts;
    const err = new Error(remaining > 0
      ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
      : "Too many incorrect attempts. Request a new code.");
    err.status = remaining > 0 ? 400 : 429;
    err.code = remaining > 0 ? "OTP_INVALID" : "OTP_LOCKED";
    throw err;
  }
  await consumeOtpRecord(doc._id);
  return doc;
}
