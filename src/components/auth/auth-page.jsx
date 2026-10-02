// MERIDIAN authentication — commercial sign in / sign up.
// Provider buttons lead (Google / Microsoft / Apple / Amazon with real brand
// marks), then email+password (works with only MongoDB — the always-available
// credential), then email/phone codes, guest last. Unconfigured providers
// render disabled with their missing-variable hint — OAuth is never faked.
//
// After sign-in the user returns to the pre-login destination (`?returnTo=`)
// instead of always landing on /app.
import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Mail, Phone, KeyRound, UserRound } from "lucide-react";
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
  EMAIL_PROVIDER_UNCONFIGURED: "Email delivery is not configured on this server yet. Use a password instead.",
  SMS_PROVIDER_UNCONFIGURED: "SMS delivery is not configured on this server yet. Use a password instead.",
  EMAIL_SEND_FAILED: "The email could not be sent. Try again shortly.",
  SMS_SEND_FAILED: "The SMS could not be sent. Try again shortly.",
  MONGO_UNCONFIGURED: "Accounts need MongoDB (MONGODB_URI) on the server.",
  ACCOUNT_LINK_REQUIRED: "An account already exists with this email. Sign in with the existing method, then link this provider from your profile.",
  ACCOUNT_LINK_CONFLICT: "This provider is already linked to another account. Sign in with it directly instead.",
  EMAIL_TAKEN: "An account with this email already exists. Sign in instead.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  WEAK_PASSWORD: "Use a password with at least 8 characters.",
  PASSWORD_REQUIRED: "Enter your password.",
  OAUTH_CANCELLED: "The provider sign-in was cancelled.",
  OAUTH_STATE_INVALID: "Sign-in request expired. Please try again.",
  OAUTH_PROVIDER_UNCONFIGURED: "This provider is not configured on the server yet. See setup steps below — or use password sign-in for now.",
  OAUTH_EXCHANGE_FAILED: "The provider rejected the sign-in. Check that the callback URL is registered in the provider console, then try again.",
  OAUTH_VERIFY_FAILED: "The provider sign-in couldn't be completed. Please try again.",
  OAUTH_FAILED: "The provider sign-in couldn't be completed. Please try again.",
  OAUTH_START_FAILED: "This provider couldn't start signing in. Check server setup, then try again.",
  UNKNOWN_PROVIDER: "Unknown sign-in provider.",
  SESSION_SECRET_MISSING: "Server session secret is missing. Set SESSION_SECRET (32+ chars) and restart.",
  ACCOUNT_DISABLED: "This account is disabled.",
  SESSION_REQUIRED: "Sign in first, then link this provider.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PHONE: "Enter a valid phone number with country code.",
};

