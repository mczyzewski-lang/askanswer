-- AlterTable
ALTER TABLE "SequenceFilm" ADD COLUMN "overlays" JSONB,
ADD COLUMN "placed" TEXT[] DEFAULT ARRAY[]::TEXT[];
