-- AlterTable
ALTER TABLE "AdReel" ADD COLUMN     "autoReason" TEXT,
ADD COLUMN     "autoScore" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autoReels" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoReelsCount" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "autoReelsError" TEXT,
ADD COLUMN     "autoReelsMax" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "autoReelsMin" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "autoReelsStatus" TEXT NOT NULL DEFAULT 'IDLE',
ADD COLUMN     "autoReelsStep" TEXT;
