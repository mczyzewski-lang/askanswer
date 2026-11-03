-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "adsBrollPerReel" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "BrollFragment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceIn" DOUBLE PRECISION NOT NULL,
    "sourceOut" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrollFragment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrollFragment_projectId_idx" ON "BrollFragment"("projectId");
