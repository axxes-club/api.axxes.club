import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireSecretKey, type AuthContext } from "../../middleware/auth.js";

const ticketTypes = new Hono<{
  Variables: {
    auth: AuthContext;
  };
}>();

ticketTypes.use("/*", requireAuth);

/**
 * Create a ticket type
 * POST /v1/ticket_types
 */
ticketTypes.post("/", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json();

  const {
    event,
    name,
    description,
    price,
    currency,
    quantity,
    sales_start_at,
    sales_end_at,
    min_per_order,
    max_per_order,
    sort_order,
    is_visible,
    metadata,
  } = body;

  if (!event) {
    throw new HTTPException(400, { message: "event is required" });
  }
  if (!name) {
    throw new HTTPException(400, { message: "name is required" });
  }
  if (price === undefined) {
    throw new HTTPException(400, { message: "price is required" });
  }

  // Verify event belongs to account
  const eventRecord = await prisma.event.findFirst({
    where: {
      id: event,
      accountId: auth.account.id,
      livemode: auth.livemode,
    },
  });

  if (!eventRecord) {
    throw new HTTPException(404, { message: "Event not found" });
  }

  // Get next sort order
  const lastTicketType = await prisma.ticketType.findFirst({
    where: { eventId: event },
    orderBy: { sortOrder: "desc" },
  });

  const ticketType = await prisma.ticketType.create({
    data: {
      eventId: event,
      name,
      description,
      price,
      currency: currency || "usd",
      quantity: quantity || null,
      salesStartAt: sales_start_at ? new Date(sales_start_at * 1000) : null,
      salesEndAt: sales_end_at ? new Date(sales_end_at * 1000) : null,
      minPerOrder: min_per_order || 1,
      maxPerOrder: max_per_order || 10,
      sortOrder: sort_order ?? (lastTicketType?.sortOrder ?? 0) + 1,
      isVisible: is_visible ?? true,
      metadata: metadata || null,
    },
  });

  return c.json(formatTicketType(ticketType), 201);
});

/**
 * Retrieve a ticket type
 * GET /v1/ticket_types/:id
 */
ticketTypes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const ticketType = await prisma.ticketType.findFirst({
    where: { id },
    include: {
      event: {
        select: {
          accountId: true,
          livemode: true,
        },
      },
    },
  });

  if (!ticketType || ticketType.event.accountId !== auth.account.id || ticketType.event.livemode !== auth.livemode) {
    throw new HTTPException(404, { message: "Ticket type not found" });
  }

  return c.json(formatTicketType(ticketType));
});

/**
 * Update a ticket type
 * POST /v1/ticket_types/:id
 */
ticketTypes.post("/:id", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json();

  // Verify ownership
  const existing = await prisma.ticketType.findFirst({
    where: { id },
    include: {
      event: {
        select: {
          accountId: true,
          livemode: true,
        },
      },
    },
  });

  if (!existing || existing.event.accountId !== auth.account.id || existing.event.livemode !== auth.livemode) {
    throw new HTTPException(404, { message: "Ticket type not found" });
  }

  const {
    name,
    description,
    price,
    currency,
    quantity,
    sales_start_at,
    sales_end_at,
    min_per_order,
    max_per_order,
    sort_order,
    is_visible,
    metadata,
  } = body;

  // Don't allow reducing quantity below sold amount
  if (quantity !== undefined && existing.quantitySold > quantity) {
    throw new HTTPException(400, {
      message: `Cannot set quantity to ${quantity}. ${existing.quantitySold} tickets already sold.`,
    });
  }

  const ticketType = await prisma.ticketType.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price }),
      ...(currency !== undefined && { currency }),
      ...(quantity !== undefined && { quantity }),
      ...(sales_start_at !== undefined && { salesStartAt: sales_start_at ? new Date(sales_start_at * 1000) : null }),
      ...(sales_end_at !== undefined && { salesEndAt: sales_end_at ? new Date(sales_end_at * 1000) : null }),
      ...(min_per_order !== undefined && { minPerOrder: min_per_order }),
      ...(max_per_order !== undefined && { maxPerOrder: max_per_order }),
      ...(sort_order !== undefined && { sortOrder: sort_order }),
      ...(is_visible !== undefined && { isVisible: is_visible }),
      ...(metadata !== undefined && { metadata }),
    },
  });

  return c.json(formatTicketType(ticketType));
});

/**
 * Delete a ticket type
 * DELETE /v1/ticket_types/:id
 */
ticketTypes.delete("/:id", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const ticketType = await prisma.ticketType.findFirst({
    where: { id },
    include: {
      event: {
        select: {
          accountId: true,
          livemode: true,
        },
      },
      _count: {
        select: { tickets: true },
      },
    },
  });

  if (!ticketType || ticketType.event.accountId !== auth.account.id || ticketType.event.livemode !== auth.livemode) {
    throw new HTTPException(404, { message: "Ticket type not found" });
  }

  if (ticketType._count.tickets > 0) {
    throw new HTTPException(400, {
      message: "Cannot delete a ticket type with sold tickets",
    });
  }

  await prisma.ticketType.delete({ where: { id } });

  return c.json({
    id,
    object: "ticket_type",
    deleted: true,
  });
});

function formatTicketType(tt: any) {
  return {
    id: tt.id,
    object: "ticket_type",
    event: tt.eventId,
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
    created: Math.floor(tt.createdAt.getTime() / 1000),
    updated: Math.floor(tt.updatedAt.getTime() / 1000),
  };
}

export default ticketTypes;
