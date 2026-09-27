import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth/auth-page";
export const Route = createFileRoute("/auth")({
  validateSearch: (search) => ({
    mode: search?.mode === "signup" ? "signup" : undefined,
    error: typeof search?.error === "string" ? search.error : undefined,
    returnTo: typeof search?.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: Auth,
});
function Auth() {
    return <AuthPage />;
}
