-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "adwordsBrief" TEXT;

-- CreateTable
CREATE TABLE "AdwordsCampaign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT 'sprzedaz',
    "landingUrl" TEXT,
    "businessName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdwordsCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdwordsAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "rowType" TEXT NOT NULL,
    "funnel" TEXT,
    "campaignCode" TEXT,
    "assetGroup" TEXT,
    "conceptId" TEXT,
    "aspectRatio" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "sceneIndex" INTEGER,
    "startS" DOUBLE PRECISION,
    "endS" DOUBLE PRECISION,
    "headline" TEXT,
    "subheadline" TEXT,
    "body" TEXT,
    "cta" TEXT,
    "adText" TEXT,
    "spokenText" TEXT,
    "screenText" TEXT,
    "visualBrief" TEXT,
    "expertPhotoKey" TEXT,
    "expertPhotoId" TEXT,
    "landingUrl" TEXT,
    "claimSource" TEXT,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "status" TEXT,
    "scoreSeed" DOUBLE PRECISION,
    "scoreNote" TEXT,
    "layout" TEXT,
    "edit" JSONB,
    "extra" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdwordsAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdwordsExpertPhoto" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "assetId" TEXT NOT NULL,
    "altText" TEXT,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentNote" TEXT,
    "consentAt" TIMESTAMP(3),
    "focalX" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "focalY" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdwordsExpertPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdwordsCampaign_projectId_code_key" ON "AdwordsCampaign"("projectId", "code");

-- CreateIndex
CREATE INDEX "AdwordsAsset_projectId_rowType_idx" ON "AdwordsAsset"("projectId", "rowType");

-- CreateIndex
CREATE UNIQUE INDEX "AdwordsAsset_projectId_assetKey_key" ON "AdwordsAsset"("projectId", "assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "AdwordsExpertPhoto_themeId_key_key" ON "AdwordsExpertPhoto"("themeId", "key");

-- AddForeignKey
ALTER TABLE "AdwordsCampaign" ADD CONSTRAINT "AdwordsCampaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdwordsAsset" ADD CONSTRAINT "AdwordsAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdwordsExpertPhoto" ADD CONSTRAINT "AdwordsExpertPhoto_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

