// Favorites repository — account-backed when signed in (/api/saved, MongoDB),
// localStorage for recent history (temporary, non-sensitive).
// Guests cannot save: callers must gate on auth state and show GuestGate.
import { api } from "./api-client.js";

const HISTORY_KEY = "meridian:history:v1";

export function guestRestricted() {
  const err = new Error("Save this place with a MERIDIAN account.");
  err.code = "GUEST_RESTRICTED";
  err.status = 401;
  return err;
}

export async function listSaved() {
  const res = await api.savedList();
  return (res.data ?? []).map((r) => ({
    id: `${r.kind ?? "PLACE"}:${r.refId || r.id}`,
    serverId: r.id,
    name: r.name,
    kind: r.kind,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

export async function savePlace(entry) {
  const res = await api.savedAdd({
    kind: entry.kind, id: String(entry.id).split(":").slice(-1)[0] ?? entry.id,
    name: entry.name, lat: entry.lat, lon: entry.lon,
  });
  return res.data;
}

export async function removeSaved(serverId) {
  await api.savedRemove(serverId);
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — favorites degrade silently, never crash.
  }
}

export function listFavorites() {
  return [];
}

export function isFavorite(id) {
  void id;
  return false;
}

export function toggleFavorite(entry) {
  void entry;
  throw guestRestricted();
}

export function recordHistory(entry) {
  const all = load(HISTORY_KEY).filter((h) => h.id !== entry.id);
  all.unshift({ ...entry, viewedAt: new Date().toISOString() });
  save(HISTORY_KEY, all.slice(0, 100));
}

export function listHistory() {
  return load(HISTORY_KEY);
}
