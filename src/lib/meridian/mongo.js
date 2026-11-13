// MongoDB (Mongoose) connection + domain schemas for Meridian.
// Primary and exclusive persistence store across geo catalog, weather cache,
// flight snapshots, and accounts. Requires `MONGODB_URI` to be configured.

import mongoose from "mongoose";
import { loadLocalEnv } from "./load-env.js";

const globalForMongo = globalThis;

function getMongoUri() {
  if (typeof window !== "undefined") return "";
  loadLocalEnv();
  const raw = typeof process !== "undefined" ? process.env.MONGODB_URI : undefined;
  return typeof raw === "string" ? raw.trim() : "";
}

export function mongoConfigured() {
  return Boolean(getMongoUri());
}

const GeoPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  { _id: false },
);

const CountrySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    officialName: { type: String, default: null },
    iso2: { type: String, index: true, unique: true, sparse: true },
    iso3: { type: String, index: true, unique: true, sparse: true },
    continent: { type: String, default: null },
    capitalCityId: { type: String, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    location: { type: GeoPointSchema, default: undefined },
    timezone: { type: String, default: null },
    currency: { type: String, default: null },
    languages: { type: [String], default: [] },
    flag: { type: String, default: null },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "countries" },
);
CountrySchema.index({ location: "2dsphere" }, { sparse: true });

const StateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    countryId: { type: String, required: true, index: true },
    name: { type: String, required: true, index: true },
    code: { type: String, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    location: { type: GeoPointSchema, default: undefined },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "states" },
);
StateSchema.index({ countryId: 1, name: 1 });

const CitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    normalizedName: { type: String, required: true, index: true },
    countryId: { type: String, required: true, index: true },
    countryCode: { type: String, default: null, index: true },
    stateId: { type: String, default: null, index: true },
    latitude: { type: Number, required: true, index: true },
    longitude: { type: Number, required: true, index: true },
    elevation: { type: Number, default: null },
    timezone: { type: String, default: null },
    population: { type: Number, default: 0, index: true },
    featureClass: { type: String, default: "P" },
    featureCode: { type: String, default: null },
    isCapital: { type: Boolean, default: false, index: true },
    location: { type: GeoPointSchema, required: true },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "cities" },
);
CitySchema.index({ location: "2dsphere" });
CitySchema.index({ source: 1, sourceId: 1 }, { unique: true, sparse: true });
CitySchema.index({ countryId: 1, population: -1 });
CitySchema.index({ latitude: 1, longitude: 1, population: -1 });

const AirportSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    iata: { type: String, default: null, index: true, sparse: true },
    icao: { type: String, default: null, index: true, sparse: true },
    name: { type: String, required: true, index: true },
    cityId: { type: String, default: null, index: true },
    countryId: { type: String, default: null, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    elevation: { type: Number, default: null },
    timezone: { type: String, default: null },
    type: { type: String, default: "international" },
    location: { type: GeoPointSchema, required: true },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "airports" },
);
AirportSchema.index({ location: "2dsphere" });
AirportSchema.index({ source: 1, sourceId: 1 }, { unique: true, sparse: true });

const AirlineSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    iataCode: { type: String, default: null, index: true },
    icaoCode: { type: String, default: null, index: true },
    countryId: { type: String, default: null, index: true },
    type: { type: String, default: "passenger" },
    active: { type: Boolean, default: true, index: true },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "airlines" },
);
AirlineSchema.index({ source: 1, sourceId: 1 }, { unique: true, sparse: true });

const PoiSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    normalizedName: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    designation: { type: String, default: null },
    cityId: { type: String, default: null, index: true },
    countryId: { type: String, default: null, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: { type: GeoPointSchema, required: true },
    source: { type: String, default: "curated" },
    sourceId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "pois" },
);
PoiSchema.index({ location: "2dsphere" });
PoiSchema.index({ source: 1, sourceId: 1 }, { unique: true, sparse: true });

const FlightStatusSchema = new mongoose.Schema(
  {
    flightNumber: { type: String, required: true, index: true },
    airlineIata: String,
    originIata: String,
    destinationIata: String,
    originCountry: String,
    destinationCountry: String,
    scope: { type: String, enum: ["domestic", "international"], default: "international" },
    status: String,
    scheduledDeparture: Date,
    estimatedDeparture: Date,
    scheduledArrival: Date,
    estimatedArrival: Date,
    terminal: String,
    gate: String,
    provider: { type: String, required: true },
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, expires: 0 },
    raw: mongoose.Schema.Types.Mixed,
  },
  { collection: "flightStatuses" },
);
FlightStatusSchema.index({ flightNumber: 1, fetchedAt: -1 });

