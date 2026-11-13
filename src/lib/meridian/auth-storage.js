// Pure MongoDB persistence layer for MERIDIAN authentication and saved locations.
// All user accounts, OAuth provider links, hashed OTP challenges, sessions,
// and user-saved locations are stored exclusively in MongoDB via Mongoose.

import mongoose from "mongoose";
import {
  AuthSession,
  OtpCode,
  SavedLocationModel,
  User,
  ensureAuthIndexes,
} from "./auth-models.js";
import { requireMongoConnection } from "./mongo.js";

export function authBackend() {
  return "mongodb";
}

async function ensureMongo() {
  await requireMongoConnection();
  await ensureAuthIndexes();
}

function normalizeMongoError(err) {
  if (err?.code === 11000) {
    err.isUniqueConflict = true;
  }
  return err;
}

function mapUserDoc(doc, { includeSecrets = false } = {}) {
  if (!doc) return null;
  const id = String(doc._id ?? doc.id);
  const avatar = doc.avatar ?? doc.avatarUrl ?? null;
  const user = {
    _id: id,
    id,
    email: doc.email ?? null,
    emailVerified: Boolean(doc.emailVerified),
    emailIsPrivateRelay: Boolean(doc.emailIsPrivateRelay),
    phone: doc.phone ?? null,
    phoneVerified: Boolean(doc.phoneVerified),
    name: doc.name ?? null,
    avatar,
    avatarUrl: avatar,
    accountStatus: doc.accountStatus || "active",
    authProviders: Array.isArray(doc.authProviders)
      ? doc.authProviders.map((p) => ({
          provider: p.provider,
          providerUserId: p.providerUserId,
          email: p.email ?? null,
          linkedAt: p.linkedAt ?? null,
        }))
      : [],
    lastLoginAt: doc.lastLoginAt ?? null,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
  if (includeSecrets) {
    user.passwordHash = doc.passwordHash ?? null;
    user.passwordSalt = doc.passwordSalt ?? null;
    user.passwordUpdatedAt = doc.passwordUpdatedAt ?? null;
  }
  return user;
}

function mapSessionDoc(doc) {
  if (!doc) return null;
  const id = String(doc._id ?? doc.id);
  return {
    _id: id,
    id,
    userId: String(doc.userId),
    tokenHash: doc.tokenHash,
    userAgent: doc.userAgent ?? null,
    method: doc.method ?? null,
    ip: doc.ip ?? null,
    createdAt: doc.createdAt ?? null,
    expiresAt: doc.expiresAt,
  };
}

function mapOtpDoc(doc) {
  if (!doc) return null;
  const id = String(doc._id ?? doc.id);
  return {
    _id: id,
    id,
    identifier: doc.identifier,
    channel: doc.channel,
    purpose: doc.purpose,
    codeHash: doc.codeHash,
    salt: doc.salt,
    external: doc.external ?? null,
    attempts: Number(doc.attempts ?? 0),
    maxAttempts: Number(doc.maxAttempts ?? 5),
    resendAvailableAt: doc.resendAvailableAt ?? null,
    ip: doc.ip ?? null,
    createdAt: doc.createdAt ?? null,
    expiresAt: doc.expiresAt,
    consumedAt: doc.consumedAt ?? null,
  };
}

function mapSavedDoc(doc) {
  if (!doc) return null;
  const id = String(doc._id ?? doc.id);
  return {
    _id: id,
    id,
    placeId: doc.placeId ?? null,
    userId: String(doc.userId),
    kind: doc.kind ?? "PLACE",
    name: doc.name,
    country: doc.country ?? null,
    lat: Number(doc.lat),
    lon: Number(doc.lon),
    note: doc.note ?? null,
    createdAt: doc.createdAt ?? null,
  };
}

export async function findUserById(id, { includeSecrets = false } = {}) {
  await ensureMongo();
  const strId = id ? String(id) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return null;
  const doc = await User().findById(strId).lean();
  return mapUserDoc(doc, { includeSecrets });
}

export async function findUserByEmail(email, { includeSecrets = false } = {}) {
  await ensureMongo();
  if (!email) return null;
  const doc = await User().findOne({ email: String(email).toLowerCase().trim() }).lean();
  return mapUserDoc(doc, { includeSecrets });
}

export async function findUserByPhone(phone, { includeSecrets = false } = {}) {
  await ensureMongo();
  if (!phone) return null;
  const doc = await User().findOne({ phone: String(phone).trim() }).lean();
  return mapUserDoc(doc, { includeSecrets });
}

export async function findUserByProvider(provider, providerUserId, { includeSecrets = false } = {}) {
  await ensureMongo();
  if (!provider || !providerUserId) return null;
  const doc = await User()
    .findOne({
      authProviders: {
        $elemMatch: {
          provider: String(provider),
          providerUserId: String(providerUserId),
        },
      },
    })
    .lean();
  return mapUserDoc(doc, { includeSecrets });
}

export async function userExistsWithEmail(email, { excludeUserId } = {}) {
  await ensureMongo();
  if (!email) return false;
  const filter = { email: String(email).toLowerCase().trim() };
  if (excludeUserId && mongoose.Types.ObjectId.isValid(String(excludeUserId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(excludeUserId)) };
  }
  const hit = await User().exists(filter);
  return Boolean(hit);
}

export async function userExistsWithPhone(phone, { excludeUserId } = {}) {
  await ensureMongo();
  if (!phone) return false;
  const filter = { phone: String(phone).trim() };
  if (excludeUserId && mongoose.Types.ObjectId.isValid(String(excludeUserId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(excludeUserId)) };
  }
  const hit = await User().exists(filter);
  return Boolean(hit);
}

export async function createUser(fields) {
  await ensureMongo();
  const avatar = fields.avatar ?? fields.avatarUrl ?? null;
  const payload = {
    emailVerified: Boolean(fields.emailVerified),
    emailIsPrivateRelay: Boolean(fields.emailIsPrivateRelay),
    phoneVerified: Boolean(fields.phoneVerified),
    name: fields.name ?? null,
    avatar,
    accountStatus: fields.accountStatus || "active",
    passwordHash: fields.passwordHash ?? null,
    passwordSalt: fields.passwordSalt ?? null,
    passwordUpdatedAt: fields.passwordUpdatedAt ?? null,
    authProviders: Array.isArray(fields.authProviders) ? fields.authProviders : [],
    lastLoginAt: fields.lastLoginAt ?? new Date(),
  };
  // Omit falsy/null email & phone so sparse/partial unique indexes never collide on null
  if (fields.email) payload.email = String(fields.email).toLowerCase().trim();
  if (fields.phone) payload.phone = String(fields.phone).trim();

  try {
    const doc = await User().create(payload);
    return mapUserDoc(doc.toObject ? doc.toObject() : doc, { includeSecrets: true });
  } catch (err) {
    throw normalizeMongoError(err);
  }
}

export async function saveUser(user) {
  await ensureMongo();
  const userId = String(user?.id ?? user?._id ?? "");
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const err = new Error("User not found.");
    err.status = 404;
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const avatar = user.avatar ?? user.avatarUrl ?? null;
  const $set = {
    emailVerified: Boolean(user.emailVerified),
    emailIsPrivateRelay: Boolean(user.emailIsPrivateRelay),
    phoneVerified: Boolean(user.phoneVerified),
    name: user.name ?? null,
    avatar,
    accountStatus: user.accountStatus || "active",
    authProviders: Array.isArray(user.authProviders) ? user.authProviders : [],
    lastLoginAt: user.lastLoginAt ?? new Date(),
  };
  const $unset = {};

  if (user.email) $set.email = String(user.email).toLowerCase().trim();
  else $unset.email = 1;

  if (user.phone) $set.phone = String(user.phone).trim();
  else $unset.phone = 1;

  if ("passwordHash" in user) $set.passwordHash = user.passwordHash ?? null;
  if ("passwordSalt" in user) $set.passwordSalt = user.passwordSalt ?? null;
  if ("passwordUpdatedAt" in user) $set.passwordUpdatedAt = user.passwordUpdatedAt ?? null;

  const updateOp = Object.keys($unset).length > 0 ? { $set, $unset } : { $set };

  try {
    const doc = await User()
      .findByIdAndUpdate(userId, updateOp, { returnDocument: "after" })
      .lean();
    return mapUserDoc(doc, { includeSecrets: true });
  } catch (err) {
    throw normalizeMongoError(err);
  }
}

export async function touchUserLogin(userId) {
  await ensureMongo();
  const strId = userId ? String(userId) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return;
  await User().updateOne({ _id: strId }, { $set: { lastLoginAt: new Date() } });
}

export async function createAuthSession({
  userId,
  tokenHash,
  userAgent,
  method,
  ip,
  expiresAt,
}) {
  await ensureMongo();
  const doc = await AuthSession().create({
    userId: String(userId),
    tokenHash,
    userAgent: userAgent ?? null,
    method: method ?? null,
    ip: ip ?? null,
    expiresAt: expiresAt instanceof Date ? expiresAt : new Date(expiresAt),
  });
  return mapSessionDoc(doc.toObject ? doc.toObject() : doc);
}

export async function findAuthSessionByTokenHash(tokenHash) {
  await ensureMongo();
  if (!tokenHash) return null;
  const doc = await AuthSession()
    .findOne({ tokenHash, expiresAt: { $gt: new Date() } })
    .lean();
  return mapSessionDoc(doc);
}

export async function deleteAuthSessionById(id) {
  await ensureMongo();
  const strId = id ? String(id) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return;
  await AuthSession().deleteOne({ _id: strId });
}

export async function deleteAuthSessionByTokenHash(tokenHash) {
  await ensureMongo();
  if (!tokenHash) return;
  await AuthSession().deleteOne({ tokenHash });
}

export async function revokeUserAuthSessions(
  userId,
  { exceptSessionId = null, exceptTokenHash = null } = {},
) {
  await ensureMongo();
  const filter = { userId: String(userId) };
  if (exceptSessionId && mongoose.Types.ObjectId.isValid(String(exceptSessionId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(exceptSessionId)) };
  }
  if (exceptTokenHash) {
    filter.tokenHash = { $ne: exceptTokenHash };
  }
  const res = await AuthSession().deleteMany(filter);
  return Number(res?.deletedCount ?? 0);
}

export async function findLatestActiveOtp({ identifier, channel, purpose }) {
  await ensureMongo();
  const doc = await OtpCode()
    .findOne({
      identifier: String(identifier),
      channel: String(channel),
      purpose: String(purpose || "auth"),
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    })
    .sort({ createdAt: -1 })
    .lean();
  return mapOtpDoc(doc);
}

export async function createOtpRecord({
  identifier,
  channel,
  purpose,
  codeHash,
  salt,
  maxAttempts,
  expiresAt,
  resendAvailableAt,
  ip,
}) {
  await ensureMongo();
  const doc = await OtpCode().create({
    identifier: String(identifier),
    channel: String(channel),
    purpose: String(purpose || "auth"),
    codeHash,
    salt,
    maxAttempts: Number(maxAttempts ?? 5),
    resendAvailableAt: resendAvailableAt
      ? resendAvailableAt instanceof Date
        ? resendAvailableAt
        : new Date(resendAvailableAt)
      : null,
    expiresAt: expiresAt instanceof Date ? expiresAt : new Date(expiresAt),
    ip: ip ?? null,
  });
  return mapOtpDoc(doc.toObject ? doc.toObject() : doc);
}

export async function setOtpExternal(otpId, verifier) {
  await ensureMongo();
  const strId = otpId ? String(otpId) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return;
  await OtpCode().updateOne({ _id: strId }, { $set: { external: String(verifier) } });
}

export async function incrementOtpAttempts(otpId) {
  await ensureMongo();
  const strId = otpId ? String(otpId) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return 0;
  const doc = await OtpCode()
    .findByIdAndUpdate(strId, { $inc: { attempts: 1 } }, { returnDocument: "after" })
    .lean();
  return Number(doc?.attempts ?? 0);
}

export async function consumeOtpRecord(otpId) {
  await ensureMongo();
  const strId = otpId ? String(otpId) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return;
  await OtpCode().updateOne({ _id: strId }, { $set: { consumedAt: new Date() } });
}

export async function invalidateSiblingOtps({ identifier, channel, purpose, exceptId }) {
  await ensureMongo();
  const filter = {
    identifier: String(identifier),
    channel: String(channel),
    purpose: String(purpose || "auth"),
    consumedAt: null,
  };
  if (exceptId && mongoose.Types.ObjectId.isValid(String(exceptId))) {
    filter._id = { $ne: new mongoose.Types.ObjectId(String(exceptId)) };
  }
  await OtpCode().updateMany(filter, { $set: { consumedAt: new Date() } });
}

export async function deleteOtpRecord(otpId) {
  await ensureMongo();
  const strId = otpId ? String(otpId) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) return;
  await OtpCode().deleteOne({ _id: strId });
}

