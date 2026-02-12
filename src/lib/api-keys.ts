import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma.js";
import type { ApiKeyType, ApiMode } from "@prisma/client";

// Key format: {prefix}_{mode}_{random}
// Examples: pk_test_abc123, sk_live_xyz789

const KEY_PREFIXES = {
  PUBLISHABLE: "pk",
  SECRET: "sk",
  RESTRICTED: "rk",
} as const;

const MODE_PREFIXES = {
  TEST: "test",
  LIVE: "live",
} as const;

/**
 * Generate a new API key
 */
export function generateApiKey(type: ApiKeyType, mode: ApiMode): string {
  const prefix = KEY_PREFIXES[type];
  const modePrefix = MODE_PREFIXES[mode];
  const random = randomBytes(24).toString("base64url");
  return `${prefix}_${modePrefix}_${random}`;
}

/**
 * Hash an API key for storage/lookup
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Parse API key to extract type and mode
 */
export function parseApiKey(key: string): { type: ApiKeyType; mode: ApiMode } | null {
  const parts = key.split("_");
  if (parts.length < 3) return null;

  const [prefix, modeStr] = parts;

  let type: ApiKeyType | null = null;
  if (prefix === "pk") type = "PUBLISHABLE";
  else if (prefix === "sk") type = "SECRET";
  else if (prefix === "rk") type = "RESTRICTED";
  else return null;

  let mode: ApiMode | null = null;
  if (modeStr === "test") mode = "TEST";
  else if (modeStr === "live") mode = "LIVE";
  else return null;

  return { type, mode };
}

/**
 * Validate and retrieve API key from database
 */
export async function validateApiKey(key: string) {
  const parsed = parseApiKey(key);
  if (!parsed) return null;

  const keyHash = hashApiKey(key);

  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: { account: true },
  });

  if (!apiKey) return null;
  if (apiKey.revokedAt) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

  // Update last used timestamp (fire and forget)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return {
    apiKey,
    account: apiKey.account,
    type: parsed.type,
    mode: parsed.mode,
    livemode: parsed.mode === "LIVE",
  };
}

/**
 * Create a new API key for an account
 */
export async function createApiKey(
  accountId: string,
  type: ApiKeyType,
  mode: ApiMode,
  name: string = "Default"
) {
  const key = generateApiKey(type, mode);
  const keyHash = hashApiKey(key);

  await prisma.apiKey.create({
    data: {
      accountId,
      key, // Store the full key (only shown once)
      keyHash,
      name,
      type,
      mode,
    },
  });

  return key;
}
