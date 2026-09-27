import { useMemo } from "react";
import { AdditiveBlending, BackSide, Color, FrontSide } from "three";
import { GLOBE } from "@/lib/theme";
const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = /* glsl */ `
  varying vec3 vNormal;
  uniform vec3 uColor;
  uniform float uPower;
  uniform float uBias;
  uniform float uIntensity;
  void main() {
    float fresnel = pow(uBias - dot(vNormal, vec3(0.0, 0.0, 1.0)), uPower);
    gl_FragColor = vec4(uColor, 1.0) * fresnel * uIntensity;
  }
`;
function AtmosphereLayer({ scale, side, color, power, bias, intensity, }) {
    const uniforms = useMemo(() => ({
        uColor: { value: new Color(color) },
        uPower: { value: power },
        uBias: { value: bias },
        uIntensity: { value: intensity },
    }), [bias, color, intensity, power]);
    return (<mesh scale={scale}>
      <sphereGeometry args={[1, 64, 64]}/>
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} transparent depthWrite={false} blending={AdditiveBlending} side={side} toneMapped={false}/>
    </mesh>);
}
export function Atmosphere() {
    return (<group>
      <AtmosphereLayer scale={1.018} side={FrontSide} color={GLOBE.atmosphereCore} power={4.2} bias={0.72} intensity={0.55}/>
      <AtmosphereLayer scale={1.16} side={BackSide} color={GLOBE.atmosphere} power={2.9} bias={0.68} intensity={0.85}/>
      <AtmosphereLayer scale={1.32} side={BackSide} color={GLOBE.atmosphere} power={2.2} bias={0.62} intensity={0.28}/>
    </group>);
}
