// MERIDIAN app shell — one continuous application around a persistent globe.
//
//   desktop  icon rail | workspace. Opening a section widens the rail into a
//            panel column; the globe keeps the rest.
//   mobile   full-bleed globe, bottom navigation, sections rise as a sheet.
//
// The globe canvas sits above the section switch, so moving between sections
// never remounts it. Search, map mode and account live in the top bar.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bookmark, LogOut, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { useAuthPrompt } from "@/lib/meridian/use-auth-prompt.js";
import { useIsDesktop } from "@/lib/meridian/use-media-query.js";
import { PROVIDER_LABEL } from "@/lib/meridian/auth-messages.js";
import { getPlace } from "@/data/locations";
import { GlobeExperience } from "@/components/globe/globe-experience";
import { Map2D } from "./map-2d.jsx";
import { Hud } from "@/components/overlay/hud";
import { SearchBar } from "./search-bar.jsx";
import { MobileNav, Sidebar } from "./sidebar.jsx";
import { MODULE_TITLE } from "./sections.js";
import { LocationPanel } from "./location-panel.jsx";
import { ExplorePanel } from "./explore-panel.jsx";
import { TravelPlanner } from "./travel-planner.jsx";
import { FlightPanel } from "./flight-panel.jsx";
import { AIPanel } from "./ai-panel.jsx";
import {
  MapsPanel, WeatherModulePanel, DiscoverPanel, ToolsPanel, PersonalPanel, SettingsPanel,
} from "./modules.jsx";
import { cn } from "@/lib/utils";

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
          aria-label={m === "3d" ? "3D globe" : "2D map"}
          className={cn(
            "rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-label transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            mapMode === m ? "bg-accent text-accent-fg" : "text-subtle hover:text-fg",
          )}
        >
          {m === "3d" ? "3D" : "2D"}
        </button>
      ))}
    </div>
  );
}

const MENU_ITEM = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-raised/70 focus-visible:bg-surface-raised/70 focus-visible:outline-none disabled:opacity-40";