// Per-provider setup guidance shown when the server reports the provider as
// unconfigured. Callback URLs are derived from the current origin at render
// time — register exactly that URL in the provider console.
const OAUTH_SETUP = {
  google: {
    console: "Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)",
    vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    steps: [
      "Create an OAuth client ID (type: Web application).",
      "Add the callback URL below under Authorized redirect URIs.",
      "Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET on the server and restart.",
    ],
  },
  microsoft: {
    console: "Microsoft Entra admin center → App registrations → New registration",
    vars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    steps: [
      "Register an app (Web platform), add the callback URL below as a redirect URI.",
      "Create a client secret under Certificates & secrets.",
      "Set MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET (+ optional MICROSOFT_TENANT_ID, default common) and restart.",
    ],
  },
  apple: {
    console: "Apple Developer → Certificates, Identifiers & Profiles → Services ID + Key",
    vars: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
    steps: [
      "Create a Services ID (this is APPLE_CLIENT_ID) with Sign in with Apple enabled.",
      "Create a Sign in with Apple key (note Key ID + Team ID), download the .p8 private key.",
      "Set APPLE_CLIENT_ID + APPLE_TEAM_ID + APPLE_KEY_ID + APPLE_PRIVATE_KEY and restart.",
    ],
  },
  amazon: {
    console: "Amazon Developer Console → Login with Amazon → Create security profile",
    vars: ["AMAZON_CLIENT_ID", "AMAZON_CLIENT_SECRET"],
    steps: [
      "Create a security profile, add the callback URL below under Allowed return URLs.",
      "Set AMAZON_CLIENT_ID + AMAZON_CLIENT_SECRET on the server and restart.",
    ],
  },
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
  { id: "password", label: "Password", Icon: KeyRound },
  { id: "email", label: "Email code", Icon: Mail },
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

  const [tab, setTab] = useState("email"); // password|email|phone — reference shows Email code active
  // Derived from route search (not useState) so the sign-in/create toggle
  // updates without a remount or reload.
  const mode = modeParam === "signup" ? "signup" : "signin";
  const [urlError, setUrlError] = useState(errorParam ?? null);
  const [caps, setCaps] = useState(null);
  const returnTo = useMemo(() => sanitizeReturnTo(returnToParam), [returnToParam]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [cc, setCc] = useState("+91");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(null); // provider id
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [setupOpen, setSetupOpen] = useState(null); // provider id with setup help expanded
  const [capsLoading, setCapsLoading] = useState(true);
  const busy = pending || oauthPending !== null;

  const refreshCaps = () => {
    setCapsLoading(true);
    api.authProviders()
      .then((res) => setCaps(res.data))
      .catch(() => setCaps({ oauth: [] }))
      .finally(() => setCapsLoading(false));
  };

  useEffect(() => {
    refreshCaps();
  }, []);

  useEffect(() => {
    if (status === "AUTHENTICATED" || status === "GUEST") navigate({ to: returnTo });
  }, [status, navigate, returnTo]);

  // Keep the displayed error in sync when arriving from an OAuth redirect.
  useEffect(() => { setUrlError(errorParam ?? null); }, [errorParam]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (err) => {
    const base = ERROR_TEXT[err?.code] ?? err?.message ?? "Something went wrong. Please try again.";
    // OTP_INVALID carries remaining-attempt detail in err.message — keep it.
    setError(err?.code === "OTP_INVALID" && err?.message !== base ? `${base} ${err.message}` : base);
  };

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? "").trim());

  const submitPassword = async () => {
    setError("");
    if (!validEmail(email)) {
      setError(ERROR_TEXT.INVALID_EMAIL);
      return;
    }
    if (mode === "signup" && String(password ?? "").length < 8) {
      setError(ERROR_TEXT.WEAK_PASSWORD);
      return;
    }
    if (mode === "signin" && !password) {
      setError(ERROR_TEXT.PASSWORD_REQUIRED);
      return;
    }
    setPending(true);
    try {
      const res = mode === "signup"
        ? await api.signupPassword(email.trim(), password, name.trim() || undefined)
        : await api.signinPassword(email.trim(), password);
      setAuthenticated(res.data.user);
      toast.success(mode === "signup" ? "Account created — welcome to Meridian." : "Welcome back.");
      navigate({ to: returnTo });
    } catch (err) { fail(err); } finally { setPending(false); }
  };

  const sendEmail = async () => {
    setError("");
    if (!validEmail(email)) {
      setError(ERROR_TEXT.INVALID_EMAIL);
      return;
    }
    setPending(true);
    try {
      await api.requestEmailOtp(email.trim());
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
      // Show the failure inline; keep the session state untouched so the
      // user can retry the code without being bounced.
      fail(err);
      void authError;
    } finally { setPending(false); }
  };

  const guest = () => {
    continueAsGuest();
    navigate({ to: returnTo });
  };

  const startOAuth = (id) => {
    // Full-page redirect to the provider; the server seals state+nonce+returnTo
    // in an HttpOnly cookie and the callback returns here afterwards. The
    // signup/signin tab (mode) travels as a query param so a start failure
    // can land back on the same tab instead of flipping to sign-in.
    setOauthPending(id);
    const qs = new URLSearchParams();
    if (returnTo && returnTo !== "/app") qs.set("returnTo", returnTo);
    if (mode === "signup") qs.set("mode", "signup");
    const suffix = qs.toString() ? `?${qs}` : "";
    window.location.assign(`/api/auth/${id}${suffix}`);
  };

  const callbackUrlFor = (id) => {
    try {
      return `${window.location.origin}/api/auth/${id}/callback`;
    } catch {
      return `/api/auth/${id}/callback`;
    }
  };

  const configured = useMemo(() => {
    const list = caps?.oauth ?? [];
    return [...list].sort((a, b) => OAUTH_ORDER.indexOf(a.id) - OAUTH_ORDER.indexOf(b.id));
  }, [caps]);
  const passwordOk = caps?.password?.configured ?? caps?.mongo?.configured ?? true;
  const emailOk = caps?.emailOtp?.configured ?? true;
  const phoneOk = caps?.phoneOtp?.configured ?? true;

  return (
    // Reference layout: dark stage, left observatory visual + right inset card.
    // Below lg the visual hides and the card takes the full width.
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:flex-row">
      {/* Left observatory visual — matches reference orbit illustration */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex" aria-hidden>
        <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 40%, rgba(158,201,214,.10) 0%, transparent 62%)" }} />
        <div className="relative px-12 text-center">
          <p className="text-xs font-medium uppercase tracking-label text-muted">Observatory</p>
          <p className="font-display mt-3 text-7xl italic leading-none">Meridian</p>
          <p className="mx-auto mt-5 max-w-sm text-[15px] leading-relaxed text-muted">
            A quiet globe of places that hold the light — now
            <br />
            with a place for you.
          </p>
          <svg viewBox="0 0 320 320" className="mx-auto mt-10 block w-64 opacity-70" aria-hidden focusable="false">
            <circle cx="160" cy="170" r="88" fill="none" stroke="rgba(158,201,214,.45)" strokeWidth="1" />
            <ellipse cx="160" cy="170" rx="128" ry="52" fill="none" stroke="rgba(158,201,214,.32)" strokeWidth="1" transform="rotate(-16 160 170)" />
            <ellipse cx="160" cy="170" rx="128" ry="52" fill="none" stroke="rgba(158,201,214,.18)" strokeWidth="1" transform="rotate(24 160 170)" />
            <circle cx="112" cy="118" r="3.5" fill="#e9edf4" />
            <circle cx="222" cy="216" r="4.5" fill="#9ec9d6" opacity="0.9" />
          </svg>
        </div>
      </div>

      {/* Right inset card — rounded panel with breathing room, scrolls safely on short screens */}
      <div className="flex flex-1 items-stretch justify-center p-3 sm:p-5 lg:max-w-[720px] lg:p-6">
        <div className="m-auto max-h-none w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/[0.06] bg-surface p-6 shadow-border backdrop-blur-md sm:p-8 lg:max-h-[calc(100dvh-3rem)] lg:p-10">
          <button type="button" onClick={() => navigate({ to: "/" })}
            className="flex items-center gap-2 rounded-lg text-sm text-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <ArrowLeft className="size-4" aria-hidden /> Back to Meridian
          </button>
          <p className="mt-6 text-xs font-medium uppercase tracking-label text-muted">
            {mode === "signup" ? "Create account" : "Enter Meridian"}
          </p>
          <h1 className="font-display mt-2 text-4xl italic leading-tight">
            {mode === "signup" ? "Join the observatory" : "Welcome back"}
          </h1>

          {(urlError || error) && (
            <p role="alert" className="mt-3 rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-muted">
              {urlError ? (ERROR_TEXT[urlError] ?? `Sign-in failed (${urlError}). Please try again.`) : error}
            </p>
          )}
          {urlError && (
            <button type="button" onClick={() => { setUrlError(null); setError(""); }} className="mt-1 rounded text-xs text-subtle hover:text-fg">
              Dismiss
            </button>
          )}

          {/* Primary: provider sign-in comes first, one calm row each. */}
          <div className="mt-7" role="group" aria-label="Continue with a provider">
            {capsLoading ? (
              <ul className="space-y-2.5" aria-label="Loading sign-in providers">
                {OAUTH_ORDER.map((id) => (
                  <li key={id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5">
                    <span className="size-5 shrink-0 animate-pulse rounded-full bg-border" aria-hidden />
                    <span className="h-4 flex-1 animate-pulse rounded bg-border/70" aria-hidden />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-2.5">
                {configured.map((p) => {
                  const Mark = OAUTH_MARKS[p.id];
                  const waiting = oauthPending === p.id;
                  if (!p.configured) {
                    const open = setupOpen === p.id;
                    const setup = OAUTH_SETUP[p.id];
                    const callbackUrl = callbackUrlFor(p.id);
                    return (
                      <li key={p.id} className="rounded-2xl bg-white/[0.03]">
                        <button
                          type="button"
                          onClick={() => setSetupOpen(open ? null : p.id)}
                          aria-expanded={open}
                          aria-label={`Continue with ${OAUTH_LABEL[p.id] ?? p.id} — setup needed. Show setup steps.`}
                          className="flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 text-[15px] text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {Mark && <Mark className="size-5 shrink-0 opacity-60" />}
                          <span className="flex-1 text-left">Continue with {OAUTH_LABEL[p.id] ?? p.id}</span>
                          <span className="text-[11px] uppercase tracking-label text-subtle">{open ? "hide setup" : "setup needed"}</span>
                        </button>
                        {open && (
                          <div className="border-t border-border/60 px-4 py-3 text-left">
                            <p className="text-xs font-medium">To enable {OAUTH_LABEL[p.id] ?? p.id} sign-in:</p>
                            {setup && (
                              <>
                                <p className="mt-1.5 text-[11px] text-muted">{setup.console}</p>
                                <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
                                  {setup.steps.map((s, i) => <li key={i}>{s}</li>)}
                                </ol>
                              </>
                            )}
                            <p className="mt-2 text-[11px] text-muted">Missing on server:</p>
                            <p className="mt-0.5 font-mono text-[11px] text-fg">{(p.missing ?? []).join(", ") || "unknown"}</p>
                            <p className="mt-2 text-[11px] text-muted">Register this callback URL:</p>
                            <p className="mt-0.5 break-all rounded-lg bg-bg/60 px-2 py-1.5 font-mono text-[11px] text-fg">{callbackUrl}</p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => { try { navigator.clipboard?.writeText(callbackUrl); toast.success("Callback URL copied."); } catch { /* clipboard unavailable */ } }}
                                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                Copy URL
                              </button>
                              <button
                                type="button"
                                onClick={refreshCaps}
                                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                I've configured it — retry
                              </button>
                            </div>
                            <p className="mt-2 text-[11px] text-subtle">
                              Password sign-in below works right now (no provider setup needed).
                            </p>
                          </div>
                        )}
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
            )}
            {!capsLoading && configured.length > 0 && configured.every((p) => !p.configured) && (
              <p className="mt-2 text-[11px] leading-relaxed text-subtle">
                Social sign-in needs server setup (expand a provider above). Password sign-in below works now.
              </p>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
              <Lock className="size-3" aria-hidden /> Secure sign-in — credentials stay with the provider.
            </p>
          </div>

          <div className="my-6 flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] uppercase tracking-label text-subtle">or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2" role="tablist" aria-label="Sign-in methods">
            {SIGNIN_TABS.map((t) => {
              const TabIcon = t.Icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id} role="tab" aria-selected={active} type="button" onClick={() => { setTab(t.id); setSent(false); setCode(""); setError(""); }}
                  className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-5 sm:text-[15px]", active ? "bg-white/[0.07] font-medium text-fg" : "text-subtle hover:text-fg")}>
                  <TabIcon className="size-4 shrink-0 sm:size-[18px]" aria-hidden /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === "password" && (
            <div className="mt-4 space-y-3">
              {!passwordOk && <p className="text-xs text-subtle">Password sign-in needs MONGODB_URI on the server.</p>}
              <label className="block text-xs text-muted">Email address
                <input type="email" autoComplete="email" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                  className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
              </label>
              <label className="block text-xs text-muted">Password {mode === "signup" && <span className="text-subtle">(min 8 characters)</span>}
                <span className="relative mt-1 block">
                  <input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Choose a password" : "Your password"}
                    onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                    className="w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 pr-10 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg">
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </span>
              </label>
              {mode === "signup" && (
                <label className="block text-xs text-muted">Display name <span className="text-subtle">(optional)</span>
                  <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="Ada"
                    onKeyDown={(e) => e.key === "Enter" && submitPassword()}
                    className="mt-1 w-full rounded-xl bg-surface-raised/70 px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" />
                </label>
              )}
              <button type="button" onClick={submitPassword} disabled={pending || !passwordOk}
                className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold uppercase tracking-label text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40">
                {pending ? (mode === "signup" ? "Creating…" : "Signing in…") : mode === "signup" ? "Create account" : "Sign in"}
              </button>
              <p className="text-[11px] text-subtle">
                {mode === "signup" ? "Passwords are hashed with scrypt and never stored in plain text." : "Forgot your password? Create a new account with email codes if enabled, or continue as guest."}
              </p>
            </div>
          )}

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
