// Section panels: Maps (view mode), Weather, Discover (landmarks/POIs), Tools
// (distance), Saved (favorites/history) and Settings (units, account, data).
// Every panel that loads data has all four states: loading, error (with a
// retry), empty and loaded.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { apiErrorMessage, PROVIDER_LABEL } from "@/lib/meridian/auth-messages.js";
import { useAuthPrompt } from "@/lib/meridian/use-auth-prompt.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { useAuthStore } from "@/store/auth-store.js";
import { listHistory, listSaved, removeSaved } from "@/lib/meridian/favorites.js";
import {
  Panel, EmptyState, ErrorState, SkeletonRows, SourceLine,
  inputClass, primaryButtonClass, quietButtonClass,
} from "./ui.jsx";
import { WeatherPanel } from "./weather-card.jsx";
import { cn } from "@/lib/utils";

const SEGMENT = "rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const segment = (on) => cn(SEGMENT, on ? "bg-accent text-accent-fg" : "bg-surface-raised/70 text-muted hover:text-fg");
const ROW_BUTTON = "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function MapsPanel() {
  const mapMode = useMeridianStore((s) => s.mapMode);
  const setMapMode = useMeridianStore((s) => s.setMapMode);
  return (
    <Panel kicker="Maps" title="View mode">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Map mode">
        {(["3d", "2d"]).map((m) => (
          <button key={m} type="button" onClick={() => setMapMode(m)} aria-pressed={mapMode === m} className={segment(mapMode === m)}>
            {m === "3d" ? "3D Globe" : "2D Map"}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-subtle">Selection, route and tracking carry over when you switch.</p>
    </Panel>
  );
}

/** Load something for the selected location; reload whenever it changes. */
function useLocationData(location, load) {
  const [state, setState] = useState({ data: null, pending: false, error: false });
  const [attempt, setAttempt] = useState(0);
  const lat = location?.lat;
  const lon = location?.lon;
  useEffect(() => {
    if (lat == null || lon == null) {
      setState({ data: null, pending: false, error: false });
      return undefined;
    }
    let alive = true;
    setState({ data: null, pending: true, error: false });
    load(lat, lon)
      .then((data) => alive && setState({ data, pending: false, error: false }))
      .catch(() => alive && setState({ data: null, pending: false, error: true }));
    return () => { alive = false; };
    // `load` is a stable module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

const loadWeather = (lat, lon) => api.weather(lat, lon).then((res) => res.data);
const loadPois = (lat, lon) => api.nearby(lat, lon, 50).then((res) => res.data?.pois ?? []);

export function WeatherModulePanel() {
  const location = useMeridianStore((s) => s.location);
  const wx = useLocationData(location, loadWeather);
  if (location?.lat == null) {
    return (
      <Panel kicker="Weather" title="Weather">
        <EmptyState message="Pick a place — search above or choose one on the globe — to see its weather." />
      </Panel>
    );
  }
  return <WeatherPanel weather={wx.data} pending={wx.pending} error={wx.error} onRetry={wx.retry} title={location.name} />;
}

export function DiscoverPanel() {
  const location = useMeridianStore((s) => s.location);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const pois = useLocationData(location, loadPois);
  if (location?.lat == null) {
    return (
      <Panel kicker="Discover" title="Landmarks nearby">
        <EmptyState message="Pick a place to see the landmarks and points of interest around it." />
      </Panel>
    );
  }
  return (
    <Panel kicker="Discover" title={`Near ${location.name}`}>
      {pois.pending && <SkeletonRows rows={4} label="Finding landmarks" />}
      {pois.error && <ErrorState message="Landmarks couldn't be loaded." onRetry={pois.retry} />}
      {pois.data?.length === 0 && <EmptyState message="No catalogued landmarks within 50 km of here yet." />}
      {pois.data?.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {pois.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    selectLocation({ kind: "POI", id: p.id, name: p.name, lat: p.latitude, lon: p.longitude, raw: p });
                    useGlobeStore.getState().focusPointOn(p.latitude, p.longitude);
                  }}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-xl bg-surface-raised/50 px-3 py-2 text-left text-sm hover:bg-surface-raised", ROW_BUTTON)}
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-subtle">{p.designation ?? p.category}</span>
                </button>
              </li>
            ))}
          </ul>
          <SourceLine source="Meridian place catalog" />
        </>
      )}
    </Panel>
  );
}

