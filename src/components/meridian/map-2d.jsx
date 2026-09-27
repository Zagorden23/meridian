// 2D map: real tiled map (CartoDB dark / OpenStreetMap) through a clean
// MapAdapter surface. No API key required; attribution is rendered.
// Shared state (selected location, route, tracked flight, markers) is read
// from the same zustand stores as the 3D globe, so switching 3D ⇄ 2D
// preserves everything.
//
// Adapter methods implemented: create / destroy / resize / setCenter /
// setZoom / flyTo / fitBounds / setMarkers / removeMarkers / setRoute /
// clearRoute (see inline LeafletMapAdapter).
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { api } from "@/lib/meridian/api-client.js";
import { useMeridianStore } from "@/store/meridian-store.js";
import { useGlobeStore } from "@/store/globe-store.js";
import { recordHistory } from "@/lib/meridian/favorites.js";

const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION = "Esri, HERE, Garmin, OpenStreetMap contributors";

class LeafletMapAdapter {
  constructor(L, map) {
    this.L = L;
    this.map = map;
    this.markers = new Map();
    this.routeLayer = null;
    this.trackLayer = null;
  }
  create() { return this; }
  destroy() { this.map.remove(); }
  resize() { this.map.invalidateSize(); }
  setCenter(lat, lon, zoom) {
    this.map.setView([lat, lon], zoom ?? this.map.getZoom());
  }
  setZoom(zoom) { this.map.setZoom(zoom); }
  flyTo(lat, lon, zoom = 5) { this.map.flyTo([lat, lon], zoom, { duration: 1.2 }); }
  fitBounds(bounds) { this.map.fitBounds(bounds, { padding: [40, 40] }); }
  setMarkers(list) {
    this.removeMarkers();
    for (const m of list) {
      if (m.latitude == null || m.longitude == null) continue;
      const marker = this.L.circleMarker([m.latitude, m.longitude], {
        radius: 4, color: "#d4eef5", fillColor: "#d4eef5", fillOpacity: 0.7, weight: 1,
      });
      if (m.name) marker.bindTooltip(m.name);
      marker.addTo(this.map);
      this.markers.set(m.id ?? m.name, marker);
    }
  }
  removeMarkers() {
    for (const mk of this.markers.values()) mk.remove();
    this.markers.clear();
  }
  setRoute(route) {
    this.clearRoute();
    if (!route) return;
    const pts = [];
    for (let i = 0; i <= 48; i += 1) {
      const t = i / 48;
      pts.push([
        route.origin.lat + (route.destination.lat - route.origin.lat) * t,
        route.origin.lon + (route.destination.lon - route.origin.lon) * t,
      ]);
    }
    this.routeLayer = this.L.polyline(pts, { color: "#f4fbfd", weight: 2, opacity: 0.85 }).addTo(this.map);
    this.fitBounds(this.routeLayer.getBounds());
  }
  clearRoute() {
    if (this.routeLayer) { this.routeLayer.remove(); this.routeLayer = null; }
  }
}

export function Map2D() {
  const containerRef = useRef(null);
  const adapterRef = useRef(null);
  const location = useMeridianStore((s) => s.location);
  const selectLocation = useMeridianStore((s) => s.selectLocation);
  const route = useMeridianStore((s) => s.route);
  const trackedFlight = useMeridianStore((s) => s.trackedFlight);
  const latest = useRef({ location, route, trackedFlight });
  latest.current = { location, route, trackedFlight };

  // Create the Leaflet map once (client-only).
  useEffect(() => {
    let adapter = null;
    let alive = true;
    let L = null;
    (async () => {
      const mod = await import("leaflet");
      L = mod.default ?? mod;
      if (!alive || !containerRef.current) return;
      // Fix default icon paths for bundlers (we use circleMarkers anyway).
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });
      const loc = latest.current.location;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(
        loc?.lat != null ? [loc.lat, loc.lon] : [20, 10], loc?.lat != null ? 4 : 2,
      );
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 16 }).addTo(map);
      adapter = new LeafletMapAdapter(L, map);
      adapterRef.current = adapter;

      // Click → reverse-geocode to nearest catalogued city (shared with globe).
      map.on("click", async (e) => {
        try {
          const res = await api.reverse(e.latlng.lat, e.latlng.lng);
          const city = res.data?.city;
          if (city) {
            const locSel = { kind: "CITY", id: city.id, name: city.name, lat: city.latitude, lon: city.longitude, raw: city };
            selectLocation(locSel);
            recordHistory({ id: `CITY:${city.id}`, name: city.name, kind: "CITY", lat: city.latitude, lon: city.longitude });
            useGlobeStore.getState().focusPointOn(city.latitude, city.longitude);
          }
        } catch { /* keep map usable offline */ }
      });

      // Base marker layer: capitals (viewport loading happens server-side).
      try {
        const res = await api.capitals();
        if (alive) adapter.setMarkers(res.data ?? []);
      } catch { /* markers optional */ }
      // Restore shared state on creation.
      if (latest.current.route) adapter.setRoute(latest.current.route);
      if (latest.current.location?.lat != null) {
        adapter.flyTo(latest.current.location.lat, latest.current.location.lon, 4);
      }
      const onResize = () => adapter.resize();
      window.addEventListener("resize", onResize);
      adapter._cleanup = () => window.removeEventListener("resize", onResize);
    })();
    return () => {
      alive = false;
      if (adapter) {
        adapter._cleanup?.();
        adapter.destroy();
        adapterRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection follows the shared store (3D → 2D preserved).
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || location?.lat == null) return;
    adapter.flyTo(location.lat, location.lon, Math.max(adapter.map.getZoom(), 4));
    const L = adapter.L;
    if (adapter._sel) adapter._sel.remove();
    adapter._sel = L.circleMarker([location.lat, location.lon], {
      radius: 8, color: "#f4fbfd", fillColor: "#9ec9d6", fillOpacity: 0.9, weight: 2,
    }).addTo(adapter.map);
    adapter._sel.bindTooltip(location.name ?? "Selected").openTooltip();
  }, [location?.id]); // eslint-disable-line

  // Route follows the shared store.
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (route) adapter.setRoute(route);
    else adapter.clearRoute();
  }, [route]);

  // Live aircraft marker (red, prominent) mirrors the 3D layer.
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const L = adapter.L;
    if (adapter._ac) { adapter._ac.remove(); adapter._ac = null; }
    const pos = trackedFlight?.position;
    if (pos?.latitude != null && pos?.longitude != null) {
      adapter._ac = L.circleMarker([pos.latitude, pos.longitude], {
        radius: 9, color: "#ff5a5a", fillColor: "#ff5a5a", fillOpacity: 0.95, weight: 2,
      }).addTo(adapter.map);
      adapter._ac.bindTooltip(`● LIVE ${trackedFlight.callsign ?? trackedFlight.flightNumber ?? ""}`.trim());
      adapter.flyTo(pos.latitude, pos.longitude, Math.max(adapter.map.getZoom(), 4));
    }
  }, [trackedFlight?.position?.latitude, trackedFlight?.position?.longitude, trackedFlight?.callsign]); // eslint-disable-line

  return (
    <div className="absolute inset-0 bg-[#0a0d14]" aria-label="2D map">
      <div ref={containerRef} className="h-full w-full" style={{ background: "#0a0d14" }} />
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-surface/85 px-3 py-1 text-[11px] text-subtle backdrop-blur-md">
        Real tiles · Esri / OpenStreetMap · Click for nearest city
      </div>
    </div>
  );
}
