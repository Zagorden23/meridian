// MERIDIAN authentication — one identifier-first screen for sign in and
// account creation. Provider buttons lead (Google / Microsoft / Apple with
// real brand marks), then "or continue with email", phone as a secondary tab,
// guest last. Unconfigured providers render disabled with their missing-variable
// hint — OAuth is never faked.
//
// After sign-in the user returns to the pre-login destination (`?returnTo=`)
// instead of always landing on /app.
import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Lock, Mail, Phone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { useAuthStore } from "@/store/auth-store.js";
import { cn } from "@/lib/utils";

const ERROR_TEXT = {
  OTP_INVALID: "Incorrect code.",
  OTP_EXPIRED: "This code has expired. Request a new one.",
  OTP_LOCKED: "Too many incorrect attempts. Request a new code.",
  OTP_NOT_FOUND: "No active code. Request a new one first.",
  OTP_RESEND_COOLDOWN: "Please wait before requesting a new code.",
  RATE_LIMITED: "Too many attempts. Please wait and try again.",
  EMAIL_PROVIDER_UNCONFIGURED: "Email delivery is not configured on this server yet.",
  SMS_PROVIDER_UNCONFIGURED: "SMS delivery is not configured on this server yet.",
  EMAIL_SEND_FAILED: "The email could not be sent. Try again shortly.",
  SMS_SEND_FAILED: "The SMS could not be sent. Try again shortly.",
  MONGO_UNCONFIGURED: "Accounts need MongoDB (MONGODB_URI) on the server.",
  ACCOUNT_LINK_REQUIRED: "An account already exists with this email. Sign in with the existing method, then link this provider from your profile.",
  OAUTH_CANCELLED: "The provider sign-in was cancelled.",
  OAUTH_STATE_INVALID: "Sign-in request expired. Please try again.",
  OAUTH_PROVIDER_UNCONFIGURED: "This provider is not configured on the server.",
  OAUTH_EXCHANGE_FAILED: "The provider rejected the sign-in. Please try again.",
  OAUTH_VERIFY_FAILED: "The provider sign-in couldn't be completed. Please try again.",
  OAUTH_FAILED: "The provider sign-in couldn't be completed. Please try again.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PHONE: "Enter a valid phone number with country code.",
};

const OAUTH_ORDER = ["google", "microsoft", "apple", "amazon"];
const OAUTH_LABEL = { google: "Google", microsoft: "Microsoft", apple: "Apple", amazon: "Amazon" };
const COUNTRY_CODES = ["+91", "+1", "+44", "+61", "+65", "+971", "+81", "+49", "+33", "+34"];

// Only same-origin paths survive — an absolute or protocol-relative URL would
// turn sign-in into an open redirect.
function sanitizeReturnTo(value) {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  if (raw.includes("\\") || /[\r\n]/.test(raw)) return "/app";
  return raw.slice(0, 512);
}

function GoogleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function MicrosoftMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <rect x="2.5" y="2.5" width="9" height="9" fill="#F25022" />
      <rect x="12.5" y="2.5" width="9" height="9" fill="#7FBA00" />
      <rect x="2.5" y="12.5" width="9" height="9" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function AppleMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M16.36 12.76c0-2.3 1.88-3.4 1.97-3.46-1.08-1.57-2.75-1.79-3.34-1.81-1.42-.15-2.77.84-3.49.84-.72 0-1.83-.82-3.01-.8-1.55.02-2.97.9-3.77 2.28-1.61 2.8-.41 6.94 1.16 9.21.76 1.1 1.67 2.34 2.87 2.3 1.15-.05 1.58-.75 2.97-.75s1.78.75 3 .73c1.24-.02 2.02-1.12 2.78-2.23.87-1.28 1.23-2.51 1.25-2.57-.03-.01-2.4-.92-2.43-3.74zM14.16 4.06c.64-.77 1.07-1.85.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.77-.97 2.82 1.02.08 2.07-.52 2.71-1.28z" />
    </svg>
  );
}

function AmazonMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M20.05 16.62c-.65.96-3.74 1.76-5.35 1.85-.5.03-1.16.03-1.7-.1.54-.37 1.2-.83 1.63-1.4.24-.32.18-.66-.16-.92-1.04-.8-2.7-1.36-4.17-1.36-1.25 0-2.4.4-3.1.96-.3.24-.62.2-.78-.12-.34-.66-.2-1.5.32-2.06 1.03-1.1 2.9-1.72 4.7-1.72 1.5 0 3.05.42 4.04 1.14.42.3.86.2 1.02-.24l.55-1.58c.08-.24-.06-.5-.32-.58-1.2-.4-2.6-.6-4.06-.6-1.58 0-3.2.28-4.6.82-1.63.63-2.9 1.6-3.36 2.88-.2.56-.16 1.12.14 1.6.44.7 1.3 1.24 2.4 1.6-1 .5-1.7 1.2-1.76 1.94-.03.5.28.83.8.83l.24-.02c.5-.05 1.7-.6 2.6-1.34.86.6 2.06 1.12 3.67 1.3 1.95.22 4.5-.22 5.63-1.05.3-.22.45-.62.2-.9l-.4-.52z" />
    </svg>
  );
}

const OAUTH_MARKS = { google: GoogleMark, microsoft: MicrosoftMark, apple: AppleMark, amazon: AmazonMark };
const SIGNIN_TABS = [
  { id: "email", label: "Email", Icon: Mail },
  { id: "phone", label: "Phone", Icon: Phone },
];

function OtpBoxes({ value, onChange, disabled }) {
  const refs = useRef([]);
  const set = (i, ch) => {
    const next = value.split("");
    next[i] = ch.replace(/\D/g, "").slice(-1);
    onChange(next.join(""));
    if (ch && i < 5) refs.current[i + 1]?.focus();
  };
  return (
    <fieldset>
      <legend className="text-xs text-muted">Enter verification code</legend>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="Six digit code">
        {Array.from({ length: 6 }, (_, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={value[i] ?? ""}
            disabled={disabled}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus(); }}
            onPaste={(e) => {
              e.preventDefault();
              const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
              if (digits) {
                onChange(digits);
                refs.current[Math.min(digits.length, 5)]?.focus();
              }
            }}
            className="h-11 w-10 rounded-xl bg-surface-raised/70 text-center text-lg tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          />
        ))}
      </div>
    </fieldset>
  );
}

