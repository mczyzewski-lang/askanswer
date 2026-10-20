ALTER TYPE "ProjectFormat" ADD VALUE IF NOT EXISTS 'ADS';

CREATE TABLE "AdFootage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "step" TEXT,
    "error" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "receivedChunks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "originalAssetId" TEXT,
    "assetId" TEXT,
    "durationSec" DOUBLE PRECISION,
    "words" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdFootage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdFootage_projectId_idx" ON "AdFootage"("projectId");
ALTER TABLE "AdFootage" ADD CONSTRAINT "AdFootage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdReel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT,
    "parts" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "compositionId" TEXT,
    "matches" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdReel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdReel_projectId_code_key" ON "AdReel"("projectId", "code");
ALTER TABLE "AdReel" ADD CONSTRAINT "AdReel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
