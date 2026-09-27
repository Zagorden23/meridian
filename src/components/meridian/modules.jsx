// Discover (landmarks/POIs), Tools (distance, coordinates, timezone), Personal
// (favorites/history), Settings (units, map provider, data sources), Maps mode.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { listHistory, listSaved, removeSaved } from "@/lib/meridian/favorites.js";
import { Panel, EmptyState, SourceLine } from "./ui.jsx";
import { WeatherPanel } from "./weather-card.jsx";
import { cn } from "@/lib/utils";

export function MapsPanel() {
  const mapMode = useMeridianStore((s) => s.mapMode);
  const setMapMode = useMeridianStore((s) => s.setMapMode);
  return (
    <Panel kicker="Maps" title="View mode">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Map mode">
        {(["3d", "2d"]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMapMode(m)}
            aria-pressed={mapMode === m}
            className={cn("rounded-xl px-3 py-2.5 text-sm font-medium", mapMode === m ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted hover:text-fg")}
          >
            {m === "3d" ? "3D Globe" : "2D Map"}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-subtle">Selection, route and tracking state carry over when you switch.</p>
    </Panel>
  );
}

export function WeatherModulePanel() {
  const location = useMeridianStore((s) => s.location);
  const [wx, setWx] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  if (location?.lat == null) {
    return <Panel kicker="Weather" title="Weather"><EmptyState message="Select a location first — search anywhere above." /></Panel>;
  }
  const load = async () => {
    setPending(true);
    setError(false);
    try {
      const res = await api.weather(location.lat, location.lon);
      setWx(res.data);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-3">
      <WeatherPanel weather={wx} pending={pending} error={error} title={location.name} />
      {!wx && !pending && (
        <button type="button" onClick={load} className="w-full rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
          Load weather for {location.name}
        </button>
      )}
    </div>
  );
}

export function DiscoverPanel() {
  const location = useMeridianStore((s) => s.location);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const [pois, setPois] = useState(null);
  if (location?.lat == null) {
    return <Panel kicker="Discover" title="Landmarks & POIs"><EmptyState message="Select a location first." /></Panel>;
  }
  const load = async () => {
    try {
      const res = await api.nearby(location.lat, location.lon, 50);
      setPois(res.data?.pois ?? []);
    } catch {
      setPois([]);
    }
  };
  return (
    <Panel kicker="Discover" title={`Near ${location.name}`}>
      {!pois && (
        <button type="button" onClick={load} className="w-full rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
          Find landmarks & POIs
        </button>
      )}
      {pois?.length === 0 && <EmptyState message="No catalogued POIs within 50 km." />}
      <ul className="space-y-1.5">
        {(pois ?? []).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                selectLocation({ kind: "POI", id: p.id, name: p.name, lat: p.latitude, lon: p.longitude, raw: p });
                useGlobeStore.getState().focusPointOn(p.latitude, p.longitude);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface-raised/50 px-3 py-2 text-left text-sm hover:bg-surface-raised"
            >
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-subtle">{p.designation ?? p.category}</span>
            </button>
          </li>
        ))}
      </ul>
      {pois && <SourceLine source="Geographic dataset" />}
    </Panel>
  );
}

export function ToolsPanel() {
  const [a, setA] = useState({ lat: "13.0827", lon: "80.2707" });
  const [b, setB] = useState({ lat: "22.5726", lon: "88.3639" });
  const [out, setOut] = useState(null);
  const calc = async () => {
    const { distanceKm, bearingDeg } = await import("@/lib/meridian/geo-math.js");
    const la = Number(a.lat), lo = Number(a.lon), lb = Number(b.lat), lb2 = Number(b.lon);
    if (![la, lo, lb, lb2].every(Number.isFinite)) {
      setOut({ error: "Enter valid coordinates." });
      return;
    }
    setOut({ km: distanceKm(la, lo, lb, lb2), bearing: bearingDeg(la, lo, lb, lb2) });
  };
  return (
    <Panel kicker="Tools" title="Distance calculator">
      <div className="grid grid-cols-2 gap-2">
        <CoordInput label="From lat" value={a.lat} onChange={(v) => setA({ ...a, lat: v })} />
        <CoordInput label="From lon" value={a.lon} onChange={(v) => setA({ ...a, lon: v })} />
        <CoordInput label="To lat" value={b.lat} onChange={(v) => setB({ ...b, lat: v })} />
        <CoordInput label="To lon" value={b.lon} onChange={(v) => setB({ ...b, lon: v })} />
      </div>
      <button type="button" onClick={calc} className="mt-2 w-full rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
        Calculate great-circle
      </button>
      {out?.error && <p className="mt-2 text-sm text-muted">{out.error}</p>}
      {out?.km != null && (
        <p className="mt-2 text-sm">Distance: <strong className="tabular-nums">{out.km.toFixed(1)} km</strong> · Bearing <strong className="tabular-nums">{out.bearing.toFixed(0)}°</strong></p>
      )}
      <SourceLine source="WGS84 haversine" />
    </Panel>
  );
}

function CoordInput({ label, value, onChange }) {
  return (
    <label className="block text-xs text-muted">{label}
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal"
        className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2 text-sm tabular-nums outline-none" />
    </label>
  );
}

// Contextual account prompt for guests reaching account features.
// Never blocks exploration — dismissing returns to the current context.
export function GuestGate({ message = "Save this place with a MERIDIAN account." }) {
  const navigate = useNavigate();
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  return (
    <Panel kicker="Account" title="Members keep more">
      <p className="text-sm text-muted">{message}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => navigate({ to: "/auth" })}
          className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
          Sign in
        </button>
        <button type="button" onClick={() => navigate({ to: "/auth?mode=signup" })}
          className="rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-muted hover:text-fg">
          Create account
        </button>
      </div>
      <button type="button" onClick={() => setActiveModule("explore")}
        className="mt-2 w-full text-xs text-subtle hover:text-fg">
        Continue exploring
      </button>
    </Panel>
  );
}

export function PersonalPanel() {
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const status = useAuthStore((s) => s.status);
  const authed = status === "AUTHENTICATED";
  const [favs, setFavs] = useState([]);
  const [hist] = useState(() => listHistory());
  const [pending, setPending] = useState(false);
  const open = (f) => {
    if (f.lat == null) return;
    selectLocation({ kind: f.kind ?? "CITY", id: String(f.id).split(":").slice(1).join(":") || f.id, name: f.name, lat: f.lat, lon: f.lon });
    useGlobeStore.getState().focusPointOn(f.lat, f.lon);
  };
  const refresh = () => {
    if (!authed) return;
    setPending(true);
    listSaved().then(setFavs).catch(() => setFavs([])).finally(() => setPending(false));
  };
  useEffect(() => { refresh(); }, [authed]); // eslint-disable-line
  if (!authed) {
    return (
      <div className="space-y-3">
        <GuestGate />
        <Panel kicker="Personal" title="Recent on this device">
          {!hist.length && <EmptyState message="Your recent searches will appear here." />}
          <ul className="space-y-1">
            {hist.slice(0, 10).map((h) => (
              <li key={h.id + h.viewedAt}>
                <button type="button" onClick={() => open(h)} className="w-full truncate rounded-xl px-3 py-1.5 text-left text-sm text-muted hover:bg-surface-raised/70 hover:text-fg">
                  {h.name}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }
  const remove = async (f) => {
    if (!f.serverId) return;
    await removeSaved(f.serverId).catch(() => {});
    refresh();
  };
  return (
    <div className="space-y-3">
      <Panel kicker="Personal" title="Saved locations" action={
        <button type="button" onClick={refresh} className="text-xs text-subtle hover:text-fg">
          {pending ? "Loading…" : "Refresh"}
        </button>
      }>
        {!favs.length && <EmptyState message="No saved places yet — tap the heart on any location." />}
        <ul className="space-y-1">
          {favs.map((f) => (
            <li key={f.serverId ?? f.id} className="flex items-center gap-1">
              <button type="button" onClick={() => open(f)} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-surface-raised/70">
                <span className="truncate font-medium">{f.name}</span>
                <span className="text-[10px] uppercase tracking-label text-subtle">{f.kind}</span>
              </button>
              <button type="button" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}
                className="shrink-0 rounded-full px-2 py-1 text-xs text-subtle hover:text-fg">×</button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel kicker="Personal" title="Recent">
        {!hist.length && <EmptyState message="Your recent searches will appear here." />}
        <ul className="space-y-1">
          {hist.slice(0, 10).map((h) => (
            <li key={h.id + h.viewedAt}>
              <button type="button" onClick={() => open(h)} className="w-full truncate rounded-xl px-3 py-1.5 text-left text-sm text-muted hover:bg-surface-raised/70 hover:text-fg">
                {h.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function SettingsPanel() {
  const units = useMeridianStore((s) => s.units);
  const setUnits = useMeridianStore((s) => s.setUnits);
  const [providers, setProviders] = useState(null);
  const load = () => api.providers().then((res) => setProviders(res.data)).catch(() => setProviders({ error: true }));
  return (
    <div className="space-y-3">
      <Panel kicker="Settings" title="Preferences">
        <p className="mb-1.5 text-xs text-muted">Units</p>
        <div className="grid grid-cols-2 gap-2">
          {(["metric", "imperial"]).map((u) => (
            <button key={u} type="button" onClick={() => setUnits(u)} aria-pressed={units === u}
              className={cn("rounded-xl px-3 py-2 text-sm capitalize", units === u ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted hover:text-fg")}>
              {u === "metric" ? "°C · km" : "°F · miles"}
            </button>
          ))}
        </div>
      </Panel>
      <Panel kicker="Settings" title="Data sources" action={
        <button type="button" onClick={load} className="text-xs text-subtle hover:text-fg">Check health</button>
      }>
        {!providers && <p className="text-sm text-subtle">Weather: Open-Meteo (keyless). Live traffic: OpenSky (coverage-limited). Schedules: licensed provider via FLIGHT_API_KEY.</p>}
        {providers?.error && <p className="text-sm text-subtle">Health check failed.</p>}
        {providers && !providers.error && (
          <pre className="max-h-56 overflow-auto rounded-xl bg-surface-raised/50 p-2.5 text-[11px] leading-relaxed text-muted">
            {JSON.stringify(providers, null, 2)}
          </pre>
        )}
      </Panel>
    </div>
  );
}
