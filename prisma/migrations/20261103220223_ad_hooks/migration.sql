-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "adsRecording" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "hooks" TEXT[] DEFAULT ARRAY[]::TEXT[];
