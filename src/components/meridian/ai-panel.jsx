// MERIDIAN AI workspace: conversation + input + send + suggested actions +
// tool results + loading + error states. Structured backend tools only — the
// client executes a whitelisted action set, never arbitrary code.
import { useState } from "react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { useAuthPrompt } from "@/lib/meridian/use-auth-prompt.js";
import { Panel, inputClass, primaryButtonClass } from "./ui.jsx";
import { cn } from "@/lib/utils";

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
  const [failedQuestion, setFailedQuestion] = useState(""); // kept so a failed ask can be retried
  const [lastTools, setLastTools] = useState([]);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const setMapMode = useMeridianStore((s) => s.setMapMode);
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  const setTrackedFlight = useMeridianStore((s) => s.setTrackedFlight);
  const promptAuth = useAuthPrompt();

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
    setFailedQuestion("");
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
      // Said once, in the conversation, with the question kept for a retry.
      const msg = err?.status === 429
        ? "That's a lot of questions at once — give it a moment and ask again."
        : "I couldn't reach the assistant just now. Please try again.";
      setFailedQuestion(text);
      setMessages((m) => [...m, { role: "assistant", text: msg, failed: true }]);
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
              <button type="button" onClick={() => promptAuth()}
                className="mt-2 block rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                Sign in for unlimited AI
              </button>
            )}
            {m.failed && i === messages.length - 1 && failedQuestion && !pending && (
              <button type="button" onClick={() => send(failedQuestion)}
                className="mt-2 block rounded-full bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Try again
              </button>
            )}
          </li>
        ))}
        {pending && (
          <li className="flex items-center gap-2 text-xs text-subtle" role="status">
            <span className="inline-block size-3 animate-spin rounded-full border border-subtle border-t-transparent" aria-hidden />
            Looking that up…
          </li>
        )}
      </ul>


      {lastTools.length > 0 && (
        <details className="mt-2 rounded-xl bg-surface-raised/50 px-3 py-2">
          <summary className="cursor-pointer rounded text-xs font-medium text-muted">Sources used ({lastTools.length})</summary>
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
            className="rounded-full bg-surface-raised/70 px-2.5 py-1.5 text-xs text-muted transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about places, weather, flights…"
          aria-label="Ask Meridian AI"
          maxLength={500}
          className={cn(inputClass, "min-w-0 flex-1")}
        />
        <button type="submit" disabled={pending || !input.trim()} className={primaryButtonClass}>
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
      <p className="mt-1.5 text-[11px] text-subtle">Answers come from live data sources — flights, weather and coordinates are never made up.</p>
    </Panel>
  );
}
