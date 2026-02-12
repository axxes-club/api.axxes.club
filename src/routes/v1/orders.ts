import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireSecretKey, type AuthContext } from "../../middleware/auth.js";
import { generateOrderNumber, generateTicketNumber, generateQrData, calculatePlatformFee } from "../../lib/utils.js";

const orders = new Hono<{
  Variables: {
    auth: AuthContext;
    idempotencyKey?: string;
  };
}>();

orders.use("/*", requireAuth);

/**
 * List orders
 * GET /v1/orders
 */
orders.get("/", async (c) => {
  const auth = c.get("auth");
  const { limit = "10", starting_after, event, customer, status } = c.req.query();

  const where: any = {
    event: {
      accountId: auth.account.id,
    },
    livemode: auth.livemode,
  };

  if (event) where.eventId = event;
  if (customer) where.customerId = customer;
  if (status) where.status = status.toUpperCase();

  const orderList = await prisma.order.findMany({
    where,
    take: parseInt(limit) + 1,
    orderBy: { createdAt: "desc" },
    cursor: starting_after ? { id: starting_after } : undefined,
    skip: starting_after ? 1 : 0,
    include: {
      items: {
        include: { ticketType: true },
      },
      customer: true,
      _count: { select: { tickets: true } },
    },
  });

  const hasMore = orderList.length > parseInt(limit);
  const data = hasMore ? orderList.slice(0, -1) : orderList;

  return c.json({
    object: "list",
    data: data.map(formatOrder),
    has_more: hasMore,
    url: "/v1/orders",
  });
});

/**
 * Create an order
 * POST /v1/orders
 */
orders.post("/", async (c) => {
  const auth = c.get("auth");
  const idempotencyKey = c.get("idempotencyKey");
  const body = await c.req.json();

  const {
    event,
    customer,
    email,
    name,
    items,
    metadata,
  } = body;

  if (!event) {
    throw new HTTPException(400, { message: "event is required" });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new HTTPException(400, { message: "items is required and must be a non-empty array" });
  }
  if (!customer && !email) {
    throw new HTTPException(400, { message: "Either customer or email is required" });
  }

  // Verify event
  const eventRecord = await prisma.event.findFirst({
    where: {
      id: event,
      accountId: auth.account.id,
      livemode: auth.livemode,
      status: "PUBLISHED",
    },
  });

  if (!eventRecord) {
    throw new HTTPException(404, { message: "Event not found or not published" });
  }

  // Validate and calculate totals
  let subtotal = 0;
  const validatedItems: { ticketTypeId: string; quantity: number; unitPrice: number }[] = [];

  for (const item of items) {
    if (!item.ticket_type || !item.quantity) {
      throw new HTTPException(400, { message: "Each item must have ticket_type and quantity" });
    }

    const ticketType = await prisma.ticketType.findFirst({
      where: {
        id: item.ticket_type,
        eventId: event,
        isVisible: true,
      },
    });

    if (!ticketType) {
      throw new HTTPException(404, { message: `Ticket type ${item.ticket_type} not found` });
    }

    // Check quantity limits
    if (item.quantity < ticketType.minPerOrder) {
      throw new HTTPException(400, {
        message: `Minimum ${ticketType.minPerOrder} tickets required for ${ticketType.name}`,
      });
    }
    if (item.quantity > ticketType.maxPerOrder) {
      throw new HTTPException(400, {
        message: `Maximum ${ticketType.maxPerOrder} tickets allowed for ${ticketType.name}`,
      });
    }

    // Check availability
    if (ticketType.quantity !== null) {
      const available = ticketType.quantity - ticketType.quantitySold;
      if (item.quantity > available) {
        throw new HTTPException(400, {
          message: `Only ${available} tickets available for ${ticketType.name}`,
        });
      }
    }

    // Check sales window
    const now = new Date();
    if (ticketType.salesStartAt && now < ticketType.salesStartAt) {
      throw new HTTPException(400, {
        message: `Sales for ${ticketType.name} haven't started yet`,
      });
    }
    if (ticketType.salesEndAt && now > ticketType.salesEndAt) {
      throw new HTTPException(400, {
        message: `Sales for ${ticketType.name} have ended`,
      });
    }

    const itemTotal = ticketType.price * item.quantity;
    subtotal += itemTotal;

    validatedItems.push({
      ticketTypeId: ticketType.id,
      quantity: item.quantity,
      unitPrice: ticketType.price,
    });
  }

  // Calculate fees
  const platformFee = calculatePlatformFee(subtotal);
  const total = subtotal + platformFee;

  // Get or create customer
  let customerId = customer;
  if (!customerId && email) {
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        accountId: auth.account.id,
        email: email.toLowerCase(),
      },
    });

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const newCustomer = await prisma.customer.create({
        data: {
          accountId: auth.account.id,
          email: email.toLowerCase(),
          name,
        },
      });
      customerId = newCustomer.id;
    }
  }

  // Create order with items
  const order = await prisma.order.create({
    data: {
      eventId: event,
      customerId,
      number: generateOrderNumber(),
      subtotal,
      platformFee,
      processingFee: 0, // Set after payment
      total,
      currency: "usd",
      guestEmail: customer ? null : email,
      guestName: customer ? null : name,
      idempotencyKey,
      metadata: metadata || null,
      livemode: auth.livemode,
      items: {
        create: validatedItems.map((item) => ({
          ticketTypeId: item.ticketTypeId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
    include: {
      items: {
        include: { ticketType: true },
      },
      customer: true,
    },
  });

  return c.json(formatOrder(order), 201);
});

/**
 * Retrieve an order
 * GET /v1/orders/:id
 */
orders.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const order = await prisma.order.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
    include: {
      items: {
        include: { ticketType: true },
      },
      customer: true,
      tickets: true,
      _count: { select: { tickets: true } },
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: "Order not found" });
  }

  return c.json(formatOrder(order));
});

