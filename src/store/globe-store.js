import { create } from "zustand";

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The globe idles in a slow orbit. Anything the person is looking at pins it:
// a featured place (`selectedId`) or a catalog/search/route focus
// (`focusPoint`). While either is set the orbit stays paused — including after
// a drag — so the globe never drifts away from the current selection.
const mayOrbit = (state, overrides = {}) => {
  const s = { ...state, ...overrides };
  return s.selectedId === null && s.focusPoint === null && !s.interacting && !prefersReducedMotion();
};

export const useGlobeStore = create((set) => ({
  selectedId: null,
  hoveredId: null,
  interacting: false,
  autoRotate: !prefersReducedMotion(),
  focusNonce: 0,
  // Arbitrary catalog focus (lat/lon) — set by search, AI, 2D map, travel.
  // CameraRig flies here without disturbing the featured selectedId flow.
  focusPoint: null,
  focusPointNonce: 0,
  select: (id) => set((state) => ({
    selectedId: id,
    autoRotate: mayOrbit(state, { selectedId: id }),
    focusNonce: id ? state.focusNonce + 1 : state.focusNonce,
  })),
  hover: (id) => set({ hoveredId: id }),
  setInteracting: (value) => set((state) => ({
    interacting: value,
    autoRotate: mayOrbit(state, { interacting: value }),
  })),
  pauseOrbit: () => set({ autoRotate: false }),
  resumeOrbit: () => set({
    selectedId: null,
    focusPoint: null,
    autoRotate: !prefersReducedMotion(),
  }),
  focusPointOn: (lat, lon) => set((state) => ({
    focusPoint: { lat, lon },
    focusPointNonce: state.focusPointNonce + 1,
    autoRotate: false,
  })),
  // The focused thing was dismissed: release the pin and let the orbit resume.
  clearFocusPoint: () => set((state) => (state.focusPoint === null
    ? state
    : { focusPoint: null, autoRotate: mayOrbit(state, { focusPoint: null }) })),
}));
