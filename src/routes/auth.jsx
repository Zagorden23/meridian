import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/auth-page";

const OAUTH_IDS = ["google", "microsoft", "apple", "amazon"];

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => ({
    mode: search?.mode === "signup" ? "signup" : undefined,
    // An error code from an OAuth redirect. It is only ever looked up in a
    // fixed message table — never rendered as text.
    error: typeof search?.error === "string" && /^[A-Z_]{3,48}$/.test(search.error) ? search.error : undefined,
    oauthProvider: OAUTH_IDS.includes(search?.oauthProvider) ? search.oauthProvider : undefined,
    returnTo: typeof search?.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: Auth,
});

function Auth() {
  return <AuthPage />;
}
