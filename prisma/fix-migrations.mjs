import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(`
    UPDATE _prisma_migrations
    SET finished_at = started_at, rolled_back_at = NULL, logs = NULL
    WHERE migration_name = '0001_init' AND finished_at IS NULL;
  `);
  console.log("[fix-migrations] Marked 0001_init as applied");
} catch (e) {
  console.log("[fix-migrations] Skipped:", e.message);
} finally {
  await prisma.$disconnect();
}
