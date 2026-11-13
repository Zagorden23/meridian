// Travel planner: elegant multi-step domestic / international flow.
// Country picked ONCE for domestic; states auto-skip when not applicable.
// Backend re-validates origin/destination country rules on search.
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { Panel, ErrorState, EmptyState, inputClass, primaryButtonClass, quietButtonClass } from "./ui.jsx";
import { cn } from "@/lib/utils";

const STEPS = ["Journey", "Origin", "Destination", "Details", "Results"];

export function TravelPlanner() {
  const [tripType, setTripType] = useState("domestic");
  const [step, setStep] = useState(0);
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState("india");
  const [fromCountry, setFromCountry] = useState("india");
  const [toCountry, setToCountry] = useState("united-kingdom");
  const [states, setStates] = useState({}); // countryId → states
  const [cities, setCities] = useState({}); // countryId → cities
  const [airports, setAirports] = useState([]);
  const [origin, setOrigin] = useState({ state: "", city: "", airport: "" });
  const [destination, setDestination] = useState({ state: "", city: "", airport: "" });
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10));
  const [passengers, setPassengers] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const setRoute = useMeridianStore((s) => s.setRoute);

  useEffect(() => {
    api.countries().then((res) => setCountries(res.data ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    api.airports().then((res) => setAirports(res.data ?? [])).catch(() => {});
  }, []);

  const loadGeo = async (countryId) => {
    if (states[countryId] && cities[countryId]) return;
    try {
      const [st, ci] = await Promise.all([api.countryStates(countryId), api.countryCities(countryId)]);
      setStates((s) => ({ ...s, [countryId]: st.data ?? [] }));
      setCities((s) => ({ ...s, [countryId]: ci.data ?? [] }));
    } catch {
      setStates((s) => ({ ...s, [countryId]: [] }));
      setCities((s) => ({ ...s, [countryId]: [] }));
    }
  };
  useEffect(() => { loadGeo(tripType === "domestic" ? country : fromCountry); }, [tripType, country, fromCountry]); // eslint-disable-line
  useEffect(() => { if (tripType === "international") loadGeo(toCountry); }, [tripType, toCountry]); // eslint-disable-line

  const originCountry = tripType === "domestic" ? country : fromCountry;
  const destCountry = tripType === "domestic" ? country : toCountry;

  const search = async () => {
    setError("");
    setResult(null);
    setSearching(true);
    try {
      const res = await api.flightsSearch({
        tripType,
        originAirport: origin.airport,
        destinationAirport: destination.airport,
        originCountry,
        destinationCountry: destCountry,
        departureDate: date,
        passengers,
      });
      setResult(res.data);
    } catch (err) {
      if (err?.code === "PROVIDER_UNAVAILABLE") {
        // No schedule source is connected: say so plainly. The route itself
        // is real and can still be drawn — flights are never made up.
        setResult({ unavailable: true });
      } else if (err?.status >= 400 && err?.status < 500) {
        setError(err.message);
      } else {
        setError("Flight search didn't respond. Please try again.");
      }
    } finally {
      setSearching(false);
      setStep(4);
    }
  };

  const viewRoute = () => {
    const o = airports.find((a) => a.iata === origin.airport);
    const d = airports.find((a) => a.iata === destination.airport);
    if (!o || !d) return;
    setRoute({
      origin: { lat: o.latitude, lon: o.longitude, name: o.name },
      destination: { lat: d.latitude, lon: d.longitude, name: d.name },
      label: `${o.iata} → ${d.iata}`,
    });
    useGlobeStore.getState().pauseOrbit();
    useGlobeStore.getState().focusPointOn((o.latitude + d.latitude) / 2, (o.longitude + d.longitude) / 2);
  };

  return (
    <Panel kicker="Travel" title={tripType === "domestic" ? "Domestic flights" : "International flights"}>
      {/* Progress: where you are, and a way back to any earlier step. */}
      <div className="mb-3">
        <p className="text-[11px] text-subtle" aria-live="polite">
          Step {step + 1} of {STEPS.length} · <span className="text-muted">{STEPS[step]}</span>
        </p>
        <ol className="mt-1.5 flex gap-1" aria-label="Travel steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <button
                type="button"
                onClick={() => setStep(i)}
                disabled={i >= step}
                aria-label={`${i + 1}. ${s}${i === step ? " (current)" : i < step ? " — go back" : ""}`}
                aria-current={step === i ? "step" : undefined}
                className="block w-full rounded-full py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className={cn("block h-1 rounded-full transition-colors duration-200", i <= step ? "bg-accent" : "bg-surface-raised")} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-2">
          {(["domestic", "international"]).map((t) => (
            <button key={t} type="button" onClick={() => { setTripType(t); setStep(1); }} aria-pressed={tripType === t}
              className={cn("rounded-xl px-3 py-2.5 text-sm font-medium capitalize transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", tripType === t ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted hover:text-fg")}>
              {t}
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2">
          {tripType === "domestic" ? (
            <Select label="Country" value={country} onChange={setCountry} options={countries.map((c) => ({ value: c.id, label: `${c.flag ?? ""} ${c.name}` }))} />
          ) : (
            <Select label="From country" value={fromCountry} onChange={setFromCountry} options={countries.map((c) => ({ value: c.id, label: `${c.flag ?? ""} ${c.name}` }))} />
          )}
          <EndpointForm scope="origin" countryId={originCountry} states={states[originCountry] ?? []} cities={cities[originCountry] ?? []} airports={airports} value={origin} onChange={setOrigin} />
          <Nav onNext={() => setStep(2)} nextDisabled={!origin.airport} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-2">
          {tripType === "international" && (
            <Select label="To country" value={toCountry} onChange={setToCountry} options={countries.map((c) => ({ value: c.id, label: `${c.flag ?? ""} ${c.name}` }))} />
          )}
          <EndpointForm scope="destination" countryId={destCountry} states={states[destCountry] ?? []} cities={cities[destCountry] ?? []} airports={airports} value={destination} onChange={setDestination} />
          <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} nextDisabled={!destination.airport} />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          <label className="block text-xs text-muted">Travel date
            <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)}
              className={cn(inputClass, "mt-1")} />
          </label>
          <label className="block text-xs text-muted">Passengers
            <input type="number" min={1} max={9} value={passengers}
              onChange={(e) => setPassengers(Math.min(9, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
              className={cn(inputClass, "mt-1")} />
          </label>
          <Nav onBack={() => setStep(2)} onNext={search} nextDisabled={searching || !date} nextLabel={searching ? "Searching…" : "Search flights"} />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{origin.airport} → {destination.airport}</p>
          {error && <ErrorState message={error} onRetry={search} />}
          {result?.unavailable && (
            <p className="text-sm leading-relaxed text-muted">
              Live schedules aren&apos;t connected yet, so there are no fares or departure times to show for this route. You can still see it on the globe.
            </p>
          )}
          {result && !result.unavailable && <EmptyState message="No scheduled flights were returned for this route and date." />}
          {origin.airport && destination.airport && (
            <button type="button" onClick={viewRoute} className={cn(primaryButtonClass, "w-full")}>
              View route on globe
            </button>
          )}
          <button type="button" onClick={() => { setStep(0); setResult(null); setError(""); }} className={cn(quietButtonClass, "w-full")}>
            New search
          </button>
        </div>
      )}
    </Panel>
  );
}

function EndpointForm({ countryId, states, cities, airports, value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const stateCities = useMemo(() => {
    if (!value.state) return cities;
    const st = states.find((s) => s.id === value.state);
    if (!st) return cities;
    const byState = cities.filter((c) => c.state_id === value.state);
    return byState.length ? byState : cities;
  }, [value.state, cities, states]);
  const cityAirports = useMemo(() => {
    let list = airports;
    if (value.city) list = list.filter((a) => a.city_id === value.city);
    else if (countryId) list = list.filter((a) => a.country_id === countryId);
    return list;
  }, [value.city, airports, countryId]);

  return (
    <div className="space-y-2">
      {states.length > 0 && (
        <Select label="State" value={value.state} onChange={(v) => set({ state: v, city: "", airport: "" })}
          options={states.map((s) => ({ value: s.id, label: s.name }))} placeholder="Select state" />
      )}
      <Select label="City" value={value.city} onChange={(v) => set({ city: v, airport: "" })}
        options={stateCities.map((c) => ({ value: c.id, label: c.name }))} placeholder="Select city" />
      <Select label="Airport" value={value.airport} onChange={(v) => set({ airport: v })}
        options={cityAirports.map((a) => ({ value: a.iata, label: `${a.iata} — ${a.name}` }))} placeholder="Select airport" />
    </div>
  );
}

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="block text-xs text-muted">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "mt-1")}>
        <option value="">{placeholder ?? "Select country"}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Nav({ onBack, onNext, nextDisabled, nextLabel }) {
  return (
    <div className="flex gap-2 pt-1">
      {onBack && <button type="button" onClick={onBack} className={cn(quietButtonClass, "flex-1")}>Back</button>}
      {onNext && <button type="button" onClick={onNext} disabled={nextDisabled} className={cn(primaryButtonClass, "flex-1")}>{nextLabel ?? "Continue"}</button>}
    </div>
  );
}
