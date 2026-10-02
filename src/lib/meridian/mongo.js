// MongoDB / Mongoose layer — MERIDIAN's primary database when MONGODB_URI
// is set (Atlas in production, local mongod in dev). JavaScript only,
// Mongoose only, no SQL. Every geographic document stores:
//   location: { type: "Point", coordinates: [longitude, latitude] }
// with a 2dsphere index. High-frequency collections (flightPositions,
// flightTracks, weatherSnapshots) use TTL retention so live data cannot grow
// unbounded. All helpers are server-only and degrade to null when no URI is
// configured, letting the SQL/PGLite fallback keep the app running.
import "./load-env.js";
import mongoose from "mongoose";

const uri = () => {
  const v = typeof process !== "undefined" ? process.env.MONGODB_URI : undefined;
  return v && String(v).trim() ? String(v).trim() : null;
};

export function mongoConfigured() {
  return Boolean(uri());
}

const GeoPoint = new mongoose.Schema({
  type: { type: String, enum: ["Point"], default: "Point" },
  coordinates: { type: [Number], default: [0, 0] }, // [lon, lat]
}, { _id: false });

function model(name, schema) {
  if (mongoose.models[name]) return mongoose.models[name];
  return mongoose.model(name, schema);
}

export const Country = () => model("MeridianCountry", new mongoose.Schema({
  name: { type: String, required: true, index: true },
  iso2: { type: String, index: true },
  iso3: { type: String, index: true },
  continent: String,
  location: { type: GeoPoint, required: false },
  latitude: Number,
  longitude: Number,
  timezone: String,
  currency: String,
  languages: String,
  source: { type: String, default: "meridian-curated" },
  sourceId: String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: "countries" }));

export const State = () => model("MeridianState", new mongoose.Schema({
  name: { type: String, required: true, index: true },
  code: String,
  countryId: { type: String, index: true },
  location: { type: GeoPoint, required: false },
  source: { type: String, default: "meridian-curated" },
  sourceId: String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: "states" }));

export const City = () => model("MeridianCity", new mongoose.Schema({
  name: { type: String, required: true, index: true },
  normalizedName: { type: String, index: true },
  countryId: { type: String, index: true },
  stateId: { type: String, index: true },
  population: Number,
  isCapital: { type: Boolean, index: true },
  timezone: String,
  location: { type: GeoPoint, required: true },
  source: { type: String, default: "meridian-curated" },
  sourceId: String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: "cities" }));

export const Airport = () => model("MeridianAirport", new mongoose.Schema({
  name: { type: String, required: true },
  iata: { type: String, index: true },
  icao: { type: String, index: true },
  cityId: { type: String, index: true },
  countryId: { type: String, index: true },
  type: String,
  location: { type: GeoPoint, required: true },
  source: { type: String, default: "meridian-curated" },
  sourceId: String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: "airports" }));

export const Airline = () => model("MeridianAirline", new mongoose.Schema({
  name: { type: String, required: true },
  iataCode: { type: String, index: true },
  icaoCode: { type: String, index: true },
  countryId: { type: String, index: true },
  source: { type: String, default: "meridian-curated" },
  updatedAt: { type: Date, default: Date.now },
}, { collection: "airlines" }));

export const FlightStatus = () => model("MeridianFlightStatus", new mongoose.Schema({
  flightNumber: { type: String, required: true, index: true },
  airline: String,
  origin: String,
  destination: String,
  status: { type: String, default: "UNKNOWN" },
  scheduledDeparture: Date,
  estimatedDeparture: Date,
  actualDeparture: Date,
  scheduledArrival: Date,
  estimatedArrival: Date,
  actualArrival: Date,
  terminal: String,
  gate: String,
  aircraft: String,
  source: String,
  fetchedAt: { type: Date, default: Date.now },
}, { collection: "flightStatuses" }));

export const FlightPosition = () => model("MeridianFlightPosition", new mongoose.Schema({
  flightId: String,
  flightNumber: { type: String, index: true },
  latitude: Number,
  longitude: Number,
  altitude: Number,
  groundspeed: Number,
  heading: Number,
  verticalRate: Number,
  timestamp: Date,
  source: String,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }, // 7-day TTL
}, { collection: "flightPositions" }));

