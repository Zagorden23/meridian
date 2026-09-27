import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color } from "three";
import { ROUTES } from "@/data/network";
import { greatCirclePoints } from "@/lib/geo";
import { GLOBE } from "@/lib/theme";
import { getGlowTexture } from "@/components/globe/glow-texture";
import { useGlobeStore } from "@/store/globe-store";

const ARC_RADIUS = 1.02;
const MIN_SEGMENTS = 48;
const MAX_SEGMENTS = 96;
const PULSE_SPEED = 0.12;

/** Stable per-edge pulse offset so flows don't march in lockstep. */
function hash01(id) {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n = (n * 31 + id.charCodeAt(i)) % 997;
  return n / 997;
}

function ArcLine({ edge, active, dimmed }) {
  const { from, to, angle, id } = edge;
  const segments = Math.round(
    MIN_SEGMENTS + ((angle / Math.PI) * (MAX_SEGMENTS - MIN_SEGMENTS))
  );
  const points = useMemo(
    () => greatCirclePoints(from, to, ARC_RADIUS, segments),
    [from, to, segments]
  );
  const positions = useMemo(() => {
    const arr = new Float32Array((segments + 1) * 3);
    points.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });
    return arr;
  }, [points, segments]);

  const pulseRef = useRef(null);
  const pulseRef2 = useRef(null);
  const glow = useMemo(() => getGlowTexture(), []);
  const lineColor = useMemo(() => new Color(GLOBE.atmosphere), []);
  const hotColor = useMemo(() => new Color("#ffffff"), []);
  const offset = useMemo(() => hash01(id), [id]);
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    const speed = active ? PULSE_SPEED * 1.6 : PULSE_SPEED;
    const place = (phase) => {
      const u = (t * speed + offset + phase) % 1;
      const f = u * segments;
      const i0 = Math.floor(f);
      const i1 = Math.min(segments, i0 + 1);
      const a = points[i0];
      const b = points[i1];
      const k = f - i0;
      return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k];
    };
    if (pulseRef.current) pulseRef.current.position.set(...place(0));
    // Second pulse trails on long arcs when active, adds flow on all arcs otherwise spaced out
    if (pulseRef2.current) {
      if (active || angle > 0.9) {
        pulseRef2.current.visible = true;
        pulseRef2.current.position.set(...place(0.5));
      } else {
        pulseRef2.current.visible = false;
      }
    }
  });

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={active ? hotColor : lineColor}
          transparent
          opacity={active ? 0.85 : dimmed ? 0.14 : 0.32}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </line>
      <sprite ref={pulseRef} scale={active ? [0.09, 0.09, 1] : [0.06, 0.06, 1]}>
        <spriteMaterial
          map={glow}
          color={active ? hotColor : lineColor}
          transparent
          opacity={active ? 0.95 : dimmed ? 0.35 : 0.6}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={pulseRef2} scale={[0.05, 0.05, 1]}>
        <spriteMaterial
          map={glow}
          color={active ? hotColor : lineColor}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

export function Routes() {
  const selectedId = useGlobeStore((s) => s.selectedId);
  const hoveredId = useGlobeStore((s) => s.hoveredId);
  const focus = selectedId ?? hoveredId;
  return (
    <group>
      {ROUTES.map((edge) => {
        const touches =
          focus != null && (edge.from.id === focus || edge.to.id === focus);
        return (
          <ArcLine
            key={edge.id}
            edge={edge}
            active={touches}
            dimmed={focus != null && !touches}
          />
        );
      })}
    </group>
  );
}
