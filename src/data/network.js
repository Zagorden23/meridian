import { PLACES } from "@/data/locations";
/** Great-circle central angle between two places, radians. */
function centralAngle(a, b) {
    const toRad = Math.PI / 180;
    const lat1 = a.lat * toRad;
    const lat2 = b.lat * toRad;
    const sinHalfLat = Math.sin((lat2 - lat1) / 2);
    const sinHalfLon = Math.sin(((b.lon - a.lon) * toRad) / 2);
    const h = sinHalfLat * sinHalfLat +
        Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * Each place links to its two nearest neighbours — a deterministic network
 * that hugs geography instead of an arbitrary hand-picked graph.
 */
function buildNetwork() {
    const seen = new Set();
    const edges = [];
    for (const place of PLACES) {
        const ranked = PLACES.filter((p) => p.id !== place.id)
            .map((p) => ({ place: p, angle: centralAngle(place, p) }))
            .sort((x, y) => x.angle - y.angle)
            .slice(0, 2);
        for (const { place: peer, angle } of ranked) {
            const id = [place.id, peer.id].sort().join("--");
            if (seen.has(id))
                continue;
            seen.add(id);
            edges.push({ id, from: place, to: peer, angle });
        }
    }
    return edges;
}
export const ROUTES = buildNetwork();
/** Places directly connected to the given one, in edge order. */
export function connectedPlaces(placeId) {
    const out = [];
    for (const edge of ROUTES) {
        if (edge.from.id === placeId)
            out.push(edge.to);
        else if (edge.to.id === placeId)
            out.push(edge.from);
    }
    return out;
}
