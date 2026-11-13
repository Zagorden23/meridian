// Email+password credential flow — server-only.
// Works with only MongoDB (no Resend/Twilio/OAuth). Passwords are
// scrypt-hashed with unique salts; plaintext never leaves function scope.
//
// The address typed at sign-up is unproven: the account is usable straight
// away, but `emailVerified` stays false until its owner confirms the mailbox,
// and the first such proof resets everything attached before it
// (claimUnverifiedAccount in auth.js).
import { connectMongo } from "./mongo.js";
import { httpError } from "./api-envelope.js";
import { clientKey, rateLimit } from "./rate-limit.js";
import {
  User, createSession, ensureAuthIndexes, getSessionUser, hashPassword, normalizeEmail,
  publicUser, revokeUserSessions, touchLogin, validateName, validatePassword, verifyPassword,
} from "./auth.js";

function limit(key, opts) {
  try {
    rateLimit(key, opts);
  } catch {
    throw httpError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
  }
}

export function requireMongo() {
  if (!process.env.MONGODB_URI) {
    throw httpError(503, "MONGO_UNCONFIGURED", "Accounts need MongoDB. Set MONGODB_URI on the server.");
  }
}

export async function signupWithPassword(request, { email, password, name }) {
  requireMongo();
  const cleanEmail = normalizeEmail(email);
  const pw = validatePassword(password);
  const displayName = validateName(name);
  limit(`pw:signup:${cleanEmail}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  limit(clientKey(request, "POST:/api/auth/signup-password"), { limit: 20, windowMs: 60 * 60 * 1000 });
  await connectMongo();
  await ensureAuthIndexes().catch(() => {});
  const existing = await User().exists({ email: cleanEmail });
  if (existing) {
    throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
  }
  const { salt, passwordHash } = await hashPassword(pw);
  let user;
  try {
    user = await User().create({
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
    // Two sign-ups racing for one address: the unique index settles it.
    if (err?.code === 11000) {
      throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.");
    }
    throw err;
  }
  const { cookie } = await createSession(user._id, request, { method: "password" });
  return { user: publicUser(user), created: true, method: "password", cookie };
}

// A fixed credential to burn the same scrypt work when the address is unknown,
// so response time does not reveal which addresses have accounts.
const DECOY_SALT = "00000000000000000000000000000000";
const DECOY_HASH = "00".repeat(64);

export async function signinWithPassword(request, { email, password }) {
  requireMongo();
  const cleanEmail = normalizeEmail(email);
  if (!String(password ?? "")) {
    throw httpError(400, "PASSWORD_REQUIRED", "Enter your password.");
  }
  limit(`pw:signin:${cleanEmail}`, { limit: 10, windowMs: 15 * 60 * 1000 });
  limit(clientKey(request, "POST:/api/auth/signin-password"), { limit: 30, windowMs: 60 * 60 * 1000 });
  await connectMongo();
  const user = await User().findOne({ email: cleanEmail }).select("+passwordHash +passwordSalt");
  const hasCredential = Boolean(user?.passwordHash && user?.passwordSalt);
  const ok = await verifyPassword(
    password,
    hasCredential ? user.passwordSalt : DECOY_SALT,
    hasCredential ? user.passwordHash : DECOY_HASH,
  );
  if (!hasCredential || !ok) {
    throw httpError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }
  if (user.accountStatus !== "active") {
    throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
  }
  await touchLogin(user._id);
  const { cookie } = await createSession(user._id, request, { method: "password" });
  return { user: publicUser(user), created: false, method: "password", cookie };
}

/**
 * Set a first password, or change an existing one, for the signed-in account.
 *
 * Changing requires the current password — except from a session that was
 * itself opened by proving the mailbox (an emailed code). That is the recovery
 * path for a forgotten password: prove the address, then choose a new one.
 * Every other session of the account is signed out afterwards.
 */
export async function setPassword(request, { currentPassword, newPassword }) {
  requireMongo();
  const sess = await getSessionUser(request);
  if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
  limit(`pw:change:${sess.user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  const pw = validatePassword(newPassword);
  const user = await User().findById(sess.user.id).select("+passwordHash +passwordSalt");
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
    // A password signs in against an address — one has to exist first.
    throw httpError(400, "EMAIL_REQUIRED", "Add an email sign-in to this account before setting a password.");
  }
  const { salt, passwordHash } = await hashPassword(pw);
  user.passwordHash = passwordHash;
  user.passwordSalt = salt;
  user.passwordUpdatedAt = new Date();
  if (!(user.authProviders ?? []).some((p) => p.provider === "password")) {
    user.authProviders.push({ provider: "password", providerUserId: user.email, email: user.email });
  }
  user.updatedAt = new Date();
  await user.save();
  const signedOut = await revokeUserSessions(user._id, { exceptSessionId: sess.sessionId });
  return { user: publicUser(user), signedOut };
}
