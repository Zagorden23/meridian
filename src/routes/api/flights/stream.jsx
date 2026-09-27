// SSE live flight stream: provider → backend poll (15 s) → cache → events.
// Browsers share one backend poll cadence instead of hammering OpenSky.
import { createFileRoute } from "@tanstack/react-router";
import { getLiveTraffic } from "@/lib/meridian/flight-providers.js";

export const Route = createFileRoute("/api/flights/stream")({
  server: {
    handlers: {
      async GET({ request }) {
        const url = new URL(request.url);
        const bbox = {
          lamin: Number(url.searchParams.get("lamin")),
          lamax: Number(url.searchParams.get("lamax")),
          lomin: Number(url.searchParams.get("lomin")),
          lomax: Number(url.searchParams.get("lomax")),
        };
        const viewport = [bbox.lamin, bbox.lamax, bbox.lomin, bbox.lomax].every(Number.isFinite) ? bbox : {};
        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            let closed = false;
            request.signal?.addEventListener("abort", () => { closed = true; });
            const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
            controller.enqueue(enc.encode(": meridian live flights\n\n"));
            while (!closed) {
              try {
                const traffic = await getLiveTraffic(viewport);
                send({ ...traffic, freshness: "LIVE" });
              } catch (err) {
                send({ error: err.message ?? "Live traffic unavailable", freshness: "UNKNOWN" });
              }
              await new Promise((r) => setTimeout(r, 15000));
              if (closed) break;
            }
            try { controller.close(); } catch { /* already closed */ }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
