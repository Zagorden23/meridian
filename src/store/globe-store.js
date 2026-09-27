import { create } from "zustand";
function prefersReducedMotion() {
    if (typeof window === "undefined")
        return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
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
        autoRotate: id === null && !state.interacting && !prefersReducedMotion(),
        focusNonce: id ? state.focusNonce + 1 : state.focusNonce,
    })),
    hover: (id) => set({ hoveredId: id }),
    setInteracting: (value) => set((state) => ({
        interacting: value,
        autoRotate: value
            ? false
            : state.selectedId === null && !prefersReducedMotion(),
    })),
    pauseOrbit: () => set({ autoRotate: false }),
    resumeOrbit: () => set({
        selectedId: null,
        autoRotate: !prefersReducedMotion(),
    }),
    focusPointOn: (lat, lon) => set((state) => ({
        focusPoint: { lat, lon },
        focusPointNonce: state.focusPointNonce + 1,
        autoRotate: false,
    })),
}));
