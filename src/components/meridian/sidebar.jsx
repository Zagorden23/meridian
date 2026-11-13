// Section navigation — one definition, two presentations:
//   Sidebar    desktop rail. Slim icons by default so the globe stays the hero;
//              expanded it becomes a labelled column above the section panel.
//   MobileNav  bottom bar on small screens, labelled and thumb-reachable.
// Both navigate for real (`/app?m=travel`): deep-linkable, back/forward
// friendly, refresh-safe — while the globe canvas stays mounted.
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMeridianStore } from "@/store/meridian-store.js";
import { cn } from "@/lib/utils";
import { MODULES } from "./sections.js";

function useSectionNav() {
  const navigate = useNavigate();
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  // The store updates first so the UI never waits on routing.
  return (id) => {
    setActiveModule(id);
    navigate({ to: "/app", search: { m: id } });
  };
}

// Rail rows are a fixed height so the active indicator can slide between them.
const ROW_REM = 2.25; // h-9
const GAP_REM = 0.125; // gap-0.5

export function Sidebar() {
  const sidebarOpen = useMeridianStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMeridianStore((s) => s.setSidebarOpen);
  const activeModule = useMeridianStore((s) => s.activeModule);
  const go = useSectionNav();
  const activeIndex = Math.max(0, MODULES.findIndex((m) => m.id === activeModule));

  return (
    <nav
      aria-label="Sections"
      className="pointer-events-auto flex w-full shrink-0 flex-col rounded-2xl bg-surface/90 p-1.5 shadow-border backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? "Collapse panel" : "Expand panel"}
        aria-expanded={sidebarOpen}
        className="mb-1 flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-subtle transition-colors duration-150 hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {sidebarOpen ? <PanelLeftClose className="size-4 shrink-0" aria-hidden /> : <PanelLeftOpen className="size-4 shrink-0" aria-hidden />}
        {sidebarOpen && <span className="font-display text-base italic text-fg">Meridian</span>}
      </button>
      <ul className="relative flex flex-col gap-0.5">
        {/* One indicator that travels to the active row instead of each row
            switching its own background on and off. */}
        <li
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-9 rounded-xl bg-surface-raised shadow-border-hover transition-transform duration-200 ease-out"
          style={{ transform: `translateY(${activeIndex * (ROW_REM + GAP_REM)}rem)` }}
        />
        {MODULES.map((mod) => {
          const ModuleIcon = mod.icon;
          const active = activeModule === mod.id;
          return (
            <li key={mod.id} className="relative">
              <button
                type="button"
                onClick={() => (active && sidebarOpen ? setSidebarOpen(false) : go(mod.id))}
                aria-current={active ? "page" : undefined}
                aria-label={sidebarOpen ? undefined : mod.label}
                title={sidebarOpen ? undefined : mod.label}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  active ? "text-fg" : "text-muted hover:bg-surface-raised/50 hover:text-fg",
                )}
              >
                <ModuleIcon className={cn("size-4 shrink-0 transition-colors duration-150", active && "text-accent")} aria-hidden />
                {sidebarOpen && <span className="truncate">{mod.label}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Bottom navigation for small screens. Tapping a section opens its sheet;
 * tapping the active section again folds the sheet away to show the globe.
 */
export function MobileNav() {
  const sidebarOpen = useMeridianStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMeridianStore((s) => s.setSidebarOpen);
  const activeModule = useMeridianStore((s) => s.activeModule);
  const go = useSectionNav();
  return (
    <nav
      aria-label="Sections"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 border-t border-border bg-bg/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="no-scrollbar flex snap-x overflow-x-auto px-1">
        {MODULES.map((mod) => {
          const ModuleIcon = mod.icon;
          const active = activeModule === mod.id;
          const open = active && sidebarOpen;
          return (
            <li key={mod.id} className="shrink-0 grow basis-[4.25rem] snap-start">
              <button
                type="button"
                onClick={() => (open ? setSidebarOpen(false) : go(mod.id))}
                aria-current={active ? "page" : undefined}
                aria-expanded={open}
                aria-label={mod.label}
                className={cn(
                  "relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-wide transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  active ? "text-fg" : "text-subtle",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full bg-accent transition-opacity duration-200",
                    open ? "opacity-100" : "opacity-0",
                  )}
                />
                <ModuleIcon className={cn("size-5 transition-colors duration-150", active && "text-accent")} aria-hidden />
                {mod.short}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
