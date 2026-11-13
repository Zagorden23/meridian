import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser } from "@/lib/meridian/auth-saved.js";
import { listSavedLocations, upsertSavedLocation } from "@/lib/meridian/auth-storage.js";

async function requireUser(request) {
  const sess = await getSessionUser(request);
  if (!sess) {
    const err = new Error("Sign in with a MERIDIAN account to save places.");
    err.status = 401;
    err.code = "SESSION_REQUIRED";
    throw err;
  }
  return sess.user;
}

export const Route = createFileRoute("/api/saved/locations")({
  server: {
    handlers: {
      async GET({ request }) {
        try {
          const user = await requireUser(request);
          const rows = await listSavedLocations(user.id);
          return sendData(rows);
        } catch (err) { return sendError(err); }
      },
      async POST({ request }) {
        try {
          const user = await requireUser(request);
          const body = await readJson(request);
          const lat = Number(body.lat);
          const lon = Number(body.lon);
          if (!body.kind || !body.name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            const err = new Error("kind, name, lat and lon are required.");
            err.status = 400; err.code = "INVALID_SAVED";
            throw err;
          }
          const doc = await upsertSavedLocation(user.id, {
            kind: body.kind,
            id: body.id,
            name: body.name,
            lat,
            lon,
          });
          return sendData(doc);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
