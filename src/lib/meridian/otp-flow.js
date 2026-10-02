// Shared OTP request/verify flow for email + phone channels.
// Codes are generated, scrypt-hashed and delivered here; plaintext codes are
// never logged, never returned, and die with the function scope.
import { connectMongo } from "./mongo.js";
import { clientKey, rateLimit } from "./rate-limit.js";
import {
  OtpCode, generateOtpCode, hashOtp, verifyOtp,
} from "./auth.js";

export const OTP_TTL_MS = 5 * 60 * 1000;

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

export function requireMongo() {
  if (!process.env.MONGODB_URI) {
    const err = new Error("Accounts need MongoDB. Set MONGODB_URI on the server.");
    err.status = 503;
    err.code = "MONGO_UNCONFIGURED";
    throw err;
  }
}

export async function requestOtp(request, identifier, channel, send) {
  requireMongo();
  limit(`otp:req:${channel}:${identifier}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  limit(clientKey(request, `POST:/api/auth/request-${channel}-otp`), { limit: 30, windowMs: 60 * 60 * 1000 });
  await connectMongo();
  const recent = await OtpCode().findOne({ identifier, consumedAt: null }).sort({ createdAt: -1 }).lean();
  if (recent && recent.resendAvailableAt > new Date()) {
    const wait = Math.ceil((recent.resendAvailableAt - Date.now()) / 1000);
    const err = new Error(`Wait ${wait}s before requesting a new code.`);
    err.status = 429;
    err.code = "OTP_RESEND_COOLDOWN";
    throw err;
  }
  const code = generateOtpCode(); // never logged, never returned
  const { salt, codeHash } = await hashOtp(code);
  const doc = await OtpCode().create({
    identifier, channel, codeHash, salt,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    resendAvailableAt: new Date(Date.now() + 60 * 1000),
  });
  try {
    await send(code); // throws honest 503 when the channel has no provider
  } catch (err) {
    // Delivery failed — remove the triggers so the user is not stuck behind
    // a 60s cooldown for a code that was never sent.
    await OtpCode().deleteOne({ _id: doc._id }).catch(() => {});
    throw err;
  }
  return { channel, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
}

export async function consumeOtp(request, identifier, code) {
  requireMongo();
  if (!String(code ?? "").trim()) {
    const err = new Error("Enter the 6-digit code.");
    err.status = 400;
    err.code = "OTP_REQUIRED";
    throw err;
  }
  limit(`otp:verify:${identifier}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  await connectMongo();
  const doc = await OtpCode().findOne({ identifier, consumedAt: null }).sort({ createdAt: -1 });
  if (!doc) {
    const err = new Error("No active code. Request a new one.");
    err.status = 400;
    err.code = "OTP_NOT_FOUND";
    throw err;
  }
  if (doc.expiresAt < new Date()) {
    const err = new Error("This code has expired. Request a new one.");
    err.status = 400;
    err.code = "OTP_EXPIRED";
    throw err;
  }
  if (doc.attempts >= doc.maxAttempts) {
    const err = new Error("Too many incorrect attempts. Request a new code.");
    err.status = 429;
    err.code = "OTP_LOCKED";
    throw err;
  }
  const valid = await verifyOtp(code, doc.salt, doc.codeHash);
  doc.attempts += 1;
  if (!valid) {
    await doc.save();
    const remaining = doc.maxAttempts - doc.attempts;
    const err = new Error(remaining > 0
      ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
      : "Too many incorrect attempts. Request a new code.");
    err.status = 400;
    err.code = remaining > 0 ? "OTP_INVALID" : "OTP_LOCKED";
    throw err;
  }
  doc.consumedAt = new Date();
  await doc.save();
  return doc;
}
