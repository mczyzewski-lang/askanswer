import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { adminRequest, login } from "./helpers";

const V1 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
const V2 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_kreacje_AB_v2.csv", "utf-8");
const HIST_NAME = "Grupa plików – raport szczegółowych informacji o komponentach (3).csv";
const HIST = fs.readFileSync(`tests/fixtures/adwords/${HIST_NAME}`, "utf-8");

test("Google Adwords v2: creatives v1 + v2 (experiments), Historia PMax, per-arm export, assistant", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  const imp = async (text: string, dryRun = false) => (await request.post(`${base}/import`, { data: { text, dryRun, fileName: "x.csv" } })).json();

  // 1. creatives v1 (81) and v2 (experiments) — both idempotent
  expect((await imp(V1)).created).toBe(81);
  const v2 = await imp(V2);
  expect(v2.kind).toBe("creatives");
  expect(v2.concepts.experiments).toBe(5);
  expect(v2.counts.experiment_plan).toBe(5);
  expect(v2.counts.historical_reference).toBe(4);
  expect([v2.updated, v2.unchanged]).toEqual([0, 0]);
  const again = await imp(V2);
  expect([again.created, again.updated]).toEqual([0, 0]);
  expect((await imp(V1)).unchanged).toBe(81);
  const total = 81 + v2.total;

  // 2. the Google Ads report is recognised and goes to Historia PMax (67 rows, the period, exact values)
  const dry = await (await request.post(`${base}/import`, { data: { text: HIST, dryRun: true, fileName: HIST_NAME } })).json();
  expect([dry.kind, dry.total, dry.applied]).toEqual(["history", 67, false]);
  const h1 = await (await request.post(`${base}/history`, { data: { text: HIST, fileName: HIST_NAME, dryRun: false } })).json();
  expect([h1.applied, h1.total, h1.replaced]).toEqual([true, 67, false]);
  const h2 = await (await request.post(`${base}/history`, { data: { text: HIST, fileName: HIST_NAME, dryRun: false } })).json();
  expect(h2.replaced).toBe(true);
  const hist = await (await request.get(`${base}/history`)).json();
  expect(hist.imports).toHaveLength(1);
  expect(hist.rows).toHaveLength(67);
  expect([hist.imports[0].periodFrom.slice(0, 10), hist.imports[0].periodTo.slice(0, 10)]).toEqual(["2026-01-01", "2026-11-08"]);
  const r = hist.rows.find((x: { component: string }) => x.component === "Rozwód bez walki w sądzie");
  expect([r.impressions, r.clicks, r.conversions, r.cost, r.raw["Wartość konw."]]).toEqual([920583, 122016, 8825.39, 266241.65, "0,00"]);
  expect(hist.rows.every((x: { convValue: number }) => x.convValue === 0)).toBe(true);
  // no totals anywhere in the API
  expect(JSON.stringify(Object.keys(hist))).toBe('["imports","rows"]');
  // the creatives were not touched by the history import
  expect((await (await request.get(base)).json()).assets).toHaveLength(total);

  // 3. the archive blocks reuse; meta rows are never rendered
  const data = await (await request.get(base)).json();
  const plan = data.assets.find((a: { rowType: string }) => a.rowType === "experiment_plan");
  expect((await request.get(`${base}/render/${plan.id}`)).status()).toBe(400);
  const added = await (await request.post(`${base}/assets`, { data: { rowType: "headline", adText: "Złóż to zamiast pozwu", assetGroup: "AG-SPRZEDAZ" } })).json();
  const ev = (await (await request.get(base)).json()).evaluation.texts.find((t: { id: string }) => t.id === added.id);
  expect(ev.gate.status).toBe("blokada");
  await request.delete(`${base}/assets/${added.id}`);

  // 4. export one arm: B of T01 only — its 3 images, its texts, its video sources; no plan / archive
  const zB = unzipSync(new Uint8Array(await (await request.get(`${base}/zip?fmt=png&experiment=T01&variant=B`)).body()));
  const names = Object.keys(zB);
  expect(names.filter((n) => n.startsWith("grafiki/"))).toEqual(expect.arrayContaining(["grafiki/nowy-etap_T01B_landscape_1200x628.png", "grafiki/nowy-etap_T01B_square_1200x1200.png", "grafiki/nowy-etap_T01B_portrait_960x1200.png"]));
  expect(names.filter((n) => n.startsWith("grafiki/"))).toHaveLength(3);
  expect(names).toEqual(expect.arrayContaining(["wideo/VT01B/napisy.srt", "wideo/VT01B/teleprompter.txt", "wideo/shotlista.csv", "teksty_google_ads.csv", "manifest.json"]));
  const man = JSON.parse(strFromU8(zB["manifest.json"]));
  expect(man.files.every((f: { experiment_id: string; variant: string; cta: string }) => f.experiment_id === "T01" && f.variant === "B" && f.cta === "Umów konsultację")).toBe(true);
  const txt = strFromU8(zB["teksty_google_ads.csv"]);
  expect(txt).toContain("Rozwód bez wojny");
  expect(txt).not.toContain("Rozwód bez walki w sądzie");
  expect(txt).not.toMatch(/experiment_plan|historical_reference|zamiast pozwu/);
  // one concept as a set
  const zG = unzipSync(new Uint8Array(await (await request.get(`${base}/zip?fmt=png&concepts=G02`)).body()));
  expect(Object.keys(zG).filter((n) => n.startsWith("grafiki/"))).toHaveLength(3);

  // 5. the assistant: an image concept and a video script
  const di = await (await request.post(`${base}/assistant`, { data: { prompt: "Grafika o tym, że najpierw ustalamy plan, potem pozew", kind: "image" } })).json();
  expect(di.image.headline).toBe("Plan przed pozwem");
  expect((await request.put(`${base}/assistant`, { data: { draft: di, campaignCode: "NE-PMAX-SPRZ", headlineForAds: true } })).status()).toBe(201);
  const dv = await (await request.post(`${base}/assistant`, { data: { prompt: "Film: czy rozwód musi być wojną, 3 kroki i CTA", kind: "video" } })).json();
  expect(dv.video.scenes[0]).toMatchObject({ startS: 0, endS: 3 });
  await request.put(`${base}/assistant`, { data: { draft: dv } });
  const after = (await (await request.get(base)).json()).assets as Array<{ conceptId: string; rowType: string }>;
  expect(after.filter((a) => a.conceptId === di.conceptId && a.rowType === "image")).toHaveLength(3);
  expect(after.filter((a) => a.conceptId === dv.conceptId && a.rowType === "video")).toHaveLength(3);
  expect(after.filter((a) => a.conceptId === dv.conceptId && a.rowType === "video_scene")).toHaveLength(4);

  // UI
  await login(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`/admin/adwords/${project.id}?tab=historia`);
  await expect(page.getByTestId("non-additive")).toContainText("nie sumujemy");
  await expect(page.getByTestId("roas")).toHaveText("ROAS niedostępny");
  await expect(page.getByTestId("history-row")).toHaveCount(67);
  await page.getByLabel("Typ komponentu").selectOption("headline");
  await expect(page.getByTestId("history-row").first()).toContainText("Rozwód bez walki w sądzie");
  await expect(page.getByTestId("history-table")).not.toContainText(/Łącznie|Suma/);
  // link a historical component to a concept (hypothesis source)
  await page.getByTestId("history-row").first().getByRole("combobox").selectOption("G01");
  await expect.poll(async () => (await (await request.get(`${base}/history`)).json()).rows.find((x: { component: string }) => x.component === "Rozwód bez walki w sądzie").conceptId).toBe("G01");

  await page.goto(`/admin/adwords/${project.id}?tab=eksperymenty`);
  await expect(page.getByTestId("experiment-card")).toHaveCount(5);
  await expect(page.getByTestId("experiment-checks")).toContainText("od 3. sekundy do końca są identyczne");
  await expect(page.getByTestId("arm-A")).toContainText("Rozwód bez walki w sądzie");
  await expect(page.getByTestId("arm-B")).toContainText("Rozwód bez wojny");
  await expect(page.getByTestId("arm-A").getByTestId("historical-evidence")).toContainText("920");
  await expect(page.getByTestId("arm-A").getByTestId("historical-evidence")).toContainText("Wymaga testu A/B");
  await page.getByTestId("experiment-mode").selectOption("exploration");
  await expect(page.getByTestId("mode-note")).toContainText("brak izolowanego testu");
  await expect(page.getByTestId("export-arm-B")).toHaveAttribute("href", /experiment=T01&variant=B/);

  // the assistant from the page: describe → draft → add → it is in the gallery
  await page.goto(`/admin/adwords/${project.id}?tab=asystent`);
  await page.getByTestId("assistant-prompt").fill("Grafika z hasłem o planie przed pozwem, ciepłe kolory, CTA konsultacja");
  await page.getByTestId("assistant-ask").click();
  await expect(page.getByTestId("assistant-draft")).toBeVisible();
  await expect(page.getByLabel("Hasło propozycji")).toHaveValue("Plan przed pozwem");
  await page.getByLabel("Hasło propozycji").fill("Najpierw plan rozstania");
  await page.getByTestId("assistant-save").click();
  await expect(page.getByTestId("concept-card").filter({ hasText: "Najpierw plan rozstania" })).toBeVisible();
  // download one concept / a selection
  const card = page.getByTestId("concept-card").filter({ hasText: "G02" });
  await expect(card.getByTestId("download-concept")).toHaveAttribute("href", /concepts=G02/);
  await card.getByTestId("pick-concept").check();
  await page.getByTestId("concept-card").filter({ hasText: "G03" }).getByTestId("pick-concept").check();
  await expect(page.getByTestId("download-picked")).toHaveAttribute("href", /concepts=G02%2CG03/);

  // the brief: hypothesis lines from history, A/B vs exploration kept apart, missing data
  await page.goto(`/admin/adwords/${project.id}?tab=raport`);
  const brief = await page.getByLabel("Brief").inputValue();
  expect(brief).toContain("Hipoteza oparta na:");
  expect(brief).toContain("nie jest wynikiem testu kontrolowanego");
  expect(brief).toContain("Eksploracja");
  expect(brief).toContain("Testy A/B");
  expect(brief).toContain("Brakujące dane");
  expect(brief).toContain("ROAS niedostępny");
  // the landing page tab: the mock repeats the ad's headline / CTA, checks, a spec to download
  await page.goto(`/admin/adwords/${project.id}?tab=landing`);
  await expect(page.getByTestId("landing-h1")).not.toBeEmpty();
  await expect(page.getByTestId("landing-checks")).toContainText("URL");
  await expect(page.getByTestId("landing-sections")).toContainText("H1 = hasło z reklamy");
  await page.getByRole("button", { name: "Komputer" }).click();
  await page.getByTestId("landing-mock").screenshot({ path: "test-results/landing-desktop.png" });
  await page.getByRole("button", { name: "Telefon" }).click();
  await page.getByTestId("landing-mock").screenshot({ path: "test-results/landing-mobile.png" });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("landing-download").click()]);
  expect(dl.suggestedFilename()).toMatch(/^landing_page_.*\.md$/);
});
