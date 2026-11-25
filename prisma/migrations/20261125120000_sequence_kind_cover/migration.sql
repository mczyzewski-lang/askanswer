-- AlterTable
ALTER TABLE "SequenceFilm" ADD COLUMN "coverAssetId" TEXT,
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'sequence';
