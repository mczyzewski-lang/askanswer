-- CreateTable
CREATE TABLE "SequenceClip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "words" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceFilm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'A',
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "note" TEXT,
    "parts" JSONB NOT NULL,
    "compositionId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "review" TEXT NOT NULL DEFAULT 'TODO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceFilm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SequenceClip_projectId_name_key" ON "SequenceClip"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceFilm_projectId_code_version_key" ON "SequenceFilm"("projectId", "code", "version");

-- AddForeignKey
ALTER TABLE "SequenceClip" ADD CONSTRAINT "SequenceClip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceFilm" ADD CONSTRAINT "SequenceFilm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