const FlightPositionSchema = new mongoose.Schema(
  {
    icao24: { type: String, required: true, unique: true },
    callsign: { type: String, index: true },
    originCountry: String,
    location: { type: GeoPointSchema, required: true },
    baroAltitudeM: Number,
    velocityMs: Number,
    trueTrackDeg: Number,
    onGround: Boolean,
    provider: { type: String, default: "opensky" },
    observedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now, expires: 300 },
    expiresAt: { type: Date, expires: 0 },
  },
  { collection: "flightPositions" },
);
FlightPositionSchema.index({ location: "2dsphere" });

const FlightTrackSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    origin: mongoose.Schema.Types.Mixed,
    destination: mongoose.Schema.Types.Mixed,
    waypoints: { type: [[Number]], default: [] }, // [lat, lon]
    distanceKm: Number,
    durationMin: Number,
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "flightTracks" },
);

const WeatherSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, sparse: true, index: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    location: { type: GeoPointSchema, default: undefined },
    provider: { type: String, required: true },
    payload: mongoose.Schema.Types.Mixed,
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, expires: 0 },
  },
  { collection: "weatherSnapshots" },
);
WeatherSnapshotSchema.index({ location: "2dsphere" });

const SearchHistorySchema = new mongoose.Schema(
  {
    userId: { type: String, default: "guest", index: true },
    query: { type: String, required: true },
    resolvedName: String,
    lat: Number,
    lon: Number,
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "searchHistory" },
);

const IngestionLogSchema = new mongoose.Schema(
  {
    dataset: { type: String, required: true, index: true },
    source: { type: String, required: true },
    records: { type: Number, default: 0 },
    finishedAt: { type: Date, default: Date.now },
  },
  { collection: "ingestionLogs" },
);

export const Country = () => mongoose.models.Country || mongoose.model("Country", CountrySchema);
export const State = () => mongoose.models.State || mongoose.model("State", StateSchema);
export const City = () => mongoose.models.City || mongoose.model("City", CitySchema);
export const Airport = () => mongoose.models.Airport || mongoose.model("Airport", AirportSchema);
export const Airline = () => mongoose.models.Airline || mongoose.model("Airline", AirlineSchema);
export const Poi = () => mongoose.models.Poi || mongoose.model("Poi", PoiSchema);
export const FlightStatus = () =>
  mongoose.models.FlightStatus || mongoose.model("FlightStatus", FlightStatusSchema);
export const FlightPosition = () =>
  mongoose.models.FlightPosition || mongoose.model("FlightPosition", FlightPositionSchema);
export const FlightTrack = () =>
  mongoose.models.FlightTrack || mongoose.model("FlightTrack", FlightTrackSchema);
export const WeatherSnapshot = () =>
  mongoose.models.WeatherSnapshot || mongoose.model("WeatherSnapshot", WeatherSnapshotSchema);
export const SearchHistory = () =>
  mongoose.models.SearchHistory || mongoose.model("SearchHistory", SearchHistorySchema);
export const IngestionLog = () =>
  mongoose.models.IngestionLog || mongoose.model("IngestionLog", IngestionLogSchema);

export async function createIndexesSafely(model) {
  try {
    await model.createIndexes();
  } catch (err) {
    if (
      err?.code === 85 ||
      err?.code === 86 ||
      err?.codeName === "IndexOptionsConflict" ||
      err?.codeName === "IndexKeySpecsConflict"
    ) {
      await model.syncIndexes();
      return;
    }
    throw err;
  }
}

async function ensureGeoIndexes() {
  if (globalForMongo.__meridianGeoIndexUri === globalForMongo.__meridianMongoUri &&
      globalForMongo.__meridianGeoIndexPromise) {
    return globalForMongo.__meridianGeoIndexPromise;
  }
  const activeUri = globalForMongo.__meridianMongoUri;
  const p = Promise.all([
    createIndexesSafely(Country()),
    createIndexesSafely(State()),
    createIndexesSafely(City()),
    createIndexesSafely(Airport()),
    createIndexesSafely(Airline()),
    createIndexesSafely(Poi()),
    createIndexesSafely(FlightStatus()),
    createIndexesSafely(FlightPosition()),
    createIndexesSafely(FlightTrack()),
    createIndexesSafely(WeatherSnapshot()),
    createIndexesSafely(SearchHistory()),
    createIndexesSafely(IngestionLog()),
  ])
    .then(() => {
      globalForMongo.__meridianGeoIndexUri = activeUri;
    })
    .catch((err) => {
      globalForMongo.__meridianGeoIndexPromise = null;
      throw err;
    });
  globalForMongo.__meridianGeoIndexPromise = p;
  return p;
}

