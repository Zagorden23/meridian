import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { ClampToEdgeWrapping, Color, RepeatWrapping, SRGBColorSpace, } from "three";
import { Atmosphere } from "@/components/globe/atmosphere";
import { GLOBE } from "@/lib/theme";
import { useGlobeStore } from "@/store/globe-store";
const EARTH_MAPS = [
    "/textures/earth-day.jpg",
    "/textures/earth-normal.jpg",
    "/textures/earth-specular.jpg",
    "/textures/earth-clouds.png",
];
export function Earth() {
    const cloudsRef = useRef(null);
    const dragRef = useRef({ x: 0, y: 0, moved: false });
    const select = useGlobeStore((state) => state.select);
    const [dayMap, normalMap, specMap, cloudMap] = useTexture([...EARTH_MAPS]);
    useLayoutEffect(() => {
        dayMap.colorSpace = SRGBColorSpace;
        cloudMap.colorSpace = SRGBColorSpace;
        for (const map of [dayMap, normalMap, specMap, cloudMap]) {
            map.anisotropy = 8;
            map.wrapS = RepeatWrapping;
            map.wrapT = ClampToEdgeWrapping;
            map.needsUpdate = true;
        }
    }, [cloudMap, dayMap, normalMap, specMap]);
    useFrame((_, delta) => {
        const d = Math.min(delta, 0.1);
        if (cloudsRef.current) {
            cloudsRef.current.rotation.y += d * 0.012;
        }
    });
    return (<group>
      <mesh onPointerDown={(event) => {
            dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
        }} onPointerMove={(event) => {
            if (!event.buttons)
                return;
            const dx = event.clientX - dragRef.current.x;
            const dy = event.clientY - dragRef.current.y;
            if (dx * dx + dy * dy > 16)
                dragRef.current.moved = true;
        }} onClick={(event) => {
            event.stopPropagation();
            if (!dragRef.current.moved)
                select(null);
        }}>
        <sphereGeometry args={[1, 96, 96]}/>
        <meshPhongMaterial map={dayMap} normalMap={normalMap} specularMap={specMap} specular={new Color(GLOBE.specular)} shininess={14} emissive={new Color("#0a121c")} emissiveIntensity={0.62} normalScale={[0.55, 0.55]}/>
      </mesh>

      <mesh ref={cloudsRef} scale={1.008}>
        <sphereGeometry args={[1, 64, 64]}/>
        <meshPhongMaterial map={cloudMap} alphaMap={cloudMap} transparent opacity={0.42} depthWrite={false} shininess={2} specular={new Color("#000000")} emissive={new Color("#9eb4c4")} emissiveIntensity={0.08}/>
      </mesh>

      <Atmosphere />
    </group>);
}
