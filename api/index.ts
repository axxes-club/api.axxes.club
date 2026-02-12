import "dotenv/config";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

export const config = {
  runtime: "nodejs",
};

const prisma = new PrismaClient();

const app = new Hono().basePath("/");

// Middleware
app.use("*", cors());
app.use("*", secureHeaders());
app.use("*", prettyJSON());

// Auth helper
async function validateApiKey(key: string) {
  const parts = key.split("_");
  if (parts.length < 3) return null;
  
  const [prefix, modeStr] = parts;
  let type = prefix === "pk" ? "PUBLISHABLE" : prefix === "sk" ? "SECRET" : null;
  let mode = modeStr === "test" ? "TEST" : modeStr === "live" ? "LIVE" : null;
  if (!type || !mode) return null;

  const keyHash = createHash("sha256").update(key).digest("hex");
  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: { account: true },
  });

  if (!apiKey || apiKey.revokedAt) return null;
  return { apiKey, account: apiKey.account, type, mode, livemode: mode === "LIVE" };
}

// Health check
app.get("/", (c) => c.json({
  name: "Axxes API",
  version: "1.0.0",
  docs: "https://docs.axxes.club",
  status: "operational",
}));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Events endpoint
app.get("/v1/events", async (c) => {
  const authHeader = c.req.header("Authorization");
  const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : c.req.query("api_key");
  
  if (!apiKey) {
    return c.json({ error: { type: "authentication_error", message: "Missing API key" } }, 401);
  }
  
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    return c.json({ error: { type: "authentication_error", message: "Invalid API key" } }, 401);
  }

  const events = await prisma.event.findMany({
    where: { accountId: auth.account.id, livemode: auth.livemode },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return c.json({
    object: "list",
    data: events.map((e: any) => ({
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
});

app.post("/v1/events", async (c) => {
  const authHeader = c.req.header("Authorization");
  const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  if (!apiKey) {
    return c.json({ error: { type: "authentication_error", message: "Missing API key" } }, 401);
  }
  
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    return c.json({ error: { type: "authentication_error", message: "Invalid API key" } }, 401);
  }

  const body = await c.req.json();
  const { name, starts_at, venue_name, city, state, country } = body;
  
  if (!name || !starts_at || !venue_name || !city) {
    return c.json({ error: { type: "invalid_request_error", message: "Missing required fields" } }, 400);
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

  return c.json({
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
  }, 201);
});

// 404
app.notFound((c) => c.json({ error: { type: "invalid_request_error", message: "Not found" } }, 404));

export default handle(app);