export function AuthPage() {
  const navigate = useNavigate();
  // Route search is SSR-consistent (unlike window.location), so server and
  // client render the same links — no hydration mismatch.
  const { mode: modeParam, error: errorParam, returnTo: returnToParam } = getRouteApi("/auth").useSearch();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const authError = useAuthStore((s) => s.authError);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  const status = useAuthStore((s) => s.status);

  const [tab, setTab] = useState("email"); // email|phone
  // Derived from route search (not useState) so the sign-in/create toggle
  // updates without a remount or reload.
  const mode = modeParam === "signup" ? "signup" : "signin";
  const [urlError, setUrlError] = useState(errorParam ?? null);
  const [caps, setCaps] = useState(null);
  const returnTo = useMemo(() => sanitizeReturnTo(returnToParam), [returnToParam]);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cc, setCc] = useState("+91");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(null); // provider id
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const busy = pending || oauthPending !== null;

  useEffect(() => {
    api.authProviders().then((res) => setCaps(res.data)).catch(() => setCaps({ oauth: [] }));
  }, []);

  useEffect(() => {
    if (status === "AUTHENTICATED" || status === "GUEST") navigate({ to: returnTo });
  }, [status, navigate, returnTo]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => {
    const msg = ERROR_TEXT[err?.code] ?? err?.message ?? "Something went wrong. Please try again.";
    setError(err?.code && ERROR_TEXT[err.code] && err.code === "OTP_INVALID" ? `${msg} ${err.message}` : msg);
  };

  const sendEmail = async () => {
    setPending(true); setError("");
    try {
      await api.requestEmailOtp(email);
      setSent(true); setCode(""); setCooldown(60);
      toast.success("Code sent — check your inbox.");
    } catch (err) { fail(err); } finally { setPending(false); }
  };

  const sendPhone = async () => {
    setPending(true); setError("");
    try {
      await api.requestPhoneOtp(phone, cc);
      setSent(true); setCode(""); setCooldown(60);
      toast.success("Code sent — check your messages.");
    } catch (err) { fail(err); } finally { setPending(false); }
  };

  const verify = async () => {
    setPending(true); setError("");
    try {
      const res = tab === "email"
        ? await api.verifyEmailOtp(email, code, mode === "signup" ? name : undefined)
        : await api.verifyPhoneOtp(phone, cc, code, mode === "signup" ? name : undefined);
      setAuthenticated(res.data.user);
      toast.success(mode === "signup" ? "Account created — welcome to Meridian." : "Welcome back.");
      navigate({ to: returnTo });
    } catch (err) {
      fail(err);
      if (["OTP_INVALID", "OTP_EXPIRED", "OTP_LOCKED", "OTP_NOT_FOUND"].includes(err?.code)) {
        authError(err.message);
        useAuthStore.setState({ status: useAuthStore.getState().user ? "AUTHENTICATED" : "UNAUTHENTICATED" });
      }
    } finally { setPending(false); }
  };

  const guest = () => {
    continueAsGuest();
    navigate({ to: returnTo });
  };

  const startOAuth = (id) => {
    // Full-page redirect to the provider; the server seals state+nonce+returnTo
    // in an HttpOnly cookie and the callback returns here afterwards.
    setOauthPending(id);
    const dest = returnTo && returnTo !== "/app"
      ? `/api/auth/${id}?returnTo=${encodeURIComponent(returnTo)}`
      : `/api/auth/${id}`;
    window.location.assign(dest);
  };

  const configured = useMemo(() => {
    const list = caps?.oauth ?? [];
    return [...list].sort((a, b) => OAUTH_ORDER.indexOf(a.id) - OAUTH_ORDER.indexOf(b.id));
  }, [caps]);
  const emailOk = caps?.emailOtp?.configured ?? true;
  const phoneOk = caps?.phoneOtp?.configured ?? true;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg md:flex-row">
      {/* Left observatory visual */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden md:flex" aria-hidden>
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 42%, rgba(158,201,214,.12) 0%, transparent 60%)" }} />
        <div className="relative text-center">
          <p className="text-xs font-medium uppercase tracking-label text-muted">Observatory</p>
          <p className="font-display mt-2 text-6xl italic">Meridian</p>
          <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted">
            A quiet globe of places that hold the light — now with a place for you.
          </p>
          <svg viewBox="0 0 300 300" className="mx-auto mt-8 w-56 opacity-80">
            <circle cx="150" cy="150" r="86" fill="none" stroke="rgba(158,201,214,.4)" strokeWidth="1" />
            <ellipse cx="150" cy="150" rx="118" ry="44" fill="none" stroke="rgba(158,201,214,.3)" strokeWidth="1" transform="rotate(-18 150 150)" />
            <circle cx="104" cy="104" r="3" fill="#e9edf4" />
            <circle cx="212" cy="182" r="4" fill="#9ec9d6" />
          </svg>
        </div>
      </div>

      {/* Right card */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md rounded-3xl bg-surface/85 p-6 shadow-border backdrop-blur-md md:p-8">
          <button type="button" onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-1.5 rounded-lg text-xs text-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <ArrowLeft className="size-3.5" aria-hidden /> Back to Meridian
          </button>
          <p className="mt-4 text-xs font-medium uppercase tracking-label text-muted">
            {mode === "signup" ? "Create account" : "Enter Meridian"}
          </p>
          <h1 className="font-display mt-1 text-3xl italic">
            {mode === "signup" ? "Join the observatory" : "Welcome back"}
          </h1>

          {(urlError || error) && (
            <p role="alert" className="mt-3 rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-muted">
              {ERROR_TEXT[urlError] ?? error}
            </p>
          )}
          {urlError && (
            <button type="button" onClick={() => { setUrlError(null); setError(""); }} className="mt-1 rounded text-xs text-subtle hover:text-fg">
              Dismiss
            </button>
          )}

          {/* Primary: provider sign-in comes first, one calm row each. */}
          <div className="mt-5" role="group" aria-label="Continue with a provider">
            <ul className="space-y-2">
              {configured.map((p) => {
                const Mark = OAUTH_MARKS[p.id];
                const waiting = oauthPending === p.id;
                if (!p.configured) {
                  return (
                    <li key={p.id}>
                      <span
                        title={`Not configured on this server: ${(p.missing ?? []).join(", ")}`}
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center gap-3 rounded-xl bg-surface-raised/40 px-4 py-2.5 text-sm text-subtle"
                      >
                        {Mark && <Mark className="size-[18px] shrink-0 opacity-50" />}
                        <span className="flex-1">Continue with {OAUTH_LABEL[p.id] ?? p.id}</span>
                        <span className="text-[11px] uppercase tracking-label">setup needed</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => startOAuth(p.id)}
                      disabled={busy}
                      aria-label={`Continue with ${OAUTH_LABEL[p.id] ?? p.id}`}
                      className="flex w-full items-center gap-3 rounded-xl bg-surface-raised/70 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      {waiting
                        ? <Loader2 className="size-[18px] shrink-0 animate-spin" aria-hidden />
                        : Mark && <Mark className="size-[18px] shrink-0" />}
                      <span className="flex-1 text-left">
                        {waiting ? `Connecting to ${OAUTH_LABEL[p.id] ?? p.id}…` : `Continue with ${OAUTH_LABEL[p.id] ?? p.id}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
              <Lock className="size-3" aria-hidden /> Secure sign-in — credentials stay with the provider.
            </p>
          </div>

          <div className="my-4 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] uppercase tracking-label text-subtle">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-1.5" role="tablist" aria-label="Sign-in methods">
            {SIGNIN_TABS.map((t) => {
              const TabIcon = t.Icon;
              return (
                <button
                  key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => { setTab(t.id); setSent(false); setCode(""); setError(""); }}
                  className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent", tab === t.id ? "bg-surface-raised text-fg" : "text-subtle hover:text-fg")}>
                  <TabIcon className="size-4" aria-hidden /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === "email" && (
            <div className="mt-4 space-y-3">
              {!emailOk && <p className="text-xs text-subtle">Email codes need EMAIL_PROVIDER_KEY + EMAIL_FROM on the server.</p>}
              <label className="block text-xs text-muted">Email address
                <input type="email" autoComplete="email" value={email} disabled={sent || busy} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && !sent && sendEmail()}
                  className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
              </label>
              {mode === "signup" && (
                <label className="block text-xs text-muted">Display name <span className="text-subtle">(optional)</span>
                  <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Ada"
                    className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
                </label>
              )}
              {!sent ? (
                <button type="button" onClick={sendEmail} disabled={pending || !emailOk}
                  className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold uppercase tracking-label text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40">
                  {pending ? "Sending…" : "Continue with Email"}
                </button>
              ) : (
                <>
                  <OtpBoxes value={code} onChange={setCode} disabled={pending} />
                  <p className="text-[11px] text-subtle">Code expires in 5 minutes.</p>
                  <button type="button" onClick={verify} disabled={pending || code.length !== 6}
                    className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold uppercase tracking-label text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40">
                    {pending ? "Verifying…" : mode === "signup" ? "Verify & create account" : "Verify & sign in"}
                  </button>
                  <button type="button" onClick={sendEmail} disabled={pending || cooldown > 0}
                    className="w-full rounded text-xs text-subtle hover:text-fg disabled:opacity-40">
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "phone" && (
            <div className="mt-4 space-y-3">
              {!phoneOk && <p className="text-xs text-subtle">SMS codes need SMS_PROVIDER_KEY + SMS_PROVIDER_SECRET + SMS_FROM on the server.</p>}
              <div className="flex gap-2">
                <label className="block w-24 shrink-0 text-xs text-muted">Code
                  <select value={cc} disabled={sent || busy} onChange={(e) => setCc(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-surface-raised/70 px-2 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
                    {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block min-w-0 flex-1 text-xs text-muted">Phone number
                  <input type="tel" autoComplete="tel" value={phone} disabled={sent || busy} onChange={(e) => setPhone(e.target.value)}
                    placeholder="98765 43210" onKeyDown={(e) => e.key === "Enter" && !sent && sendPhone()}
                    className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
                </label>
              </div>
              {mode === "signup" && (
                <label className="block text-xs text-muted">Display name <span className="text-subtle">(optional)</span>
                  <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Ada"
                    className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
                </label>
              )}
              {!sent ? (
                <button type="button" onClick={sendPhone} disabled={pending || !phoneOk}
                  className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold uppercase tracking-label text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40">
                  {pending ? "Sending…" : "Continue with Phone"}
                </button>
              ) : (
                <>
                  <OtpBoxes value={code} onChange={setCode} disabled={pending} />
                  <p className="text-[11px] text-subtle">Code expires in 5 minutes.</p>
                  <button type="button" onClick={verify} disabled={pending || code.length !== 6}
                    className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold uppercase tracking-label text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40">
                    {pending ? "Verifying…" : mode === "signup" ? "Verify & create account" : "Verify & sign in"}
                  </button>
                  <button type="button" onClick={sendPhone} disabled={pending || cooldown > 0}
                    className="w-full rounded text-xs text-subtle hover:text-fg disabled:opacity-40">
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </>
              )}
            </div>
          )}

          <button type="button" onClick={guest} disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            <UserRound className="size-4" aria-hidden /> Continue as guest
          </button>
          <p className="mt-3 text-center text-[11px] text-subtle">
            {mode === "signup" ? "Have an account? " : "New to Meridian? "}
            <button
              type="button"
              onClick={() => navigate({
                to: "/auth",
                search: {
                  ...(mode === "signup" ? {} : { mode: "signup" }),
                  ...(returnTo !== "/app" ? { returnTo } : {}),
                },
              })}
              className="rounded underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
