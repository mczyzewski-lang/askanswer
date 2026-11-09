import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");
const OFFER = { producer: "Mediator i prawnik prowadzący", when: "do 2 dni roboczych po rozmowie", form: "PDF na e-mail + omówienie", contents: "ustalenia, kroki, dokumenty, koszt naszej usługi", requiresCall: "tak, 20 minut", whatIsFree: "plan i rozmowa" };

test("Google Adwords v5: 50 ad assets + 16 landing blocks, offer, claims registry, LP editor, preview, exports", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  const imp = async (dryRun = false) => (await request.post(`${base}/import`, { data: { text: V5, dryRun, fileName: "nowy_etap_pmax_v5.csv" } })).json();

  // 1. import: 66 records = 50 ad assets + 16 landing content; scenes derived from inline video columns; idempotent
  const dry = await imp(true);
  expect(dry.issues.filter((i: { level: string }) => i.level === "error")).toEqual([]);
  expect(dry.scopes).toEqual({ adAssets: 50, landingContent: 16 });
  const first = await imp();
  expect(first.created).toBe(66 + 16);
  expect(first.derivedScenes).toBe(16);
  const again = await imp();
  expect([again.created, again.updated, again.unchanged]).toEqual([0, 0, 82]);
  let data = await (await request.get(base)).json();
  expect(data.assets.filter((a: { recordScope: string }) => a.recordScope === "landing_content")).toHaveLength(16);
  expect(data.gateLp).toEqual({ offerValid: false, approvedClaims: [] });
  // claims registry seeded from the texts and proof_claim
  const keys = data.landing.claims.map((c: { key: string }) => c.key);
  expect(keys).toEqual(expect.arrayContaining(["rating", "reviews_count", "divorces_count", "record_days", "case_signature", "duration_compare"]));
  // ads: a free plan without a confirmed offer is blocked; S04 without URL blocked; G08 blocked by its claim
  const evText = (k: string) => data.evaluation.texts.find((t: { assetKey: string }) => t.assetKey === k);
  expect(evText("LH02").gate.status).toBe("blokada");
  expect(data.evaluation.sitelinks.find((t: { assetKey: string }) => t.assetKey === "S04").gate.status).toBe("blokada");
  expect(data.evaluation.images.find((t: { assetKey: string }) => t.assetKey === "G08-L").gate.status).toBe("blokada");
  // landing rows are never rendered / exported as Google assets
  const lpRow = data.assets.find((a: { rowType: string }) => a.rowType === "landing_page");
  expect((await request.get(`${base}/render/${lpRow.id}`)).status()).toBe(400);

  // 2. production export refused while the offer and URL are open; preview allowed and flagged
  expect((await request.get(`${base}/landing/export?variant=LP_A_PLAN&fmt=html&mode=production`)).status()).toBe(409);
  const prev = await (await request.get(`${base}/landing/export?variant=LP_A_PLAN&fmt=html&mode=preview`)).text();
  expect(prev).toContain("PODGLĄD ROBOCZY");
  expect(prev).toContain("oferta planu niepotwierdzona");

  // 3. approving a claim needs a source and a date
  const rating = data.landing.claims.find((c: { key: string }) => c.key === "rating");
  expect((await request.patch(`${base}/claims/${rating.id}`, { data: { approvalStatus: "approved" } })).status()).toBe(400);

  // 4. UI: offer, URL, claims, the editor and the 1440 / 390 preview
  await login(page);
  await page.goto(`/admin/adwords/${project.id}?tab=landing`);
  await expect(page.getByTestId("offer-status")).toHaveText("blocked_offer_validation");
  await expect(page.getByTestId("lp-variant")).toHaveCount(3);
  await expect(page.getByTestId("lp-variant").filter({ hasText: "C: Proof + Speed" })).toContainText("blocked_claim_validation");
  for (const [k, v] of Object.entries(OFFER)) await page.getByLabel(({ producer: "Kto wytwarza plan", when: "Kiedy klient go otrzymuje", form: "W jakiej formie", contents: "Co plan obejmuje", requiresCall: "Czy wymaga rozmowy", whatIsFree: "Co jest bezpłatne" } as Record<string, string>)[k]).fill(v);
  await page.getByTestId("offer-confirm").click();
  await expect(page.getByTestId("offer-card")).toContainText("potwierdzone");
  await page.getByLabel("URL wariantu").fill("https://nowy-etap.pl/plan-rozwodu/");
  await page.getByTestId("lp-url-save").click();
  await expect(page.getByTestId("lp-url-status")).toHaveText("URL OK");
  // A: blocks, inherited sections, the preview iframe has one H1
  await expect(page.getByTestId("lp-block")).toHaveCount(10);
  const frame = page.frameLocator('[data-testid="lp-preview"]');
  await expect(frame.locator("h1")).toHaveCount(1);
  await expect(frame.locator("h1")).toHaveText("Rozwód bez walki w sądzie? Najpierw plan, potem pozew.");
  await expect(frame.locator(".banner")).toContainText("twierdzenie bez dowodu");
  if (process.env.LP_SHOTS) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByTestId("lp-variant-view").screenshot({ path: `${process.env.LP_SHOTS}/lp-desktop.png` });
  }
  // production view removes the unproven rating and the case study
  await page.getByTestId("lp-mode-production").click();
  await expect(page.getByTestId("lp-removed")).toContainText("Case study");
  await expect(frame.locator("body")).not.toContainText("1000 opinii");
  await expect(frame.locator(".proof-bar").first()).toHaveText("Opinie klientów w Google");
  await page.getByRole("button", { name: "390 px" }).click();
  await expect(page.getByTitle("Podgląd LP_A_PLAN 390px")).toBeVisible();
  if (process.env.LP_SHOTS) {
    await page.getByTestId("lp-preview").screenshot({ path: `${process.env.LP_SHOTS}/lp-mobile.png` });
    await page.getByTestId("landing-content").screenshot({ path: `${process.env.LP_SHOTS}/lp-full.png` });
  }
  // edit the H1 of the hero
  await page.getByLabel("H1 (tylko hero) — hero").fill("Najpierw plan, potem pozew. Rozwód bez walki w sądzie.");
  await page.getByLabel("H2 / podtytuł — hero").click();
  await expect(frame.locator("h1")).toHaveText("Najpierw plan, potem pozew. Rozwód bez walki w sądzie.");
  // the linked ads with message match
  await expect(page.getByTestId("lp-ad-row").first()).toBeVisible();
  // approve the rating claim in the registry
  const row = page.getByTestId("claim-row").filter({ hasText: "Ocena w Google" });
  await row.getByLabel("Źródło rating").fill("Profil Google Nowy Etap — zrzut ekranu");
  await row.getByLabel("Data rating").fill("2026-11-09");
  await row.getByLabel("Data rating").blur();
  await expect(row.getByTestId("claim-approve")).toBeEnabled();
  await row.getByTestId("claim-approve").click();
  await expect(page.getByTestId("claim-row").filter({ hasText: "Ocena w Google" })).toContainText("zatwierdzone");
  // the ad editor shows where an image leads
  await page.goto(`/admin/adwords/${project.id}?tab=teksty`);
  await expect(page.getByTestId("texts-sitelinks")).toContainText("blocked_missing_url");

  // 5. production exports now work (claims still unproven are removed); the ZIP carries them
  const html = await (await request.get(`${base}/landing/export?variant=LP_A_PLAN&fmt=html&mode=production`)).text();
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain("4,8/5");
  expect(html).not.toContain("1000 opinii");
  expect(html).not.toContain("I C 475/23");
  // B has no URL yet → its production export is refused; with a real URL it works
  expect((await request.get(`${base}/landing/export?variant=LP_B_COST&fmt=json&mode=production`)).status()).toBe(409);
  await request.patch(`${base}/landing`, { data: { variant: { id: "LP_B_COST", url: "https://nowy-etap.pl/koszt-rozwodu/" } } });
  const json = await (await request.get(`${base}/landing/export?variant=LP_B_COST&fmt=json&mode=production`)).json();
  expect(json.sections.find((s: { section: string }) => s.section === "hero").h1).toBe("Najpierw plan i ustalenia. Dopiero potem pozew o rozwód.");
  data = await (await request.get(base)).json();
  expect(data.gateLp.offerValid).toBe(true);
  expect(data.evaluation.texts.find((t: { assetKey: string }) => t.assetKey === "LH02").gate.status).not.toBe("blokada");
  const z = unzipSync(new Uint8Array(await (await request.get(`${base}/zip?fmt=png&parts=texts,landing`)).body()));
  const names = Object.keys(z);
  expect(names.some((n) => n.startsWith("grafiki/"))).toBe(false);
  expect(names).toContain("teksty_google_ads.csv");
  expect(names).toContain("landing_page/nowy-etap_LP_A_PLAN.html");
  expect(names).toContain("landing_page/nowy-etap_LP_B_COST.json");
  expect(names).toContain("landing_page/LP_C_PROOF_SPEED_ZABLOKOWANY.txt");
  expect(strFromU8(z["teksty_google_ads.csv"])).toContain("S04");
});
