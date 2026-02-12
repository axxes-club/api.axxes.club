import { nanoid } from "nanoid";

/**
 * Generate a unique order number (human-readable)
 */
export function generateOrderNumber(): string {
  // Format: AX-XXXXXXXX (8 chars)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "AX-";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a unique ticket number (human-readable)
 */
export function generateTicketNumber(): string {
  // Format: TKT-XXXXXXXXXXXX (12 chars)
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "TKT-";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate QR data for a ticket (signed token)
 */
export function generateQrData(): string {
  // For now, just a unique ID. Could be a signed JWT later.
  return `qr_${nanoid(32)}`;
}

/**
 * Generate a scanner code (6 digits)
 */
export function generateScannerCode(): string {
  return Math.random().toString().slice(2, 8).padEnd(6, "0");
}

/**
 * Generate a webhook secret
 */
export function generateWebhookSecret(): string {
  return `whsec_${nanoid(32)}`;
}

/**
 * Slugify a string
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Calculate platform fee (2.9% + $0.30 like Stripe)
 */
export function calculatePlatformFee(subtotal: number): number {
  // 2.9% + 30 cents
  return Math.round(subtotal * 0.029 + 30);
}

/**
 * Calculate processing fee (passed to Stripe)
 */
export function calculateProcessingFee(total: number): number {
  // Stripe fee: 2.9% + 30 cents
  return Math.round(total * 0.029 + 30);
}

/**
 * Format cents to display string
 */
export function formatCents(cents: number, currency: string = "usd"): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  return formatter.format(cents / 100);
}

/**
 * Pagination helper
 */
export function paginate<T>(
  items: T[],
  page: number = 1,
  limit: number = 10
): {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
} {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const data = items.slice(offset, offset + limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

/**
 * Convert Prisma object to API response (camelCase to snake_case)
 */
export function toApiResponse<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    
    if (value instanceof Date) {
      result[snakeKey] = Math.floor(value.getTime() / 1000); // Unix timestamp
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        typeof item === "object" && item !== null ? toApiResponse(item) : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[snakeKey] = toApiResponse(value);
    } else {
      result[snakeKey] = value;
    }
  }
  
  return result;
}

/**
 * Convert API request (snake_case to camelCase)
 */
export function fromApiRequest<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    
    if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        typeof item === "object" && item !== null ? fromApiRequest(item) : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[camelKey] = fromApiRequest(value);
    } else {
      result[camelKey] = value;
    }
  }
  
  return result;
}
