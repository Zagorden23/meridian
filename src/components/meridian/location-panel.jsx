// LocationPanel — tabbed cards (Overview / Weather / Time / Nearby / Airports)
// for whatever the user selected in 3D, 2D, search or AI. Weather and timezone
// load asynchronously and never block globe animation.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Heart, X } from "lucide-react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { listSaved, removeSaved, savePlace } from "@/lib/meridian/favorites.js";
import { Panel, SourceLine, ErrorState, EmptyState, Stat } from "./ui.jsx";
import { WeatherCard } from "./weather-card.jsx";
import { formatCoord } from "@/lib/coords.js";
import { cn } from "@/lib/utils";

const TABS = ["Overview", "Weather", "Time", "Nearby", "Airports"];

export function LocationPanel() {
  const location = useMeridianStore((s) => s.location);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const [tab, setTab] = useState("Overview");
  const [wx, setWx] = useState(null);
  const [wxPending, setWxPending] = useState(false);
  const [wxError, setWxError] = useState(false);
  const [tz, setTz] = useState(null);
  const [nearby, setNearby] = useState(null);
  const [airports, setAirports] = useState(null);
  const [fav, setFav] = useState(null); // serverId when saved, null otherwise
  const [gateOpen, setGateOpen] = useState(false);
  const [countryName, setCountryName] = useState(null);
  const navigate = useNavigate();
  const authStatus = useAuthStore((s) => s.status);
  const authed = authStatus === "AUTHENTICATED";

  useEffect(() => {
    setTab("Overview");
    setWx(null);
    setWxError(false);
    setTz(null);
    setNearby(null);
    setAirports(null);
    setCountryName(null);
    setGateOpen(false);
    setFav(null);
    if (location && authed) {
      listSaved()
        .then((rows) => {
          const hit = rows.find((r) => r.id === `${location.kind}:${location.id}`);
          setFav(hit ? hit.serverId : null);
        })
        .catch(() => setFav(null));
    }
  }, [location, authed]);

  const toggleSave = async () => {
    if (!location) return;
    if (!authed) {
      setGateOpen(true); // guests get the contextual prompt, never a silent save
      return;
    }
    try {
      if (fav) {
        await removeSaved(fav);
        setFav(null);
      } else {
        const saved = await savePlace({ kind: location.kind, id: location.id, name: location.name, lat, lon });
        setFav(saved?.id ?? true);
      }
    } catch (err) {
      if (err?.code === "SESSION_REQUIRED") setGateOpen(true);
    }
  };

  // Resolve country id → display name (search rows carry only the id).
  useEffect(() => {
    const id = location?.country ?? location?.raw?.country_id;
    const embedded = location?.raw?.countryName;
    if (embedded) {
      setCountryName(embedded);
      return;
    }
    if (!id) return;
    let alive = true;
    api.country(id).then((res) => alive && setCountryName(res.data?.name ?? id)).catch(() => alive && setCountryName(id));
    return () => { alive = false; };
  }, [location]);

  const { lat, lon } = location ?? {};
  const hasCoords = lat != null && lon != null;

  // Weather + timezone fetch on mount of a selection (debounced by selection change).
  useEffect(() => {
    if (!location || !hasCoords) return;
    let alive = true;
    const ctrl = new AbortController();
    setWxPending(true);
    api.weather(lat, lon, ctrl.signal)
      .then((res) => alive && (setWx(res.data), setWxError(false)))
      .catch((err) => alive && err?.name !== "AbortError" && setWxError(true))
      .finally(() => alive && setWxPending(false));
    const timezone = location.raw?.timezone ?? location.timezone;
    api.timezone(lat, lon, timezone)
      .then((res) => alive && setTz(res.data))
      .catch(() => {});
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [location, lat, lon, hasCoords]);

  useEffect(() => {
    if (!location || tab !== "Nearby" || nearby || !hasCoords) return;
    api.nearby(lat, lon, 100).then((res) => setNearby(res.data)).catch(() => setNearby({ cities: [], pois: [] }));
  }, [tab, location, nearby, lat, lon, hasCoords]);

  useEffect(() => {
    if (!location || tab !== "Airports" || airports) return;
    const params = {};
    if (location.kind === "CITY") params.cityId = location.id;
    if (location.kind === "COUNTRY") params.countryId = location.id;
    api.airports(params).then((res) => setAirports(res.data)).catch(() => setAirports([]));
  }, [tab, location, airports]);

  if (!location) return null;
  const raw = location.raw ?? {};

  return (
    <Panel
      kicker={location.kind}
      title={location.name}
      action={
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={fav ? "Remove favorite" : "Save favorite"}
            aria-pressed={Boolean(fav)}
            onClick={toggleSave}
            className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <Heart className={cn("size-4", fav && "fill-accent text-accent")} />
          </button>
          <button
            type="button"
            aria-label="Close location panel"
            onClick={() => selectLocation(null)}
            className="rounded-full p-1.5 text-subtle transition-colors hover:bg-surface-raised hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
      }
      className="max-h-[46dvh] overflow-y-auto"
    >
      <div role="tablist" aria-label="Location sections" className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs",
              tab === t ? "bg-surface-raised text-fg" : "text-subtle hover:text-fg",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {gateOpen && (
        <div role="alert" className="mb-3 rounded-xl border border-accent/30 bg-surface-raised/50 px-3 py-2.5">
          <p className="text-sm">Save this place with a MERIDIAN account.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => navigate({ to: "/auth" })}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">Sign in</button>
            <button type="button" onClick={() => navigate({ to: "/auth?mode=signup" })}
              className="rounded-full bg-surface-raised px-3 py-1.5 text-xs text-muted hover:text-fg">Create account</button>
            <button type="button" onClick={() => setGateOpen(false)}
              className="rounded-full px-3 py-1.5 text-xs text-subtle hover:text-fg">Continue exploring</button>
          </div>
        </div>
      )}

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
          <SourceLine source="Geographic dataset" />
        </div>
      )}

      {tab === "Weather" && (
        hasCoords ? <WeatherCard weather={wx} pending={wxPending} error={wxError} /> : <EmptyState message="No coordinates for this location." />
      )}

      {tab === "Time" && (
        tz ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Stat label="Local time" value={tz.localTime ?? "—"} />
            <Stat label="UTC offset" value={tz.utcOffset ?? "—"} />
            <Stat label="Sunrise (est.)" value={tz.sunrise ? new Date(tz.sunrise).toLocaleTimeString() : tz.polar === "day" ? "Polar day" : "—"} />
            <Stat label="Sunset (est.)" value={tz.sunset ? new Date(tz.sunset).toLocaleTimeString() : tz.polar === "night" ? "Polar night" : "—"} />
            <Stat label="Daylight" value={tz.isDaytime == null ? "—" : tz.isDaytime ? "Day" : "Night"} />
            <SourceLine source="IANA timezone database · solar approx." />
          </div>
        ) : <p className="py-2 text-sm text-subtle">Loading time…</p>
      )}

      {tab === "Nearby" && (
        nearby ? (
          <div className="space-y-2">
            {(nearby.cities ?? []).map((c) => (
              <NearbyRow key={c.id} name={c.name} detail={`${c.distanceKm?.toFixed(0)} km`} />
            ))}
            {(nearby.pois ?? []).map((p) => (
              <NearbyRow key={p.id} name={p.name} detail={`${p.category}${p.designation ? ` · ${p.designation}` : ""} · ${p.distanceKm?.toFixed(0)} km`} />
            ))}
            {!nearby.cities?.length && !nearby.pois?.length && <EmptyState message="Nothing catalogued nearby yet." />}
          </div>
        ) : <p className="py-2 text-sm text-subtle">Loading nearby…</p>
      )}

      {tab === "Airports" && (
        airports ? (
          airports.length ? (
            <ul className="space-y-2">
              {airports.map((a) => (
                <li key={a.id} className="rounded-xl bg-surface-raised/50 px-3 py-2 text-sm">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-subtle">{a.iata}{a.icao ? ` · ${a.icao}` : ""} · {a.type}</p>
                </li>
              ))}
            </ul>
          ) : <EmptyState message="No airports catalogued for this selection." />
        ) : <p className="py-2 text-sm text-subtle">Loading airports…</p>
      )}
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

export function LocationError() {
  return <ErrorState message="Location lookup failed. The catalog may still be seeding — try again shortly." />;
}
