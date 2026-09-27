// MERIDIAN app shell: icon rail | main workspace (flex, responsive).
// Top bar carries brand, search, mode and account so the map below is
// unobstructed. A module opens its panel in a side column next to the rail;
// the column collapses to the rail for a clean canvas.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleUserRound, LogOut, Menu, X } from "lucide-react";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { getPlace } from "@/data/locations";
import { GlobeExperience } from "@/components/globe/globe-experience";
import { Map2D } from "./map-2d.jsx";
import { Hud } from "@/components/overlay/hud";
import { SearchBar } from "./search-bar.jsx";
import { Sidebar } from "./sidebar.jsx";
import { LocationPanel } from "./location-panel.jsx";
import { ExplorePanel } from "./explore-panel.jsx";
import { TravelPlanner } from "./travel-planner.jsx";
import { FlightPanel } from "./flight-panel.jsx";
import { AIPanel } from "./ai-panel.jsx";
import {
  MapsPanel, WeatherModulePanel, DiscoverPanel, ToolsPanel, PersonalPanel, SettingsPanel,
} from "./modules.jsx";
import { cn } from "@/lib/utils";

const MODULE_TITLE = {
  explore: "Explore",
  travel: "Travel",
  weather: "Weather",
  maps: "Maps",
  discover: "Discover",
  ai: "Meridian AI",
  personal: "Saved",
  tools: "Tools",
  settings: "Settings",
};

function ModuleContent() {
  const activeModule = useMeridianStore((s) => s.activeModule);
  switch (activeModule) {
    case "explore": return <ExplorePanel />;
    case "travel": return (<div className="space-y-3"><TravelPlanner /><FlightPanel /></div>);
    case "weather": return <WeatherModulePanel />;
    case "maps": return <MapsPanel />;
    case "discover": return <DiscoverPanel />;
    case "ai": return <AIPanel />;
    case "personal": return <PersonalPanel />;
    case "tools": return <ToolsPanel />;
    case "settings": return <SettingsPanel />;
    default: return null;
  }
}

function ModeSwitch({ className }) {
  const mapMode = useMeridianStore((s) => s.mapMode);
  const setMapMode = useMeridianStore((s) => s.setMapMode);
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-fit items-center gap-0.5 rounded-full bg-surface/90 p-0.5 shadow-border backdrop-blur-md",
        className,
      )}
      role="group"
      aria-label="Map mode"
    >
      {(["3d", "2d"]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMapMode(m)}
          aria-pressed={mapMode === m}
          className={cn(
            "rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-label transition-colors",
            mapMode === m ? "bg-accent text-accent-fg" : "text-subtle hover:text-fg",
          )}
        >
          {m === "3d" ? "3D" : "2D"}
        </button>
      ))}
    </div>
  );
}

