// Mongoose models for MERIDIAN authentication and user-saved places.
// Pure MongoDB persistence backing all auth, session, OTP, and saved-place flows.

import mongoose from "mongoose";
import { createIndexesSafely, requireMongoConnection } from "./mongo.js";

const globalForAuthIndexes = globalThis;

const AuthProviderLinkSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["google", "apple", "microsoft", "amazon", "email", "phone", "password"],
      required: true,
    },
    providerUserId: { type: String, required: true },
    email: { type: String, default: null },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, lowercase: true },
    emailVerified: { type: Boolean, default: false },
    emailIsPrivateRelay: { type: Boolean, default: false },
    phone: { type: String, trim: true },
    phoneVerified: { type: Boolean, default: false },
    name: { type: String, trim: true, default: null },
    avatar: { type: String, default: null },
    accountStatus: { type: String, enum: ["active", "disabled"], default: "active" },
    passwordHash: { type: String, default: null },
    passwordSalt: { type: String, default: null },
    passwordUpdatedAt: { type: Date, default: null },
    authProviders: { type: [AuthProviderLinkSchema], default: [] },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { collection: "users", timestamps: true },
);

UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } },
);
UserSchema.index({ "authProviders.provider": 1, "authProviders.providerUserId": 1 });

const OtpCodeSchema = new mongoose.Schema(
  {
    identifier: { type: String, required: true, index: true },
    channel: { type: String, enum: ["email", "phone"], required: true, index: true },
    purpose: {
      type: String,
      enum: ["auth", "login", "verify_email", "verify_phone", "link_email", "link_phone", "reset_password"],
      default: "auth",
    },
    codeHash: { type: String, required: true },
    salt: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    ip: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    resendAvailableAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, expires: 0 },
    consumedAt: { type: Date, default: null },
  },
  { collection: "otpCodes" },
);

OtpCodeSchema.index({ identifier: 1, channel: 1, purpose: 1, createdAt: -1 });

const AuthSessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    userAgent: { type: String, default: null },
    method: { type: String, default: null },
    ip: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { collection: "authSessions" },
);

const SavedLocationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    placeId: { type: String, default: null },
    kind: { type: String, default: "PLACE" },
    name: { type: String, required: true },
    country: { type: String, default: null },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    note: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "savedLocations" },
);

SavedLocationSchema.index({ userId: 1, lat: 1, lon: 1 });

export const User = () => mongoose.models.User || mongoose.model("User", UserSchema);
export const OtpCode = () => mongoose.models.OtpCode || mongoose.model("OtpCode", OtpCodeSchema);
export const AuthSession = () =>
  mongoose.models.AuthSession || mongoose.model("AuthSession", AuthSessionSchema);
export const SavedLocationModel = () =>
  mongoose.models.SavedLocation || mongoose.model("SavedLocation", SavedLocationSchema);

export async function ensureAuthIndexes() {
  const conn = await requireMongoConnection();
  const activeUri = process.env.MONGODB_URI?.trim() || conn.connection.name || "default";
  if (
    globalForAuthIndexes.__meridianAuthIndexUri === activeUri &&
    globalForAuthIndexes.__meridianAuthIndexesReady
  ) {
    return;
  }
  const p = Promise.all([
    createIndexesSafely(User()),
    createIndexesSafely(OtpCode()),
    createIndexesSafely(AuthSession()),
    createIndexesSafely(SavedLocationModel()),
  ])
    .then(() => {
      globalForAuthIndexes.__meridianAuthIndexUri = activeUri;
    })
    .catch((err) => {
      globalForAuthIndexes.__meridianAuthIndexesReady = null;
      throw err;
    });
  globalForAuthIndexes.__meridianAuthIndexesReady = p;
  return p;
}
