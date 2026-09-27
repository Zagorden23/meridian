import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Earth } from "@/components/globe/earth";
import { Markers } from "@/components/globe/markers";
import { Routes } from "@/components/globe/routes";
import { FlightGlobeLayer } from "@/components/meridian/flight-globe-layer";
import { CameraRig, DEFAULT_DISTANCE } from "@/components/globe/camera-rig";
import { GLOBE } from "@/lib/theme";
import { latLonToVector3 } from "@/lib/geo";
import { useGlobeStore } from "@/store/globe-store";
import { cn } from "@/lib/utils";
const START = latLonToVector3(16, 18, DEFAULT_DISTANCE);
function SceneLights() {
    return (<>
      <ambientLight color={GLOBE.ambient} intensity={0.32}/>
      <hemisphereLight args={[GLOBE.hemiSky, GLOBE.hemiGround, 0.58]}/>
      <directionalLight position={[7.4, 3.1, 5.2]} color={GLOBE.sun} intensity={1.9}/>
      <directionalLight position={[-5.5, -1.6, -3.8]} color={GLOBE.fill} intensity={0.28}/>
    </>);
}
export default function GlobeCanvas() {
    const hoveredId = useGlobeStore((state) => state.hoveredId);
    const interacting = useGlobeStore((state) => state.interacting);
    return (<div className={cn("absolute inset-0 touch-none", hoveredId ? "cursor-pointer" : interacting ? "cursor-grabbing" : "cursor-grab")}>
      <Canvas camera={{
            position: [START.x, START.y, START.z],
            fov: 40,
            near: 0.1,
            far: 80,
        }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }} onCreated={({ gl }) => {
            gl.setClearColor(GLOBE.bg, 1);
            gl.domElement.style.touchAction = "none";
        }}>
        <color attach="background" args={[GLOBE.bg]}/>
        <Suspense fallback={null}>
          <SceneLights />
          <Earth />
          <Routes />
          <Markers />
          <FlightGlobeLayer />
          <Stars radius={70} depth={36} count={4200} factor={3.2} saturation={0} fade speed={0.35}/>
        </Suspense>
        <CameraRig />
      </Canvas>
    </div>);
}
