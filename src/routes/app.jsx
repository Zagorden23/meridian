import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { MeridianUI } from "@/components/meridian/meridian-ui";
import { canUseApp, useAuthStore } from "@/store/auth-store.js";
import { MODULE_IDS, useMeridianStore } from "@/store/meridian-store.js";

export const Route = createFileRoute("/app")({
  // `?m=` is the module (explore|travel|…): deep links, refresh and
  // back/forward work, while the globe canvas itself never remounts.
  validateSearch: (search) => ({
    m: typeof search?.m === "string" ? search.m : undefined,
  }),
  component: App,
});
function App() {
  const status = useAuthStore((s) => s.status);
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const navigate = useNavigate();
  const search = Route.useSearch();
  const syncModule = useMeridianStore((s) => s.syncActiveModule);
  const firstSync = useRef(true);
  useEffect(() => {
    init();
  }, [init]);
  useEffect(() => {
    // URL is the source of truth for the active section — a shared link,
    // a refresh or back/forward lands on the same module without
    // touching the globe, search or selection state.
    if (typeof search?.m === "string" && MODULE_IDS.includes(search.m)) {
      syncModule(search.m);
      // Fresh mounts (deep link / refresh / post-login return) open the
      // panel so the linked section is visible; in-session back/forward
      // never remounts, so it keeps whatever the user had.
      if (firstSync.current) {
        firstSync.current = false;
        useMeridianStore.setState({ sidebarOpen: true });
      }
    }
  }, [search?.m, syncModule]);
  useEffect(() => {
    // Redirect only after the session check settles — never on the
    // first render, where status is still the UNAUTHENTICATED default
    // while the session request is in flight.
    if (!initialized || status === "AUTHENTICATING") return;
    if (status === "UNAUTHENTICATED" || status === "SESSION_EXPIRED" || status === "AUTH_ERROR") {
      // Preserve the intended destination so sign-in returns here —
      // e.g. /app?m=travel → /auth?returnTo=… → /app?m=travel.
      const m = typeof search?.m === "string" && MODULE_IDS.includes(search.m) ? search.m : undefined;
      navigate({ to: "/auth", search: m ? { returnTo: `/app?m=${m}` } : undefined });
    }
  }, [status, initialized, navigate, search?.m]);
    if (!initialized || status === "AUTHENTICATING") {
        return (<main className="flex h-dvh w-full items-center justify-center bg-bg text-subtle">
        <p className="text-sm">Opening Meridian…</p>
      </main>);
    }
    if (!canUseApp(useAuthStore.getState())) {
        return null;
    }
    return (<main className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <MeridianUI />
    </main>);
}
