import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

async function validateApiKey(key: string) {
  const parts = key.split("_");
  if (parts.length < 3) return null;
  
  const [prefix, modeStr] = parts;
  const type = prefix === "pk" ? "PUBLISHABLE" : prefix === "sk" ? "SECRET" : null;
  const mode = modeStr === "test" ? "TEST" : modeStr === "live" ? "LIVE" : null;
  if (!type || !mode) return null;

  const keyHash = createHash("sha256").update(key).digest("hex");
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: { account: true },
  });

  if (!apiKey || apiKey.revokedAt) return null;
  return { apiKey, account: apiKey.account, type, mode, livemode: mode === "LIVE" };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    const authHeader = req.headers.authorization;
    const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    
    if (!apiKey) {
      return res.status(401).json({ error: { type: "authentication_error", message: "Missing API key" } });
    }
    
    const auth = await validateApiKey(apiKey);
    if (!auth) {
      return res.status(401).json({ error: { type: "authentication_error", message: "Invalid API key" } });
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
