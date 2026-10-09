-- Independent API identities are Account rows, not Handshake users.
-- Apply before promoting the Prisma client/runtime using isActive.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;
