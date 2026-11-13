// MERIDIAN authentication — sign in / create account.
//
// One decision at a time: provider buttons lead (Google / Microsoft / Apple),
// a divider, then the first-party methods (email code, password, phone) as a
// single segmented control, and guest access last.
//
// Nothing is faked. A method the server cannot perform is never offered as if
// it worked: in production it is left out; in development it is shown with the
// setup it is waiting for. After sign-in the person returns to where they were
// headed (`?returnTo=`), not to a fixed landing page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Lock, Mail, Phone, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/meridian/api-client.js";
import { authErrorMessage } from "@/lib/meridian/auth-messages.js";
import { safeReturnTo } from "@/lib/meridian/return-to.js";
import { useAuthStore } from "@/store/auth-store.js";
import { cn } from "@/lib/utils";
import { ProviderButtons, ProviderButtonsSkeleton } from "./provider-buttons.jsx";
import { EmailCodeForm, PasswordForm, PhoneCodeForm } from "./auth-forms.jsx";

// The three providers every visitor expects sit in a fixed order. Anything
// else (Amazon) appears only once it is actually configured.
const PROVIDER_ORDER = ["google", "apple", "microsoft", "amazon"];
const CORE_PROVIDERS = new Set(["google", "apple", "microsoft"]);

const METHODS = [
  { id: "password", label: "Password", Icon: KeyRound, cap: "password", needs: "Password sign-in is unavailable right now." },
  { id: "email", label: "Email code", Icon: Mail, cap: "emailOtp", needs: "Email codes need EMAIL_PROVIDER_KEY and EMAIL_FROM on the server." },
  { id: "phone", label: "Phone", Icon: Phone, cap: "phoneOtp", needs: "Text message codes need SMS_PROVIDER_KEY, SMS_PROVIDER_SECRET and SMS_VERIFY_SERVICE_SID (or SMS_FROM) on the server." },
];

function ObservatoryVisual() {
  return (
    <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex" aria-hidden>
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 40%, rgba(158,201,214,.10) 0%, transparent 62%)" }} />
      <div className="relative px-12 text-center">
        <p className="text-xs font-medium uppercase tracking-label text-muted">Observatory</p>
        <p className="font-display mt-3 text-7xl italic leading-none">Meridian</p>
        <p className="mx-auto mt-5 max-w-sm text-[15px] leading-relaxed text-muted">
          A living atlas of the world — places, weather, routes and flights, with a place for you.
        </p>
        <svg viewBox="0 0 320 320" className="mx-auto mt-10 block w-64 opacity-70" focusable="false">
          <circle cx="160" cy="170" r="88" fill="none" stroke="rgba(158,201,214,.45)" strokeWidth="1" />
          <ellipse cx="160" cy="170" rx="128" ry="52" fill="none" stroke="rgba(158,201,214,.32)" strokeWidth="1" transform="rotate(-16 160 170)" />
          <ellipse cx="160" cy="170" rx="128" ry="52" fill="none" stroke="rgba(158,201,214,.18)" strokeWidth="1" transform="rotate(24 160 170)" />
          <circle cx="112" cy="118" r="3.5" fill="#e9edf4" />
          <circle cx="222" cy="216" r="4.5" fill="#9ec9d6" opacity="0.9" />
        </svg>
      </div>
    </div>
  );
}

