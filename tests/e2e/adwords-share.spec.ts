import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { unzipSync } from "fflate";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");

test("Google Adwords: a read-only link for an agency (no login), only what passed the gates, revocable", async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  await request.post(`${base}/import`, { data: { text: V5, fileName: "v5.csv", dryRun: false } });

  // the owner creates the link in the module
  await login(page);
  await page.goto(`/admin/adwords/${project.id}`);
  await page.getByTestId("share-open").click();
  await page.getByLabel("Dla kogo").fill("Agencja Testowa");
  await page.getByTestId("share-create").click();
  await expect(page.getByTestId("share-row")).toContainText("Agencja Testowa");
  const shares = await (await request.get(`${base}/shares`)).json();
  const token = shares[0].token as string;
  expect(token.length).toBeGreaterThanOrEqual(30);

  // the agency: a fresh browser without any session
  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto(`/share/adwords/${token}`);
  await expect(a).toHaveURL(new RegExp(`/share/adwords/${token}$`));
  await expect(a.getByRole("heading", { level: 1 })).toHaveText("Nowy Etap");
  await expect(a.getByTestId("share-concept")).toHaveCount(8);
  // previews are real renders
  const img = a.getByTestId("share-concept").first().locator("img").first();
  await expect(img).toBeVisible();
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(1000);
  // nothing editable on the page
  await expect(a.locator("input, textarea, select")).toHaveCount(0);
  // a blocked concept (G08 — unproven numbers) is visible but not downloadable
  const g08 = a.getByTestId("share-concept").filter({ hasText: "G08" });
  await expect(g08).toContainText("zablokowane");
  await expect(g08.getByTestId("share-image-download")).toHaveCount(0);
  await expect(a.getByTestId("share-texts")).toContainText("Rozwód bez walki w sądzie");
  await expect(a.getByTestId("share-videos")).toContainText("0–3 s");
  await expect(a.getByTestId("share-landing")).toContainText("Niedostępne do wdrożenia");
  await expect(a.getByTestId("share-brief")).not.toBeEmpty();

  // the API of the link: no session needed, blocked items refused
  const g08id = (await (await request.get(base)).json()).assets.find((x: { assetKey: string }) => x.assetKey === "G08-L").id;
  expect((await anon.request.get(`/api/share/adwords/${token}/render/${g08id}?download=1`)).status()).toBe(403);
  expect((await anon.request.get(`/api/share/adwords/${token}/render/${g08id}`)).status()).toBe(200);
  expect((await anon.request.get(`/api/share/adwords/${token}/landing?variant=LP_A_PLAN&fmt=html`)).status()).toBe(409);
  // the agency cannot reach the admin API
  expect((await anon.request.get(base)).status()).toBe(401);
  // before the free plan is confirmed, nothing promising it is handed over
  const z0 = unzipSync(new Uint8Array(await (await anon.request.get(`/api/share/adwords/${token}/zip?parts=images,texts`)).body()));
  expect(Object.keys(z0).filter((n) => n.startsWith("grafiki/"))).toHaveLength(0);
  const t0 = new TextDecoder().decode(z0["teksty_google_ads.csv"]);
  expect(t0).toContain("H02");
  expect(t0).not.toContain("LH02");
  // the owner confirms the offer → the creatives are ready, except G08 (unproven numbers) and S04 (no URL)
  await request.put(`${base}/offer`, { data: { producer: "mediator", when: "2 dni", form: "PDF", contents: "ustalenia, kroki, koszt usługi", requiresCall: "tak", whatIsFree: "plan i rozmowa", confirmed: true } });
  const z = unzipSync(new Uint8Array(await (await anon.request.get(`/api/share/adwords/${token}/zip?parts=images,texts`)).body()));
  const names = Object.keys(z);
  expect(names.filter((n) => n.startsWith("grafiki/")).length).toBeGreaterThan(0);
  expect(names.some((n) => n.includes("G08"))).toBe(false);
  expect(names.some((n) => n.endsWith("_google_adwords.csv"))).toBe(false);
  const texts = new TextDecoder().decode(z["teksty_google_ads.csv"]);
  expect(texts).toContain("LH02");
  expect(texts).not.toContain("S04");
  if (process.env.LP_SHOTS) {
    await a.setViewportSize({ width: 1280, height: 900 });
    await a.reload();
    await a.waitForTimeout(4000);
    await a.screenshot({ path: `${process.env.LP_SHOTS}/share.png`, fullPage: false });
    await a.getByTestId("share-texts").screenshot({ path: `${process.env.LP_SHOTS}/share-texts.png` });
  }
  // counted
  expect((await (await request.get(`${base}/shares`)).json())[0].accessCount).toBeGreaterThan(0);

  // revoked: the link stops working at once
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("share-revoke").click();
  await expect(page.getByTestId("share-row")).toContainText("odwołany");
  expect((await anon.request.get(`/api/share/adwords/${token}/zip`)).status()).toBe(404);
  const gone = await a.goto(`/share/adwords/${token}`);
  expect(gone?.status()).toBe(404);
  expect((await anon.request.get(`/share/adwords/not-a-real-token-xxxxxxxxxxxxx`)).status()).toBe(404);
  await anon.close();
});
