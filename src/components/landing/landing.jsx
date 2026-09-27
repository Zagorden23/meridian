// MERIDIAN landing — cinematic observatory entry. Dark, quiet, globe-led.
// Sections: hero (wordmark + orbital Earth + CTAs), capabilities, flight
// intelligence (illustrative arc), explore strip, AI concept, final CTA.
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Compass, CloudSun, Plane, Map as MapIcon, Bot, Radar, ArrowRight, UserRound,
} from "lucide-react";
import { useAuthStore } from "@/store/auth-store.js";

function Stars() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        backgroundImage:
          "radial-gradient(1px 1px at 12% 22%, rgba(233,237,244,.7) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 68% 12%, rgba(158,201,214,.8) 50%, transparent 51%)," +
          "radial-gradient(1.5px 1.5px at 84% 38%, rgba(233,237,244,.6) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 32% 68%, rgba(233,237,244,.5) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 52% 84%, rgba(158,201,214,.6) 50%, transparent 51%)," +
          "radial-gradient(1.5px 1.5px at 8% 52%, rgba(233,237,244,.5) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 44% 8%, rgba(233,237,244,.6) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 76% 72%, rgba(233,237,244,.45) 50%, transparent 51%)," +
          "radial-gradient(1px 1px at 22% 40%, rgba(158,201,214,.5) 50%, transparent 51%)," +
          "radial-gradient(1.5px 1.5px at 60% 55%, rgba(233,237,244,.5) 50%, transparent 51%)",
      }}
    />
  );
}

function OrbitalEarth({ className = "" }) {
  return (
    <svg viewBox="0 0 480 480" className={className} role="img" aria-label="Stylized orbital Earth" aria-hidden={false}>
      <defs>
        <radialGradient id="m-earth" cx="38%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#1d2b36" />
          <stop offset="55%" stopColor="#0d141b" />
          <stop offset="100%" stopColor="#07080c" />
        </radialGradient>
        <linearGradient id="m-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9ec9d6" stopOpacity="0" />
          <stop offset="55%" stopColor="#9ec9d6" stopOpacity=".9" />
          <stop offset="100%" stopColor="#e9edf4" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="240" cy="240" rx="150" ry="150" fill="url(#m-earth)" stroke="rgba(158,201,214,.35)" strokeWidth="1" />
      <ellipse cx="240" cy="240" rx="196" ry="72" fill="none" stroke="url(#m-arc)" strokeWidth="1.2" transform="rotate(-18 240 240)" />
      <ellipse cx="240" cy="240" rx="218" ry="96" fill="none" stroke="rgba(158,201,214,.28)" strokeWidth="1" transform="rotate(12 240 240)" />
      <circle cx="240" cy="240" r="150" fill="none" stroke="rgba(233,237,244,.08)" strokeWidth="1" />
      <circle cx="150" cy="150" r="3" fill="#e9edf4">
        <animate attributeName="opacity" values="1;.35;1" dur="3.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="352" cy="300" r="4" fill="#ff7a7a">
        <animate attributeName="opacity" values="1;.4;1" dur="2.1s" repeatCount="indefinite" />
      </circle>
      <circle cx="352" cy="300" r="9" fill="none" stroke="rgba(255,122,122,.5)" strokeWidth="1">
        <animate attributeName="r" values="7;12" dur="2.1s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".7;0" dur="2.1s" repeatCount="indefinite" />
      </circle>
      <circle cx="386" cy="118" r="2.5" fill="#9ec9d6" />
    </svg>
  );
}

