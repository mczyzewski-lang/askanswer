import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { adminRequest, login } from "./helpers";

/** Auto Reels: one long recording → transcript → AI hooks + context → reels laid out in the Studio. */
test("Auto Reels: a recording becomes ready reels (hook + context, pauses cut), menu on the left", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  await login(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/admin");
  // desktop: the menu is a sidebar on the left
  const side = page.getByTestId("admin-sidebar");
  await expect(side).toBeVisible();
  await expect(page.getByTestId("admin-nav-top")).toBeHidden();
  const box = (await side.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.height).toBeGreaterThan(800);
  await side.getByRole("link", { name: "Auto Reels" }).click();
  await expect(page).toHaveURL(/\/admin\/auto-reels$/);

  await page.getByLabel("Nazwa").fill("Podcast testowy");
  await page.getByLabel("Ile reelsów").fill("5");
  await page.getByLabel("Min. długość (s)").fill("10");
  await page.getByLabel("Maks. długość (s)").fill("40");
  await page.getByTestId("ar-create").click();
  await expect(page.getByTestId("auto-reels")).toBeVisible();
  const projectId = page.url().split("/").pop()!;

  const buf = fs.readFileSync("tests/fixtures/generated/sample-take.mp4");
  await page.getByTestId("ar-video-input").setInputFiles({ name: "podcast.mp4", mimeType: "video/mp4", buffer: buf });
  // processed → the reels start on their own
  await expect(page.getByTestId("ar-reel")).toHaveCount(1, { timeout: 240_000 });
  await expect(page.getByTestId("ar-reel")).toContainText("Testowy reels z podcastu");
  await expect(page.getByTestId("ar-reel")).toContainText("88");
  await expect(page.getByTestId("ar-open-studio")).toBeVisible();

  const d = await (await request.get(`/api/admin/ads/${projectId}`)).json();
  expect(d.project.autoReelsStatus).toBe("DONE");
  const compId = d.reels[0].compositionId;
  const doc = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;
  expect(doc.meta.autoReels).toBe(true);
  expect(doc.clips.some((c: { label?: string }) => c.label === "HOOK")).toBe(true);
  expect(doc.clips.some((c: { label?: string }) => c.label === "BODY")).toBe(true);
  // the long silence of the fixture (2.6–4.6 s) is cut out of the passage
  expect(d.reels[0].durationSec).toBeLessThan(12 + 3);
  expect(doc.pauses.some((p: { status: string }) => p.status === "applied")).toBe(true);
  // not listed among the Ads Studio campaigns
  const ads = await (await request.get("/api/admin/ads")).json();
  expect(ads.projects.some((p: { id: string }) => p.id === projectId)).toBe(false);
  if (process.env.AR_SHOT) await page.screenshot({ path: process.env.AR_SHOT, fullPage: true });

  // phone: the menu is a row at the top
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("admin-sidebar")).toBeHidden();
  await expect(page.getByTestId("admin-nav-top")).toBeVisible();
});
