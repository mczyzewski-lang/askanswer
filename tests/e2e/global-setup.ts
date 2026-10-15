import { execSync } from "node:child_process";
import fs from "node:fs";

/** Fresh test database + storage for every E2E run (never touches the dev database). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL!;
  if (!/askby_test/.test(url)) throw new Error("Refusing to reset a non-test database: " + url);
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
  execSync(
    `psql "${url.replace("?schema=public", "")}" -v ON_ERROR_STOP=1 -c 'TRUNCATE "User","Expert","Theme","Project","Category","Question","Invitation","Recording","RecordingTake","MediaAsset","Transcript","TranscriptWord","SubtitleSegment","SilenceSuggestion","VideoComposition","RenderJob","Job","VoiceCollection","VoiceCollectionItem" CASCADE'`,
    { stdio: "inherit" },
  );
  fs.rmSync("storage-test", { recursive: true, force: true });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: process.env });
  execSync("npx tsx scripts/make-fixtures.ts", { stdio: "inherit" });
}
