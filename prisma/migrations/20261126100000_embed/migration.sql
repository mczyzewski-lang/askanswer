-- AlterTable
ALTER TABLE "SequenceFilm" ADD COLUMN "embedToken" TEXT,
ADD COLUMN "embedAssetId" TEXT,
ADD COLUMN "embedNoCardAssetId" TEXT,
ADD COLUMN "embedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "SequenceFilm_embedToken_key" ON "SequenceFilm"("embedToken");

-- CreateTable
CREATE TABLE "EmbedEvent" (
    "id" TEXT NOT NULL,
    "filmId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "percent" INTEGER,
    "seconds" DOUBLE PRECISION,
    "page" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmbedEvent_filmId_createdAt_idx" ON "EmbedEvent"("filmId", "createdAt");

-- CreateIndex
CREATE INDEX "EmbedEvent_filmId_session_idx" ON "EmbedEvent"("filmId", "session");

-- AddForeignKey
ALTER TABLE "EmbedEvent" ADD CONSTRAINT "EmbedEvent_filmId_fkey" FOREIGN KEY ("filmId") REFERENCES "SequenceFilm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
