-- AI scene styles (theme default + per-category override) and a default expert per category
ALTER TABLE "Theme" ADD COLUMN "brollStyle" TEXT;
ALTER TABLE "Category" ADD COLUMN "brollStyle" TEXT;
ALTER TABLE "Category" ADD COLUMN "expertId" TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- one-time data setup (requested): every existing category gets the editorial ink style
-- (colours are filled in from the project theme at generation time)
UPDATE "Category" SET "brollStyle" = 'Hand-drawn editorial ink animation on warm textured paper tinted {{paper}}, thin imperfect pen lines and charcoal hatching in {{ink}}, subtle paper grain, tiny {{accent}} accents only during conflict or key moments. Keep one consistent look and the same recurring objects in every shot. Motion from frame one. Characters only emote and gesture, they do NOT talk; faceless or simplified figures, no readable text, letters or logos. Diegetic audio only, no speech, no music.' WHERE "brollStyle" IS NULL;

-- expert "Marek Czyżewski" and a "Growth" category with the same style in every existing project
INSERT INTO "Expert" ("id", "name", "createdAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), 'Marek Czyżewski', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Expert" WHERE "name" = 'Marek Czyżewski');

INSERT INTO "Category" ("id", "name", "projectId", "order", "brollStyle", "expertId")
SELECT 'c' || substr(md5(random()::text || p."id"), 1, 24), 'Growth', p."id",
       COALESCE((SELECT MAX(c."order") + 1 FROM "Category" c WHERE c."projectId" = p."id"), 0),
       'Hand-drawn editorial ink animation on warm textured paper tinted {{paper}}, thin imperfect pen lines and charcoal hatching in {{ink}}, subtle paper grain, tiny {{accent}} accents only during conflict or key moments. Keep one consistent look and the same recurring objects in every shot. Motion from frame one. Characters only emote and gesture, they do NOT talk; faceless or simplified figures, no readable text, letters or logos. Diegetic audio only, no speech, no music.',
       (SELECT e."id" FROM "Expert" e WHERE e."name" = 'Marek Czyżewski' ORDER BY e."createdAt" LIMIT 1)
FROM "Project" p
WHERE NOT EXISTS (SELECT 1 FROM "Category" c WHERE c."projectId" = p."id" AND c."name" = 'Growth');

UPDATE "Category" SET "expertId" = (SELECT e."id" FROM "Expert" e WHERE e."name" = 'Marek Czyżewski' ORDER BY e."createdAt" LIMIT 1)
WHERE "name" = 'Growth' AND "expertId" IS NULL;
