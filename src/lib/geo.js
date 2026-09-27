import { Quaternion, Vector3 } from "three";
const DEG = Math.PI / 180;
const Z_UP = new Vector3(0, 0, 1);
/** Convert WGS84 lat/lon to a point on a Y-up sphere matching SphereGeometry UVs. */
export function latLonToVector3(lat, lon, radius, target = new Vector3()) {
    const phi = (90 - lat) * DEG;
    const theta = (lon + 180) * DEG;
    const sinPhi = Math.sin(phi);
    return target.set(-radius * sinPhi * Math.cos(theta), radius * Math.cos(phi), radius * sinPhi * Math.sin(theta));
}
export function outwardQuaternion(lat, lon, target = new Quaternion()) {
    return target.setFromUnitVectors(Z_UP, latLonToVector3(lat, lon, 1).normalize());
}
/**
 * Great-circle arc between two lat/lon points, lifted above the surface so
 * the mid-arc floats clear of the globe. Endpoints graze the marker shell.
 */
export function greatCirclePoints(from, to, radius, segments) {
    const a = latLonToVector3(from.lat, from.lon, 1).normalize();
    const b = latLonToVector3(to.lat, to.lon, 1).normalize();
    const omega = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    // Farther pairs lift higher; near pairs stay close to the surface.
    const lift = 1.05 + 0.24 * (omega / Math.PI);
    const sinOmega = Math.sin(omega);
    const points = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        let v;
        if (sinOmega < 1e-6) {
            // Coincident or antipodal endpoints: fall back to a straight chord.
            v = a.clone().lerp(b, t);
        }
        else {
            const wa = Math.sin((1 - t) * omega) / sinOmega;
            const wb = Math.sin(t * omega) / sinOmega;
            v = new Vector3(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
        }
        if (v.lengthSq() < 1e-12)
            v.copy(a);
        const r = radius * (1 + (lift - 1) * Math.sin(Math.PI * t));
        points.push(v.normalize().multiplyScalar(r));
    }
    return points;
}
