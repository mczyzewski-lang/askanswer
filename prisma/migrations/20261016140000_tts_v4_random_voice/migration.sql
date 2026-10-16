-- Eleven v4 as the default narrator model; projects on "default" switch to it
ALTER TABLE "Project" ALTER COLUMN "ttsModel" SET DEFAULT 'eleven_v4';
UPDATE "Project" SET "ttsModel" = 'eleven_v4' WHERE "ttsModel" IS NULL OR "ttsModel" = '';

-- random narrator voice from a collection, and natural hesitations
ALTER TABLE "Project" ADD COLUMN "voiceCollectionId" TEXT;
ALTER TABLE "Project" ADD COLUMN "naturalFillers" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Project" ADD CONSTRAINT "Project_voiceCollectionId_fkey" FOREIGN KEY ("voiceCollectionId") REFERENCES "VoiceCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
