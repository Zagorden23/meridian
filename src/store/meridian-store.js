// MERIDIAN application store — everything the featured globe-store doesn't own.
// Selection here is a catalog object { kind, id, name, lat, lon, ... } or null;
// mapMode syncs 3D ⇄ 2D without resetting location (GATE 10).
import { create } from "zustand";

export const MODULE_IDS = [
  "explore", "travel", "weather", "maps", "discover", "ai", "personal", "tools", "settings",
];

export const useMeridianStore = create((set) => ({
  mapMode: "3d",
  setMapMode: (mapMode) => set({ mapMode }),

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  activeModule: "explore", // explore|travel|weather|maps|discover|ai|personal|tools|settings
  // Selecting a module opens the rail so its panel is visible; users can
  // collapse back to icons for an unobstructed globe.
  setActiveModule: (activeModule) => set({ activeModule, sidebarOpen: true }),
  // URL-driven sync (deep link / refresh / back-forward): mirrors the route
  // into the store without forcing the panel open, so navigation never
  // disturbs globe, search or selection state.
  syncActiveModule: (activeModule) => set((s) =>
    s.activeModule === activeModule ? s : { activeModule }),

  location: null, // { kind, id, name, lat, lon, country, ... }
  selectLocation: (location) => set({ location }),

  route: null, // { origin:{lat,lon,name}, destination:{...}, label }
  setRoute: (route) => set({ route }),
  clearRoute: () => set({ route: null }),

  trackedFlight: null, // { callsign/flightNumber, position, follow }
  setTrackedFlight: (trackedFlight) => set({ trackedFlight }),

  capitalsMode: false,
  setCapitalsMode: (capitalsMode) => set({ capitalsMode }),

  trafficMode: false,
  setTrafficMode: (trafficMode) => set({ trafficMode }),

  units: "metric", // metric|imperial
  setUnits: (units) => set({ units }),

  deviceLocation: null,
  setDeviceLocation: (deviceLocation) => set({ deviceLocation }),
}));
