// LocationPanel — tabbed card (Overview / Weather / Time / Nearby / Airports)
// for whatever was selected in 3D, 2D, search or AI. Each tab loads on demand,
// never blocks the globe, and has its own loading, error and empty states.
import { useEffect, useId, useState } from "react";
import { Heart, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { useAuthPrompt } from "@/lib/meridian/use-auth-prompt.js";
import { listSaved, removeSaved, savePlace } from "@/lib/meridian/favorites.js";
import { Panel, SourceLine, ErrorState, EmptyState, SkeletonRows, Stat } from "./ui.jsx";
import { WeatherCard } from "./weather-card.jsx";
import { formatCoord } from "@/lib/coords.js";
import { cn } from "@/lib/utils";

const TABS = ["Overview", "Weather", "Time", "Nearby", "Airports"];
const KIND_LABEL = { CITY: "City", COUNTRY: "Country", AIRPORT: "Airport", STATE: "Region", POI: "Landmark", PLACE: "Place", COORDINATES: "Coordinates" };
const ICON_BUTTON = "flex size-8 items-center justify-center rounded-full text-subtle transition-colors duration-150 hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40";

// `idle` → nothing requested yet; otherwise { data } | { error: true }.
const IDLE = { data: null, error: false, pending: false };

export function LocationPanel() {
  const location = useMeridianStore((s) => s.location);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const authed = useAuthStore((s) => s.status === "AUTHENTICATED");
  const promptAuth = useAuthPrompt();
  const tabsId = useId();
  const [tab, setTab] = useState("Overview");
  const [wx, setWx] = useState(IDLE);
  const [tz, setTz] = useState(IDLE);
  const [nearby, setNearby] = useState(IDLE);
  const [airports, setAirports] = useState(IDLE);
  const [attempt, setAttempt] = useState(0); // bump to retry the visible tab
  const [fav, setFav] = useState(null); // server id when saved, null otherwise
  const [saving, setSaving] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [countryName, setCountryName] = useState(null);

  const { lat, lon } = location ?? {};
  const hasCoords = lat != null && lon != null;

  // New selection → fresh card.
  useEffect(() => {
    setTab("Overview");
    setWx(IDLE);
    setTz(IDLE);
    setNearby(IDLE);
    setAirports(IDLE);
    setCountryName(null);
    setGateOpen(false);
    setFav(null);
    if (!location || !authed) return undefined;
    let alive = true;
    listSaved()
      .then((rows) => {
        const hit = rows.find((r) => r.id === `${location.kind}:${location.id}`);
        if (alive) setFav(hit ? hit.serverId : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [location, authed]);

  const toggleSave = async () => {
    if (!location || saving) return;
    if (!authed) {
      setGateOpen(true); // guests get the contextual prompt, never a silent save
      return;
    }
    setSaving(true);
    try {
      if (fav) {
        await removeSaved(fav);
        setFav(null);
        toast.success(`Removed ${location.name} from saved places.`);
      } else {
        const saved = await savePlace({ kind: location.kind, id: location.id, name: location.name, lat, lon });
        setFav(saved?.id ?? true);
        toast.success(`Saved ${location.name}.`);
      }
    } catch (err) {
      if (err?.code === "SESSION_REQUIRED") {
        useAuthStore.getState().sessionExpired();
      } else {
        toast.error(`Couldn't ${fav ? "remove" : "save"} ${location.name}. Please try again.`);
      }
    } finally {
      setSaving(false);
    }
  };

  // Resolve country id → display name (search rows carry only the id).
  useEffect(() => {
    const id = location?.country ?? location?.raw?.country_id;
    const embedded = location?.raw?.countryName;
    if (embedded) {
      setCountryName(embedded);
      return undefined;
    }
    if (!id) return undefined;
    let alive = true;
    api.country(id).then((res) => alive && setCountryName(res.data?.name ?? id)).catch(() => alive && setCountryName(id));
    return () => { alive = false; };
  }, [location]);

  // Weather + local time load with the selection; Nearby and Airports when
  // their tab is first opened.
  useEffect(() => {
    if (!location || !hasCoords) return undefined;
    let alive = true;
    setWx({ ...IDLE, pending: true });
    api.weather(lat, lon)
      .then((res) => alive && setWx({ ...IDLE, data: res.data }))
      .catch(() => alive && setWx({ ...IDLE, error: true }));
    setTz({ ...IDLE, pending: true });
    api.timezone(lat, lon, location.raw?.timezone ?? location.timezone)
      .then((res) => alive && setTz({ ...IDLE, data: res.data }))
      .catch(() => alive && setTz({ ...IDLE, error: true }));
    return () => { alive = false; };
  }, [location, lat, lon, hasCoords, attempt]);

  useEffect(() => {
    if (!location || tab !== "Nearby" || !hasCoords || nearby.data || nearby.pending) return;
    setNearby({ ...IDLE, pending: true });
    api.nearby(lat, lon, 100)
      .then((res) => setNearby({ ...IDLE, data: res.data }))
      .catch(() => setNearby({ ...IDLE, error: true }));
    // Depends on the tab and selection only; the state it sets is its own guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, location, lat, lon, hasCoords, attempt]);

  useEffect(() => {
    if (!location || tab !== "Airports" || airports.data || airports.pending) return;
    const params = {};
    if (location.kind === "CITY") params.cityId = location.id;
    if (location.kind === "COUNTRY") params.countryId = location.id;
    setAirports({ ...IDLE, pending: true });
    api.airports(params)
      .then((res) => setAirports({ ...IDLE, data: res.data ?? [] }))
      .catch(() => setAirports({ ...IDLE, error: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, location, attempt]);

  if (!location) return null;
  const raw = location.raw ?? {};
  const retry = (reset) => { reset(IDLE); setAttempt((n) => n + 1); };

  return (
    <Panel
      kicker={KIND_LABEL[location.kind] ?? location.kind}
      title={location.name || "Selected place"}
      action={
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            aria-label={fav ? `Remove ${location.name} from saved places` : `Save ${location.name}`}
            aria-pressed={Boolean(fav)}
            onClick={toggleSave}
            disabled={saving}
            className={ICON_BUTTON}
          >
            <Heart className={cn("size-4 transition-colors duration-150", fav && "fill-accent text-accent")} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => selectLocation(null)}
            className={ICON_BUTTON}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      }
      className="max-h-[46dvh] overflow-y-auto overscroll-contain"
    >
      <div role="tablist" aria-label={`${location.name} details`} className="no-scrollbar -mx-1 mb-3 flex gap-1 overflow-x-auto px-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${tabsId}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              tab === t ? "bg-surface-raised font-medium text-fg" : "text-subtle hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {gateOpen && (
        <div role="alert" className="animate-enter mb-3 rounded-xl border border-accent/30 bg-surface-raised/50 px-3 py-2.5">
          <p className="text-sm">Sign in to save {location.name} to your places.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => promptAuth()}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface">Sign in</button>
            <button type="button" onClick={() => promptAuth("signup")}
              className="rounded-full bg-surface-raised px-3 py-1.5 text-xs text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Create account</button>
            <button type="button" onClick={() => setGateOpen(false)}
              className="rounded-full px-3 py-1.5 text-xs text-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Not now</button>
          </div>
        </div>
      )}

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === "Overview" && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {raw.region && <Stat label="Region" value={raw.region} />}
            {(location.country || raw.country_id) && <Stat label="Country" value={countryName ?? location.country ?? raw.country_id} />}
            {raw.state_code && <Stat label="State" value={raw.state_code} />}
            {hasCoords && <Stat label="Coordinates" value={formatCoord(lat, lon)} />}
            {raw.timezone && <Stat label="Timezone" value={raw.timezone} />}
            {raw.elevation != null && <Stat label="Elevation" value={`${raw.elevation} m`} />}
            {raw.population != null && <Stat label="Population" value={Number(raw.population).toLocaleString()} />}
            {raw.isCapital != null && <Stat label="Capital" value={raw.isCapital ? "Yes" : "No"} />}
            {raw.iata && <Stat label="IATA" value={raw.iata} />}
            {raw.icao && <Stat label="ICAO" value={raw.icao} />}
            {raw.iso2 && <Stat label="ISO" value={raw.iso2} />}
            {raw.currency && <Stat label="Currency" value={raw.currency} />}
            {raw.languages && <Stat label="Languages" value={raw.languages} />}
          </div>
        )}

        {tab === "Weather" && (
          hasCoords
            ? <WeatherCard weather={wx.data} pending={wx.pending} error={wx.error} onRetry={() => setAttempt((n) => n + 1)} />
            : <EmptyState message="No coordinates for this place." />
        )}

        {tab === "Time" && (
          <>
            {tz.pending && <SkeletonRows rows={3} label="Loading local time" />}
            {tz.error && <ErrorState message="Local time couldn't be loaded." onRetry={() => setAttempt((n) => n + 1)} />}
            {!hasCoords && <EmptyState message="No coordinates for this place." />}
            {tz.data && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Stat label="Local time" value={tz.data.localTime ?? "—"} />
                <Stat label="UTC offset" value={tz.data.utcOffset ?? "—"} />
                <Stat label="Sunrise (est.)" value={tz.data.sunrise ? new Date(tz.data.sunrise).toLocaleTimeString() : tz.data.polar === "day" ? "Polar day" : "—"} />
                <Stat label="Sunset (est.)" value={tz.data.sunset ? new Date(tz.data.sunset).toLocaleTimeString() : tz.data.polar === "night" ? "Polar night" : "—"} />
                <Stat label="Daylight" value={tz.data.isDaytime == null ? "—" : tz.data.isDaytime ? "Day" : "Night"} />
                <div className="col-span-2"><SourceLine source="IANA time zone database · solar position estimate" /></div>
              </div>
            )}
          </>
        )}

        {tab === "Nearby" && (
          <>
            {nearby.pending && <SkeletonRows rows={3} label="Finding nearby places" />}
            {nearby.error && <ErrorState message="Nearby places couldn't be loaded." onRetry={() => retry(setNearby)} />}
            {!hasCoords && <EmptyState message="No coordinates for this place." />}
            {nearby.data && (
              <div className="space-y-2">
                {(nearby.data.cities ?? []).map((c) => (
                  <NearbyRow key={c.id} name={c.name} detail={`${c.distanceKm?.toFixed(0)} km`} />
                ))}
                {(nearby.data.pois ?? []).map((p) => (
                  <NearbyRow key={p.id} name={p.name} detail={`${p.category}${p.designation ? ` · ${p.designation}` : ""} · ${p.distanceKm?.toFixed(0)} km`} />
                ))}
                {!nearby.data.cities?.length && !nearby.data.pois?.length && <EmptyState message="Nothing catalogued within 100 km yet." />}
              </div>
            )}
          </>
        )}

        {tab === "Airports" && (
          <>
            {airports.pending && <SkeletonRows rows={3} label="Finding airports" />}
            {airports.error && <ErrorState message="Airports couldn't be loaded." onRetry={() => retry(setAirports)} />}
            {airports.data && (
              airports.data.length ? (
                <ul className="space-y-2">
                  {airports.data.map((a) => (
                    <li key={a.id} className="rounded-xl bg-surface-raised/50 px-3 py-2 text-sm">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-subtle">{[a.iata, a.icao, a.type].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState message="No airports catalogued for this place." />
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function NearbyRow({ name, detail }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-raised/50 px-3 py-2 text-sm">
      <span className="truncate font-medium">{name}</span>
      <span className="shrink-0 text-xs text-subtle">{detail}</span>
    </div>
  );
}
