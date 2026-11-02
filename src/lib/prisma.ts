import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/** Creates a PrismaClient connected through the `pg` driver adapter. */
export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL (see .env.example)");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One shared PrismaClient for the whole app (avoids exhausting DB connections).
export const prisma = createPrismaClient();
