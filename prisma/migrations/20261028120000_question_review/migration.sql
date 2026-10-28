-- AlterTable
ALTER TABLE "Question" ADD COLUMN "review" JSONB,
ADD COLUMN "reviewedAt" TIMESTAMP(3);
