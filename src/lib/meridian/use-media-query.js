import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. Used where a layout difference must not be
 * CSS-only — e.g. the section panel exists once (desktop column OR mobile
 * sheet), because mounting both would double every request it makes.
 */
export function useMediaQuery(query, serverDefault = false) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Tailwind's `md` breakpoint: the desktop shell starts here. */
export const useIsDesktop = () => useMediaQuery("(min-width: 768px)", true);
