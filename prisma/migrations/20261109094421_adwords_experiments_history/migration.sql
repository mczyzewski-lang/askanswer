-- AlterTable
ALTER TABLE "AdwordsAsset" ADD COLUMN     "deployMode" TEXT,
ADD COLUMN     "evidenceNote" TEXT,
ADD COLUMN     "experimentId" TEXT,
ADD COLUMN     "pairedAssetId" TEXT,
ADD COLUMN     "testAxis" TEXT,
ADD COLUMN     "testStage" TEXT,
ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "AdwordsHistoryImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "title" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "periodRaw" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdwordsHistoryImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdwordsHistoryRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "assetState" TEXT,
    "component" TEXT NOT NULL,
    "level" TEXT,
    "status" TEXT,
    "assetType" TEXT,
    "typeKey" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3),
    "conversions" DOUBLE PRECISION,
    "convValue" DOUBLE PRECISION,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "currency" TEXT,
    "cost" DOUBLE PRECISION,
    "addedBy" TEXT,
    "angle" TEXT,
    "conceptId" TEXT,

    CONSTRAINT "AdwordsHistoryRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdwordsHistoryImport_projectId_fileHash_key" ON "AdwordsHistoryImport"("projectId", "fileHash");

-- CreateIndex
CREATE INDEX "AdwordsHistoryRow_projectId_typeKey_idx" ON "AdwordsHistoryRow"("projectId", "typeKey");

-- CreateIndex
CREATE INDEX "AdwordsHistoryRow_importId_idx" ON "AdwordsHistoryRow"("importId");

-- AddForeignKey
ALTER TABLE "AdwordsHistoryImport" ADD CONSTRAINT "AdwordsHistoryImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdwordsHistoryRow" ADD CONSTRAINT "AdwordsHistoryRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AdwordsHistoryImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

