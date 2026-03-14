const hits = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  hits.forEach((val, key) => {
    if (val.resetAt < now) hits.delete(key);
  });
}, 5 * 60 * 1000);

/**
 * Simple in-memory rate limiter.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 */
export function rateLimit(
  key: string,
  { maxRequests = 10, windowMs = 60_000 } = {}
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true };
}

/**
 * Extract a best-effort IP from a Request for rate-limiting.
 */
export function getRequestIP(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