function AccountMenu() {
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (status === "GUEST") {
    return (
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface/90 py-0.5 pl-3 pr-0.5 shadow-border backdrop-blur-md">
        <span className="hidden text-[11px] uppercase tracking-label text-subtle sm:inline">Guest</span>
        <button
          type="button"
          onClick={() => navigate({ to: "/auth" })}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => navigate({ to: "/auth?mode=signup" })}
          className="hidden rounded-full px-2.5 py-1.5 text-xs text-subtle hover:text-fg sm:inline"
        >
          Join
        </button>
      </div>
    );
  }

  if (status !== "AUTHENTICATED" || !user) return null;

  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  const out = async () => {
    setBusy(true);
    await signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="pointer-events-auto relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={user.email ?? user.name ?? "Account"}
        className="flex size-9 items-center justify-center rounded-full bg-surface/90 shadow-border backdrop-blur-md transition-colors hover:bg-surface-raised/80"
      >
        {user.avatar
          ? <img src={user.avatar} alt="" className="size-9 rounded-full object-cover" referrerPolicy="no-referrer" />
          : <span className="flex size-9 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold">{initial}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 w-60 rounded-2xl border border-border bg-bg p-2 shadow-border">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.name ?? "Meridian member"}</p>
            {user.email && <p className="truncate text-xs text-subtle">{user.email}</p>}
            {user.providers?.length > 0 && (
              <p className="mt-1 text-[10px] uppercase tracking-label text-subtle">
                via {user.providers.join(" · ")}
              </p>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          {([
            ["Saved places", "personal"],
            ["Settings", "settings"],
          ]).map(([label, mod]) => (
            <button
              key={label}
              role="menuitem"
              type="button"
              onClick={() => { setActiveModule(mod); navigate({ to: "/app", search: { m: mod } }); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-raised/70"
            >
              <CircleUserRound className="size-4 text-subtle" aria-hidden /> {label}
            </button>
          ))}
          <button
            role="menuitem"
            type="button"
            onClick={out}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-raised/70 disabled:opacity-40"
          >
            <LogOut className="size-4 text-subtle" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBar() {
  // A quiet, persistent strip naming the current context — always know
  // where you are and what you are looking at.
  const location = useMeridianStore((s) => s.location);
  const activeModule = useMeridianStore((s) => s.activeModule);
  const mapMode = useMeridianStore((s) => s.mapMode);
  const tracked = useMeridianStore((s) => s.trackedFlight);
  const selectedId = useGlobeStore((s) => s.selectedId);
  const selected = selectedId ? getPlace(selectedId) : null;
  const label = MODULE_TITLE[activeModule] ?? "Explore";
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-3 bottom-3 z-[15] flex items-center justify-between gap-2 rounded-full border border-border/50 bg-bg/60 py-1.5 pl-4 pr-2 text-[11px] tracking-wide text-subtle backdrop-blur-md md:inset-x-4 md:bottom-4"
    >
      <span className="flex min-w-0 items-center gap-2 truncate">
        <span className="uppercase tracking-label text-muted">{label}</span>
        <span aria-hidden className="text-border">·</span>
        <span className="truncate">{location?.name ?? selected?.name ?? (mapMode === "3d" ? "Global view" : "Map view")}</span>
      </span>
      {tracked && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-label text-accent">
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
          </span>
          Live · {tracked.callsign ?? "Aircraft"}
        </span>
      )}
    </div>
  );
}

export function MeridianUI() {
  const mapMode = useMeridianStore((s) => s.mapMode);
  const location = useMeridianStore((s) => s.location);
  const sidebarOpen = useMeridianStore((s) => s.sidebarOpen);
  const activeModule = useMeridianStore((s) => s.activeModule);
  const [menuOpen, setMenuOpen] = useState(false);

  const panelOpen = sidebarOpen; // rail expanded -> module panel visible

  return (
    <div className="flex h-full w-full min-h-0">
      {/* Sidebar column — part of layout, never an overlay. */}
      <aside
        aria-label="Meridian sidebar"
        className={cn(
          "hidden min-h-0 shrink-0 flex-col gap-2 border-r border-border bg-bg p-2.5 transition-[width] duration-200 md:flex",
          panelOpen ? "w-[19rem]" : "w-[3.75rem]",
        )}
      >
        <Sidebar />
        {panelOpen && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5" role="region" aria-label="Module panel">
            {/* Keyed by section: a short enter transition on switch while the
                globe canvas beside it never remounts. */}
            <div key={activeModule} className="animate-enter space-y-3">
              <ModuleContent />
            </div>
          </div>
        )}
      </aside>

      {/* Main workspace */}
      <section aria-label="Main workspace" className="relative min-w-0 flex-1 overflow-hidden">
        {mapMode === "3d" ? <GlobeExperience /> : <Map2D />}
        <div className="vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden />
        <Hud compact={panelOpen} />

        {/* Top bar: search · mode · account */}
        <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-2 md:inset-x-4 md:top-4">
          <div className="pointer-events-auto min-w-0 flex-1 md:max-w-sm">
            <SearchBar />
          </div>
          <ModeSwitch className="shrink-0" />
          <div className="ml-auto shrink-0">
            <AccountMenu />
          </div>
        </div>

        {/* Mobile menu button — lives in the top bar for predictability */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          className="absolute bottom-16 right-3 z-30 rounded-full bg-surface/90 p-2.5 shadow-border backdrop-blur-md md:hidden"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <StatusBar />

        {/* Mobile module sheet */}
        {menuOpen && (
          <div className="absolute inset-x-3 bottom-3 top-auto z-30 flex max-h-[70dvh] flex-col gap-2 overflow-y-auto rounded-2xl border border-border bg-bg p-3 md:hidden">
            <Sidebar />
            <div className="space-y-3">
              <p className="px-1 text-[11px] uppercase tracking-label text-subtle">{MODULE_TITLE[activeModule] ?? "Explore"}</p>
              <div key={activeModule} className="animate-enter space-y-3">
                <ModuleContent />
              </div>
            </div>
          </div>
        )}

        {/* Location card scoped to the workspace */}
        {location && (
          <div className="absolute inset-x-3 bottom-14 z-20 md:inset-x-auto md:bottom-16 md:left-1/2 md:w-[26rem] md:-translate-x-1/2">
            <LocationPanel />
          </div>
        )}
      </section>
    </div>
  );
}