export function ToolsPanel() {
  const [a, setA] = useState({ lat: "13.0827", lon: "80.2707" });
  const [b, setB] = useState({ lat: "22.5726", lon: "88.3639" });
  const [out, setOut] = useState(null);
  const units = useMeridianStore((s) => s.units);
  const calc = async (event) => {
    event.preventDefault();
    const { distanceKm, bearingDeg } = await import("@/lib/meridian/geo-math.js");
    const la = Number(a.lat), lo = Number(a.lon), lb = Number(b.lat), lb2 = Number(b.lon);
    const valid = [a.lat, a.lon, b.lat, b.lon].every((v) => String(v).trim() !== "")
      && [la, lo, lb, lb2].every(Number.isFinite)
      && Math.abs(la) <= 90 && Math.abs(lb) <= 90 && Math.abs(lo) <= 180 && Math.abs(lb2) <= 180;
    if (!valid) {
      setOut({ error: "Enter latitudes between −90 and 90 and longitudes between −180 and 180." });
      return;
    }
    setOut({ km: distanceKm(la, lo, lb, lb2), bearing: bearingDeg(la, lo, lb, lb2) });
  };
  const distance = out?.km == null ? null
    : units === "imperial" ? `${(out.km * 0.621371).toFixed(1)} mi` : `${out.km.toFixed(1)} km`;
  return (
    <Panel kicker="Tools" title="Distance calculator">
      <form onSubmit={calc} noValidate>
        <div className="grid grid-cols-2 gap-2">
          <CoordInput label="From latitude" value={a.lat} onChange={(v) => setA({ ...a, lat: v })} />
          <CoordInput label="From longitude" value={a.lon} onChange={(v) => setA({ ...a, lon: v })} />
          <CoordInput label="To latitude" value={b.lat} onChange={(v) => setB({ ...b, lat: v })} />
          <CoordInput label="To longitude" value={b.lon} onChange={(v) => setB({ ...b, lon: v })} />
        </div>
        <button type="submit" className={cn(primaryButtonClass, "mt-2 w-full")}>
          Calculate distance
        </button>
      </form>
      <div aria-live="polite">
        {out?.error && <p className="mt-2 text-sm text-muted">{out.error}</p>}
        {distance && (
          <p className="mt-2 text-sm">Distance <strong className="tabular-nums">{distance}</strong> · Bearing <strong className="tabular-nums">{out.bearing.toFixed(0)}°</strong></p>
        )}
      </div>
      <SourceLine source="Great-circle distance on the WGS84 sphere" />
    </Panel>
  );
}

function CoordInput({ label, value, onChange }) {
  return (
    <label className="block text-xs text-muted">{label}
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal"
        className={cn(inputClass, "mt-1 tabular-nums")} />
    </label>
  );
}

// Contextual account prompt for guests reaching account features.
// Never blocks exploration — dismissing returns to the current context.
export function GuestGate({ message = "Sign in to save places and find them again on any device." }) {
  const promptAuth = useAuthPrompt();
  const setActiveModule = useMeridianStore((s) => s.setActiveModule);
  return (
    <Panel kicker="Account" title="Keep your places">
      <p className="text-sm text-muted">{message}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => promptAuth()} className={primaryButtonClass}>Sign in</button>
        <button type="button" onClick={() => promptAuth("signup")} className={quietButtonClass}>Create account</button>
      </div>
      <button type="button" onClick={() => setActiveModule("explore")}
        className={cn("mt-2 w-full rounded-lg py-1 text-xs text-subtle hover:text-fg", ROW_BUTTON)}>
        Continue exploring
      </button>
    </Panel>
  );
}

