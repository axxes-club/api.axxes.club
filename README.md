# Axxes API

> The Stripe of Ticketing — API-first event ticketing platform

## Overview

Axxes API provides a complete ticketing solution with:

- **Events** — Create and manage events
- **Ticket Types** — Define pricing tiers with inventory management
- **Orders** — Handle checkout and payments
- **Tickets** — Generate and validate tickets with QR codes
- **Scanners** — Check-in system for door staff
- **Webhooks** — Real-time event notifications

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL

# Push database schema
npm run db:push

# Generate Prisma client
npm run db:generate

# Start development server
npm run dev
```

## API Authentication

All API requests require authentication via API key:

```bash
# Bearer token (recommended)
curl https://api.axxes.club/v1/events \
  -H "Authorization: Bearer sk_test_xxx"

# Query parameter
curl "https://api.axxes.club/v1/events?api_key=sk_test_xxx"
```

### Key Types

| Prefix | Type | Use Case |
|--------|------|----------|
| `pk_test_` | Publishable (Test) | Client-side, test mode |
| `sk_test_` | Secret (Test) | Server-side, test mode |
| `pk_live_` | Publishable (Live) | Client-side, live mode |
| `sk_live_` | Secret (Live) | Server-side, live mode |

## Core Resources

### Events

```bash
# Create an event
curl -X POST https://api.axxes.club/v1/events \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer Festival 2024",
    "starts_at": 1720310400,
    "venue_name": "Central Park",
    "city": "New York"
  }'

# List events
curl https://api.axxes.club/v1/events \
  -H "Authorization: Bearer sk_test_xxx"

# Publish an event
curl -X POST https://api.axxes.club/v1/events/evt_xxx/publish \
  -H "Authorization: Bearer sk_test_xxx"
```

### Ticket Types

```bash
# Create a ticket type
curl -X POST https://api.axxes.club/v1/ticket_types \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "evt_xxx",
    "name": "General Admission",
    "price": 5000,
    "quantity": 1000
  }'
```

### Orders

```bash
# Create an order
curl -X POST https://api.axxes.club/v1/orders \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "evt_xxx",
    "email": "customer@example.com",
    "items": [
      { "ticket_type": "tt_xxx", "quantity": 2 }
    ]
  }'

# Mark order as paid (generates tickets)
curl -X POST https://api.axxes.club/v1/orders/ord_xxx/pay \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "stripe_payment_intent": "pi_xxx"
  }'
```

### Tickets

```bash
# Lookup ticket by QR data
curl "https://api.axxes.club/v1/tickets/lookup?qr_data=qr_xxx" \
  -H "Authorization: Bearer sk_test_xxx"

# Check in a ticket
curl -X POST https://api.axxes.club/v1/tickets/tkt_xxx/check_in \
  -H "Authorization: Bearer sk_test_xxx"
```

## Idempotency

For POST/PUT/PATCH requests, include an `Idempotency-Key` header to prevent duplicate operations:

```bash
curl -X POST https://api.axxes.club/v1/orders \
  -H "Authorization: Bearer sk_test_xxx" \
  -H "Idempotency-Key: unique-request-id" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

## Error Handling

Errors follow a consistent format:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "resource_not_found",
    "message": "Event not found",
    "param": "event",
    "doc_url": "https://docs.axxes.club/errors/resource_not_found"
  }
}
```

### Error Types

| Type | Description |
|------|-------------|
| `authentication_error` | Invalid or missing API key |
| `permission_error` | Key doesn't have required permissions |
| `invalid_request_error` | Invalid parameters or resource not found |
| `rate_limit_error` | Too many requests |
| `api_error` | Internal server error |

## Webhooks

Configure webhook endpoints to receive real-time notifications:

- `event.created`
- `event.published`
- `event.cancelled`
- `order.created`
- `order.paid`
- `order.refunded`
- `ticket.checked_in`

## Rate Limits

| Mode | Limit |
|------|-------|
| Test | 20 requests/second |
| Live | 100 requests/second |

## Development

```bash
# Run tests
npm test

# Open Prisma Studio
npm run db:studio

# Generate Prisma client after schema changes
npm run db:generate

# Apply schema changes
npm run db:push
```

## License

MIT © Axxes Club
