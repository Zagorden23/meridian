import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { connectMongo } from "@/lib/meridian/mongo.js";
import { getSessionUser, SavedLocationModel } from "@/lib/meridian/auth-saved.js";

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
          await connectMongo();
          const rows = await SavedLocationModel().find({ userId: user.id }).sort({ createdAt: -1 }).limit(500).lean();
          return sendData(rows.map((r) => ({ ...r, id: String(r._id) })));
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
          await connectMongo();
          const key = `${body.kind}:${body.id ?? body.name}`;
          const doc = await SavedLocationModel().findOneAndUpdate(
            { userId: user.id, key },
            {
              $set: {
                userId: user.id, key, kind: String(body.kind).slice(0, 24),
                refId: String(body.id ?? "").slice(0, 160),
                name: String(body.name).slice(0, 160),
                latitude: lat, longitude: lon,
              },
            },
            { upsert: true, new: true },
          ).lean();
          return sendData({ ...doc, id: String(doc._id) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
