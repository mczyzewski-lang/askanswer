-- AlterTable
ALTER TABLE "CommentReply" ADD COLUMN     "automationId" TEXT;

-- CreateTable
CREATE TABLE "CommentAutomation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "publicReply" TEXT NOT NULL DEFAULT '',
    "dmReply" TEXT NOT NULL DEFAULT '',
    "platforms" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentAutomation_projectId_idx" ON "CommentAutomation"("projectId");

-- AddForeignKey
ALTER TABLE "CommentAutomation" ADD CONSTRAINT "CommentAutomation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SocialProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
