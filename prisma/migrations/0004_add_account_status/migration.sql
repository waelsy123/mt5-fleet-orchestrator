-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('SETUP', 'ACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';
