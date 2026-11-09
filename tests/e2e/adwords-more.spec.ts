import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");

test("Google Adwords: the topic in every headline (fix proposals), versions with the expert's photo, AI infographic versions", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  await request.post(`${base}/import`, { data: { text: V5, fileName: "v5.csv", dryRun: false } });
  let data = await (await request.get(base)).json();
  // the topic is read from the texts
  expect(data.project.topic).toBe("rozwód");
  const g03 = data.evaluation.images.find((e: { assetKey: string }) => e.assetKey === "G03-L");
  expect(g03.gate.problems.map((p: { message: string }) => p.message).join(" ")).toContain("nie mówi, czego dotyczy");

  // a photo of the expert (with consent)
  const photo = path.join(os.tmpdir(), `anna-${Date.now()}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=800x1000:duration=1", "-frames:v", "1", photo]);
  const up = await request.post(`${base}/photos`, { multipart: { file: { name: "anna.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(photo) }, key: "anna", name: "Anna Mediatorka", consentConfirmed: "true" } });
  expect(up.ok()).toBe(true);

  await login(page);
  await page.goto(`/admin/adwords/${project.id}?tab=grafiki`);
  const more = page.getByTestId("more-creatives");
  await expect(more).toContainText("bez tematu");
  // 1. proposals: G03 "Najpierw plan, potem pozew" → "… pozew o rozwód" (OpenAI mock), accepted
  await more.getByTestId("copy-fix").click();
  const row = page.getByTestId("copy-fix-row").filter({ hasText: "G03 (grafika)" });
  await expect(row.getByRole("textbox")).toHaveValue("Najpierw plan, potem pozew o rozwód");
  await page.getByTestId("copy-fix-apply").click();
  await expect(page.getByTestId("copy-fixes")).toHaveCount(0);
  data = await (await request.get(base)).json();
  expect(data.assets.filter((a: { conceptId: string; rowType: string }) => a.conceptId === "G03" && a.rowType === "image").every((a: { headline: string }) => a.headline === "Najpierw plan, potem pozew o rozwód")).toBe(true);
  expect(data.evaluation.images.find((e: { assetKey: string }) => e.assetKey === "G03-L").gate.problems.map((p: { message: string }) => p.message).join(" ")).not.toContain("nie mówi, czego dotyczy");

  // 2. versions with the expert: G03 + G04 picked → G03E, G04E with Anna's photo, layout expert_split
  for (const c of ["G03", "G04"]) await page.getByTestId("concept-card").filter({ hasText: c }).first().getByTestId("pick-concept").check();
  await more.getByTestId("variants-expert").click();
  await expect(page.getByTestId("concept-card").filter({ hasText: "G03E" })).toBeVisible();
  data = await (await request.get(base)).json();
  const g03e = data.assets.filter((a: { conceptId: string }) => a.conceptId === "G03E");
  expect(g03e).toHaveLength(3);
  expect(g03e.every((a: { effectiveLayout: string; expertPhotoKey: string }) => a.effectiveLayout === "expert_split" && a.expertPhotoKey === "anna")).toBe(true);
  const png = await request.get(`${base}/render/${g03e[0].id}`);
  expect([png.status(), png.headers()["x-render-overflow"]]).toEqual([200, "false"]);

  // 3. AI infographic version of G03 (background job, OpenAI image mock) → G03I, needs approval
  await more.getByTestId("variants-infographic").click();
  await expect(page.getByTestId("concept-card").filter({ hasText: "G03I" })).toBeVisible({ timeout: 120_000 });
  data = await (await request.get(base)).json();
  const g03i = data.assets.filter((a: { conceptId: string }) => a.conceptId === "G03I");
  expect(g03i).toHaveLength(3);
  expect(g03i.every((a: { effectiveLayout: string; approvalRequired: boolean; infographicUrl: string | null }) => a.effectiveLayout === "infographic" && a.approvalRequired && !!a.infographicUrl)).toBe(true);
  const ipng = await request.get(`${base}/render/${g03i[0].id}`);
  expect(ipng.status()).toBe(200);
  // AI text in the picture: not publishable until a person approves it
  expect(data.evaluation.images.find((e: { id: string }) => e.id === g03i[0].id).gate.status).toBe("blokada");
});
