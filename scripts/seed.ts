import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

function generateApiKey(type: "PUBLISHABLE" | "SECRET", mode: "TEST" | "LIVE"): string {
  const prefix = type === "PUBLISHABLE" ? "pk" : "sk";
  const modePrefix = mode === "TEST" ? "test" : "live";
  const random = randomBytes(24).toString("base64url");
  return `${prefix}_${modePrefix}_${random}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function main() {
  console.log("🌱 Seeding database...\n");

  // Create account
  const account = await prisma.account.create({
    data: {
      name: "Test Organizer",
      email: "test@axxes.club",
    },
  });
  console.log("✅ Account created:", account.id);

  // Create API keys
  const testSecretKey = generateApiKey("SECRET", "TEST");
  const testPublishableKey = generateApiKey("PUBLISHABLE", "TEST");

  await prisma.apiKey.create({
    data: {
      accountId: account.id,
      key: testSecretKey,
      keyHash: hashApiKey(testSecretKey),
      name: "Test Secret",
      type: "SECRET",
      mode: "TEST",
    },
  });

  await prisma.apiKey.create({
    data: {
      accountId: account.id,
      key: testPublishableKey,
      keyHash: hashApiKey(testPublishableKey),
      name: "Test Publishable",
      type: "PUBLISHABLE",
      mode: "TEST",
    },
  });

  console.log("\n📋 API Keys (save these!):");
  console.log("─".repeat(60));
  console.log(`Secret (test):      ${testSecretKey}`);
  console.log(`Publishable (test): ${testPublishableKey}`);
  console.log("─".repeat(60));

  console.log("\n✨ Seeding complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
