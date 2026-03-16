-- CreateEnum
CREATE TYPE "VpsStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "ProvisionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "Vps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "vncIp" TEXT,
    "vncPort" INTEGER,
    "password" TEXT NOT NULL,
    "apiPort" INTEGER NOT NULL DEFAULT 8000,
    "status" "VpsStatus" NOT NULL DEFAULT 'PENDING',
    "lastSeen" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "broker" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freeMargin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "lastSynced" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "profit" DOUBLE PRECISION NOT NULL,
    "positions" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProvisionLog" (
    "id" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "status" "ProvisionStatus" NOT NULL DEFAULT 'RUNNING',
    "logs" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ProvisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Vps_ip_key" ON "Vps"("ip");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_vpsId_server_login_key" ON "Account"("vpsId", "server", "login");
CREATE INDEX IF NOT EXISTS "AccountSnapshot_accountId_timestamp_idx" ON "AccountSnapshot"("accountId", "timestamp");

-- AddForeignKey (idempotent via IF NOT EXISTS isn't supported for constraints, skip if exists)
DO $$ BEGIN
  ALTER TABLE "Account" ADD CONSTRAINT "Account_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProvisionLog" ADD CONSTRAINT "ProvisionLog_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "Vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
