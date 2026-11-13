// Global search: "Search anywhere..." with categorized autocomplete.
// Ranking comes from the backend (exact → normalized → capital → population).
import { useEffect, useId, useRef, useState } from "react";
import { Plane, Search, Building2, MapPin, Flag, Compass, Loader2, X } from "lucide-react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { recordHistory } from "@/lib/meridian/favorites.js";
import { cn } from "@/lib/utils";

const KIND_ICON = { CITY: MapPin, COUNTRY: Flag, AIRPORT: Plane, STATE: Building2, PLACE: MapPin, COORDINATES: Compass };
const KIND_LABEL = { CITY: "City", COUNTRY: "Country", AIRPORT: "Airport", STATE: "Region", PLACE: "Place", POI: "Landmark", COORDINATES: "Coordinates" };

function coordsOf(hit) {
  const lat = hit.latitude ?? hit.lat;
  const lon = hit.longitude ?? hit.lon;
  return lat != null && lon != null ? { lat: Number(lat), lon: Number(lon) } : null;
}

export function SearchBar() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listId = useId();
  const inputRef = useRef(null);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const timer = useRef(null);
  const abort = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  useEffect(() => () => {
    clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  const run = (value) => {
    setQ(value);
    clearTimeout(timer.current);
    abort.current?.abort();
    if (value.trim().length < 2) {
      setHits([]);
      setOpen(false);
      setPending(false);
      return;
    }
    setPending(true);
    setFailed(false);
    timer.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await api.search(value.trim(), ctrl.signal);
        setHits(res.data ?? []);
        setActive(0);
        setOpen(true);
      } catch (err) {
        if (err?.name === "AbortError") return; // superseded by a newer keystroke
        setHits([]);
        setFailed(true);
        setOpen(true);
      }
      setPending(false);
    }, 220);
  };

  const choose = (hit) => {
    const c = coordsOf(hit);
    const loc = {
      kind: hit.kind,
      id: hit.id,
      name: hit.name,
      lat: c?.lat,
      lon: c?.lon,
      country: hit.countryId ?? hit.country ?? hit.countryName ?? null,
      raw: hit,
    };
    selectLocation(loc);
    recordHistory({ id: `${hit.kind}:${hit.id}`, name: hit.name, kind: hit.kind, lat: c?.lat, lon: c?.lon });
    if (c) {
      useGlobeStore.getState().pauseOrbit();
      useGlobeStore.getState().focusPointOn(c.lat, c.lon);
    }
    setOpen(false);
    setQ(hit.name);
  };

  return (
    <div ref={boxRef} className="pointer-events-auto relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-full bg-surface/90 py-2 pl-3.5 pr-2 shadow-border backdrop-blur-md">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => run(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              choose(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search anywhere…"
          aria-label="Search places, airports or coordinates"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="w-full min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
        />
        {pending && <Loader2 className="mr-1 size-4 shrink-0 animate-spin text-subtle" aria-hidden />}
        {!pending && q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { run(""); inputRef.current?.focus(); }}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-subtle transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label="Search results" className="animate-enter absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-2xl bg-surface/95 p-1.5 shadow-border backdrop-blur-md">
          {hits.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-subtle">
              {failed
                ? "Search isn't responding right now. Please try again."
                : "No matches. Try a city, an airport code, or coordinates like 35.68, 139.69."}
            </li>
          )}
          {hits.map((hit, i) => {
            const Icon = KIND_ICON[hit.kind] ?? MapPin;
            return (
              <li key={`${hit.kind}-${hit.id}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={i === active}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-100",
                    i === active ? "bg-surface-raised" : "",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{hit.name}</span>
                    <span className="block truncate text-xs text-subtle">
                      {hit.kind === "AIRPORT"
                        ? `${hit.iata ?? ""} ${hit.icao ?? ""}`.trim()
                        : hit.kind === "COORDINATES"
                          ? "Go to coordinates"
                          : hit.countryName ?? hit.countryId ?? ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-label text-subtle">{KIND_LABEL[hit.kind] ?? hit.kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
