// Authentication state machine — explicit states only, no scattered booleans:
// UNAUTHENTICATED → AUTHENTICATING → AUTHENTICATED
// UNAUTHENTICATED → GUEST (guestSessionId in sessionStorage, no PII)
// AUTHENTICATED → UNAUTHENTICATED (sign out, session invalidated server-side)
// *_ → SESSION_EXPIRED (401 on a session call) / AUTH_ERROR (failure detail)
import { create } from "zustand";
import { api } from "@/lib/meridian/api-client.js";

const GUEST_KEY = "meridian:guest:v1";

function readGuestId() {
  try {
    return sessionStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

export const useAuthStore = create((set, get) => ({
  status: "UNAUTHENTICATED", // + AUTHENTICATING AUTHENTICATED GUEST SESSION_EXPIRED AUTH_ERROR
  user: null,
  guestSessionId: null,
  error: null,
  initialized: false,

  init: async () => {
    if (get().initialized && get().status !== "UNAUTHENTICATED") return;
    set({ status: "AUTHENTICATING", error: null });
    try {
      const res = await api.session();
      if (res.data?.status === "authenticated" && res.data.user) {
        set({ status: "AUTHENTICATED", user: res.data.user, guestSessionId: null, initialized: true });
        try { sessionStorage.removeItem(GUEST_KEY); } catch { /* noop */ }
        return;
      }
    } catch {
      // Session endpoint unreachable — stay unauthenticated, surface below.
    }
    const gid = readGuestId();
    set({
      status: gid ? "GUEST" : "UNAUTHENTICATED",
      guestSessionId: gid,
      user: null,
      initialized: true,
    });
  },

  continueAsGuest: () => {
    let gid = readGuestId();
    if (!gid) {
      gid = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `guest-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      try { sessionStorage.setItem(GUEST_KEY, gid); } catch { /* noop */ }
    }
    set({ status: "GUEST", guestSessionId: gid, user: null, error: null, initialized: true });
  },

  setAuthenticated: (user) => {
    try { sessionStorage.removeItem(GUEST_KEY); } catch { /* noop */ }
    set({ status: "AUTHENTICATED", user, guestSessionId: null, error: null, initialized: true });
  },

  sessionExpired: () => set({ status: "SESSION_EXPIRED", user: null, error: null }),

  authError: (error) => set({ status: "AUTH_ERROR", error }),

  signOut: async () => {
    try { await api.logout(); } catch { /* cookie may already be gone */ }
    try { sessionStorage.removeItem(GUEST_KEY); } catch { /* noop */ }
    set({ status: "UNAUTHENTICATED", user: null, guestSessionId: null, error: null, initialized: true });
  },

  exitGuest: () => {
    try { sessionStorage.removeItem(GUEST_KEY); } catch { /* noop */ }
    set({ status: "UNAUTHENTICATED", guestSessionId: null, user: null, initialized: true });
  },
}));

export const isAuthenticated = (s) => s.status === "AUTHENTICATED";
export const isGuest = (s) => s.status === "GUEST";
export const canUseApp = (s) => s.status === "AUTHENTICATED" || s.status === "GUEST";
