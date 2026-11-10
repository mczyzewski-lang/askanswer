import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");
const HIST_NAME = "Grupa plików – raport szczegółowych informacji o komponentach (3).csv";
const HIST = fs.readFileSync(`tests/fixtures/adwords/${HIST_NAME}`, "utf-8");

test("Asystent: analysis of the PMax history + current set → new content proposals (checked) → added to Google and Meta", async ({ page, request }) => {
  test.setTimeout(240_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  await request.post(`${base}/import`, { data: { text: V5, fileName: "v5.csv", dryRun: false } });
  await request.post(`${base}/history`, { data: { text: HIST, fileName: HIST_NAME, dryRun: false } });
  const before = await (await request.get(base)).json();

  await login(page);
  await page.goto(`/admin/adwords/${project.id}?tab=asystent`);
  const panel = page.getByTestId("proposals");
  await panel.getByTestId("proposals-run").click();
  // the analysis uses the history (clicks, CTR by angle) and the current set
  await expect(panel.getByTestId("proposals-analysis")).toContainText("Najwięcej kliknięć w historii");
  await expect(panel.getByTestId("proposals-analysis")).toContainText("Kąty wg mediany CTR");
  await expect(panel.getByTestId("proposals-analysis")).toContainText("Oferta bezpłatnego planu niepotwierdzona");
  // a proposal breaking the rules is flagged and not picked
  const bad = panel.getByTestId("proposal").filter({ has: page.locator('input[value="Najlepszy rozwód w mieście"]') });
  await expect(bad).toContainText("zwrot wartościujący");
  await expect(bad.getByRole("checkbox")).not.toBeChecked();
  // an existing headline is flagged as a duplicate
  await expect(panel.getByTestId("proposal").filter({ has: page.locator('input[value="Rozwód bez walki w sądzie"]') }).first()).toContainText("już jest w zestawie");
  await panel.getByTestId("proposals-add").click();
  await expect(page.getByText(/Dodano: \d+ tekstów, \d+ konceptów graficznych/)).toBeVisible();

  const after = await (await request.get(base)).json();
  const ai = after.assets.filter((a: { assetKey: string }) => a.assetKey.startsWith("AI-"));
  expect(ai.map((a: { adText: string }) => a.adText)).toEqual(expect.arrayContaining(["Rozwód? Najpierw plan", "Rozwód z planem"]));
  expect(ai.some((a: { adText: string }) => /Najlepszy/.test(a.adText))).toBe(false);
  // a comparison concept (3 formats) and a steps concept were created
  const newConcepts = [...new Set(after.assets.filter((a: { rowType: string }) => a.rowType === "image").map((a: { conceptId: string }) => a.conceptId))].filter((c) => !before.assets.some((b: { conceptId: string }) => b.conceptId === c));
  expect(newConcepts).toHaveLength(2);
  const cmp = after.assets.filter((a: { conceptId: string; effectiveLayout: string }) => newConcepts.includes(a.conceptId) && a.effectiveLayout === "comparison");
  expect(cmp).toHaveLength(3);
  for (const a of cmp) expect((await request.get(`${base}/render/${a.id}`)).headers()["x-render-overflow"]).toBe("false");
  // the Meta ad
  const meta = await (await request.get(`${base}/meta`)).json();
  expect(meta.map((m: { name: string }) => m.name)).toContain("Meta AI — bez walki");
});

