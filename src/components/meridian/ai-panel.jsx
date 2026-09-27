// MERIDIAN AI workspace: conversation + input + send + suggested actions +
// tool results + loading + error states. Structured backend tools only — the
// client executes a whitelisted action set, never arbitrary code.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { Panel, ErrorState } from "./ui.jsx";

const GUEST_AI_LIMIT = 20;
const GUEST_AI_KEY = "meridian:ai-guest-count:v1";

const WHITELISTED = new Set(["navigateGlobe", "openTravel", "trackFlight", "switchMapMode"]);

const SUGGESTIONS = [
  "Weather in Tokyo",
  "Track 6E 521",
  "Nearest airport",
  "Show Kyoto",
  "Chennai to Kolkata route",
];

export function AIPanel() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "I'm Meridian AI. Ask about places, weather, or flights — every live fact comes from a backend tool." },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [lastTools, setLastTools] = useState([]);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const setMapMode = useMeridianStore((s) => s.setMapMode);
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  const setTrackedFlight = useMeridianStore((s) => s.setTrackedFlight);
  const navigate = useNavigate();

  const runActions = (actions = []) => {
    for (const a of actions) {
      if (!WHITELISTED.has(a.action)) continue; // never execute anything else
      if (a.action === "navigateGlobe" && a.lat != null && a.lon != null) {
        if (a.id) selectLocation({ kind: a.kind ?? "CITY", id: a.id, name: "", lat: a.lat, lon: a.lon });
        useGlobeStore.getState().pauseOrbit();
        useGlobeStore.getState().focusPointOn(a.lat, a.lon);
      } else if (a.action === "openTravel") {
        setActiveModule("travel");
      } else if (a.action === "switchMapMode" && (a.mode === "2d" || a.mode === "3d")) {
        setMapMode(a.mode);
      } else if (a.action === "trackFlight" && a.position) {
        setTrackedFlight({
          callsign: a.flightNumber ?? a.position.callsign,
          flightNumber: a.flightNumber,
          position: a.position,
          updatedAt: new Date().toISOString(),
        });
        setMapMode("3d");
        useGlobeStore.getState().pauseOrbit();
        useGlobeStore.getState().focusPointOn(a.position.latitude, a.position.longitude);
      }
    }
  };

  const send = async (preset) => {
    const text = (preset ?? input).trim();
    if (!text || pending) return;
    setInput("");
    setError("");
    // Guests get full public-tool access up to a session quota; members are
    // unlimited. The limit is enforced before any backend call.
    if (useAuthStore.getState().status === "GUEST") {
      let used = 0;
      try { used = Number(sessionStorage.getItem(GUEST_AI_KEY) ?? 0); } catch { /* noop */ }
      if (used >= GUEST_AI_LIMIT) {
        setMessages((m) => [...m,
          { role: "user", text },
          { role: "assistant", text: "You've used your 20 guest AI answers for this visit. Sign in for unlimited Meridian AI — your exploration context carries over.", guestLimit: true },
        ]);
        return;
      }
      try { sessionStorage.setItem(GUEST_AI_KEY, String(used + 1)); } catch { /* noop */ }
    }
    setMessages((m) => [...m, { role: "user", text }]);
    setPending(true);
    try {
      const location = useMeridianStore.getState().location;
      const res = await api.aiChat(text, {
        locationName: location?.name,
        location: location ? { lat: location.lat, lon: location.lon } : undefined,
      });
      setMessages((m) => [...m, { role: "assistant", text: res.data?.reply ?? "…" }]);
      setLastTools(res.data?.tools ?? []);
      runActions(res.data?.actions);
    } catch (err) {
      const msg = `The assistant is unavailable: ${err.message}`;
      setError(msg);
      setMessages((m) => [...m, { role: "assistant", text: msg }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel kicker="AI" title="Meridian AI">
      <ul className="max-h-64 space-y-2 overflow-y-auto" aria-live="polite" aria-label="Conversation">
        {messages.map((m, i) => (
          <li key={i} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-surface-raised" : "bg-surface-raised/50 text-muted"}`}>
            {m.text}
            {m.guestLimit && (
              <button type="button" onClick={() => navigate({ to: "/auth" })}
                className="mt-2 block rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">
                Sign in for unlimited AI
              </button>
            )}
          </li>
        ))}
        {pending && (
          <li className="flex items-center gap-2 text-xs text-subtle" role="status">
            <span className="inline-block size-3 animate-spin rounded-full border border-subtle border-t-transparent" aria-hidden />
            Consulting backend tools…
          </li>
        )}
      </ul>

      {error && <div className="mt-2"><ErrorState message={error} /></div>}

      {lastTools.length > 0 && (
        <details className="mt-2 rounded-xl bg-surface-raised/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">Tool results ({lastTools.length})</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto text-[11px] leading-relaxed text-subtle">
            {JSON.stringify(lastTools, null, 2)}
          </pre>
        </details>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggested actions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => send(s)}
            className="rounded-full bg-surface-raised/70 px-2.5 py-1 text-xs text-muted hover:text-fg disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about places, weather, flights…"
          aria-label="Ask Meridian AI"
          className="min-w-0 flex-1 rounded-xl bg-surface-raised/70 px-3 py-2 text-sm outline-none placeholder:text-subtle"
        />
        <button type="button" onClick={() => send()} disabled={pending} className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-40">
          {pending ? "…" : "Send"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-subtle">Structured tools only — no invented flights, weather, or coordinates.</p>
    </Panel>
  );
}