function RouteArc() {
  return (
    <svg viewBox="0 0 560 260" className="w-full" role="img" aria-label="Illustrative flight arc from Chennai to Kolkata">
      <defs>
        <linearGradient id="m-route" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9ec9d6" />
          <stop offset="100%" stopColor="#e9edf4" />
        </linearGradient>
      </defs>
      <path d="M60,220 Q280,20 500,220" fill="none" stroke="url(#m-route)" strokeWidth="1.5" strokeDasharray="5 4" />
      <circle cx="60" cy="220" r="5" fill="#e9edf4" />
      <circle cx="500" cy="220" r="5" fill="#e9edf4" />
      <circle cx="280" cy="106" r="6" fill="#ff7a7a">
        <animate attributeName="opacity" values="1;.45;1" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <text x="60" y="244" fill="#8b93a7" fontSize="13" textAnchor="middle">Chennai</text>
      <text x="500" y="244" fill="#8b93a7" fontSize="13" textAnchor="middle">Kolkata</text>
      <text x="280" y="88" fill="#6b7386" fontSize="11" textAnchor="middle">aircraft · illustrative</text>
    </svg>
  );
}

const CAPABILITIES = [
  { icon: Compass, title: "Explore", text: "Discover cities, countries, capitals and places." },
  { icon: CloudSun, title: "Weather", text: "Current conditions and forecasts for supported locations." },
  { icon: Plane, title: "Travel", text: "Search routes and available flights." },
  { icon: Radar, title: "Live flight intelligence", text: "Track supported flights and aircraft positions." },
  { icon: MapIcon, title: "Maps", text: "Switch between the 3D globe and 2D maps." },
  { icon: Bot, title: "Meridian AI", text: "Search and navigate the platform in natural language." },
];

