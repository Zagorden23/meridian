// 3D flight layer: planned-route arc (parametric great-circle, height scaled
// by distance) + live aircraft marker. Mounted inside the existing Canvas.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide } from "three";
import { greatCirclePoints, latLonToVector3 } from "@/lib/geo.js";
import { getGlowTexture } from "@/components/globe/glow-texture";
import { useMeridianStore } from "@/store/meridian-store.js";

const ARC_RADIUS = 1.02;

function RouteArc({ route }) {
  const points = useMemo(
    () => greatCirclePoints(
      { lat: route.origin.lat, lon: route.origin.lon },
      { lat: route.destination.lat, lon: route.destination.lon },
      ARC_RADIUS, 72,
    ),
    [route],
  );
  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });
    return arr;
  }, [points]);
  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={new Color("#f4fbfd")} transparent opacity={0.8} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </line>
      <EndpointSpot lat={route.origin.lat} lon={route.origin.lon} />
      <EndpointSpot lat={route.destination.lat} lon={route.destination.lon} />
    </group>
  );
}

function EndpointSpot({ lat, lon }) {
  const glow = useMemo(() => getGlowTexture(), []);
  const position = useMemo(() => latLonToVector3(lat, lon, 1.018), [lat, lon]);
  return (
    <sprite position={position} scale={[0.14, 0.14, 1]}>
      <spriteMaterial map={glow} color={new Color("#f4fbfd")} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} opacity={0.9} />
    </sprite>
  );
}

function AircraftMarker({ position }) {
  const ref = useRef(null);
  const glow = useMemo(() => getGlowTexture(), []);
  const target = useMemo(
    () => (position ? latLonToVector3(position.latitude, position.longitude, 1.03) : null),
    [position?.latitude, position?.longitude], // eslint-disable-line
  );
  useFrame((state, delta) => {
    if (!ref.current || !target) return;
    // Smooth interpolation toward the latest fix (no teleporting).
    ref.current.position.lerp(target, Math.min(1, Math.min(delta, 0.1) * 1.5));
    const s = 0.16 + Math.sin(state.clock.elapsedTime * 3) * 0.02;
    ref.current.scale.set(s, s, 1);
  });
  if (!target) return null;
  return (
    <group>
      <sprite ref={ref} position={target} scale={[0.16, 0.16, 1]}>
        <spriteMaterial map={glow} color={new Color("#ff5a5a")} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} opacity={0.95} />
      </sprite>
      <mesh position={target}>
        <sphereGeometry args={[0.008, 12, 12]} />
        <meshBasicMaterial color={new Color("#ff6b6b")} toneMapped={false} />
      </mesh>
      <mesh position={target} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.02, 0.024, 40]} />
        <meshBasicMaterial color={new Color("#ff6b6b")} transparent opacity={0.85} side={DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function ActualTrack({ points }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      const v = latLonToVector3(p.latitude ?? p.lat, p.longitude ?? p.lon, 1.032);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    });
    return arr;
  }, [points]);
  if (!points.length) return null;
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={new Color("#ff5a5a")} transparent opacity={0.9} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </line>
  );
}

export function FlightGlobeLayer() {
  const route = useMeridianStore((s) => s.route);
  const trackedFlight = useMeridianStore((s) => s.trackedFlight);
  // Planned route (white arc, adaptive height via greatCirclePoints) is
  // visually distinct from the actual flown track (red) — never conflate.
  const track = trackedFlight?.track ?? trackedFlight?.position?.track ?? null;
  return (
    <group>
      {route && <RouteArc route={route} />}
      {Array.isArray(track) && track.length > 1 && <ActualTrack points={track} />}
      {trackedFlight?.position && <AircraftMarker position={trackedFlight.position} />}
    </group>
  );
}
