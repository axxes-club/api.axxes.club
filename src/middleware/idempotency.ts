import { createMiddleware } from "hono/factory";
import { createHash } from "crypto";

// In-memory cache for idempotency (use Redis in production)
const idempotencyCache = new Map<string, {
  response: any;
  statusCode: number;
  timestamp: number;
}>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [key, value] of idempotencyCache.entries()) {
    if (now - value.timestamp > maxAge) {
      idempotencyCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Idempotency middleware for POST/PATCH/PUT requests
 * Uses Idempotency-Key header to prevent duplicate operations
 */
export const idempotency = createMiddleware<{
  Variables: {
    idempotencyKey?: string;
  };
}>(async (c, next) => {
  const method = c.req.method;
  
  // Only apply to mutating requests
  if (!["POST", "PUT", "PATCH"].includes(method)) {
    await next();
    return;
  }

  const idempotencyKey = c.req.header("Idempotency-Key");
  
  if (!idempotencyKey) {
    // No idempotency key provided, proceed normally
    await next();
    return;
  }

  // Create a cache key that includes the request path
  // Note: auth context may not be set yet, so we use a simpler key
  const authHeader = c.req.header("Authorization") || "";
  const accountId = authHeader.slice(0, 20) || "anonymous";
  const cacheKey = createHash("sha256")
    .update(`${accountId}:${idempotencyKey}:${c.req.path}`)
    .digest("hex");

  // Check if we have a cached response
  const cached = idempotencyCache.get(cacheKey);
  if (cached) {
    c.header("Idempotency-Replayed", "true");
    return c.json(cached.response, cached.statusCode as any);
  }

  // Store the key for later
  c.set("idempotencyKey", idempotencyKey);

  // Proceed with the request
  await next();

  // Cache the response (only for successful responses)
  const status = c.res.status;
  if (status >= 200 && status < 300) {
    try {
      const responseClone = c.res.clone();
      const responseBody = await responseClone.json();
      
      idempotencyCache.set(cacheKey, {
        response: responseBody,
        statusCode: status,
        timestamp: Date.now(),
      });
    } catch {
      // Response wasn't JSON, skip caching
    }
  }
});
