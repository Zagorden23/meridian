import { useEffect } from "react";
import { ChevronLeft, ChevronRight, MapPin, Pause, Play, X } from "lucide-react";
import { PLACES, getPlace } from "@/data/locations";
import { formatCoord } from "@/lib/coords";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGlobeStore } from "@/store/globe-store";
import { useMeridianStore } from "@/store/meridian-store";

// HUD overlays live inside the workspace. `compact` mode (sidebar panel open)
// hides the wordmark + featured rail so the globe is readable next to the
// module panel. Selected-place card stays reachable in both modes.
export function Hud({ compact = false }) {
  const selectedId = useGlobeStore((state) => state.selectedId);
  const hoveredId = useGlobeStore((state) => state.hoveredId);
  const autoRotate = useGlobeStore((state) => state.autoRotate);
  const interacting = useGlobeStore((state) => state.interacting);
  const select = useGlobeStore((state) => state.select);
  const pauseOrbit = useGlobeStore((state) => state.pauseOrbit);
  const resumeOrbit = useGlobeStore((state) => state.resumeOrbit);
  const activeModule = useMeridianStore((state) => state.activeModule);
  const sidebarOpen = useMeridianStore((state) => state.sidebarOpen);
  // Featured rail only makes sense in Explore with the panel collapsed —
  // when the panel is open the same list is already inside it.
  const showFeatured = activeModule === "explore" && !sidebarOpen;
  const selected = getPlace(selectedId);
  const orbiting = autoRotate && !interacting && !selectedId;
  const selectedIndex = PLACES.findIndex((p) => p.id === selectedId);
  const goPrev = () => {
    if (selectedIndex < 0) select(PLACES[PLACES.length - 1].id);
    else select(PLACES[(selectedIndex - 1 + PLACES.length) % PLACES.length].id);
  };
  const goNext = () => {
    if (selectedIndex < 0) select(PLACES[0].id);
    else select(PLACES[(selectedIndex + 1) % PLACES.length].id);
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-3 md:p-4">
      {/* Brand + orbit control: brand only on mobile when no selection;
          desktop keeps it for personality. Hidden once a panel is open. */}
      {!compact && (
        <header className="pointer-events-none flex items-start justify-between gap-3 pt-16 md:pt-14">
          <div className="pointer-events-auto max-w-72 max-md:hidden">
            <p className="text-[11px] font-medium uppercase tracking-label text-muted">Observatory</p>
            <h1 className="font-display mt-1 text-3xl italic text-fg md:text-4xl">Meridian</h1>
            <p className="mt-2 hidden max-w-56 text-sm leading-snug text-muted md:block">
              A quiet globe of places that hold the light.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-events-auto"
            onClick={() => (orbiting ? pauseOrbit() : resumeOrbit())}
            aria-pressed={orbiting}
            aria-label={orbiting ? "Pause orbit" : "Resume orbit"}
          >
            {orbiting ? <Pause className="size-4" /> : <Play className="size-4" />}
            <span className="hidden sm:inline">{orbiting ? "Orbiting" : "Resume orbit"}</span>
          </Button>
        </header>
      )}

      <div className={cn("flex min-h-0 flex-1 flex-col justify-end gap-3 md:flex-row md:items-stretch md:justify-between", !compact && "mt-4")}>
        {/* Selection card — mobile only when a place is selected; desktop shows
            the invite card otherwise. Lifted above StatusBar. */}
        <section
          className={cn(
            "pointer-events-auto max-w-md self-end rounded-3xl bg-surface/90 p-4 text-fg shadow-border",
            !selected && "max-md:hidden",
          )}
          aria-live="polite"
        >
          {selected ? (
            <div key={selected.id} className="animate-enter">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium tracking-label text-muted uppercase">
                  {selected.tag} · {String(selectedIndex + 1).padStart(2, "0")}/{String(PLACES.length).padStart(2, "0")}
                </p>
                <button
                  type="button"
                  onClick={() => select(null)}
                  aria-label="Clear selection"
                  className="rounded-full p-1 text-subtle transition-colors hover:bg-surface-raised hover:text-fg"
                >
                  <X className="size-4" />
                </button>
              </div>
              <h2 className="font-display mt-2 text-2xl italic md:text-3xl">{selected.name}</h2>
              <p className="mt-1 text-sm text-muted">{selected.region}</p>
              <p className="mt-3 text-sm leading-relaxed">{selected.blurb}</p>
              <p className="mt-3 font-sans text-xs tabular-nums tracking-wide text-subtle">
                {formatCoord(selected.lat, selected.lon)}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={goPrev} aria-label="Previous place">
                  <ChevronLeft className="size-4" />
                  Prev
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={goNext} aria-label="Next place">
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium tracking-label text-muted uppercase">Looking</p>
              <h2 className="font-display mt-2 text-2xl italic md:text-3xl">Spin the world</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Drag to turn the globe. Choose a marker or a place from the list to travel there.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={goNext} aria-label="Travel to first place">
                  Start tour
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </section>

        {showFeatured && (
          <nav
            aria-label="Featured locations"
            className="pointer-events-auto flex w-full min-h-0 flex-col rounded-3xl bg-surface/90 p-3 shadow-border md:w-80"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-xs font-medium tracking-label text-muted uppercase">Featured</p>
              <span className="text-xs tabular-nums text-subtle">{String(PLACES.length).padStart(2, "0")}</span>
            </div>
            <ul className="flex min-h-0 gap-2 overflow-x-auto pb-1 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:pb-0">
              {PLACES.map((place, index) => {
                const active = place.id === selectedId;
                const lit = active || place.id === hoveredId;
                return (
                  <li key={place.id} className="min-w-40 shrink-0 md:min-w-0">
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => select(place.id)}
                      className={cn(
                        "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors duration-150",
                        active ? "bg-surface-raised text-fg shadow-border-hover" : "text-fg hover:bg-surface-raised/70",
                      )}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", lit ? "bg-accent" : "bg-muted/70")} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{place.name}</span>
                      <span className="hidden truncate text-xs text-muted md:inline">{place.region}</span>
                      <span className="font-sans text-xs tabular-nums text-subtle">{String(index + 1).padStart(2, "0")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>

      <p className={cn("pointer-events-none mb-10 mt-3 hidden items-center gap-2 text-xs text-subtle", !selected && "md:flex")}>
        <MapPin className="size-3.5" aria-hidden />
        Drag to spin · Click a light to travel · Scroll to zoom · ←→↑↓/WASD to fly · [ ] for prev/next
      </p>
    </div>
  );
}
