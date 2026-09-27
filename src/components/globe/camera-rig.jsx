import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { PLACES, getPlace } from "@/data/locations";
import { latLonToVector3 } from "@/lib/geo";
import { useGlobeStore } from "@/store/globe-store";
export const DEFAULT_DISTANCE = 2.88;
const FOCUS_DISTANCE = 2.38;
const AUTO_ROTATE = 0.085;
const IDLE_RESUME = 2.2;
const KEY_AZIMUTH = 1.4;
const KEY_POLAR = 0.9;
const KEY_DOLLY = 1.1;
export function CameraRig() {
    const controlsRef = useRef(null);
    const selectedId = useGlobeStore((state) => state.selectedId);
    const focusNonce = useGlobeStore((state) => state.focusNonce);
    const focusPoint = useGlobeStore((state) => state.focusPoint);
    const focusPointNonce = useGlobeStore((state) => state.focusPointNonce);
    const autoRotate = useGlobeStore((state) => state.autoRotate);
    const setInteracting = useGlobeStore((state) => state.setInteracting);
    const pausedRef = useRef(false);
    const idleRef = useRef(0);
    const keysRef = useRef(new Set());
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls)
            return;
        controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
        controls.mouseButtons.middle = CameraControlsImpl.ACTION.NONE;
        controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY;
        controls.touches.three = CameraControlsImpl.ACTION.NONE;
        controls.truckSpeed = 0;
        controls.smoothTime = 0.65;
        controls.draggingSmoothTime = 0.12;
    }, []);
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls) return;
        const place = getPlace(selectedId);
        if (!place) return;
        const target = latLonToVector3(place.lat, place.lon, FOCUS_DISTANCE);
        void controls.setLookAt(target.x, target.y, target.z, 0, 0, 0, true);
    }, [selectedId, focusNonce]);
    // Catalog / AI / 2D-map focus: fly to an arbitrary lat/lon (GATE 10).
    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls || !focusPoint) return;
        const target = latLonToVector3(focusPoint.lat, focusPoint.lon, FOCUS_DISTANCE);
        void controls.setLookAt(target.x, target.y, target.z, 0, 0, 0, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusPointNonce]);

    // Keyboard movement: hold arrows/WASD to orbit, +/- to zoom,
    // [/] or ,/. to hop between places, 0/Home to reset.
    useEffect(() => {
        const down = (event) => {
            const tag = event.target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            const k = event.key;
            if (
                k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" ||
                k === "a" || k === "d" || k === "w" || k === "s" ||
                k === "A" || k === "D" || k === "W" || k === "S" ||
                k === "+" || k === "=" || k === "-" || k === "_"
            ) {
                keysRef.current.add(k.length === 1 ? k.toLowerCase() : k);
                event.preventDefault();
                return;
            }
            const select = useGlobeStore.getState().select;
            const current = useGlobeStore.getState().selectedId;
            const idx = PLACES.findIndex((p) => p.id === current);
            if (k === "]" || k === "." || k === "PageDown") {
                select(PLACES[(idx + 1 + PLACES.length) % PLACES.length].id);
                event.preventDefault();
            } else if (k === "[" || k === "," || k === "PageUp") {
                select(PLACES[(idx - 1 + PLACES.length) % PLACES.length].id);
                event.preventDefault();
            } else if (k === "0" || k === "Home") {
                select(null);
                event.preventDefault();
            }
        };
        const up = (event) => {
            const k = event.key;
            keysRef.current.delete(k.length === 1 ? k.toLowerCase() : k);
            keysRef.current.delete(k);
        };
        const blur = () => keysRef.current.clear();
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
        };
    }, []);
    useFrame((_, delta) => {
        const controls = controlsRef.current;
        if (!controls) return;
        const d = Math.min(delta, 0.1);
        const keys = keysRef.current;
        const keyDrive =
            keys.has("ArrowLeft") || keys.has("ArrowRight") ||
            keys.has("ArrowUp") || keys.has("ArrowDown") ||
            keys.has("a") || keys.has("d") || keys.has("w") || keys.has("s") ||
            keys.has("+") || keys.has("=") || keys.has("-") || keys.has("_");
        if (keyDrive) {
            idleRef.current = 0;
            if (!pausedRef.current) {
                pausedRef.current = true;
                setInteracting(true);
            }
            if (keys.has("ArrowLeft") || keys.has("a")) controls.azimuthAngle -= KEY_AZIMUTH * d;
            if (keys.has("ArrowRight") || keys.has("d")) controls.azimuthAngle += KEY_AZIMUTH * d;
            if (keys.has("ArrowUp") || keys.has("w")) controls.polarAngle -= KEY_POLAR * d;
            if (keys.has("ArrowDown") || keys.has("s")) controls.polarAngle += KEY_POLAR * d;
            if (keys.has("+") || keys.has("=")) void controls.dolly(-KEY_DOLLY * d, true);
            if (keys.has("-") || keys.has("_")) void controls.dolly(KEY_DOLLY * d, true);
        }
        const dragging = controls.currentAction !== CameraControlsImpl.ACTION.NONE;
        if (dragging) {
            idleRef.current = 0;
            if (!pausedRef.current) {
                pausedRef.current = true;
                setInteracting(true);
            }
        }
        else if (pausedRef.current) {
            idleRef.current += d;
            if (idleRef.current >= IDLE_RESUME) {
                pausedRef.current = false;
                setInteracting(false);
            }
        }
        if (autoRotate && !selectedId && !pausedRef.current) {
            controls.azimuthAngle += AUTO_ROTATE * d;
        }
    });
    return (<CameraControls ref={controlsRef} makeDefault minDistance={2.18} maxDistance={4.6} minPolarAngle={0.32} maxPolarAngle={Math.PI - 0.32} azimuthRotateSpeed={0.68} polarRotateSpeed={0.68} dollyToCursor={false}/>);
}