export function AuthPage() {
  const navigate = useNavigate();
  // Route search is SSR-consistent (unlike window.location), so server and
  // client render the same markup — no hydration mismatch.
  const search = getRouteApi("/auth").useSearch();
  const mode = search.mode === "signup" ? "signup" : "signin";
  const returnTo = useMemo(() => safeReturnTo(search.returnTo), [search.returnTo]);
  const status = useAuthStore((s) => s.status);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);

  const [caps, setCaps] = useState(null);
  const [capsLoading, setCapsLoading] = useState(true);
  const [picked, setPicked] = useState(null); // method the person chose; null → best available
  const [email, setEmail] = useState(""); // shared by the email-code and password forms
  const [oauthPending, setOauthPending] = useState(null); // provider id while redirecting

  const refreshCaps = useCallback(() => {
    setCapsLoading(true);
    api.authProviders()
      .then((res) => setCaps(res.data))
      .catch(() => setCaps({ oauth: [], unreachable: true }))
      .finally(() => setCapsLoading(false));
  }, []);

  useEffect(() => { refreshCaps(); }, [refreshCaps]);

  // Already signed in (or arriving back from a provider) → straight through.
  useEffect(() => {
    if (status === "AUTHENTICATED" || status === "GUEST") navigate({ to: returnTo, replace: true });
  }, [status, navigate, returnTo]);

  // Returning with the back button after starting a provider redirect restores
  // this page from the back/forward cache — release the "Connecting…" state.
  useEffect(() => {
    const onShow = (event) => { if (event.persisted) setOauthPending(null); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const diagnostics = caps?.diagnostics === true;
  const methodOk = (m) => caps?.[m.cap]?.configured === true;
  const methods = METHODS.filter((m) => diagnostics || methodOk(m));
  const tab = (picked && methods.some((m) => m.id === picked) ? picked : null)
    ?? methods.find(methodOk)?.id ?? methods[0]?.id ?? null;
  const active = methods.find((m) => m.id === tab) ?? null;
  const unavailable = active && !methodOk(active) ? active.needs : null;

  const providers = useMemo(() => (caps?.oauth ?? [])
    .filter((p) => p.configured || (caps?.diagnostics === true && CORE_PROVIDERS.has(p.id)))
    .sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id)), [caps]);

  // Search params that survive in-page navigation (dismiss, mode toggle).
  const keep = (extra = {}) => ({ ...(returnTo !== "/app" ? { returnTo } : {}), ...extra });

  const done = (data) => {
    setAuthenticated(data.user, data.method ?? null);
    if (data.claimed) {
      toast.success("Email confirmed. Sign-in methods added before it was confirmed were removed — set a new password in Settings.");
    } else if (data.reset) {
      toast.success("Password updated — welcome back.");
    } else if (data.verified) {
      toast.success("Email confirmed — welcome to Meridian.");
    } else {
      toast.success(data.created ? "Account created — welcome to Meridian." : "Welcome back.");
    }
    navigate({ to: returnTo, replace: true });
  };

  const guest = () => {
    continueAsGuest();
    navigate({ to: returnTo, replace: true });
  };

  const startOAuth = (id) => {
    // Full-page redirect to the provider; the server seals state + nonce +
    // returnTo in an HttpOnly cookie and the callback returns here afterwards.
    // The signup/signin tab travels along so a failed start lands on the same
    // tab instead of flipping to sign-in.
    setOauthPending(id);
    const qs = new URLSearchParams();
    if (returnTo !== "/app") qs.set("returnTo", returnTo);
    if (mode === "signup") qs.set("mode", "signup");
    const suffix = qs.toString() ? `?${qs}` : "";
    window.location.assign(`/api/auth/${id}${suffix}`);
  };

  const urlError = search.error
    ? authErrorMessage(search.error, { provider: search.oauthProvider, diagnostics })
    : "";
  const nothingAvailable = !capsLoading && providers.length === 0 && methods.length === 0;
  const formDisabled = oauthPending !== null;

  return (
    // Dark stage: observatory visual on the left, inset card on the right.
    // Below lg the visual hides and the card takes the full width.
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:flex-row">
      <ObservatoryVisual />

      <main className="flex flex-1 items-stretch justify-center p-3 sm:p-5 lg:max-w-[720px] lg:p-6">
        <div className="m-auto w-full max-w-xl overflow-y-auto rounded-[28px] border border-white/[0.06] bg-surface p-6 shadow-border sm:p-8 lg:max-h-[calc(100dvh-3rem)] lg:p-10">
          <button type="button" onClick={() => navigate({ to: "/" })}
            className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-1 text-sm text-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <ArrowLeft className="size-4" aria-hidden /> Back to Meridian
          </button>
          <p className="mt-6 text-xs font-medium uppercase tracking-label text-muted">
            {mode === "signup" ? "Create account" : "Enter Meridian"}
          </p>
          <h1 className="font-display mt-2 text-4xl italic leading-tight">
            {mode === "signup" ? "Join the observatory" : "Welcome back"}
          </h1>
          {returnTo !== "/app" && (
            <p className="mt-2 text-sm text-muted">Sign in to continue where you left off.</p>
          )}

          {urlError && (
            <div role="alert" className="animate-enter mt-4 flex items-start gap-2 rounded-xl bg-surface-raised/70 py-2.5 pl-3.5 pr-1.5 text-sm text-fg/90">
              <p className="min-w-0 flex-1 py-0.5">{urlError}</p>
              <button type="button" aria-label="Dismiss message"
                onClick={() => navigate({ to: "/auth", search: keep(mode === "signup" ? { mode: "signup" } : {}), replace: true })}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}

          <div role="group" aria-label="Account mode"
            className="mt-5 grid grid-cols-2 gap-1 rounded-full bg-white/[0.04] p-1">
            <button
              type="button"
              aria-pressed={mode === "signin"}
              onClick={() => navigate({ to: "/auth", search: keep(), replace: true })}
              className={cn(
                "h-9 rounded-full text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                mode === "signin" ? "bg-surface-raised text-fg shadow-border-hover" : "text-subtle hover:text-fg",
              )}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => navigate({ to: "/auth", search: keep({ mode: "signup" }), replace: true })}
              className={cn(
                "h-9 rounded-full text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                mode === "signup" ? "bg-surface-raised text-fg shadow-border-hover" : "text-subtle hover:text-fg",
              )}
            >
              Create account
            </button>
          </div>

          <div className="mt-6">
            {capsLoading && !caps ? (
              <>
                <ProviderButtonsSkeleton />
                <div className="skeleton mt-8 h-11 rounded-full" role="presentation" />
                <div className="skeleton mt-4 h-28 rounded-xl" role="presentation" />
              </>
            ) : (
              <>
                {providers.length > 0 && (
                  <section aria-label={mode === "signup" ? "Sign up with a provider" : "Continue with a provider"}>
                    <ProviderButtons
                      providers={providers}
                      mode={mode}
                      busy={oauthPending !== null}
                      pendingId={oauthPending}
                      onStart={startOAuth}
                      onRefresh={refreshCaps}
                    />
                    {providers.some((p) => p.configured) && (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-subtle">
                        <Lock className="size-3 shrink-0" aria-hidden /> Your password stays with the provider — Meridian never sees it.
                      </p>
                    )}
                  </section>
                )}

                {providers.length > 0 && methods.length > 0 && (
                  <div className="my-6 flex items-center gap-4" aria-hidden>
                    <span className="h-px flex-1 bg-white/10" />
                    <span className="text-[11px] uppercase tracking-label text-subtle">or</span>
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                )}

                {methods.length > 1 && (
                  <div role="tablist" aria-label="Sign-in method"
                    className="grid gap-1 rounded-full bg-white/[0.04] p-1"
                    style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }}>
                    {methods.map((m) => {
                      const selected = m.id === tab;
                      return (
                        <button
                          key={m.id} type="button" role="tab" id={`method-${m.id}`}
                          aria-selected={selected} aria-controls="method-panel"
                          onClick={() => setPicked(m.id)}
                          className={cn(
                            "flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full px-1.5 text-[12px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:gap-2 sm:px-2 sm:text-sm",
                            selected ? "bg-surface-raised font-medium text-fg shadow-border-hover" : "text-subtle hover:text-fg",
                          )}
                        >
                          <m.Icon className="size-3.5 shrink-0 sm:size-4" aria-hidden />
                          <span className="truncate">{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {active && (
                  // Keyed by method + mode: switching resets that form's own
                  // state and plays the short enter transition.
                  <div key={`${active.id}:${mode}`} id="method-panel" role="tabpanel"
                    aria-labelledby={methods.length > 1 ? `method-${active.id}` : undefined}
                    className={cn("animate-enter", methods.length > 1 && "mt-5")}>
                    {active.id === "email" && (
                      <EmailCodeForm mode={mode} email={email} onEmail={setEmail} disabled={formDisabled}
                        unavailable={unavailable} sandbox={caps?.emailOtp?.sandbox === true}
                        diagnostics={diagnostics} onDone={done} />
                    )}
                    {active.id === "password" && (
                      <PasswordForm mode={mode} email={email} onEmail={setEmail} disabled={formDisabled}
                        unavailable={unavailable} diagnostics={diagnostics}
                        canResetPassword={caps?.emailOtp?.configured === true} onDone={done} />
                    )}
                    {active.id === "phone" && (
                      <PhoneCodeForm mode={mode} disabled={formDisabled}
                        unavailable={unavailable} sandbox={caps?.phoneOtp?.sandbox === true}
                        diagnostics={diagnostics} onDone={done} />
                    )}
                  </div>
                )}

                {nothingAvailable && (
                  <p className="rounded-xl bg-surface-raised/70 px-3.5 py-3 text-sm leading-relaxed text-muted">
                    {caps?.unreachable
                      ? "We couldn't reach the sign-in service. Check your connection and try again."
                      : "Account sign-in isn't available right now. You can still explore as a guest."}
                    {caps?.unreachable && (
                      <button type="button" onClick={refreshCaps}
                        className="ml-1 rounded underline underline-offset-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        Retry
                      </button>
                    )}
                  </p>
                )}
              </>
            )}
          </div>

          <button type="button" onClick={guest} disabled={formDisabled}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-muted transition-colors duration-150 hover:border-white/20 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
            <UserRound className="size-4" aria-hidden /> Continue as guest
          </button>
          <p className="mt-4 text-center text-xs text-subtle">
            {mode === "signup" ? "Already have an account? " : "New to Meridian? "}
            <button
              type="button"
              onClick={() => navigate({ to: "/auth", search: keep(mode === "signup" ? {} : { mode: "signup" }) })}
              className="rounded underline underline-offset-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
