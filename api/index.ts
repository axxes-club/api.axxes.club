import type { IncomingMessage, ServerResponse } from "node:http";

export interface ApiRequest extends IncomingMessage { body?: any; query?: Record<string, string | string[]>; }
export interface ApiResponse extends ServerResponse { status(code: number): ApiResponse; json(value: unknown): ApiResponse; }
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { isIP } from "node:net";

const prisma = new PrismaClient();

async function validateApiKey(key: string) {
  const parts = key.split("_");
  if (parts.length < 3) return null;
  
  const [prefix, modeStr] = parts;
  const type = prefix === "pk" ? "PUBLISHABLE" : prefix === "sk" ? "SECRET" : prefix === "rk" ? "RESTRICTED" : null;
  const mode = modeStr === "test" ? "TEST" : modeStr === "live" ? "LIVE" : null;
  if (!type || !mode) return null;

  const keyHash = createHash("sha256").update(key).digest("hex");
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: { account: true },
  });

  if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) || apiKey.type !== type || apiKey.mode !== mode) return null;
  return { apiKey, account: apiKey.account, type, mode, livemode: mode === "LIVE" };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const path = req.url?.split("?")[0] || "/";

  // Health check
  if (path === "/" || path === "/health") {
    return res.json({
      name: "Axxes API",
      version: "1.0.0",
      docs: "https://docs.axxes.club",
      status: "operational",
    });
  }

  // Auth check for API routes
  if (path.startsWith("/v1/")) {
    const chain = String(req.headers["x-forwarded-for"] || "").split(",").map(value=>value.trim());
    const trusted = (process.env.SECURITY_TRUSTED_LB_IPS || "").split(",").map(value=>value.trim()).filter(Boolean);
    const candidate = chain.at(-2);
    const client = chain.length>=2 && trusted.includes(chain.at(-1)!) && isIP(candidate||"") ? candidate : "untrusted";
    try {
      for (const [identity, limit] of [["anonymous-global", 500], [`anonymous-client:${client}`, 60]] as const) {
        const bucket = createHash("sha256").update(`${identity}:${Math.floor(Date.now()/60000)}`).digest("hex");
        const admitted = await prisma.$queryRawUnsafe<{hits:number}[]>("INSERT INTO api_security_rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET hits=api_security_rate_limits.hits+1 WHERE api_security_rate_limits.hits<$2 RETURNING hits",bucket,limit);
        if (admitted.length!==1) return res.status(429).json({error:{type:"rate_limit_error",message:"Request limit exceeded"}});
      }
    } catch { return res.status(503).json({error:{type:"service_error",message:"API admission unavailable"}}); }

    const authHeader = req.headers.authorization;
    const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!apiKey) {
      return res.status(401).json({ error: { type: "authentication_error", message: "Missing API key" } });
    }
    
    const auth = await validateApiKey(apiKey);
    if (!auth) {
      return res.status(401).json({ error: { type: "authentication_error", message: "Invalid API key" } });
    }

    const operation = req.method === "POST" ? "events:write" : "events:read";
    if ((req.method === "POST" && auth.type === "PUBLISHABLE") ||
        (auth.type === "RESTRICTED" && !auth.apiKey.permissions.includes(operation))) {
      return res.status(403).json({ error: { type: "permission_error", message: "API key does not permit this operation" } });
    }
    // Atomic PostgreSQL buckets are shared by every process and revision. Missing
    // migration/database errors reject the request rather than disabling limits.
    const policies: [string, number, number][] = [
      [`key:${auth.apiKey.id}`, 60, 120],
      [`account:${auth.account.id}`, 60, 240],
      [`account-day:${auth.account.id}`, 86400, 10000],
      [`account-month:${auth.account.id}`, 2592000, 100000],
    ];
    try {
      for (const [identity, seconds, limit] of policies) {
        const window = Math.floor(Date.now() / (seconds * 1000));
        const key = createHash("sha256").update(`${identity}:${window}`).digest("hex");
        const rows = await prisma.$queryRawUnsafe<{ hits: number }[]>(
          "INSERT INTO api_security_rate_limits(key,hits,expires_at) VALUES($1,1,now()+($2::int*interval '1 second')) ON CONFLICT(key) DO UPDATE SET hits=api_security_rate_limits.hits+1 WHERE api_security_rate_limits.hits<$3 RETURNING hits", key, seconds * 2, limit);
        if (rows.length !== 1) return res.status(429).json({ error: { type: "rate_limit_error", message: "API usage limit exceeded" } });
      }
    } catch {
      return res.status(503).json({ error: { type: "service_error", message: "API admission unavailable" } });
    }

    // GET /v1/events
    if (path === "/v1/events" && req.method === "GET") {
      const events = await prisma.event.findMany({
        where: { accountId: auth.account.id, livemode: auth.livemode },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      return res.json({
        object: "list",
        data: events.map((e) => ({
          id: e.id,
          object: "event",
          name: e.name,
          status: e.status.toLowerCase(),
          starts_at: Math.floor(e.startsAt.getTime() / 1000),
          venue_name: e.venueName,
          city: e.city,
          livemode: e.livemode,
        })),
        has_more: false,
      });
    }

    // POST /v1/events
    if (path === "/v1/events" && req.method === "POST") {
      const { name, starts_at, venue_name, city, state, country } = req.body || {};
      
      if (!name || !starts_at || !venue_name || !city) {
        return res.status(400).json({ error: { type: "invalid_request_error", message: "Missing required fields" } });
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      
      const event = await prisma.event.create({
        data: {
          accountId: auth.account.id,
          name,
          slug,
          startsAt: new Date(starts_at * 1000),
          venueName: venue_name,
          city,
          state,
          country: country || "US",
          livemode: auth.livemode,
        },
      });

      return res.status(201).json({
        id: event.id,
        object: "event",
        name: event.name,
        slug: event.slug,
        status: event.status.toLowerCase(),
        starts_at: Math.floor(event.startsAt.getTime() / 1000),
        venue_name: event.venueName,
        city: event.city,
        livemode: event.livemode,
        created: Math.floor(event.createdAt.getTime() / 1000),
      });
    }
  }

  return res.status(404).json({ error: { type: "invalid_request_error", message: "Not found" } });
}
