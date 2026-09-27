// In-process token-bucket rate limiter (per-route). On Render's single-node
// starter shape this is sufficient; document Redis move if scaled horizontally.
const buckets = new Map();

export function rateLimit(key, { limit = 60, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const err = new Error("Rate limit exceeded. Please retry shortly.");
    err.status = 429;
    err.code = "RATE_LIMITED";
    throw err;
  }
  return { remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export function clientKey(request, route) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (forwarded ?? "").split(",")[0].trim() || "local";
  return `${route}:${ip}`;
}
