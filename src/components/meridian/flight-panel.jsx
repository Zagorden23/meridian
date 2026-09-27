// Flight intelligence: status lookup + live traffic + TRACK FLIGHT.
// Live positions come from /api/flights/live (OpenSky); the marker
// interpolates between polls — never teleports, never fabricated.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { focusAircraft, fitFlightRoute, followAircraft, exitFlightTracking } from "@/lib/meridian/flight-camera.js";
import { Panel, ErrorState, EmptyState, SourceLine } from "./ui.jsx";

export function FlightPanel() {
  const [number, setNumber] = useState("");
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [traffic, setTraffic] = useState(null);
  const [follow, setFollow] = useState(true);
  const trafficMode = useMeridianStore((s) => s.trafficMode);
  const trackedFlight = useMeridianStore((s) => s.trackedFlight);
  const setTrackedFlight = useMeridianStore((s) => s.setTrackedFlight);
  const poll = useRef(null);

  const lookup = async () => {
    setStatusError("");
    setStatus(null);
    try {
      const res = await api.flightStatus(number);
      setStatus(res.data);
    } catch (err) {
      setStatusError(err.message);
    }
  };

  // Live traffic polling while traffic mode or tracking is active.
  const trackingId = trackedFlight?.callsign ?? null;
  useEffect(() => {
    const active = trafficMode || trackingId;
    if (!active) {
      setTraffic(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.liveTraffic();
        if (alive) setTraffic(res.data);
      } catch { /* keep last frame */ }
    };
    tick();
    poll.current = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(poll.current);
    };
  }, [trafficMode, trackingId]);

  // Camera follows the tracked aircraft when follow mode is on.
  useEffect(() => {
    const st = useMeridianStore.getState();
    if (!trackedFlight?.position || !follow || st.mapMode !== "3d") return;
    useGlobeStore.getState().focusPointOn(trackedFlight.position.latitude, trackedFlight.position.longitude);
  }, [trackedFlight?.position?.latitude, trackedFlight?.position?.longitude, follow]); // eslint-disable-line

  const track = (ac) => {
    setTrackedFlight({
      callsign: ac.callsign,
      flightNumber: number || ac.callsign,
      position: ac,
      updatedAt: new Date().toISOString(),
    });
    useGlobeStore.getState().pauseOrbit();
    useGlobeStore.getState().focusPointOn(ac.latitude, ac.longitude);
  };

  const aircraft = traffic?.aircraft ?? [];
  const tracked = trackedFlight
    ? aircraft.find((a) => a.callsign === trackedFlight.callsign) ?? trackedFlight.position
    : null;

  return (
    <div className="space-y-3">
      <Panel kicker="Flights" title="Check flight status">
        <div className="flex gap-2">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="6E 521 or AI 473"
            aria-label="Flight number"
            className="min-w-0 flex-1 rounded-xl bg-surface-raised/70 px-3 py-2 text-sm uppercase outline-none placeholder:normal-case placeholder:text-subtle"
          />
          <button type="button" onClick={lookup} className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
            Check
          </button>
        </div>
        {statusError && <div className="mt-2"><ErrorState message={statusError} /></div>}
        {status && (
          <div className="mt-2 rounded-xl bg-surface-raised/50 px-3 py-2 text-sm">
            <p className="font-medium">{status.flightNumber}</p>
            <p className="text-xs text-subtle">Status: {status.status}</p>
            <SourceLine source="Flight provider" fetchedAt={new Date().toISOString()} />
          </div>
        )}
      </Panel>

      <Panel kicker="Live" title="Air traffic" action={
        trackedFlight && (
          <button type="button" onClick={() => { setFollow(false); exitFlightTracking(); }} className="text-xs text-subtle hover:text-fg">
            Exit tracking
          </button>
        )
      }>
        {!trafficMode && !trackedFlight && <EmptyState message="Enable “Live air traffic” in Explore to see aircraft." />}
        {(trafficMode || trackedFlight) && !traffic && <p className="text-sm text-subtle">Loading live positions…</p>}
        {tracked && (
          <div className="mb-2 rounded-xl border border-accent/40 px-3 py-2 text-sm">
            <p className="font-medium">● LIVE · {tracked.callsign}</p>
            <p className="text-xs text-muted">
              {tracked.latitude?.toFixed(2)}°, {tracked.longitude?.toFixed(2)}°
              {tracked.altitude != null ? ` · ${Math.round(tracked.altitude)} m` : ""}
              {tracked.groundspeed != null ? ` · ${Math.round(tracked.groundspeed * 3.6)} km/h` : ""}
              {tracked.heading != null ? ` · HDG ${Math.round(tracked.heading)}°` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setFollow(true); followAircraft(); }} className={`rounded-full px-2.5 py-1 text-xs ${follow ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted"}`}>Follow aircraft</button>
              <button type="button" onClick={() => { setFollow(false); fitFlightRoute(); }} className="rounded-full bg-surface-raised/70 px-2.5 py-1 text-xs text-muted">View full route</button>
              <button type="button" onClick={() => { setFollow(false); focusAircraft(); }} className="rounded-full bg-surface-raised/70 px-2.5 py-1 text-xs text-muted">Focus aircraft</button>
              <button type="button" onClick={() => setFollow(false)} className={`rounded-full px-2.5 py-1 text-xs ${!follow ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted"}`}>Free camera</button>
            </div>
            <SourceLine source="OpenSky" fetchedAt={tracked.fetchedAt} />
          </div>
        )}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {aircraft.slice(0, 60).map((ac) => (
            <li key={ac.flightId ?? ac.callsign}>
              <button type="button" onClick={() => track(ac)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-surface-raised/70">
                <span className="font-medium">{ac.callsign ?? "—"}</span>
                <span className="flex items-center gap-2 text-xs text-subtle">
                  <span className="tabular-nums">{ac.latitude?.toFixed(1)}°, {ac.longitude?.toFixed(1)}°</span>
                  <span className="text-accent">Track</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {traffic && <SourceLine source="OpenSky" fetchedAt={traffic.fetchedAt} />}
      </Panel>
    </div>
  );
}
