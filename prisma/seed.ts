/**
 * Reload the demo data:  npm run seed
 * (The same data is loaded automatically on the server's first start on an empty database.)
 */
import { createPrismaClient } from "../src/lib/prisma";
import { seedDemoData } from "../src/lib/demoData";

const prisma = createPrismaClient();

seedDemoData(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
