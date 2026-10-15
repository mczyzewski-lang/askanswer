/** Simple in-memory token bucket. Good enough for a single instance; swap for Redis when scaling out. */
const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(key: string, opts: { capacity: number; perMinute: number }): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: opts.capacity, at: now };
  const refill = ((now - b.at) / 60_000) * opts.perMinute;
  b.tokens = Math.min(opts.capacity, b.tokens + refill);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.at > 600_000) buckets.delete(k);
  }
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
