import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { adminRequest, login } from "./helpers";

const V5 = fs.readFileSync("tests/fixtures/adwords/nowy_etap_pmax_v5_50_assetow_i_landing_page.csv", "utf-8");
const SVG = `<svg width="750" height="160" viewBox="0 0 750 160" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h300v100H0z" fill="white"/><path d="M320 0h100v100H320z" fill="#BE934E"/><path d="M0 130h400v30H0z" fill="white"/></svg>`;

test("Nowy Etap: both logos (preset + SVG upload), 5 comparison templates in the light cards style, exports fit", async ({ page, request }) => {
  test.setTimeout(240_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;
  await request.post(`${base}/import`, { data: { text: V5, fileName: "v5.csv", dryRun: false } });
  // the preset brings both versions of the brand logo
  let data = await (await request.get(base)).json();
  expect(data.logoUrl).toBeTruthy();
  expect(data.logoDarkUrl).toBeTruthy();

  // an SVG uploaded for dark backgrounds (white) — the light one is made from it when missing
  await request.patch(`/api/admin/themes/${project.themeId}`, { data: { logoAssetId: null, logoDarkAssetId: null } });
  const up = await request.post(`/api/admin/themes/${project.themeId}/logo`, { multipart: { variant: "dark", file: { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) } } });
  expect(up.status()).toBe(201);
  expect((await up.json()).counterpart).toBe(true);
  data = await (await request.get(base)).json();
  expect(data.logoUrl).toBeTruthy();
  expect(data.logoDarkUrl).toBeTruthy();
  // an SVG with a script is refused
  const bad = await request.post(`/api/admin/themes/${project.themeId}/logo`, { multipart: { variant: "light", file: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG.replace("<path", "<script>alert(1)</script><path")) } } });
  expect(bad.status()).toBe(415);

  // the 5 ready comparisons from the gallery
  await login(page);
  await page.goto(`/admin/adwords/${project.id}?tab=grafiki`);
  await page.getByTestId("variants-templates").click();
  await expect(page.getByText(/Dodano 5 porównań/)).toBeVisible({ timeout: 30_000 });
  data = await (await request.get(base)).json();
  const cards = data.assets.filter((a: { conceptId: string | null }) => /^K\d+$/.test(a.conceptId ?? ""));
  expect(cards).toHaveLength(15);
  expect(new Set(cards.map((a: { effectiveLayout: string }) => a.effectiveLayout))).toEqual(new Set(["comparison"]));
  for (const a of cards) {
    const r = await request.get(`${base}/render/${a.id}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["x-render-overflow"]).toBe("false");
  }
  // once is enough: the second click adds nothing
  await page.getByTestId("variants-templates").click();
  await expect(page.getByText("Te porównania są już w galerii")).toBeVisible();
  if (process.env.LP_SHOTS) await page.getByTestId("concept-card").filter({ hasText: "K01" }).screenshot({ path: `${process.env.LP_SHOTS}/cards-k01.png` });

  // content never keeps the long dash: saved as "-"
  await request.patch(`${base}/assets/${cards[0].id}`, { data: { headline: "Rozwód — najpierw plan", lp: { ...cards[0].lp, comparison_left: "Pozew – odpowiedź" } } });
  const after = (await (await request.get(base)).json()).assets.find((a: { id: string }) => a.id === cards[0].id);
  expect(after.headline).toBe("Rozwód - najpierw plan");
  expect(after.lp.comparison_left).toBe("Pozew - odpowiedź");

  // the editor has the card fields
  await page.getByTestId("concept-card").filter({ hasText: "K01" }).click();
  await expect(page.getByLabel("Lewa — mocna linia")).toHaveValue("Najpierw pozew");
  await expect(page.getByLabel("Prawa — mocna linia")).toHaveValue("Najpierw plan");
});
