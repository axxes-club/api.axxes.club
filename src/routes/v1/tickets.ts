import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireSecretKey, type AuthContext } from "../../middleware/auth.js";

const tickets = new Hono<{
  Variables: {
    auth: AuthContext;
  };
}>();

tickets.use("/*", requireAuth);

/**
 * List tickets
 * GET /v1/tickets
 */
tickets.get("/", async (c) => {
  const auth = c.get("auth");
  const { limit = "10", starting_after, event, order, customer, status } = c.req.query();

  const where: any = {
    event: {
      accountId: auth.account.id,
    },
    livemode: auth.livemode,
  };

  if (event) where.eventId = event;
  if (order) where.orderId = order;
  if (customer) where.customerId = customer;
  if (status) where.status = status.toUpperCase();

  const ticketList = await prisma.ticket.findMany({
    where,
    take: parseInt(limit) + 1,
    orderBy: { createdAt: "desc" },
    cursor: starting_after ? { id: starting_after } : undefined,
    skip: starting_after ? 1 : 0,
    include: {
      ticketType: true,
      customer: true,
      event: {
        select: {
          name: true,
          startsAt: true,
          venueName: true,
        },
      },
    },
  });

  const hasMore = ticketList.length > parseInt(limit);
  const data = hasMore ? ticketList.slice(0, -1) : ticketList;

  return c.json({
    object: "list",
    data: data.map(formatTicket),
    has_more: hasMore,
    url: "/v1/tickets",
  });
});

/**
 * Retrieve a ticket
 * GET /v1/tickets/:id
 */
tickets.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
    include: {
      ticketType: true,
      customer: true,
      order: true,
      event: {
        select: {
          id: true,
          name: true,
          startsAt: true,
          endsAt: true,
          venueName: true,
          venueAddress: true,
          city: true,
          state: true,
          isAddressHidden: true,
        },
      },
    },
  });

  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }

  return c.json(formatTicket(ticket));
});

/**
 * Lookup ticket by QR data (for scanning)
 * GET /v1/tickets/lookup
 */
tickets.get("/lookup", async (c) => {
  const auth = c.get("auth");
  const { qr_data, event } = c.req.query();

  if (!qr_data) {
    throw new HTTPException(400, { message: "qr_data is required" });
  }

  const where: any = {
    qrData: qr_data,
    event: {
      accountId: auth.account.id,
    },
    livemode: auth.livemode,
  };

  if (event) where.eventId = event;

  const ticket = await prisma.ticket.findFirst({
    where,
    include: {
      ticketType: true,
      customer: true,
      event: {
        select: {
          id: true,
          name: true,
          startsAt: true,
          venueName: true,
        },
      },
    },
  });

  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }

  return c.json(formatTicket(ticket));
});

/**
 * Check in a ticket
 * POST /v1/tickets/:id/check_in
 */
tickets.post("/:id/check_in", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const { scanner } = body;

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
    include: {
      ticketType: true,
      customer: true,
      event: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }

  // Check ticket status
  if (ticket.status === "CHECKED_IN") {
    // Log the attempt
    if (scanner) {
      await prisma.scanLog.create({
        data: {
          scannerId: scanner,
          ticketId: ticket.id,
          result: "ALREADY_CHECKED_IN",
          message: `Already checked in at ${ticket.checkedInAt}`,
        },
      });
    }

    throw new HTTPException(400, {
      message: `Ticket already checked in at ${ticket.checkedInAt?.toISOString()}`,
    });
  }

  if (ticket.status === "CANCELLED") {
    if (scanner) {
      await prisma.scanLog.create({
        data: {
          scannerId: scanner,
          ticketId: ticket.id,
          result: "CANCELLED_TICKET",
        },
      });
    }
    throw new HTTPException(400, { message: "Ticket has been cancelled" });
  }

  if (ticket.status === "REFUNDED") {
    if (scanner) {
      await prisma.scanLog.create({
        data: {
          scannerId: scanner,
          ticketId: ticket.id,
          result: "CANCELLED_TICKET",
          message: "Ticket was refunded",
        },
      });
    }
    throw new HTTPException(400, { message: "Ticket has been refunded" });
  }

  // Check in the ticket
  const updatedTicket = await prisma.ticket.update({
    where: { id },
    data: {
      status: "CHECKED_IN",
      checkedInAt: new Date(),
      checkedInBy: scanner,
    },
    include: {
      ticketType: true,
      customer: true,
      event: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // Log successful scan
  if (scanner) {
    await prisma.scanLog.create({
      data: {
        scannerId: scanner,
        ticketId: ticket.id,
        result: "SUCCESS",
      },
    });
  }

  return c.json(formatTicket(updatedTicket));
});

/**
 * Undo check-in
 * POST /v1/tickets/:id/undo_check_in
 */
tickets.post("/:id/undo_check_in", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
  });

  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }

  if (ticket.status !== "CHECKED_IN") {
    throw new HTTPException(400, { message: "Ticket is not checked in" });
  }

  const updatedTicket = await prisma.ticket.update({
    where: { id },
    data: {
      status: "VALID",
      checkedInAt: null,
      checkedInBy: null,
    },
    include: {
      ticketType: true,
      customer: true,
      event: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return c.json(formatTicket(updatedTicket));
});

/**
 * Cancel a ticket
 * POST /v1/tickets/:id/cancel
 */
tickets.post("/:id/cancel", requireSecretKey, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  const ticket = await prisma.ticket.findFirst({
    where: {
      id,
      event: {
        accountId: auth.account.id,
      },
      livemode: auth.livemode,
    },
  });

  if (!ticket) {
    throw new HTTPException(404, { message: "Ticket not found" });
  }

  if (ticket.status === "CANCELLED" || ticket.status === "REFUNDED") {
    throw new HTTPException(400, { message: `Ticket is already ${ticket.status.toLowerCase()}` });
  }

  if (ticket.status === "CHECKED_IN") {
    throw new HTTPException(400, { message: "Cannot cancel a checked-in ticket" });
  }

  const updatedTicket = await prisma.ticket.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: {
      ticketType: true,
      customer: true,
    },
  });

  // Decrement ticket type sold count
  await prisma.ticketType.update({
    where: { id: ticket.ticketTypeId },
    data: { quantitySold: { decrement: 1 } },
  });

  return c.json(formatTicket(updatedTicket));
});

function formatTicket(ticket: any) {
  return {
    id: ticket.id,
    object: "ticket",
    number: ticket.number,
    event: ticket.eventId,
    event_name: ticket.event?.name,
    event_starts_at: ticket.event?.startsAt ? Math.floor(ticket.event.startsAt.getTime() / 1000) : null,
    venue_name: ticket.event?.venueName,
    venue_address: ticket.event?.isAddressHidden ? null : ticket.event?.venueAddress,
    order: ticket.orderId,
    ticket_type: ticket.ticketTypeId,
    ticket_type_name: ticket.ticketType?.name,
    customer: ticket.customerId,
    customer_email: ticket.customer?.email,
    customer_name: ticket.customer?.name,
    qr_data: ticket.qrData,
    status: ticket.status.toLowerCase(),
    checked_in_at: ticket.checkedInAt ? Math.floor(ticket.checkedInAt.getTime() / 1000) : null,
    checked_in_by: ticket.checkedInBy,
    metadata: ticket.metadata,
    livemode: ticket.livemode,
    created: Math.floor(ticket.createdAt.getTime() / 1000),
    updated: Math.floor(ticket.updatedAt.getTime() / 1000),
  };
}

export default tickets;
