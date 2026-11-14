// "Continue with …" rows. A configured provider is a live button; one that is
// still waiting for credentials is still listed but never faked — it expands
// to say it isn't switched on yet (production) or to a setup guide
// (development).
import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PROVIDER_LABEL } from "@/lib/meridian/auth-messages.js";
import { cn } from "@/lib/utils";
import { PROVIDER_MARKS } from "./provider-marks.jsx";

// Where each provider's credentials come from. Callback URLs are derived from
// the current origin at render time — register exactly that URL.
const SETUP = {
  google: {
    console: "Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)",
    steps: [
      "Create an OAuth client ID (type: Web application).",
      "Add the callback URL below under Authorized redirect URIs.",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server, then restart.",
    ],
  },
  microsoft: {
    console: "Microsoft Entra admin center → App registrations → New registration",
    steps: [
      "Register an app (Web platform) with the callback URL below as a redirect URI.",
      "Create a client secret under Certificates & secrets.",
      "Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET (MICROSOFT_TENANT_ID is optional, default “common”), then restart.",
    ],
  },
  apple: {
    console: "Apple Developer → Certificates, Identifiers & Profiles → Services ID + Key",
    steps: [
      "Create a Services ID (this is APPLE_CLIENT_ID) with Sign in with Apple enabled, and add the callback URL below as a Return URL.",
      "Create a Sign in with Apple key; note its Key ID and your Team ID, and download the .p8 file.",
      "Set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY, then restart. Apple requires an HTTPS domain — it cannot be tested on localhost.",
    ],
  },
  amazon: {
    console: "Amazon Developer Console → Login with Amazon → Security profile",
    steps: [
      "Create a security profile and add the callback URL below under Allowed Return URLs.",
      "Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET on the server, then restart.",
    ],
  },
};

const ROW = "flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function callbackUrlFor(id) {
  if (typeof window === "undefined") return `/api/auth/${id}/callback`;
  return `${window.location.origin}/api/auth/${id}/callback`;
}

function SetupGuide({ provider, onRefresh }) {
  const setup = SETUP[provider.id];
  const callbackUrl = callbackUrlFor(provider.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      toast.success("Callback URL copied.");
    } catch {
      toast.error("Couldn't copy — select the URL and copy it manually.");
    }
  };
  return (
    <div id={`setup-${provider.id}`} className="border-t border-border/60 px-4 pb-4 pt-3 text-[12px] leading-relaxed text-muted">
      {setup && (
        <>
          <p>{setup.console}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            {setup.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </>
      )}
      {provider.missing?.length > 0 && (
        <p className="mt-3">
          Not set on the server: <span className="font-mono text-fg">{provider.missing.join(", ")}</span>
        </p>
      )}
      <p className="mt-3">Callback URL</p>
      <p className="mt-1 break-all rounded-lg bg-bg/60 px-2.5 py-2 font-mono text-fg">{callbackUrl}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy}
          className="rounded-lg border border-border px-3 py-1.5 text-fg/90 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Copy URL
        </button>
        <button type="button" onClick={onRefresh}
          className="rounded-lg border border-border px-3 py-1.5 text-fg/90 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Check again
        </button>
      </div>
    </div>
  );
}

export function ProviderButtonsSkeleton({ rows = 3 }) {
  return (
    <ul className="space-y-2.5" role="status" aria-label="Loading sign-in options">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="skeleton h-12 rounded-2xl" />
      ))}
    </ul>
  );
}

function NotEnabledNote({ provider, label }) {
  return (
    <p id={`setup-${provider.id}`} className="border-t border-border/60 px-4 pb-4 pt-3 text-[12px] leading-relaxed text-muted">
      {label} sign-in isn&rsquo;t switched on for Meridian yet. Use a password, an email code or your phone below — or continue as a guest.
    </p>
  );
}

export function ProviderButtons({ providers, mode = "signin", busy, pendingId, onStart, onRefresh, diagnostics = false }) {
  const [openSetup, setOpenSetup] = useState(null);
  const action = mode === "signup" ? "Sign up with" : "Continue with";
  return (
    <ul className="space-y-2.5">
      {providers.map((p) => {
        const Mark = PROVIDER_MARKS[p.id];
        const label = PROVIDER_LABEL[p.id] ?? p.label ?? p.id;
        if (!p.configured) {
          // Always listed, never faked: opening it explains why it can't be
          // used yet (and, in development, exactly what to set up).
          const open = openSetup === p.id;
          return (
            <li key={p.id} className="rounded-2xl bg-white/[0.03] shadow-border">
              <button
                type="button"
                onClick={() => setOpenSetup(open ? null : p.id)}
                aria-expanded={open}
                aria-controls={`setup-${p.id}`}
                className={cn(ROW, "text-fg/75 hover:text-fg")}
              >
                {Mark && <Mark className="size-5 shrink-0 opacity-70" />}
                <span className="min-w-0 flex-1 truncate">{action} {label}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-label text-subtle">
                  {diagnostics ? (
                    <><span className="sm:hidden">Setup</span><span className="hidden sm:inline">Setup needed</span></>
                  ) : (
                    <><span className="sm:hidden">Off</span><span className="hidden sm:inline">Not enabled</span></>
                  )}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform duration-200", open && "rotate-180")} aria-hidden />
              </button>
              {open && (diagnostics
                ? <SetupGuide provider={p} onRefresh={onRefresh} />
                : <NotEnabledNote provider={p} label={label} />)}
            </li>
          );
        }
        const waiting = pendingId === p.id;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onStart(p.id)}
              disabled={busy}
              aria-busy={waiting}
              className={cn(ROW, "bg-white/[0.05] font-medium text-fg shadow-border hover:bg-white/[0.09] active:bg-white/[0.07] disabled:opacity-50")}
            >
              {waiting
                ? <Loader2 className="size-5 shrink-0 animate-spin text-muted" aria-hidden />
                : Mark && <Mark className="size-5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">
                {waiting ? `Connecting to ${label}…` : `${action} ${label}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