export async function listSavedLocations(userId) {
  await ensureMongo();
  const docs = await SavedLocationModel()
    .find({ userId: String(userId) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return docs.map(mapSavedDoc);
}

export async function upsertSavedLocation(userId, entry) {
  await ensureMongo();
  const lat = Math.round(Number(entry.lat) * 1e4) / 1e4;
  const lon = Math.round(Number(entry.lon) * 1e4) / 1e4;
  const placeId = entry.id ?? entry.placeId ?? null;
  const filter = placeId
    ? { userId: String(userId), placeId: String(placeId) }
    : { userId: String(userId), lat, lon };
  const doc = await SavedLocationModel()
    .findOneAndUpdate(
      filter,
      {
        $set: {
          userId: String(userId),
          placeId: placeId ? String(placeId) : null,
          kind: entry.kind || "PLACE",
          name: String(entry.name || "").trim(),
          country: entry.country ?? null,
          lat,
          lon,
          note: entry.note ?? null,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after" },
    )
    .lean();
  return mapSavedDoc(doc);
}

export async function deleteSavedLocation(id, userId) {
  await ensureMongo();
  const strId = id ? String(id) : "";
  if (!strId || !mongoose.Types.ObjectId.isValid(strId)) {
    return false;
  }
  const res = await SavedLocationModel().deleteOne({
    _id: strId,
    userId: String(userId),
  });
  return res.deletedCount > 0;
}
