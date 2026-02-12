import "dotenv/config";
import { Hono } from "hono";
import { handle } from "@hono/node-server/vercel";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

import { errorHandler } from "../src/middleware/error-handler.js";
import { idempotency } from "../src/middleware/idempotency.js";

import events from "../src/routes/v1/events.js";
import ticketTypes from "../src/routes/v1/ticket-types.js";
import orders from "../src/routes/v1/orders.js";
import tickets from "../src/routes/v1/tickets.js";

const app = new Hono().basePath("/");

// Global middleware
app.use("*", cors());
app.use("*", secureHeaders());
app.use("*", prettyJSON());
app.use("*", idempotency);

// Error handler
app.onError(errorHandler);

// Health check
app.get("/", (c) => {
  return c.json({
    name: "Axxes API",
    version: "1.0.0",
    docs: "https://docs.axxes.club",
    status: "operational",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API v1 routes
const v1 = new Hono();
v1.route("/events", events);
v1.route("/ticket_types", ticketTypes);
v1.route("/orders", orders);
v1.route("/tickets", tickets);

// Mount v1 routes
app.route("/v1", v1);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        type: "invalid_request_error",
        code: "resource_not_found",
        message: `No such route: ${c.req.method} ${c.req.path}`,
      },
    },
    404
  );
});

export default handle(app);
