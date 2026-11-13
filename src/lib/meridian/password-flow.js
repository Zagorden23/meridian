// Email+password credential & recovery flows — server-only MongoDB persistence.
// Passwords are scrypt-hashed with unique salts; plaintext never leaves scope.
import { httpError } from "./api-envelope.js";
import { clientKey, rateLimit } from "./rate-limit.js";
import {
  claimUnverifiedAccount,
  createSession,
  emailCanDeliver,
  getSessionUser,
  hashPassword,
  normalizeEmail,
  publicUser,
  revokeUserSessions,
  sendEmailOtp,
  touchLogin,
  validateName,
  validatePassword,
  verifyPassword,
} from "./auth.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  saveUser,
} from "./auth-storage.js";
import { OTP_TTL_MS, consumeOtp, requestOtp } from "./otp-flow.js";
import { requireMongoConnection } from "./mongo.js";

function limit(key, opts) {
  try {
    rateLimit(key, opts);
  } catch {
    throw httpError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
  }
}

export async function requireMongo() {
  return requireMongoConnection();
}

export async function signupWithPassword(request, { email, password, name }) {
  const cleanEmail = normalizeEmail(email);
  const pw = validatePassword(password);
  const displayName = validateName(name);
  limit(`pw:signup:${cleanEmail}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  limit(clientKey(request, "POST:/api/auth/signup-password"), { limit: 20, windowMs: 60 * 60 * 1000 });

  const canDeliverEmail = emailCanDeliver();
  const existing = await findUserByEmail(cleanEmail, { includeSecrets: true });
  if (existing && (existing.emailVerified || !canDeliverEmail)) {
    throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
  }

  const { salt, passwordHash } = await hashPassword(pw);
  let user;
  if (existing && !existing.emailVerified) {
    // Allow restarting signup for an address that has not been verified yet.
    existing.name = displayName ?? existing.name ?? null;
    existing.passwordHash = passwordHash;
    existing.passwordSalt = salt;
    existing.passwordUpdatedAt = new Date();
    const providers = [...(existing.authProviders ?? [])];
    if (!providers.some((p) => p.provider === "password")) {
      providers.push({ provider: "password", providerUserId: cleanEmail, email: cleanEmail });
    }
    existing.authProviders = providers;
    existing.updatedAt = new Date();
    user = await saveUser(existing);
  } else {
    try {
      user = await createUser({
        email: cleanEmail,
        emailVerified: false,
        ...(displayName ? { name: displayName } : {}),
        passwordHash,
        passwordSalt: salt,
        passwordUpdatedAt: new Date(),
        authProviders: [{ provider: "password", providerUserId: cleanEmail, email: cleanEmail }],
        lastLoginAt: new Date(),
      });
    } catch (err) {
      if (err?.isUniqueConflict || err?.code === 11000) {
        throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
      }
      throw err;
    }
  }

  if (canDeliverEmail) {
    const otp = await requestOtp(
      request,
      cleanEmail,
      "email",
      (code) => sendEmailOtp(cleanEmail, code, { purpose: "verify_email" }),
      { purpose: "verify_email" },
    );
    return {
      requiresVerification: true,
      email: cleanEmail,
      created: true,
      method: "password",
      ...otp,
    };
  }

  const { cookie } = await createSession(user._id, request, { method: "password" });
  return { user: publicUser(user), created: true, method: "password", cookie };
}

// A fixed credential to burn the same scrypt work when the address is unknown,
// so response time does not reveal which addresses have accounts.
const DECOY_SALT = "00000000000000000000000000000000";
const DECOY_HASH = "00".repeat(64);

export async function signinWithPassword(request, { email, password }) {
  const cleanEmail = normalizeEmail(email);
  if (!String(password ?? "")) {
    throw httpError(400, "PASSWORD_REQUIRED", "Enter your password.");
  }
  limit(`pw:signin:${cleanEmail}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  limit(clientKey(request, "POST:/api/auth/signin-password"), { limit: 30, windowMs: 60 * 60 * 1000 });
  const user = await findUserByEmail(cleanEmail, { includeSecrets: true });
  const hasCredential = Boolean(user?.passwordHash && user?.passwordSalt);
  const ok = await verifyPassword(
    password,
    hasCredential ? user.passwordSalt : DECOY_SALT,
    hasCredential ? user.passwordHash : DECOY_HASH,
  );
  if (!hasCredential || !ok) {
    throw httpError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }
  if (user.accountStatus && user.accountStatus !== "active") {
    throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
  }
  if (!user.emailVerified && emailCanDeliver()) {
    let details = {
      email: cleanEmail,
      channel: "email",
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendInSeconds: 60,
    };
    try {
      const otp = await requestOtp(
        request,
        cleanEmail,
        "email",
        (code) => sendEmailOtp(cleanEmail, code, { purpose: "verify_email" }),
        { purpose: "verify_email" },
      );
      details = { email: cleanEmail, ...otp };
    } catch (otpErr) {
      if (otpErr?.code !== "OTP_RESEND_COOLDOWN") throw otpErr;
    }
    const err = httpError(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "Confirm your email address with the 6-digit code sent to your inbox before signing in.",
    );
    err.details = details;
    throw err;
  }
  await touchLogin(user._id);
  const { cookie } = await createSession(user._id, request, { method: "password" });
  return { user: publicUser(user), created: false, method: "password", cookie };
}

export async function forgotPassword(request, { email }) {
  const cleanEmail = normalizeEmail(email);
  limit(`pw:forgot:${cleanEmail}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  limit(clientKey(request, "POST:/api/auth/forgot-password"), { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!emailCanDeliver()) {
    throw httpError(
      503,
      "EMAIL_PROVIDER_UNCONFIGURED",
      "Email delivery is not configured on this server. Set EMAIL_PROVIDER_KEY and EMAIL_FROM.",
    );
  }
  const user = await findUserByEmail(cleanEmail);
  if (!user || (user.accountStatus && user.accountStatus !== "active")) {
    // Do not leak whether an email address is registered.
    return {
      sent: true,
      email: cleanEmail,
      channel: "email",
      purpose: "reset_password",
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendInSeconds: 60,
    };
  }
  const otp = await requestOtp(
    request,
    cleanEmail,
    "email",
    (code) => sendEmailOtp(cleanEmail, code, { purpose: "reset_password" }),
    { purpose: "reset_password" },
  );
  return { sent: true, email: cleanEmail, ...otp };
}

export async function resetPassword(request, { email, code, newPassword }) {
  const cleanEmail = normalizeEmail(email);
  const pw = validatePassword(newPassword);
  limit(`pw:reset:${cleanEmail}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  await consumeOtp(request, cleanEmail, code, { channel: "email", purpose: "reset_password" });

  const user = await findUserByEmail(cleanEmail, { includeSecrets: true });
  if (!user) {
    throw httpError(400, "OTP_INVALID", "Could not reset password for this email. Request a new code.");
  }
  if (user.accountStatus && user.accountStatus !== "active") {
    throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
  }
  if (!user.emailVerified) {
    claimUnverifiedAccount(user, { provider: "password", providerUserId: cleanEmail, email: cleanEmail });
  }
  const { salt, passwordHash } = await hashPassword(pw);
  user.passwordHash = passwordHash;
  user.passwordSalt = salt;
  user.passwordUpdatedAt = new Date();
  const providers = [...(user.authProviders ?? [])];
  if (!providers.some((p) => p.provider === "password")) {
    providers.push({ provider: "password", providerUserId: cleanEmail, email: cleanEmail });
  }
  user.authProviders = providers;
  user.updatedAt = new Date();
  const saved = await saveUser(user);
  await revokeUserSessions(saved._id);
  await touchLogin(saved._id);
  const { cookie } = await createSession(saved._id, request, { method: "password" });
  return { user: publicUser(saved), reset: true, method: "password", cookie };
}

/**
 * Set a first password, or change an existing one, for the signed-in account.
 */
export async function setPassword(request, { currentPassword, newPassword }) {
  const sess = await getSessionUser(request);
  if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
  limit(`pw:change:${sess.user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  const pw = validatePassword(newPassword);
  const user = await findUserById(sess.user.id, { includeSecrets: true });
  if (!user) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
  if (user.passwordHash) {
    const recovering = sess.method === "email" && user.emailVerified;
    if (!recovering) {
      if (!String(currentPassword ?? "")) {
        throw httpError(400, "CURRENT_PASSWORD_REQUIRED", "Enter your current password.");
      }
      const ok = await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash);
      if (!ok) throw httpError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }
  } else if (!user.email) {
    throw httpError(400, "EMAIL_REQUIRED", "Add an email sign-in to this account before setting a password.");
  }
  const { salt, passwordHash } = await hashPassword(pw);
  user.passwordHash = passwordHash;
  user.passwordSalt = salt;
  user.passwordUpdatedAt = new Date();
  const providers = [...(user.authProviders ?? [])];
  if (!providers.some((p) => p.provider === "password")) {
    providers.push({ provider: "password", providerUserId: user.email, email: user.email });
  }
  user.authProviders = providers;
  user.updatedAt = new Date();
  const saved = await saveUser(user);
  const signedOut = await revokeUserSessions(saved._id, { exceptSessionId: sess.sessionId });
  return { user: publicUser(saved), signedOut };
}
