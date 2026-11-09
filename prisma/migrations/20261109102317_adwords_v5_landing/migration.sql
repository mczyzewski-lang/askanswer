-- AlterTable
ALTER TABLE "AdwordsAsset" ADD COLUMN     "landingVariantId" TEXT,
ADD COLUMN     "lp" JSONB,
ADD COLUMN     "recordScope" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "adwordsLanding" JSONB,
ADD COLUMN     "adwordsOffer" JSONB;

-- CreateTable
CREATE TABLE "AdwordsClaim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "proofSource" TEXT,
    "dateChecked" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "claimScope" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdwordsClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdwordsClaim_projectId_key_key" ON "AdwordsClaim"("projectId", "key");

-- AddForeignKey
ALTER TABLE "AdwordsClaim" ADD CONSTRAINT "AdwordsClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

