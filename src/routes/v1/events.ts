import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireSecretKey, type AuthContext } from "../../middleware/auth.js";
import { slugify, toApiResponse } from "../../lib/utils.js";

const events = new Hono<{
  Variables: {
    auth: AuthContext;
  };
}>();

// Apply auth to all routes
events.use("/*", requireAuth);

/**
 * List events
 * GET /v1/events
 */
events.get("/", async (c) => {
  const auth = c.get("auth");
  const { limit = "10", starting_after, status } = c.req.query();

  const where: any = {
    accountId: auth.account.id,
    livemode: auth.livemode,
  };

  if (status) {
    where.status = status.toUpperCase();
  }

  const events = await prisma.event.findMany({
    where,
    take: parseInt(limit) + 1, // Fetch one extra to check if there's more
    orderBy: { createdAt: "desc" },
    cursor: starting_after ? { id: starting_after } : undefined,
    skip: starting_after ? 1 : 0,
    include: {
      ticketTypes: true,
      _count: {
        select: {
          tickets: true,
          orders: { where: { status: "PAID" } },
        },
      },
    },
  });

  const hasMore = events.length > parseInt(limit);
  const data = hasMore ? events.slice(0, -1) : events;

  return c.json({
    object: "list",
    data: data.map(formatEvent),
    has_more: hasMore,
    url: "/v1/events",
  });
});

/**
 * Create an event
 * POST /v1/events
 */
events.post("/", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();

  const {
    name,
    description,
    starts_at,
    ends_at,
    timezone,
    venue_name,
    venue_address,
    city,
    state,
    country,
    image_url,
    is_address_hidden,
    metadata,
  } = body;

  // Validation
  if (!name) {
    throw new HTTPException(400, { message: "name is required" });
  }
  if (!starts_at) {
    throw new HTTPException(400, { message: "starts_at is required" });
  }
  if (!venue_name) {
    throw new HTTPException(400, { message: "venue_name is required" });
  }
  if (!city) {
    throw new HTTPException(400, { message: "city is required" });
  }

  // Generate slug
  let slug = slugify(name);
  let suffix = 0;
  while (true) {
    const existing = await prisma.event.findFirst({
      where: {
        accountId: auth.account.id,
        slug: suffix ? `${slug}-${suffix}` : slug,
      },
    });
    if (!existing) break;
    suffix++;
  }
  if (suffix) slug = `${slug}-${suffix}`;

  const event = await prisma.event.create({
    data: {
      accountId: auth.account.id,
      name,
      description,
      slug,
      startsAt: new Date(starts_at * 1000), // Unix timestamp to Date
      endsAt: ends_at ? new Date(ends_at * 1000) : null,
      timezone: timezone || auth.account.timezone,
      venueName: venue_name,
      venueAddress: venue_address,
      city,
      state,
      country: country || "US",
      imageUrl: image_url,
      isAddressHidden: is_address_hidden || false,
      metadata: metadata || null,
      livemode: auth.livemode,
    },
    include: {
      ticketTypes: true,
    },
  });

  return c.json(formatEvent(event), 201);
});

/**
 * Retrieve an event
 * GET /v1/events/:id
 */
events.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const event = await prisma.event.findFirst({
    where: {
      id,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
    include: {
      ticketTypes: true,
      _count: {
        select: {
          tickets: true,
          orders: { where: { status: "PAID" } },
        },
      },
    },
  });

  if (!event) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  return c.json(formatEvent(event));
});

/**
 * Update an event
 * POST /v1/events/:id
 */
