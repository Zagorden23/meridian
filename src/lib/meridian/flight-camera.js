// Flight tracking camera — single home for focusOrigin / focusDestination /
// focusAircraft / fitFlightRoute / followAircraft / exitFlightTracking so the
// 3D globe, 2D map and AI actions can never disagree. All movement goes
// through the globe store's focusPointOn (CameraRig flies there); the 2D map
// subscribes to the same meridian store and follows automatically.
import { useGlobeStore } from "@/store/globe-store.js";
import { useMeridianStore } from "@/store/meridian-store.js";

function focus(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false;
  useGlobeStore.getState().pauseOrbit();
  useGlobeStore.getState().focusPointOn(Number(lat), Number(lon));
  return true;
}

export function focusOrigin() {
  const { route } = useMeridianStore.getState();
  if (!route?.origin) return false;
  return focus(route.origin.lat, route.origin.lon);
}

export function focusDestination() {
  const { route } = useMeridianStore.getState();
  if (!route?.destination) return false;
  return focus(route.destination.lat, route.destination.lon);
}

export function focusAircraft() {
  const { trackedFlight } = useMeridianStore.getState();
  const pos = trackedFlight?.position;
  if (pos?.latitude == null || pos?.longitude == null) return false;
  return focus(pos.latitude, pos.longitude);
}

export function fitFlightRoute() {
  const { route, trackedFlight } = useMeridianStore.getState();
  const pos = trackedFlight?.position;
  if (pos?.latitude != null && route?.origin) {
    // Midpoint between origin and live position keeps both in frame.
    return focus((route.origin.lat + pos.latitude) / 2, (route.origin.lon + pos.longitude) / 2);
  }
  if (route?.origin && route?.destination) {
    return focus(
      (route.origin.lat + route.destination.lat) / 2,
      (route.origin.lon + route.destination.lon) / 2,
    );
  }
  return focusAircraft();
}

export function followAircraft() {
  const { trackedFlight } = useMeridianStore.getState();
  if (!trackedFlight) return false;
  useMeridianStore.getState().setTrackedFlight({ ...trackedFlight, follow: true });
  return focusAircraft();
}

export function exitFlightTracking() {
  useMeridianStore.getState().setTrackedFlight(null);
  useGlobeStore.getState().resumeOrbit();
}
