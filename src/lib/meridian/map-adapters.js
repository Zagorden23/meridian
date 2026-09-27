// MapAdapter interface — business logic talks to THIS, never to a provider.
// Methods: setCenter, setZoom, flyTo, showMarker, removeMarker, showRoute,
// clearRoute, selectLocation, getViewport. Globe + 2D canvas adapters ship
// with the app; Google/Apple adapters activate only when configured and only
// through their official SDKs (no scraping, no dataset copying per ToS).

export const MAP_MODES = ["3d", "2d"];

export class BaseMapAdapter {
  constructor() {
    this.listeners = new Set();
    this.state = { center: { lat: 20, lon: 0 }, zoom: 1, markers: new Map(), route: null, selectedId: null };
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.getViewport());
  }
  setCenter(lat, lon) {
    this.state.center = { lat, lon };
    this.emit();
  }
  setZoom(zoom) {
    this.state.zoom = zoom;
    this.emit();
  }
  flyTo(lat, lon, zoom) {
    this.state.center = { lat, lon };
    if (zoom != null) this.state.zoom = zoom;
    this.emit();
  }
  showMarker(marker) {
    this.state.markers.set(marker.id, marker);
    this.emit();
  }
  removeMarker(id) {
    this.state.markers.delete(id);
    this.emit();
  }
  showRoute(route) {
    this.state.route = route;
    this.emit();
  }
  clearRoute() {
    this.state.route = null;
    this.emit();
  }
  selectLocation(id, location = null) {
    this.state.selectedId = id;
    if (location) this.state.center = { lat: location.lat ?? location.latitude, lon: location.lon ?? location.longitude };
    this.emit();
  }
  getViewport() {
    return {
      center: { ...this.state.center },
      zoom: this.state.zoom,
      markers: [...this.state.markers.values()],
      route: this.state.route,
      selectedId: this.state.selectedId,
    };
  }
}

// 3D globe adapter: bridges shared map state to the three.js CameraRig via the
// globe store (selection by id). No direct three imports — keeps UI decoupled.
export class GlobeMapAdapter extends BaseMapAdapter {
  constructor(globeStore) {
    super();
    this.kind = "3d";
    this.globeStore = globeStore;
  }
  selectLocation(id) {
    super.selectLocation(id);
    this.globeStore?.getState?.()?.select?.(idToFeaturedId(id) ?? null);
  }
  flyTo(lat, lon) {
    super.flyTo(lat, lon);
  }
}

// 2D canvas adapter: equirectangular projection with pan/zoom. Rendered by
// <Map2D/> without external tiles (works offline; provider tiles are an
// upgrade path via GoogleMapAdapter/AppleMapAdapter when keys exist).
export class Canvas2DMapAdapter extends BaseMapAdapter {
  constructor() {
    super();
    this.kind = "2d";
  }
  project(lat, lon, width, height) {
    return { x: ((lon + 180) / 360) * width, y: ((90 - lat) / 180) * height };
  }
  unproject(x, y, width, height) {
    return { lat: 90 - (y / height) * 180, lon: (x / width) * 360 - 180 };
  }
}

// Google Maps Platform adapter — activates only with GOOGLE_MAPS_API_KEY.
// Uses official Maps JS + Places APIs; never scrapes or bulk-copies data.
export class GoogleMapAdapter extends BaseMapAdapter {
  constructor() {
    super();
    this.kind = "google";
    this.configured = Boolean(
      (typeof process !== "undefined" && process.env?.GOOGLE_MAPS_API_KEY) ||
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY),
    );
  }
  assertConfigured() {
    if (!this.configured) {
      throw Object.assign(new Error("Google Maps is not configured. Set GOOGLE_MAPS_API_KEY."), {
        code: "MAP_PROVIDER_UNAVAILABLE",
      });
    }
  }
}

// Apple MapKit JS adapter — activates only with APPLE_MAPS_TOKEN. Capabilities
// differ from Google (annotations/overlays/directions/Look Around where
// available); the UI must not assume parity.
export class AppleMapAdapter extends BaseMapAdapter {
  constructor() {
    super();
    this.kind = "apple";
    this.configured = Boolean(
      (typeof process !== "undefined" && process.env?.APPLE_MAPS_TOKEN) ||
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_APPLE_MAPS_TOKEN),
    );
  }
  assertConfigured() {
    if (!this.configured) {
      throw Object.assign(new Error("Apple Maps is not configured. Set APPLE_MAPS_TOKEN."), {
        code: "MAP_PROVIDER_UNAVAILABLE",
      });
    }
  }
}

export function createMapAdapter(kind, deps = {}) {
  switch (kind) {
    case "2d":
      return new Canvas2DMapAdapter();
    case "google":
      return new GoogleMapAdapter();
    case "apple":
      return new AppleMapAdapter();
    case "3d":
    default:
      return new GlobeMapAdapter(deps.globeStore);
  }
}

// Featured PLACES ids double as selection ids on the globe; catalog ids pass
// through so the 2D map and panels can still show them.
function idToFeaturedId(id) {
  return id ?? null;
}