export const FlightTrack = () => model("MeridianFlightTrack", new mongoose.Schema({
  flightId: String,
  flightNumber: { type: String, index: true },
  points: [{ latitude: Number, longitude: Number, altitude: Number, timestamp: Date }],
  source: String,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }, // 30-day TTL
}, { collection: "flightTracks" }));

export const WeatherSnapshot = () => model("MeridianWeatherSnapshot", new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  location: { type: GeoPoint, required: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  source: String,
  sourceId: String,
  fetchedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, expires: 0 }, // TTL via absolute expiry
}, { collection: "weatherSnapshots" }));

export const Poi = () => model("MeridianPoi", new mongoose.Schema({
  name: { type: String, required: true, index: true },
  category: { type: String, index: true },
  designation: String,
  location: { type: GeoPoint, required: true },
  source: { type: String, default: "meridian-curated" },
  sourceId: String,
  updatedAt: { type: Date, default: Date.now },
}, { collection: "pois" }));

export const SavedLocation = () => model("MeridianSavedLocation", new mongoose.Schema({
  userId: String,
  label: String,
  kind: String,
  refId: String,
  latitude: Number,
  longitude: Number,
  createdAt: { type: Date, default: Date.now },
}, { collection: "savedLocations" }));

export const SearchHistory = () => model("MeridianSearchHistory", new mongoose.Schema({
  query: { type: String, index: true },
  kind: String,
  refId: String,
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 }, // 90-day TTL
}, { collection: "searchHistory" }));

let connectPromise = null;

/** Connect once per process; resolves null when MONGODB_URI is unset. */
export function connectMongo() {
  if (typeof window !== "undefined") throw new Error("mongo.js is server-only");
  const u = uri();
  if (!u) return Promise.resolve(null);
  connectPromise ??= mongoose.connect(u, { autoIndex: true }).then(async () => {
    await Promise.all([
      City().collection.createIndex({ location: "2dsphere" }).catch(() => {}),
      Airport().collection.createIndex({ location: "2dsphere" }).catch(() => {}),
      Poi().collection.createIndex({ location: "2dsphere" }).catch(() => {}),
      Country().collection.createIndex({ location: "2dsphere" }).catch(() => {}),
      WeatherSnapshot().collection.createIndex({ location: "2dsphere" }).catch(() => {}),
      City().collection.createIndex({ normalizedName: 1 }).catch(() => {}),
      Airport().collection.createIndex({ iata: 1, icao: 1 }).catch(() => {}),
    ]);
    return mongoose.connection;
  }).catch((err) => {
    connectPromise = null;
    throw err;
  });
  return connectPromise;
}

export function mongoStatus() {
  const ready = mongoose.connection?.readyState === 1;
  return { configured: mongoConfigured(), connected: ready, state: mongoose.connection?.readyState ?? 0 };
}

/** Best-effort dual-write: Mongo weather cache (TTL 30 min). Never throws. */
export async function cacheWeatherMongo({ lat, lon, payload, source }) {
  try {
    if (!mongoConfigured()) return;
    await connectMongo();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await WeatherSnapshot().updateOne(
      { latitude: Number(lat), longitude: Number(lon) },
      {
        $set: {
          latitude: Number(lat),
          longitude: Number(lon),
          location: { type: "Point", coordinates: [Number(lon), Number(lat)] },
          payload,
          source: source ?? payload?.source ?? "open-meteo",
          fetchedAt: new Date(),
          updatedAt: new Date(),
          expiresAt,
        },
      },
      { upsert: true },
    );
  } catch { /* cache is best-effort */ }
}

/** Nearest airport via $near — falls back to null (caller uses SQL repo). */
export async function nearestAirportMongo(lat, lon, maxKm = 500) {
  try {
    if (!mongoConfigured()) return null;
    await connectMongo();
    const rows = await Airport().find({
      location: { $near: { $geometry: { type: "Point", coordinates: [Number(lon), Number(lat)] }, $maxDistance: maxKm * 1000 } },
    }).limit(1).lean();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
