-- project formats: Answers (questions + narration) and Prompter (Hook + script read from a teleprompter)
CREATE TYPE "ProjectFormat" AS ENUM ('ANSWERS', 'PROMPTER');
ALTER TABLE "Project" ADD COLUMN "format" "ProjectFormat" NOT NULL DEFAULT 'ANSWERS';
ALTER TABLE "Question" ADD COLUMN "script" TEXT;

-- experts explicitly assigned to a project
CREATE TABLE "ProjectExpert" (
    "projectId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectExpert_pkey" PRIMARY KEY ("projectId","expertId")
);
ALTER TABLE "ProjectExpert" ADD CONSTRAINT "ProjectExpert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectExpert" ADD CONSTRAINT "ProjectExpert_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- everyone already working in a project (questions, links, category default) becomes a member
INSERT INTO "ProjectExpert" ("projectId", "expertId")
SELECT DISTINCT "projectId", "expertId" FROM (
  SELECT "projectId", "expertId" FROM "Question" WHERE "expertId" IS NOT NULL
  UNION SELECT "projectId", "expertId" FROM "Invitation"
  UNION SELECT "projectId", "expertId" FROM "Category" WHERE "expertId" IS NOT NULL
) m
ON CONFLICT DO NOTHING;