export function Landing() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const init = useAuthStore((s) => s.init);

  useEffect(() => { init(); }, [init]);

  const inApp = status === "AUTHENTICATED" || status === "GUEST";
  const guest = () => {
  continueAsGuest();
  navigate({ to: "/app" });
  };

  return (
  <div className="min-h-dvh overflow-y-auto bg-bg text-fg">
    {/* Persistent minimal nav — brand left, entry actions right. */}
    <nav aria-label="Primary" className="fixed inset-x-0 top-0 z-40 border-b border-border/40 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="font-display text-lg italic text-fg">
          Meridian
        </button>
        <div className="flex items-center gap-2">
          {inApp ? (
            <button type="button" onClick={() => navigate({ to: "/app" })}
              className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-label text-accent-fg">
              Open Meridian
            </button>
          ) : (
            <>
              <button type="button" onClick={guest}
                className="hidden rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-label text-muted hover:text-fg sm:block">
                Guest
              </button>
              <button type="button" onClick={() => navigate({ to: "/auth?mode=signup" })}
                className="hidden rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-label text-muted hover:text-fg sm:block">
                Create account
              </button>
              <button type="button" onClick={() => navigate({ to: "/auth" })}
                className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-label text-accent-fg">
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </nav>

    {/* HERO */}
    <header className="relative flex min-h-[96dvh] flex-col items-center justify-center overflow-hidden px-6 pb-8 pt-24 text-center">
        <Stars />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(158,201,214,.10) 0%, transparent 62%)" }} />
        <p className="relative text-xs font-medium uppercase tracking-label text-muted">Observatory</p>
        <h1 className="font-display relative mt-3 text-6xl italic md:text-8xl">Meridian</h1>
        <p className="relative mt-4 max-w-xl text-base leading-relaxed text-muted md:text-lg">
          A living atlas of the world. Explore places, weather, maps,
          travel and flight intelligence.
        </p>
        <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-subtle">
          Explore the world. Understand where it is. Know what is moving through it.
        </p>
        <div className="relative mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => navigate({ to: inApp ? "/app" : "/auth" })}
            className="group flex items-center gap-2 rounded-full bg-accent px-7 py-3 text-sm font-semibold uppercase tracking-label text-accent-fg"
          >
            {inApp ? "Open Meridian" : "Explore Meridian"}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
          {!inApp && (
            <button
              type="button"
              onClick={guest}
              className="flex items-center gap-2 rounded-full border border-border px-7 py-3 text-sm font-medium uppercase tracking-label text-muted hover:text-fg"
            >
              <UserRound className="size-4" aria-hidden />
              Continue as guest
            </button>
          )}
        </div>
        <OrbitalEarth className="relative mt-10 w-[min(78vw,26rem)] opacity-90" />
        <p className="relative mt-6 text-xs text-subtle">“A quiet globe of places that hold the light.”</p>
      </header>

      {/* CAPABILITIES */}
      <section aria-label="Capabilities" className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-xs font-medium uppercase tracking-label text-muted">The platform</p>
        <h2 className="font-display mt-2 text-3xl italic md:text-4xl">One atlas, every signal</h2>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <li key={c.title} className="rounded-3xl bg-surface/80 p-5 shadow-border">
              <c.icon className="size-5 text-accent" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold uppercase tracking-label">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{c.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* FLIGHT INTELLIGENCE */}
      <section aria-label="Flight intelligence" className="mx-auto max-w-5xl px-6 py-14">
        <div className="rounded-3xl bg-surface/80 p-6 shadow-border md:p-10">
          <p className="text-xs font-medium uppercase tracking-label text-muted">Flight intelligence</p>
          <h2 className="font-display mt-2 text-3xl italic">Chennai → Kolkata</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Great-circle trajectories, live positions and board data where aviation
            coverage exists — planned routes always distinct from flown tracks.
          </p>
          <div className="mt-6"><RouteArc /></div>
          <p className="mt-2 text-[11px] text-subtle">Illustrative trajectory. Live aircraft appear only when provider data is connected.</p>
        </div>
      </section>

      {/* EXPLORE STRIP */}
      <section aria-label="Explore the world" className="mx-auto max-w-5xl px-6 py-14 text-center">
        <p className="text-xs font-medium uppercase tracking-label text-muted">Explore the world</p>
        <h2 className="font-display mt-2 text-3xl italic">Countries · Cities · Capitals · Airports · POIs · Weather · Routes</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          A worldwide geographic catalog with real coordinates, weather for any
          selected place, and routes drawn as true 3D arcs.
        </p>
      </section>

      {/* AI CONCEPT */}
      <section aria-label="Meridian AI" className="mx-auto max-w-3xl px-6 py-14">
        <div className="rounded-3xl bg-surface/80 p-6 shadow-border md:p-8">
          <p className="text-xs font-medium uppercase tracking-label text-muted">Meridian AI</p>
          <h2 className="font-display mt-2 text-3xl italic">Ask, and fly there</h2>
          <div className="mt-5 space-y-2 text-sm" aria-label="Concept preview">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-surface-raised px-4 py-2.5">Track flight 6E521</p>
            <p className="w-fit max-w-[85%] rounded-2xl bg-surface-raised/50 px-4 py-2.5 text-muted">Checking current flight data…</p>
            <p className="w-fit max-w-[85%] rounded-2xl bg-surface-raised/50 px-4 py-2.5 text-muted">Status, position and trajectory appear here when live data exists — otherwise I say so.</p>
          </div>
          <p className="mt-3 text-[11px] text-subtle">Concept preview. The assistant never invents flights, positions or weather.</p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section aria-label="Begin" className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="font-display text-4xl italic">Begin your journey.</h2>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button type="button" onClick={() => navigate({ to: "/auth" })}
            className="rounded-full bg-accent px-7 py-3 text-sm font-semibold uppercase tracking-label text-accent-fg">
            Sign in
          </button>
          <button type="button" onClick={() => navigate({ to: "/auth?mode=signup" })}
            className="rounded-full border border-border px-7 py-3 text-sm font-medium uppercase tracking-label text-muted hover:text-fg">
            Create account
          </button>
          {!inApp && (
            <button type="button" onClick={guest}
              className="rounded-full border border-border px-7 py-3 text-sm font-medium uppercase tracking-label text-muted hover:text-fg">
              Continue as guest
            </button>
          )}
        </div>
        <p className="mt-8 text-xs text-subtle">Created with care · Meridian Observatory</p>
      </section>
    </div>
  );
}
