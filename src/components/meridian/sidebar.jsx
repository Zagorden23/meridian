// Collapsible left dashboard. A slim icon-rail by default so the globe stays
// the hero; expanding turns it into a labelled navigation column whose lower
// half hosts the active module's panel.
import {
  Compass, CloudSun, Plane, Map as MapIcon, Sparkles, Wrench, User, Bot,
  Settings, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMeridianStore } from "@/store/meridian-store.js";
import { cn } from "@/lib/utils";

// Order matches the user journey: orient → plan → context → personal → tools.
const MODULES = [
  { id: "explore", label: "Explore", icon: Compass },
  { id: "travel", label: "Travel", icon: Plane },
  { id: "weather", label: "Weather", icon: CloudSun },
  { id: "maps", label: "Maps", icon: MapIcon },
  { id: "discover", label: "Discover", icon: Sparkles },
  { id: "ai", label: "Meridian AI", icon: Bot },
  { id: "personal", label: "Saved", icon: User },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const navigate = useNavigate();
  const sidebarOpen = useMeridianStore((s) => s.sidebarOpen);
  const setSidebarOpen = useMeridianStore((s) => s.setSidebarOpen);
  const activeModule = useMeridianStore((s) => s.activeModule);
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);

  // Module switches are real navigations (`/app?m=travel`): deep-linkable,
  // back/forward-friendly, refresh-safe — while the globe canvas stays
  // mounted. The store updates instantly so the UI never waits on routing.
  const go = (id) => {
    setActiveModule(id);
    navigate({ to: "/app", search: { m: id } });
  };

  return (
    <nav
      aria-label="Meridian modules"
      className="pointer-events-auto flex w-full shrink-0 flex-col gap-0.5 rounded-2xl bg-surface/90 p-1.5 shadow-border backdrop-blur-md transition-[width] duration-200"
    >
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={sidebarOpen}
        className="mb-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-subtle transition-colors hover:bg-surface-raised hover:text-fg"
      >
        {sidebarOpen ? <PanelLeftClose className="size-4 shrink-0" /> : <PanelLeftOpen className="size-4 shrink-0" />}
        {sidebarOpen && <span className="font-display text-base italic text-fg">Meridian</span>}
      </button>
      {MODULES.map((mod) => {
        const ModuleIcon = mod.icon;
        const active = activeModule === mod.id;
        return (
          <button
            key={mod.id}
            type="button"
            onClick={() => (active && sidebarOpen ? setSidebarOpen(false) : go(mod.id))}
            aria-current={active ? "true" : undefined}
            title={mod.label}
            className={cn(
              "relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors",
              active
                ? "bg-surface-raised text-fg shadow-border-hover"
                : "text-muted hover:bg-surface-raised/60 hover:text-fg",
            )}
          >
            <ModuleIcon className="size-4 shrink-0" aria-hidden />
            {sidebarOpen && <span className="truncate">{mod.label}</span>}
            {active && !sidebarOpen && (
              <span aria-hidden className="absolute right-1.5 top-1/2 size-1 -translate-y-1/2 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
