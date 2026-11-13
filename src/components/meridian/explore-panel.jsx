// Explore: countries, capitals mode, device location, live traffic toggle.
import { useCallback, useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { Panel, EmptyState, ErrorState, SkeletonRows } from "./ui.jsx";
import { cn } from "@/lib/utils";

const ROW = "transition-colors duration-150 hover:bg-surface-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

export function ExplorePanel() {
  const [countries, setCountries] = useState(null);
  const [countriesError, setCountriesError] = useState(false);
  const [capitals, setCapitals] = useState(null);
  const [capitalsError, setCapitalsError] = useState(false);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const capitalsMode = useMeridianStore((s) => s.capitalsMode);
  const setCapitalsMode = useMeridianStore((s) => s.setCapitalsMode);
  const trafficMode = useMeridianStore((s) => s.trafficMode);
  const setTrafficMode = useMeridianStore((s) => s.setTrafficMode);
  const setDeviceLocation = useMeridianStore((s) => s.setDeviceLocation);
  const [geoMsg, setGeoMsg] = useState("");

  const loadCountries = useCallback(() => {
    setCountriesError(false);
    api.countries().then((res) => setCountries(res.data ?? [])).catch(() => setCountriesError(true));
  }, []);
  useEffect(() => { loadCountries(); }, [loadCountries]);

  const loadCapitals = useCallback(() => {
    setCapitalsError(false);
    api.capitals().then((res) => setCapitals(res.data ?? [])).catch(() => setCapitalsError(true));
  }, []);
  useEffect(() => {
    if (capitalsMode && !capitals) loadCapitals();
  }, [capitalsMode, capitals, loadCapitals]);

  const flyTo = (kind, item, lat, lon) => {
    selectLocation({ kind, id: item.id, name: item.name, lat, lon, raw: item });
    useGlobeStore.getState().pauseOrbit();
    useGlobeStore.getState().focusPointOn(lat, lon);
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoMsg("Geolocation isn't supported in this browser.");
      return;
    }
    setGeoMsg("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setDeviceLocation({ lat: latitude, lon: longitude, accuracy, at: new Date().toISOString() });
        setGeoMsg(
          accuracy ? `Found you, accurate to about ${Math.round(accuracy)} m.` : "Found you.",
        );
        try {
          const res = await api.reverse(latitude, longitude);
          const city = res.data?.city;
          if (city) flyTo("CITY", city, city.latitude, city.longitude);
          else {
            useGlobeStore.getState().focusPointOn(latitude, longitude);
          }
        } catch {
          useGlobeStore.getState().focusPointOn(latitude, longitude);
        }
      },
      (err) => setGeoMsg(err?.code === 1
        ? "Location access is blocked for this site. You can still search for any place above."
        : "Your location couldn't be determined. You can still search for any place above."),
      { timeout: 10000 },
    );
  };

  return (
    <div className="space-y-3">
      <Panel kicker="Explore" title="Globe">
        <div className="flex flex-wrap gap-2">
          <Toggle label="Capitals" on={capitalsMode} onClick={() => setCapitalsMode(!capitalsMode)} />
          <Toggle label="Live air traffic" on={trafficMode} onClick={() => setTrafficMode(!trafficMode)} />
        </div>
        <button
          type="button"
          onClick={useMyLocation}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-surface-raised/70 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LocateFixed className="size-4 text-muted" aria-hidden />
          Use my location
        </button>
        <p className="mt-1.5 text-xs text-subtle" aria-live="polite">{geoMsg}</p>
      </Panel>

      {capitalsMode && (
        <Panel kicker="Mode" title="Capitals">
          {!capitals && !capitalsError && <SkeletonRows rows={5} label="Loading capitals" />}
          {capitalsError && <ErrorState message="Capitals couldn't be loaded." onRetry={loadCapitals} />}
          {capitals?.length === 0 && <EmptyState message="No capitals in the catalog yet." />}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {(capitals ?? []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => flyTo("CITY", c, c.latitude, c.longitude)} className={cn("flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm", ROW)}>
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs text-subtle">{countries?.find((cc) => cc.id === c.country_id)?.name ?? c.country_id}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel kicker="Explore" title="Countries">
        {!countries && !countriesError && <SkeletonRows rows={6} label="Loading countries" />}
        {countriesError && <ErrorState message="Countries couldn't be loaded." onRetry={loadCountries} />}
        {countries?.length === 0 && <EmptyState message="The place catalog is empty. Once it is loaded, countries appear here." />}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {(countries ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => flyTo("COUNTRY", c, c.latitude, c.longitude)} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm", ROW)}>
                <span aria-hidden className="w-6 shrink-0 text-center">{c.flag}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-subtle">{c.iso2}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        on ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}
