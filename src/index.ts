import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

import { errorHandler } from "./middleware/error-handler.js";
import { idempotency } from "./middleware/idempotency.js";

import events from "./routes/v1/events.js";
import ticketTypes from "./routes/v1/ticket-types.js";
import orders from "./routes/v1/orders.js";
import tickets from "./routes/v1/tickets.js";

const app = new Hono();

// Global middleware
app.use("*", logger());
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
        doc_url: "https://docs.axxes.club/api",
      },
    },
    404
  );
});

// Start server
const port = parseInt(process.env.PORT || "3000");

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     ▄▀█ ▀▄▀ ▀▄▀ █▀▀ █▀   ▄▀█ █▀█ █                       ║
║     █▀█ █ █ █ █ ██▄ ▄█   █▀█ █▀▀ █                       ║
║                                                           ║
║     The Stripe of Ticketing                               ║
║     v1.0.0                                                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

🚀 Server running at http://localhost:${port}
📚 API Documentation: https://docs.axxes.club
`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
