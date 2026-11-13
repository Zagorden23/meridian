import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { MeridianUI } from "@/components/meridian/meridian-ui";
import { authErrorMessage, PROVIDER_LABEL } from "@/lib/meridian/auth-messages.js";
import { canUseApp, useAuthStore } from "@/store/auth-store.js";
import { MODULE_IDS, useMeridianStore } from "@/store/meridian-store.js";

const OAUTH_IDS = ["google", "microsoft", "apple", "amazon"];

export const Route = createFileRoute("/app")({
  // `?m=` is the section (explore|travel|…): deep links, refresh and
  // back/forward work, while the globe canvas itself never remounts.
  // `?authError=` arrives when linking a provider from Settings fails — it is
  // shown once as a toast and removed from the address bar.
  validateSearch: (search) => ({
    m: typeof search?.m === "string" ? search.m : undefined,
    authError: typeof search?.authError === "string" && /^[A-Z_]{3,48}$/.test(search.authError) ? search.authError : undefined,
    oauthProvider: OAUTH_IDS.includes(search?.oauthProvider) ? search.oauthProvider : undefined,
  }),
  component: App,
});

function OpeningScreen() {
  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-bg" role="status" aria-label="Opening Meridian">
      <svg viewBox="0 0 120 120" className="skeleton w-24 rounded-full" aria-hidden>
        <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(158,201,214,.4)" strokeWidth="1" />
        <ellipse cx="60" cy="60" rx="47" ry="18" fill="none" stroke="rgba(158,201,214,.3)" strokeWidth="1" transform="rotate(-18 60 60)" />
      </svg>
      <p className="text-xs uppercase tracking-label text-subtle">Opening Meridian…</p>
    </main>
  );
}

function App() {
  const status = useAuthStore((s) => s.status);
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const syncModule = useMeridianStore((s) => s.syncActiveModule);
  const firstSync = useRef(true);
  const section = typeof search?.m === "string" && MODULE_IDS.includes(search.m) ? search.m : undefined;

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    // URL is the source of truth for the active section — a shared link,
    // a refresh or back/forward lands on the same section without
    // touching the globe, search or selection state.
    if (!section) return;
    syncModule(section);
    // Fresh mounts (deep link / refresh / post-login return) open the
    // panel so the linked section is visible; in-session back/forward
    // never remounts, so it keeps whatever the user had.
    if (firstSync.current) {
      firstSync.current = false;
      useMeridianStore.setState({ sidebarOpen: true });
    }
  }, [section, syncModule]);

  useEffect(() => {
    // Redirect only after the session check settles — never on the
    // first render, where status is still the UNAUTHENTICATED default
    // while the session request is in flight.
    if (!initialized || status === "AUTHENTICATING") return;
    if (status === "UNAUTHENTICATED" || status === "SESSION_EXPIRED" || status === "AUTH_ERROR") {
      // Preserve the intended destination so sign-in returns here —
      // e.g. /app?m=travel → /auth?returnTo=… → /app?m=travel.
      if (status === "SESSION_EXPIRED") toast.message("Your session has ended. Please sign in again.");
      navigate({ to: "/auth", search: section ? { returnTo: `/app?m=${section}` } : undefined, replace: true });
    }
  }, [status, initialized, navigate, section]);

  useEffect(() => {
    if (status !== "AUTHENTICATED" || typeof document === "undefined") return;
    const match = document.cookie.match(/(?:^|;\s*)meridian_auth_notice=([^;]+)/);
    if (!match) return;
    document.cookie = "meridian_auth_notice=; Path=/; Max-Age=0; SameSite=Lax";
    const [kind, provider] = decodeURIComponent(match[1]).split(":");
    const label = PROVIDER_LABEL[provider] ?? provider ?? "Account";
    if (kind === "linked") toast.success(`${label} connected.`);
    else if (kind === "created") toast.success("Account created — welcome to Meridian.");
    else if (kind === "signin") toast.success("Welcome back.");
  }, [status]);

  useEffect(() => {
    // A failed provider link comes back here (a signed-in person never sees
    // the auth screen): say what happened once, then clean the URL so a
    // refresh does not repeat it.
    if (!search?.authError) return;
    toast.error(authErrorMessage(search.authError, { provider: search.oauthProvider }));
    navigate({ to: "/app", search: section ? { m: section } : undefined, replace: true });
  }, [search?.authError, search?.oauthProvider, section, navigate]);

  if (!initialized || status === "AUTHENTICATING") return <OpeningScreen />;
  if (!canUseApp(useAuthStore.getState())) return <OpeningScreen />;
  return (
    <main className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <MeridianUI />
    </main>
  );
}
