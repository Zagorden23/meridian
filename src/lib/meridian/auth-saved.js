// Account saved-locations model (users' own rows only — every query is
// scoped by userId server-side; user ids are server-issued, never client-set).
import mongoose from "mongoose";

function model(name, schema) {
  if (mongoose.models[name]) return mongoose.models[name];
  return mongoose.model(name, schema);
}

export const SavedLocationModel = () => model("MeridianSavedLocationAuth", new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  key: { type: String, required: true }, // kind:refId dedupe per user
  kind: String,
  refId: String,
  name: String,
  latitude: Number,
  longitude: Number,
  createdAt: { type: Date, default: Date.now },
}, { collection: "savedLocations" }));

export { getSessionUser } from "./auth.js";