export async function connectMongo() {
  if (typeof window !== "undefined") throw new Error("mongo.js is server-only");
  const uri = getMongoUri();
  if (!uri) return null;

  // Handle URI switch (primarily in isolated test runs) or live ready connection
  if (mongoose.connection.readyState === 1 && globalForMongo.__meridianMongoUri === uri) {
    await ensureGeoIndexes();
    return mongoose;
  }

  if (
    globalForMongo.__meridianMongoPromise &&
    globalForMongo.__meridianMongoUri === uri
  ) {
    const conn = await globalForMongo.__meridianMongoPromise;
    await ensureGeoIndexes();
    return conn;
  }

  // If connected to a previous URI (e.g. test suite isolation), disconnect cleanly first
  if (mongoose.connection.readyState !== 0 && globalForMongo.__meridianMongoUri !== uri) {
    await mongoose.disconnect().catch(() => {});
    globalForMongo.__meridianGeoIndexPromise = null;
    globalForMongo.__meridianGeoIndexUri = null;
  }

  globalForMongo.__meridianMongoUri = uri;
  globalForMongo.__meridianMongoPromise = mongoose
    .connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    })
    .then(async (m) => {
      await ensureGeoIndexes();
      return m;
    })
    .catch((err) => {
      globalForMongo.__meridianMongoPromise = null;
      globalForMongo.__meridianMongoUri = null;
      throw err;
    });

  return globalForMongo.__meridianMongoPromise;
}

export async function requireMongoConnection() {
  const uri = getMongoUri();
  if (!uri) {
    const err = new Error("MongoDB is not configured. Set MONGODB_URI on the server.");
    err.status = 503;
    err.code = "MONGO_UNCONFIGURED";
    throw err;
  }
  try {
    const conn = await connectMongo();
    if (!conn) {
      const err = new Error("MongoDB connection unavailable.");
      err.status = 503;
      err.code = "MONGO_UNAVAILABLE";
      throw err;
    }
    return conn;
  } catch (err) {
    if (err?.status) throw err;
    const wrapped = new Error(`MongoDB unavailable: ${err?.message || "connection failed"}`);
    wrapped.status = 503;
    wrapped.code = "MONGO_UNAVAILABLE";
    throw wrapped;
  }
}

export async function disconnectMongo() {
  globalForMongo.__meridianMongoPromise = null;
  globalForMongo.__meridianMongoUri = null;
  globalForMongo.__meridianGeoIndexPromise = null;
  globalForMongo.__meridianGeoIndexUri = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function mongoStatus() {
  const configured = mongoConfigured();
  const state = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  return {
    configured,
    connected: state === 1,
    state,
    database: mongoose.connection.name || null,
  };
}

export async function pingMongo() {
  const conn = await requireMongoConnection();
  const res = await conn.connection.db.admin().command({ ping: 1 });
  return { ok: Number(res?.ok || 0) === 1, ...mongoStatus() };
}

export async function cacheWeatherMongo(lat, lon, provider, payload, ttlMs = 15 * 60_000, key = null) {
  const conn = await connectMongo().catch(() => null);
  if (!conn) return false;
  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlMs);
  const resolvedKey = key || `wx:${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  await WeatherSnapshot().updateOne(
    { key: resolvedKey },
    {
      $set: {
        key: resolvedKey,
        lat,
        lon,
        location: { type: "Point", coordinates: [lon, lat] },
        provider,
        payload,
        fetchedAt: now,
        expiresAt,
      },
    },
    { upsert: true },
  );
  return true;
}

export async function nearestAirportMongo(lat, lon, maxKm = 500) {
  const conn = await connectMongo().catch(() => null);
  if (!conn) return null;
  const docs = await Airport().aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [lon, lat] },
        distanceField: "_distanceMeters",
        maxDistance: maxKm * 1000,
        spherical: true,
      },
    },
    { $limit: 1 },
  ]);
  if (!docs.length) return null;
  const { _id, __v, _distanceMeters, location: _location, ...rest } = docs[0];
  return {
    ...rest,
    distanceKm: typeof _distanceMeters === "number" ? Math.round((_distanceMeters / 1000) * 10) / 10 : undefined,
  };
}
