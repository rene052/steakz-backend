import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "./prisma";
import { config } from "./config";

/**
 * Runs every time the server starts. If no ADMIN account exists yet (i.e. the very
 * first start), it creates one from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
 * The password is stored as a bcrypt hash — never in plain text.
 */
export async function ensureAdmin(prisma: PrismaClient = defaultClient) {
  const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existing) return;

  await prisma.user.create({
    data: {
      name: config.adminName,
      email: config.adminEmail.toLowerCase(),
      password: await bcrypt.hash(config.adminPassword, 10),
      role: "ADMIN",
    },
  });
  console.log(`✔ Admin account created: ${config.adminEmail}`);
}