function AccountMenu() {
  const navigate = useNavigate();
  const promptAuth = useAuthPrompt();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    // Keyboard users land on the first action.
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (status === "GUEST") {
    return (
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface/90 py-0.5 pl-3 pr-0.5 shadow-border backdrop-blur-md max-sm:pl-0.5">
        <span className="hidden text-[11px] uppercase tracking-label text-subtle sm:inline">Guest</span>
        <button
          type="button"
          onClick={() => promptAuth()}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => promptAuth("signup")}
          className="hidden rounded-full px-2.5 py-1.5 text-xs text-subtle transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline"
        >
          Join
        </button>
      </div>
    );
  }

  if (status !== "AUTHENTICATED" || !user) return null;

  const initialSource = (user.name ?? user.email ?? "").trim();
  const initial = initialSource ? initialSource.charAt(0).toUpperCase() : "M";
  const methods = (user.providers ?? []).map((p) => PROVIDER_LABEL[p] ?? p);

  const out = async () => {
    setBusy(true);
    await signOut();
    toast.success("Signed out.");
    navigate({ to: "/" });
  };

  const openSection = (mod) => {
    setActiveModule(mod);
    navigate({ to: "/app", search: { m: mod } });
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex size-9 items-center justify-center rounded-full bg-surface/90 shadow-border backdrop-blur-md transition-colors duration-150 hover:bg-surface-raised/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {user.avatar
          ? <img src={user.avatar} alt="" className="size-9 rounded-full object-cover" referrerPolicy="no-referrer" />
          : <span className="flex size-9 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold">{initial}</span>}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Account" className="animate-enter absolute right-0 top-11 w-64 rounded-2xl border border-border bg-bg p-2 shadow-border">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.name ?? "Meridian member"}</p>
            {(user.email || user.phone) && (
              <p className="truncate text-xs text-subtle">{user.email ?? user.phone}</p>
            )}
            {methods.length > 0 && (
              <p className="mt-1 truncate text-[10px] uppercase tracking-label text-subtle">
                {methods.join(" · ")}
              </p>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
          <button role="menuitem" type="button" onClick={() => openSection("personal")} className={MENU_ITEM}>
            <Bookmark className="size-4 text-subtle" aria-hidden /> Saved places
          </button>
          <button role="menuitem" type="button" onClick={() => openSection("settings")} className={MENU_ITEM}>
            <Settings className="size-4 text-subtle" aria-hidden /> Settings
          </button>
          <button role="menuitem" type="button" onClick={out} disabled={busy} className={MENU_ITEM}>
            <LogOut className="size-4 text-subtle" aria-hidden /> {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBar() {
  // A quiet, persistent strip naming the current context — always know
  // where you are and what you are looking at. Desktop only: on small
  // screens the bottom navigation already says where you are.
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
      className="pointer-events-none absolute inset-x-4 bottom-4 z-[15] hidden items-center justify-between gap-2 rounded-full border border-border/50 bg-bg/60 py-1.5 pl-4 pr-2 text-[11px] tracking-wide text-subtle backdrop-blur-md md:flex"
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

const isSmallScreen = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

/** Keeps the two selection systems — featured places and catalog locations — from fighting. */
function useSelectionSync() {
  const location = useMeridianStore((s) => s.location);
  const selectedId = useGlobeStore((s) => s.selectedId);
  const hadLocation = useRef(false);

  // One thing is "selected" at a time: picking a catalog location retires the
  // featured place, and the other way round — never two detail cards at once.
  useEffect(() => {
    if (location && useGlobeStore.getState().selectedId) useGlobeStore.setState({ selectedId: null });
  }, [location]);
  useEffect(() => {
    if (selectedId && useMeridianStore.getState().location) useMeridianStore.getState().selectLocation(null);
  }, [selectedId]);

  useEffect(() => {
    if (location) {
      hadLocation.current = true;
      // On a phone the sheet would cover the place just chosen — fold it away.
      if (isSmallScreen()) useMeridianStore.getState().setSidebarOpen(false);
      return;
    }
    if (!hadLocation.current) return;
    hadLocation.current = false;
    // Card dismissed: release the camera pin so the orbit can resume — unless
    // a route or a tracked flight still owns the view.
    const { route, trackedFlight } = useMeridianStore.getState();
    if (!route && !trackedFlight) useGlobeStore.getState().clearFocusPoint();
  }, [location]);

  // Escape dismisses the location card (typing in a field keeps its own Escape).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (useMeridianStore.getState().location) useMeridianStore.getState().selectLocation(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function MeridianUI() {
  const mapMode = useMeridianStore((s) => s.mapMode);
  const location = useMeridianStore((s) => s.location);
  const panelOpen = useMeridianStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMeridianStore((s) => s.setSidebarOpen);
  const activeModule = useMeridianStore((s) => s.activeModule);
  // The section panel is mounted exactly once — desktop column or mobile
  // sheet — so its requests and polling never run twice.
  const desktop = useIsDesktop();
  useSelectionSync();

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Desktop column — part of the layout, never an overlay. */}
      {desktop && (
        <aside
          aria-label="Navigation and section panel"
          className={cn(
            "flex min-h-0 shrink-0 flex-col gap-2 border-r border-border bg-bg p-2.5 transition-[width] duration-200 ease-out",
            panelOpen ? "w-[19rem]" : "w-[3.75rem]",
          )}
        >
          <Sidebar />
          {panelOpen && (
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" role="region" aria-label={`${MODULE_TITLE[activeModule] ?? "Section"} panel`}>
              {/* Keyed by section: a short enter transition on switch while the
                  globe canvas beside it never remounts. */}
              <div key={activeModule} className="animate-enter space-y-3">
                <ModuleContent />
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Workspace */}
      <section aria-label="Globe workspace" className="relative min-w-0 flex-1 overflow-hidden">
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

        <StatusBar />

        {/* Location card — bottom-left on desktop, above the nav on mobile
            (hidden there while a section sheet is open). */}
        {location && (
          <div className={cn(
            "absolute inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 md:inset-x-auto md:bottom-16 md:left-4 md:w-[26rem]",
            !desktop && panelOpen && "hidden",
          )}>
            <div key={`${location.kind}:${location.id}`} className="animate-enter">
              <LocationPanel />
            </div>
          </div>
        )}

        {/* Mobile section sheet */}
        {!desktop && panelOpen && (
          <div
            role="region"
            aria-label={`${MODULE_TITLE[activeModule] ?? "Section"} panel`}
            className="animate-sheet absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[25] flex max-h-[68dvh] flex-col rounded-t-3xl border-t border-border bg-bg/95 backdrop-blur-md md:hidden"
          >
            <div className="flex shrink-0 items-center justify-between py-1.5 pl-5 pr-2">
              <p className="text-[11px] font-medium uppercase tracking-label text-muted">{MODULE_TITLE[activeModule] ?? "Explore"}</p>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close panel"
                className="flex size-11 items-center justify-center rounded-full text-subtle transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
              <div key={activeModule} className="animate-enter space-y-3">
                <ModuleContent />
              </div>
            </div>
          </div>
        )}

        {!desktop && <MobileNav />}
      </section>
    </div>
  );
}
