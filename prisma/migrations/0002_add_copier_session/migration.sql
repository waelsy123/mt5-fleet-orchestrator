-- CreateTable
CREATE TABLE IF NOT EXISTS "CopierSession" (
    "id" TEXT NOT NULL,
    "running" BOOLEAN NOT NULL DEFAULT false,
    "sourceVpsId" TEXT NOT NULL,
    "sourceServer" TEXT NOT NULL,
    "sourceLogin" TEXT NOT NULL,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopierSession_pkey" PRIMARY KEY ("id")
);

-- Backward compat: migrate singleton row if it exists
-- (rename "singleton" -> "session_1" so restored sessions get proper IDs)
UPDATE "CopierSession" SET "id" = 'session_1' WHERE "id" = 'singleton';
