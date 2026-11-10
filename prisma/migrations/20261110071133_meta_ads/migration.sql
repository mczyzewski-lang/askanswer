-- CreateTable
CREATE TABLE "MetaAd" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryText" TEXT NOT NULL DEFAULT '',
    "metaHeadline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "ctaButton" TEXT NOT NULL DEFAULT 'LEARN_MORE',
    "headline" TEXT NOT NULL DEFAULT '',
    "ctaImage" TEXT NOT NULL DEFAULT '',
    "destination" TEXT NOT NULL DEFAULT 'website',
    "url" TEXT,
    "webinarTitle" TEXT,
    "webinarAt" TIMESTAMP(3),
    "layout" TEXT NOT NULL DEFAULT 'typographic',
    "body" TEXT,
    "withoutExpert" BOOLEAN NOT NULL DEFAULT true,
    "photoIds" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaAd_projectId_idx" ON "MetaAd"("projectId");

-- AddForeignKey
ALTER TABLE "MetaAd" ADD CONSTRAINT "MetaAd_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