events.post("/:id", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json();

  // Find the event first
  const existing = await prisma.event.findFirst({
    where: {
      id,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  const {
    name,
    description,
    starts_at,
    ends_at,
    timezone,
    venue_name,
    venue_address,
    city,
    state,
    country,
    image_url,
    is_address_hidden,
    status,
    metadata,
  } = body;

  const event = await prisma.event.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(starts_at !== undefined && { startsAt: new Date(starts_at * 1000) }),
      ...(ends_at !== undefined && { endsAt: ends_at ? new Date(ends_at * 1000) : null }),
      ...(timezone !== undefined && { timezone }),
      ...(venue_name !== undefined && { venueName: venue_name }),
      ...(venue_address !== undefined && { venueAddress: venue_address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(country !== undefined && { country }),
      ...(image_url !== undefined && { imageUrl: image_url }),
      ...(is_address_hidden !== undefined && { isAddressHidden: is_address_hidden }),
      ...(status !== undefined && { status: status.toUpperCase() }),
      ...(metadata !== undefined && { metadata }),
    },
    include: {
      ticketTypes: true,
    },
  });

  return c.json(formatEvent(event));
});

/**
 * Delete an event
 * DELETE /v1/events/:id
 */
events.delete("/:id", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const event = await prisma.event.findFirst({
    where: {
      id,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
    include: {
      _count: {
        select: { tickets: true },
      },
    },
  });

  if (!event) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  // Don't allow deletion if tickets have been sold
  if (event._count.tickets > 0) {
    throw new HTTPException(400, {
      message: "Cannot delete an event with sold tickets. Cancel it instead.",
    });
  }

  await prisma.event.delete({ where: { id } });

  return c.json({
    id,
    object: "event",
    deleted: true,
  });
});

/**
 * Publish an event
 * POST /v1/events/:id/publish
 */
events.post("/:id/publish", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const event = await prisma.event.findFirst({
    where: {
      id,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
    include: {
      ticketTypes: true,
    },
  });

  if (!event) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  if (event.status !== "DRAFT") {
    throw new HTTPException(400, {
      message: `Event cannot be published from ${event.status} status`,
    });
  }

  if (event.ticketTypes.length === 0) {
    throw new HTTPException(400, {
      message: "Event must have at least one ticket type before publishing",
    });
  }

  const updated = await prisma.event.update({
    where: { id },
    data: { status: "PUBLISHED" },
    include: {
      ticketTypes: true,
    },
  });

  return c.json(formatEvent(updated));
});

/**
 * Cancel an event
 * POST /v1/events/:id/cancel
 */
events.post("/:id/cancel", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const event = await prisma.event.findFirst({
    where: {
      id,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
  });

  if (!event) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  if (event.status === "CANCELLED") {
    throw new HTTPException(400, { message: "Event is already cancelled" });
  }

  if (event.status === "COMPLETED") {
    throw new HTTPException(400, { message: "Cannot cancel a completed event" });
  }

  const updated = await prisma.event.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: {
      ticketTypes: true,
    },
  });

  // TODO: Handle refunds for all tickets

  return c.json(formatEvent(updated));
});

// Format event for API response
function formatEvent(event: any) {
  return {
    id: event.id,
    object: "event",
    name: event.name,
    description: event.description,
    slug: event.slug,
    starts_at: Math.floor(event.startsAt.getTime() / 1000),
    ends_at: event.endsAt ? Math.floor(event.endsAt.getTime() / 1000) : null,
    timezone: event.timezone,
    venue_name: event.venueName,
    venue_address: event.venueAddress,
    city: event.city,
    state: event.state,
    country: event.country,
    latitude: event.latitude,
    longitude: event.longitude,
    is_address_hidden: event.isAddressHidden,
    image_url: event.imageUrl,
    status: event.status.toLowerCase(),
    metadata: event.metadata,
    livemode: event.livemode,
    ticket_types: event.ticketTypes?.map(formatTicketType) || [],
    tickets_sold: event._count?.tickets || 0,
    orders_count: event._count?.orders || 0,
    created: Math.floor(event.createdAt.getTime() / 1000),
    updated: Math.floor(event.updatedAt.getTime() / 1000),
  };
}

function formatTicketType(tt: any) {
  return {
    id: tt.id,
    object: "ticket_type",
    name: tt.name,
    description: tt.description,
    price: tt.price,
    currency: tt.currency,
    quantity: tt.quantity,
    quantity_sold: tt.quantitySold,
    quantity_available: tt.quantity ? tt.quantity - tt.quantitySold : null,
    sales_start_at: tt.salesStartAt ? Math.floor(tt.salesStartAt.getTime() / 1000) : null,
    sales_end_at: tt.salesEndAt ? Math.floor(tt.salesEndAt.getTime() / 1000) : null,
    min_per_order: tt.minPerOrder,
    max_per_order: tt.maxPerOrder,
    sort_order: tt.sortOrder,
    is_visible: tt.isVisible,
    metadata: tt.metadata,
  };
}

export default events;
