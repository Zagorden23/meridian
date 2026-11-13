// Reusable weather card: current + 5-day forecast with provenance.
import { useMeridianStore } from "@/store/meridian-store.js";
import { Panel, Skeleton, SourceLine, ErrorState } from "./ui.jsx";

function temp(v, units) {
  if (v == null) return "—";
  return units === "imperial" ? `${Math.round((v * 9) / 5 + 32)}°F` : `${Math.round(v)}°C`;
}
function wind(v, units) {
  if (v == null) return "—";
  return units === "imperial" ? `${Math.round(v * 0.621371)} mph` : `${Math.round(v)} km/h`;
}

export function WeatherCard({ weather, pending, error, onRetry }) {
  const units = useMeridianStore((s) => s.units);
  if (pending) {
    return (
      <div className="space-y-2" aria-label="Loading weather">
        <Skeleton className="h-12 w-2/3" label="Loading temperature" />
        <Skeleton className="h-4 w-1/2" label="Loading conditions" />
        <Skeleton className="h-16 w-full" label="Loading details" />
      </div>
    );
  }
  if (error) return <ErrorState message="The weather couldn't be loaded." onRetry={onRetry} />;
  if (!weather) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-4xl italic">{temp(weather.temperature, units)}</span>
        <span className="text-sm text-muted">{weather.condition ?? ""}</span>
      </div>
      <p className="mt-1 text-xs text-subtle">Feels like {temp(weather.feelsLike, units)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Humidity</dt><dd>{weather.humidity ?? "—"}%</dd></div>
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Wind</dt><dd>{wind(weather.windSpeed, units)}{weather.windDirection != null ? ` · ${Math.round(weather.windDirection)}°` : ""}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Pressure</dt><dd>{weather.pressure ?? "—"} hPa</dd></div>
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Visibility</dt><dd>{weather.visibility != null ? `${(weather.visibility / 1000).toFixed(1)} km` : "—"}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Cloud cover</dt><dd>{weather.cloudCover ?? "—"}%</dd></div>
        <div><dt className="text-[11px] uppercase tracking-label text-subtle">Precipitation</dt><dd>{weather.precipitation ?? "—"} mm</dd></div>
      </dl>
      {Array.isArray(weather.forecast) && weather.forecast.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2">
          {weather.forecast.map((d) => (
            <li key={d.date} className="flex items-center justify-between text-xs text-muted">
              <span>{d.date}</span>
              <span className="truncate px-2">{d.condition ?? ""}</span>
              <span className="tabular-nums">{temp(d.tempMin, units)} – {temp(d.tempMax, units)}</span>
            </li>
          ))}
        </ul>
      )}
      <SourceLine source={weather.source === "open-meteo" ? "Open-Meteo" : weather.source} fetchedAt={weather.fetchedAt} cached={weather.cached} stale={weather.stale} />
    </div>
  );
}

export function WeatherPanel({ weather, pending, error, onRetry, title }) {
  return (
    <Panel kicker="Weather" title={title ?? "Current weather"}>
      <WeatherCard weather={weather} pending={pending} error={error} onRetry={onRetry} />
    </Panel>
  );
}
