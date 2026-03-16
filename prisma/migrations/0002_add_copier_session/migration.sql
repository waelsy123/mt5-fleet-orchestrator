-- CreateTable
CREATE TABLE IF NOT EXISTS "CopierSession" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "running" BOOLEAN NOT NULL DEFAULT false,
    "sourceVpsId" TEXT NOT NULL,
    "sourceServer" TEXT NOT NULL,
    "sourceLogin" TEXT NOT NULL,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CopierSession_pkey" PRIMARY KEY ("id")
);
