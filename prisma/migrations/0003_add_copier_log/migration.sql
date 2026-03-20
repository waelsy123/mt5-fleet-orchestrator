-- CreateTable
CREATE TABLE "CopierLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetKey" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopierLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopierLog_sessionId_createdAt_idx" ON "CopierLog"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CopierLog_sessionId_targetKey_createdAt_idx" ON "CopierLog"("sessionId", "targetKey", "createdAt");
