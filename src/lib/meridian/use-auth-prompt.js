import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMeridianStore } from "@/store/meridian-store.js";

/**
 * Send someone to sign in (or create an account) and bring them back to the
 * section they were in — every in-app "Sign in" goes through here, so none of
 * them drops the person on the default screen afterwards.
 */
export function useAuthPrompt() {
  const navigate = useNavigate();
  return useCallback((mode) => {
    const section = useMeridianStore.getState().activeModule;
    navigate({
      to: "/auth",
      search: {
        ...(mode === "signup" ? { mode: "signup" } : {}),
        returnTo: `/app?m=${section}`,
      },
    });
  }, [navigate]);
}
