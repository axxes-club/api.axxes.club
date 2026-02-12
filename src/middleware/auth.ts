import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { validateApiKey, parseApiKey } from "../lib/api-keys.js";
import type { Account, ApiKey, ApiKeyType, ApiMode } from "@prisma/client";

// Extend Hono's context with our auth data
export type AuthContext = {
  account: Account;
  apiKey: ApiKey;
  type: ApiKeyType;
  mode: ApiMode;
  livemode: boolean;
};

/**
 * Require authentication via API key
 * Extracts key from Authorization header (Bearer) or query param (api_key)
 */
export const requireAuth = createMiddleware<{
  Variables: {
    auth: AuthContext;
  };
}>(async (c, next) => {
  // Extract API key from header or query
  let apiKey: string | undefined;

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else {
    apiKey = c.req.query("api_key");
  }

  if (!apiKey) {
    throw new HTTPException(401, {
      message: "Missing API key. Include it in the Authorization header as 'Bearer sk_xxx' or as query param 'api_key'.",
    });
  }

  // Validate the key
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    throw new HTTPException(401, {
      message: "Invalid API key. Check that you're using the correct key for this environment.",
    });
  }

  // Store auth context
  c.set("auth", auth);

  await next();
});

/**
 * Require a specific key type (e.g., secret keys only for sensitive operations)
 */
export const requireSecretKey = createMiddleware<{
  Variables: {
    auth: AuthContext;
  };
}>(async (c, next) => {
  const auth = c.get("auth");
  
  if (!auth) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  if (auth.type === "PUBLISHABLE") {
    throw new HTTPException(403, {
      message: "This endpoint requires a secret API key (sk_xxx). Publishable keys cannot be used.",
    });
  }

  await next();
});

/**
 * Require live mode for certain operations
 */
export const requireLiveMode = createMiddleware<{
  Variables: {
    auth: AuthContext;
  };
}>(async (c, next) => {
  const auth = c.get("auth");
  
  if (!auth) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  if (!auth.livemode) {
    throw new HTTPException(403, {
      message: "This operation requires a live mode API key (sk_live_xxx).",
    });
  }

  await next();
});

/**
 * Optional auth - doesn't fail if no key provided
 */
export const optionalAuth = createMiddleware<{
  Variables: {
    auth: AuthContext | null;
  };
}>(async (c, next) => {
  let apiKey: string | undefined;

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else {
    apiKey = c.req.query("api_key");
  }

  if (apiKey) {
    const auth = await validateApiKey(apiKey);
    c.set("auth", auth);
  } else {
    c.set("auth", null);
  }

  await next();
});