/**
 * Pay an order (mark as paid and generate tickets)
 * POST /v1/orders/:id/pay
 */
orders.post("/:id/pay", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json();

  const { stripe_payment_intent, stripe_charge } = body;

  const order = await prisma.order.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
    include: {
      items: {
        include: { ticketType: true },
      },
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: "Order not found" });
  }

  if (order.status !== "PENDING") {
    throw new HTTPException(400, {
      message: `Order cannot be paid from ${order.status} status`,
    });
  }

  // Generate tickets
  const ticketsToCreate = [];
  for (const item of order.items) {
    for (let i = 0; i < item.quantity; i++) {
      ticketsToCreate.push({
        eventId: order.eventId,
        orderId: order.id,
        ticketTypeId: item.ticketTypeId,
        customerId: order.customerId,
        number: generateTicketNumber(),
        qrData: generateQrData(),
        livemode: auth.livemode,
      });
    }
  }

  // Transaction: update order + create tickets + update ticket type counts
  const [updatedOrder] = await prisma.$transaction([
    // Update order
    prisma.order.update({
      where: { id },
      data: {
        status: "PAID",
        stripePaymentIntentId: stripe_payment_intent,
        stripeChargeId: stripe_charge,
        paidAt: new Date(),
      },
      include: {
        items: {
          include: { ticketType: true },
        },
        customer: true,
      },
    }),
    // Create tickets
    prisma.ticket.createMany({
      data: ticketsToCreate,
    }),
    // Update ticket type sold counts
    ...order.items.map((item) =>
      prisma.ticketType.update({
        where: { id: item.ticketTypeId },
        data: {
          quantitySold: { increment: item.quantity },
        },
      })
    ),
  ]);

  // Fetch tickets
  const tickets = await prisma.ticket.findMany({
    where: { orderId: order.id },
  });

  return c.json({
    ...formatOrder(updatedOrder),
    tickets: tickets.map(formatTicket),
  });
});

/**
 * Refund an order
 * POST /v1/orders/:id/refund
 */
orders.post("/:id/refund", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const order = await prisma.order.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
    include: {
      items: true,
      tickets: true,
    },
  });

  if (!order) {
    throw new HTTPException(404, { message: "Order not found" });
  }

  if (order.status !== "PAID") {
    throw new HTTPException(400, {
      message: `Only paid orders can be refunded. Current status: ${order.status}`,
    });
  }

  // Transaction: update order + tickets + ticket type counts
  const [updatedOrder] = await prisma.$transaction([
    prisma.order.update({
      where: { id },
      data: { status: "REFUNDED" },
      include: {
        items: {
          include: { ticketType: true },
        },
        customer: true,
      },
    }),
    // Mark all tickets as refunded
    prisma.ticket.updateMany({
      where: { orderId: id },
      data: { status: "REFUNDED" },
    }),
    // Decrement ticket type sold counts
    ...order.items.map((item) =>
      prisma.ticketType.update({
        where: { id: item.ticketTypeId },
        data: {
          quantitySold: { decrement: item.quantity },
        },
      })
    ),
  ]);

  // TODO: Process Stripe refund

  return c.json(formatOrder(updatedOrder));
});

function formatOrder(order: any) {
  return {
    id: order.id,
    object: "order",
    number: order.number,
    event: order.eventId,
    customer: order.customerId,
    email: order.customer?.email || order.guestEmail,
    name: order.customer?.name || order.guestName,
    subtotal: order.subtotal,
    platform_fee: order.platformFee,
    processing_fee: order.processingFee,
    total: order.total,
    currency: order.currency,
    status: order.status.toLowerCase(),
    stripe_payment_intent: order.stripePaymentIntentId,
    stripe_charge: order.stripeChargeId,
    idempotency_key: order.idempotencyKey,
    metadata: order.metadata,
    livemode: order.livemode,
    items: order.items?.map((item: any) => ({
      id: item.id,
      ticket_type: item.ticketTypeId,
      ticket_type_name: item.ticketType?.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.quantity * item.unitPrice,
    })),
    tickets_count: order._count?.tickets || order.tickets?.length || 0,
    paid_at: order.paidAt ? Math.floor(order.paidAt.getTime() / 1000) : null,
    created: Math.floor(order.createdAt.getTime() / 1000),
    updated: Math.floor(order.updatedAt.getTime() / 1000),
  };
}

function formatTicket(ticket: any) {
  return {
    id: ticket.id,
    object: "ticket",
    number: ticket.number,
    qr_data: ticket.qrData,
    status: ticket.status.toLowerCase(),
    livemode: ticket.livemode,
  };
}

export default orders;