function RecentList({ title }) {
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const [hist] = useState(() => listHistory());
  return (
    <Panel kicker="On this device" title={title}>
      {!hist.length && <EmptyState message="Places you search for will appear here." />}
      <ul className="space-y-1">
        {hist.slice(0, 10).map((h) => (
          <li key={h.id + h.viewedAt}>
            <button type="button" onClick={() => openPlace(selectLocation, h)}
              className={cn("w-full truncate rounded-xl px-3 py-1.5 text-left text-sm text-muted hover:bg-surface-raised/70 hover:text-fg", ROW_BUTTON)}>
              {h.name}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function openPlace(selectLocation, f) {
  if (f.lat == null) return;
  selectLocation({ kind: f.kind ?? "CITY", id: String(f.id).split(":").slice(1).join(":") || f.id, name: f.name, lat: f.lat, lon: f.lon });
  useGlobeStore.getState().pauseOrbit();
  useGlobeStore.getState().focusPointOn(f.lat, f.lon);
}

export function PersonalPanel() {
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const authed = useAuthStore((s) => s.status === "AUTHENTICATED");
  const [saved, setSaved] = useState({ rows: null, error: false });
  const [removing, setRemoving] = useState(null);

  const refresh = useCallback(() => {
    setSaved({ rows: null, error: false });
    listSaved()
      .then((rows) => setSaved({ rows, error: false }))
      .catch((err) => {
        if (err?.status === 401) useAuthStore.getState().sessionExpired();
        setSaved({ rows: null, error: true });
      });
  }, []);
  useEffect(() => { if (authed) refresh(); }, [authed, refresh]);

  if (!authed) {
    return (
      <div className="space-y-3">
        <GuestGate />
        <RecentList title="Recent searches" />
      </div>
    );
  }

  const remove = async (f) => {
    if (!f.serverId) return;
    setRemoving(f.serverId);
    try {
      await removeSaved(f.serverId);
      setSaved((s) => ({ ...s, rows: (s.rows ?? []).filter((r) => r.serverId !== f.serverId) }));
      toast.success(`Removed ${f.name}.`);
    } catch {
      toast.error(`Couldn't remove ${f.name}. Please try again.`);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      <Panel kicker="Your account" title="Saved places">
        {!saved.rows && !saved.error && <SkeletonRows rows={3} label="Loading saved places" />}
        {saved.error && <ErrorState message="Your saved places couldn't be loaded." onRetry={refresh} />}
        {saved.rows?.length === 0 && <EmptyState message="Nothing saved yet — tap the heart on any place to keep it here." />}
        <ul className="space-y-1">
          {(saved.rows ?? []).map((f) => (
            <li key={f.serverId ?? f.id} className="flex items-center gap-1">
              <button type="button" onClick={() => openPlace(selectLocation, f)}
                className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-surface-raised/70", ROW_BUTTON)}>
                <span className="truncate font-medium">{f.name}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-label text-subtle">{f.kind}</span>
              </button>
              <button type="button" onClick={() => remove(f)} disabled={removing === f.serverId} aria-label={`Remove ${f.name}`}
                className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-surface-raised hover:text-fg disabled:opacity-40", ROW_BUTTON)}>
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <RecentList title="Recent searches" />
    </div>
  );
}

/**
 * Sign-in methods for the signed-in account: every method already linked can
 * be detached (as long as another remains — the server enforces that), and any
 * provider available on this deployment can be attached. Linking reuses the
 * same verified OAuth flow, so a provider is never attached twice and a
 * matching email never silently merges two accounts.
 */
function ConnectedAccounts() {
  const promptAuth = useAuthPrompt();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const [caps, setCaps] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (status !== "AUTHENTICATED") return;
    api.authProviders().then((res) => setCaps(res.data)).catch(() => setCaps({ oauth: [] }));
  }, [status]);

  if (status !== "AUTHENTICATED" || !user) {
    return (
      <Panel kicker="Account" title="Your account">
        <p className="text-sm text-muted">Sign in to save places, manage how you sign in and keep your preferences.</p>
        <button type="button" onClick={() => promptAuth()} className={cn(primaryButtonClass, "mt-3 w-full")}>
          Sign in
        </button>
      </Panel>
    );
  }

  const linked = user.providers ?? [];
  const connectable = (caps?.oauth ?? []).filter((p) => p.configured && !linked.includes(p.id));

  const unlink = async (id) => {
    setBusy(id);
    try {
      const res = await api.unlinkProvider(id);
      useAuthStore.getState().updateUser(res.data.user);
      toast.success(`${PROVIDER_LABEL[id] ?? id} removed.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, { provider: id }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel kicker="Account" title="Sign-in methods">
      <div className="mb-3 min-w-0">
        <p className="truncate text-sm font-medium">{user.name ?? "Meridian member"}</p>
        {user.email && (
          <p className="truncate text-xs text-subtle">
            {user.email}{user.emailIsPrivateRelay ? " · Apple private relay" : user.emailVerified ? "" : " · not yet confirmed"}
          </p>
        )}
      </div>
      <ul className="space-y-1.5">
        {linked.map((id) => (
          <li key={id} className="flex items-center gap-2 rounded-xl bg-surface-raised/50 py-1 pl-3 pr-1">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{PROVIDER_LABEL[id] ?? id}</span>
            <button
              type="button"
              onClick={() => unlink(id)}
              disabled={busy !== null || linked.length < 2}
              title={linked.length < 2 ? "Add another sign-in method before removing this one" : undefined}
              aria-label={`Remove ${PROVIDER_LABEL[id] ?? id} sign-in`}
              className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-subtle hover:bg-white/5 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent", ROW_BUTTON)}
            >
              {busy === id ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      {connectable.length > 0 && (
        <>
          <p className="mt-3 text-[11px] uppercase tracking-label text-subtle">Add another</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {connectable.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => window.location.assign(
                  `/api/auth/${p.id}?intent=link&returnTo=${encodeURIComponent("/app?m=settings")}`,
                )}
                className={quietButtonClass}
              >
                Connect {PROVIDER_LABEL[p.id] ?? p.label}
              </button>
            ))}
          </div>
        </>
      )}
      <PasswordSettings />
    </Panel>
  );
}

function PasswordSettings() {
  const user = useAuthStore((s) => s.user);
  const sessionMethod = useAuthStore((s) => s.sessionMethod);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;

  const has = Boolean(user.hasPassword);
  // Signed in by proving the mailbox: the forgotten password can be replaced
  // without typing the old one. The server applies the same rule.
  const recovering = has && sessionMethod === "email" && user.emailVerified;
  const needsCurrent = has && !recovering;
  const canSet = has || Boolean(user.email);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (next.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setPending(true);
    try {
      const res = await api.setPassword(needsCurrent ? current : undefined, next);
      useAuthStore.getState().updateUser(res.data.user);
      const others = res.data.signedOut ?? 0;
      toast.success(`${has ? "Password changed" : "Password set"}.${others > 0 ? " Other devices were signed out." : ""}`);
      setOpen(false);
      setCurrent("");
      setNext("");
    } catch (err) {
      if (err?.status === 401 && err?.code === "SESSION_REQUIRED") useAuthStore.getState().sessionExpired();
      setError(err?.code === "INVALID_CREDENTIALS" ? "Current password is incorrect." : apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Password</p>
          <p className="text-xs text-subtle">
            {has ? "Set" : canSet ? "Not set — add one to sign in with your email" : "Needs an email sign-in on this account first"}
          </p>
        </div>
        {canSet && !open && (
          <button type="button" onClick={() => setOpen(true)} className={cn(quietButtonClass, "shrink-0 px-2.5 py-1.5 text-xs")}>
            {has ? "Change" : "Set password"}
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} noValidate className="animate-enter mt-3 space-y-2">
          {/* Lets password managers file the new password under the right account. */}
          <input type="text" name="username" autoComplete="username" value={user.email ?? ""} readOnly hidden />
          {needsCurrent && (
            <label className="block text-xs text-muted">Current password
              <input type="password" name="current-password" autoComplete="current-password" value={current} disabled={pending}
                onChange={(e) => setCurrent(e.target.value)} className={cn(inputClass, "mt-1")} />
            </label>
          )}
          {recovering && (
            <p className="text-xs leading-relaxed text-subtle">You signed in with an email code, so you can choose a new password without the old one.</p>
          )}
          <label className="block text-xs text-muted">New password — at least 8 characters
            <input type="password" name="new-password" autoComplete="new-password" value={next} disabled={pending}
              onChange={(e) => setNext(e.target.value)} className={cn(inputClass, "mt-1")} />
          </label>
          {error && <p role="alert" className="text-xs text-fg/90">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { setOpen(false); setError(""); setCurrent(""); setNext(""); }} disabled={pending} className={cn(quietButtonClass, "flex-1")}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !next || (needsCurrent && !current)} className={cn(primaryButtonClass, "flex-1")}>
              {pending ? "Saving…" : has ? "Change password" : "Set password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SourceRow({ name, detail, state }) {
  // state: "live" | "limited" | "off"
  const tone = state === "live" ? "bg-accent" : state === "limited" ? "bg-accent/50" : "bg-muted/50";
  const label = state === "live" ? "Live" : state === "limited" ? "Limited coverage" : "Not connected";
  return (
    <li className="flex items-center gap-2.5 rounded-xl bg-surface-raised/50 px-3 py-2">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", tone)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-subtle">{detail}</span>
      </span>
      <span className="shrink-0 text-[10px] uppercase tracking-label text-subtle">{label}</span>
    </li>
  );
}

function DataSources() {
  const [state, setState] = useState({ data: null, error: false });
  const load = useCallback(() => {
    setState({ data: null, error: false });
    api.providers().then((res) => setState({ data: res.data, error: false })).catch(() => setState({ data: null, error: true }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const d = state.data;
  return (
    <Panel kicker="Settings" title="Data sources">
      {!d && !state.error && <SkeletonRows rows={4} label="Checking data sources" />}
      {state.error && <ErrorState message="Data source status couldn't be checked." onRetry={load} />}
      {d && (
        <>
          <ul className="space-y-1.5">
            <SourceRow name="Weather" detail="Open-Meteo forecast model" state="live" />
            <SourceRow name="Live air traffic" detail="OpenSky Network — strongest over Europe and North America"
              state={d.flights?.livePositions?.available ? "limited" : "off"} />
            <SourceRow name="Flight schedules" detail="Timetables and fares"
              state={d.flights?.scheduleSearch?.available ? "live" : "off"} />
            <SourceRow name="Flight status" detail="Delays, gates and arrivals"
              state={d.flights?.flightStatus?.available ? "live" : "off"} />
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-subtle">
            Meridian only shows what a source actually reports — a feature that isn&apos;t connected says so instead of filling in data.
          </p>
        </>
      )}
    </Panel>
  );
}

export function SettingsPanel() {
  const units = useMeridianStore((s) => s.units);
  const setUnits = useMeridianStore((s) => s.setUnits);
  return (
    <div className="space-y-3">
      <Panel kicker="Settings" title="Preferences">
        <p className="mb-1.5 text-xs text-muted" id="units-label">Units</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="units-label">
          {(["metric", "imperial"]).map((u) => (
            <button key={u} type="button" onClick={() => setUnits(u)} aria-pressed={units === u} className={segment(units === u)}>
              {u === "metric" ? "°C · km" : "°F · miles"}
            </button>
          ))}
        </div>
      </Panel>
      <ConnectedAccounts />
      <DataSources />
    </div>
  );
}
