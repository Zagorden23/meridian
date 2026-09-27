import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide, } from "three";
import { PLACES } from "@/data/locations";
import { GLOBE } from "@/lib/theme";
import { latLonToVector3, outwardQuaternion } from "@/lib/geo";
import { getGlowTexture } from "@/components/globe/glow-texture";
import { useGlobeStore } from "@/store/globe-store";
function hashOffset(id) {
    let n = 0;
    for (let i = 0; i < id.length; i += 1)
        n = (n + id.charCodeAt(i) * (i + 1)) % 100;
    return n / 100;
}
function Marker({ id, lat, lon, }) {
    const groupRef = useRef(null);
    const coreRef = useRef(null);
    const ringRef = useRef(null);
    const select = useGlobeStore((state) => state.select);
    const hover = useGlobeStore((state) => state.hover);
    const selected = useGlobeStore((state) => state.selectedId === id);
    const hovered = useGlobeStore((state) => state.hoveredId === id);
    const offset = useMemo(() => hashOffset(id), [id]);
    const glow = useMemo(() => getGlowTexture(), []);
    const color = useMemo(() => new Color(GLOBE.marker), []);
    const hot = useMemo(() => new Color(GLOBE.markerHot), []);
    const { position, quaternion } = useMemo(() => {
        return {
            position: latLonToVector3(lat, lon, 1.018),
            quaternion: outwardQuaternion(lat, lon),
        };
    }, [lat, lon]);
    useFrame((state) => {
        const t = state.clock.elapsedTime + offset * 12;
        const active = selected || hovered;
        const pulse = 1 + Math.sin(t * (active ? 2.6 : 1.8)) * (active ? 0.16 : 0.07);
        if (coreRef.current) {
            const base = active ? 1.35 : 1;
            coreRef.current.scale.setScalar(base * pulse);
        }
        if (ringRef.current) {
            const s = 1.05 + Math.sin(t * 2.1) * 0.08;
            ringRef.current.scale.setScalar(selected ? s : 0.001);
            ringRef.current.visible = selected;
        }
    });
    return (<group ref={groupRef} position={position} quaternion={quaternion}>
      <mesh onClick={(event) => {
            event.stopPropagation();
            select(id);
        }} onPointerOver={(event) => {
            event.stopPropagation();
            hover(id);
        }} onPointerOut={() => hover(null)}>
        <sphereGeometry args={[0.038, 12, 12]}/>
        <meshBasicMaterial transparent opacity={0} depthWrite={false}/>
      </mesh>

      <mesh ref={coreRef}>
        <sphereGeometry args={[0.012, 16, 16]}/>
        <meshBasicMaterial color={selected ? hot : color} toneMapped={false}/>
      </mesh>

      <sprite scale={selected ? [0.16, 0.16, 1] : hovered ? [0.12, 0.12, 1] : [0.09, 0.09, 1]}>
        <spriteMaterial map={glow} color={selected ? hot : color} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} opacity={selected ? 0.95 : 0.72}/>
      </sprite>

      <mesh ref={ringRef} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.028, 0.034, 48]}/>
        <meshBasicMaterial color={hot} transparent opacity={0.9} side={DoubleSide} depthWrite={false} toneMapped={false}/>
      </mesh>
    </group>);
}
export function Markers() {
    return (<group>
      {PLACES.map((place) => (<Marker key={place.id} id={place.id} lat={place.lat} lon={place.lon}/>))}
    </group>);
}
