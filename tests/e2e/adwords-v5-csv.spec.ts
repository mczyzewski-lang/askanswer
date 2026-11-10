import { expect, test, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import { adminRequest, login } from "./helpers";

const V1_PATH = "tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv";
const V5_PATH = "tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv";
const V1 = fs.readFileSync(V1_PATH, "utf-8");
const V5 = fs.readFileSync(V5_PATH, "utf-8");

type Row = Record<string, unknown> & { assetKey: string; id: string };
const SKIP = new Set(["id", "projectId", "createdAt", "updatedAt", "order", "expertPhotoId", "approvedAt", "approvedBy", "edit", "layout", "effectiveLayout"]);
/** what a project holds, by asset_id, without database ids / timestamps */
async function state(request: APIRequestContext, projectId: string) {
  const d = await (await request.get(`/api/admin/adwords/${projectId}`)).json();
  return Object.fromEntries((d.assets as Row[]).map((a) => [a.assetKey, Object.fromEntries(Object.entries(a).filter(([k]) => !SKIP.has(k)).map(([k, v]) => [k, k === "lp" && v ? Object.fromEntries(Object.entries(v as object).sort()) : v]))]));
}
const newProject = async (request: APIRequestContext, name: string) => (await (await request.post("/api/admin/projects", { data: { name, preset: "nowy-etap" } })).json()).id as string;
const imp = async (request: APIRequestContext, id: string, text: string, dryRun = false) => (await request.post(`/api/admin/adwords/${id}/import`, { data: { text, dryRun, fileName: "x.csv" } })).json();

test("CSV v5 (99 columns) and v1 (30): import report, all 50 ad assets + 16 landing records saved and editable, export → re-import without loss", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);

  // ---- v1 (30 columns) still imports as before, and survives export → re-import
  const p1 = await newProject(request, "Nowy Etap v1");
  const d1 = await imp(request, p1, V1, true);
  expect([d1.schema, d1.headers.length, d1.columns.unknown.length]).toEqual(["v1", 30, 0]);
  expect((await imp(request, p1, V1)).created).toBe(81);
  const csv1 = await (await request.get(`/api/admin/adwords/${p1}/csv`)).text();
  expect(csv1.split("\r\n")[0].replace(/^﻿/, "").split(";")).toHaveLength(30);
  const p1b = await newProject(request, "Nowy Etap v1 kopia");
  expect((await imp(request, p1b, csv1)).created).toBe(81);
  expect(await state(request, p1b)).toEqual(await state(request, p1));

  // ---- v5 (99 columns): the import report
  const p5 = await newProject(request, "Nowy Etap");
  const dry = await imp(request, p5, V5, true);
  expect([dry.schema, dry.headers.length, dry.total]).toEqual(["v5", 99, 66]);
  expect(dry.scopes).toEqual({ adAssets: 50, landingContent: 16 });
  expect(dry.columns.unknown).toEqual([]);
  expect(Object.keys(dry.columns.groups)).toEqual(expect.arrayContaining(["video", "comparison", "historical", "test", "score", "landing"]));
  expect(dry.issues.filter((i: { level: string }) => i.level === "error")).toEqual([]);
  expect(dry.missing.length).toBeGreaterThan(0);

  // the same report in the UI
  await login(page);
  await page.goto(`/admin/adwords/${p5}?tab=import`);
  await page.getByTestId("import-file").setInputFiles(V5_PATH);
  await expect(page.getByTestId("import-columns")).toContainText("Schemat V5 · 99 kolumn");
  await expect(page.getByTestId("import-columns")).toContainText("Skrypt wideo");
  await expect(page.getByTestId("import-missing")).toContainText("landing_url");
  await expect(page.getByTestId("import-scopes")).toContainText("50 assetów reklam + 16 bloków");
  if (process.env.LP_SHOTS) await page.getByTestId("import-preview").screenshot({ path: `${process.env.LP_SHOTS}/import-v5.png` });

  // ---- import: 50 ad assets + 16 landing records (+16 editable scenes from the video scripts); idempotent
  const r = await imp(request, p5, V5);
  expect([r.created, r.derivedScenes]).toEqual([82, 16]);
  let data = await (await request.get(`/api/admin/adwords/${p5}`)).json();
  const assets = data.assets as Row[];
  expect(assets.filter((a) => a.recordScope === "ad_asset")).toHaveLength(50);
  expect(assets.filter((a) => a.recordScope === "landing_content")).toHaveLength(16);
  const by = (k: string) => assets.find((a) => a.assetKey === k)!;
  expect(by("G07-L").effectiveLayout).toBe("comparison");
  expect([by("G01-L").experimentId, by("G01-L").variant, by("G01-L").pairedAssetId, by("G01-L").testPriority]).toEqual(["T01", "A", "G02-L", 1]);
  expect((by("G01-L").lp as Record<string, string>).historical_impressions).toBe("920583");
  expect([by("V01-SC1").screenText, by("V01-SC2").spokenText]).toEqual(["Rozwód bez walki w sądzie?", "Najpierw siadamy do planu: co ustalić w sprawie majątku, dzieci i kontaktów."]);
  expect((by("LP_A_PLAN-hero").lp as Record<string, string>).landing_social_proof).toContain("4,8/5");
  const again = await imp(request, p5, V5);
  expect([again.created, again.updated, again.unchanged]).toEqual([0, 0, 82]);
  // the comparison creative renders (same drawing as the preview)
  const png = await request.get(`/api/admin/adwords/${p5}/render/${by("G07-L").id}`);
  expect(png.status()).toBe(200);
  expect(png.headers()["x-render-overflow"]).toBe("false");
  if (process.env.LP_SHOTS) fs.writeFileSync(`${process.env.LP_SHOTS}/g07-comparison.png`, await png.body());

  // ---- editable: a comparison side, a scene, a landing block
  const base = `/api/admin/adwords/${p5}`;
  expect((await request.patch(`${base}/assets/${by("G07-L").id}`, { data: { lp: { comparison_right: "Plan, potem pozew" } } })).ok()).toBe(true);
  expect((await request.patch(`${base}/assets/${by("V01-SC2").id}`, { data: { spokenText: "Najpierw plan — co ustalić." } })).ok()).toBe(true);
  expect((await request.patch(`${base}/landing/blocks/${by("LP_B_COST-hero").id}`, { data: { landing_h1: "Koszt naszej usługi znasz przed decyzją." } })).ok()).toBe(true);
  // the image editor shows the comparison fields
  await page.goto(`${"/admin/adwords/"}${p5}?tab=grafiki`);
  await page.getByTestId("concept-card").filter({ hasText: "G07" }).click();
  await expect(page.getByTestId("comparison-fields")).toBeVisible();
  await expect(page.getByLabel("Prawa — treść")).toHaveValue("Plan, potem pozew");

  // ---- export (the file's 99 columns in its order) → import into a new project: the same records, edits included
  const csv = await (await request.get(`${base}/csv`)).text();
  const header = csv.split("\r\n")[0].replace(/^﻿/, "").split(";");
  expect(header).toEqual(V5.split(/\r?\n/)[0].replace(/^﻿/, "").split(";"));
  expect(csv).toContain("video_spoken_3_9");
  expect(csv).toContain("Najpierw plan - co ustalić.");
  const p5b = await newProject(request, "Nowy Etap kopia");
  const r2 = await imp(request, p5b, csv);
  expect([r2.created, r2.derivedScenes, r2.total]).toEqual([82, 16, 66]);
  const s1 = await state(request, p5);
  const s2 = await state(request, p5b);
  expect(s2).toEqual(s1);
  expect((s2["G07-L"].lp as Record<string, string>).comparison_right).toBe("Plan, potem pozew");
  expect(s2["V01-SC2"].spokenText).toBe("Najpierw plan - co ustalić.");
  // and back into the first project: nothing changes, nothing is duplicated
  const back = await imp(request, p5, csv);
  expect([back.created, back.updated]).toEqual([0, 0]);
  data = await (await request.get(base)).json();
  expect(data.assets).toHaveLength(82);
});
