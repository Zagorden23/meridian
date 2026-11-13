// WGS84 geospatial math. Single home for every coordinate calculation so the
// globe, 2D map, repositories and AI tools can never disagree.
export const EARTH_RADIUS_KM = 6371.0088;

export function toRad(deg) {
  return (deg * Math.PI) / 180;
}
export function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function validateLatLon(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Haversine great-circle distance in km.
export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Initial bearing a→b in degrees [0,360).
export function bearingDeg(aLat, aLon, bLat, bLon) {
  const dLon = toRad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Spherical-linear interpolation along the great circle (fraction 0..1).
export function interpolateGreatCircle(aLat, aLon, bLat, bLon, t) {
  const a = [toRad(aLat), toRad(aLon)];
  const b = [toRad(bLat), toRad(bLon)];
  const toVec = ([la, lo]) => [
    Math.cos(la) * Math.cos(lo),
    Math.cos(la) * Math.sin(lo),
    Math.sin(la),
  ];
  const va = toVec(a);
  const vb = toVec(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return { lat: aLat, lon: aLon };
  const so = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / so;
  const wb = Math.sin(t * omega) / so;
  const v = [va[0] * wa + vb[0] * wb, va[1] * wa + vb[1] * wb, va[2] * wa + vb[2] * wb];
  return {
    lat: toDeg(Math.asin(Math.min(1, Math.max(-1, v[2])))),
    lon: toDeg(Math.atan2(v[1], v[0])),
  };
}

// Bounding box (degrees) containing a radius around a point — for spatial queries.
export function boundingBox(lat, lon, radiusKm) {
  const rad = radiusKm / EARTH_RADIUS_KM;
  const dLat = toDeg(rad);
  const dLon = toDeg(Math.asin(Math.min(1, Math.sin(rad) / Math.cos(toRad(lat)) || 0)));
  return {
    minLat: Math.max(-90, lat - dLat),
    maxLat: Math.min(90, lat + dLat),
    minLon: lon - (Number.isFinite(dLon) ? dLon : 180),
    maxLon: lon + (Number.isFinite(dLon) ? dLon : 180),
  };
}

// Visual arc height scales with route distance (short hop → low arc).
export function arcAltitude(routeKm, globeRadius = 1, maxLift = 0.32) {
  const t = Math.min(1, routeKm / 12000);
  return globeRadius * (1 + 0.04 + maxLift * Math.sin((Math.PI / 2) * t));
}

// --- Coordinate-as-search-query ---------------------------------------------
// Accepts what a human actually types:
//   "28.6139,77.2090"  "28.6139 77.2090"  "28.6139, 77.2090"
//   "28°36'51"N 77°12'32"E"  "28°36'51" N, 77°12'32" E"  "-33.865, 151.2094 S"
// Returns { lat, lon } clamped-validated, or null when the text is not a
// coordinate pair (then normal place search applies). Never throws.
const DMS_RE = /^(\d{1,3})[°˚º]\s*(\d{1,2}(?:\.\d+)?)?['′ʹ]?\s*(\d{1,2}(?:\.\d+)?)?["″]?\s*([NSEW])?\s*[,;]?\s*(\d{1,3})[°˚º]\s*(\d{1,2}(?:\.\d+)?)?['′ʹ]?\s*(\d{1,2}(?:\.\d+)?)?["″]?\s*([NSEW])?$/i;

const DECIMAL_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*[°˚º]?\s*([NSEW])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*[°˚º]?\s*([NSEW])?$/i;

function dmsToDecimal(deg, min = 0, sec = 0, hemi = "") {
  const dec = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
  const h = String(hemi).toUpperCase();
  if (h === "S" || h === "W") return -Math.abs(dec);
  if (h === "N" || h === "E") return Math.abs(dec);
  return dec;
}

export function parseCoordinateQuery(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 80) return null;
  if (!/[\d]/.test(raw) || !(/[°˚º'′"″]/.test(raw) || /[,\s]/.test(raw))) return null;

  const dms = raw.match(DMS_RE);
  if (dms) {
    const lat = dmsToDecimal(dms[1], dms[2] ?? 0, dms[3] ?? 0, dms[4] ?? "");
    const lon = dmsToDecimal(dms[5], dms[6] ?? 0, dms[7] ?? 0, dms[8] ?? "");
    if (validateLatLon(lat, lon)) return { lat, lon, format: "DMS" };
  }

  const dec = raw.match(DECIMAL_RE);
  if (dec) {
    let lat = Number(dec[1]);
    let lon = Number(dec[3]);
    const h1 = (dec[2] ?? "").toUpperCase();
    const h2 = (dec[4] ?? "").toUpperCase();
    if (h1 === "S") lat = -Math.abs(lat);
    if (h1 === "N") lat = Math.abs(lat);
    if (h2 === "W") lon = -Math.abs(lon);
    if (h2 === "E") lon = Math.abs(lon);
    if (validateLatLon(lat, lon)) return { lat, lon, format: "DECIMAL" };
  }

  // Bare "lat, lon" with no symbols — the most common form.
  const parts = raw.split(/[,;]+|\s+/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^-?\d{1,3}(\.\d+)?$/.test(p))) {
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (validateLatLon(lat, lon)) return { lat, lon, format: "DECIMAL" };
  }
  return null;
}
