-- CreateTable
CREATE TABLE "VoiceCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCollectionItem_collectionId_voiceId_key" ON "VoiceCollectionItem"("collectionId", "voiceId");

-- AddForeignKey
ALTER TABLE "VoiceCollectionItem" ADD CONSTRAINT "VoiceCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "VoiceCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
