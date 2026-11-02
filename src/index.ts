import { app } from "./app";
import { config } from "./lib/config";
import { prisma } from "./lib/prisma";
import { ensureAdmin } from "./lib/adminSeeder";
import { seedDemoData } from "./lib/demoData";

async function main() {
  await prisma.$connect();
  await ensureAdmin();

  // First start on an empty database: create every role (managers, chefs, waiters/cashiers,
  // HQ, customers), the 7 branches, menus, tables and order history automatically,
  // so the system can be demonstrated immediately. Set SEED_DEMO_DATA=false to skip.
  if (config.seedDemoData && (await prisma.branch.count()) === 0) {
    console.log("Empty database detected — loading Steakz demo data…");
    await seedDemoData(prisma);
  }

  app.listen(config.port, () => {
    console.log(`🥩 Steakz API running on http://localhost:${config.port}`);
  });
}

main().catch(async (err) => {
  console.error("Failed to start server:", err);
  await prisma.$disconnect();
  process.exit(1);
});
