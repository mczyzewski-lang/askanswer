-- CreateTable
CREATE TABLE "EduVideo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "step" TEXT,
    "error" TEXT,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadSessionId" TEXT,
    "originalAssetId" TEXT,
    "proxyAssetId" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "words" JSONB,
    "pauses" JSONB,
    "cuts" JSONB,
    "summary" TEXT,
    "pauseMin" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    "exportAssetId" TEXT,
    "exportProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exportSettings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EduVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EduVideo_uploadSessionId_key" ON "EduVideo"("uploadSessionId");
