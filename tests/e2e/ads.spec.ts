import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { adminRequest, login } from "./helpers";

/**
 * Ads Studio: a script file + raw footage → reels cut from the transcript. The mock transcription
 * names the words słowo1, słowo2… along the fixture's voiced parts, so the script uses those words.
 */
test("ads studio: script + footage → reels laid out from the transcript", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  await login(page);
  await page.goto("/admin/ads");
  await page.getByLabel("Nazwa kampanii").fill("Kampania testowa");
  await page.getByRole("button", { name: "Nowa kampania" }).click();
  await expect(page.getByTestId("ads-studio")).toBeVisible();
  const projectId = page.url().split("/").pop()!;

  // 1. the script: two reels share the same body; one hook was never recorded
  const csv = [
    "reel;tytuł;hook;body;cta",
    "R1;Pierwszy;słowo1 słowo2 słowo3;słowo4 słowo5 słowo6 słowo7;słowo11 słowo12",
    "R2;Drugi;słowo8 słowo9 słowo10;słowo4 słowo5 słowo6 słowo7;słowo11 słowo12",
    "R3;Trzeci;Tego hooka nikt nigdy nie nagrał;słowo4 słowo5 słowo6 słowo7;słowo11 słowo12",
  ].join("\n");
  await page.getByTestId("ads-script-input").setInputFiles({ name: "scenariusze.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByTestId("ads-reel")).toHaveCount(3);

  // 2. the footage, sent in slices (like a long camera file)
  const buf = fs.readFileSync("tests/fixtures/generated/sample-take.mp4");
  const { id: fid } = await (await request.post(`/api/admin/ads/${projectId}/footage`, { data: { name: "nagranie-1.mp4", size: buf.length } })).json();
  const SLICE = 1024 * 1024;
  const total = Math.ceil(buf.length / SLICE);
  for (let i = 0; i < total; i++) expect((await request.put(`/api/admin/ads/footage/${fid}/chunks/${i}`, { data: buf.subarray(i * SLICE, (i + 1) * SLICE), headers: { "content-type": "application/octet-stream" } })).ok()).toBeTruthy();
  expect((await request.post(`/api/admin/ads/footage/${fid}/complete`, { data: { totalChunks: total } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("ads-footage-row")).toHaveAttribute("data-status", "READY", { timeout: 120_000 });

  // 3. lay out the reels
  await page.getByTestId("ads-build").click();
  await expect(page.getByTestId("ads-open-studio")).toHaveCount(3, { timeout: 60_000 });
  const data = await (await request.get(`/api/admin/ads/${projectId}`)).json();
  const r1 = data.reels.find((r: { code: string }) => r.code === "R1");
  const r3 = data.reels.find((r: { code: string }) => r.code === "R3");
  expect(r1.matches.map((m: { missing?: boolean }) => !!m.missing)).toEqual([false, false, false]);
  expect(r1.matches[0].score).toBeGreaterThan(0.9);
  // the never-recorded hook is reported, the rest of the reel is still laid out
  expect(r3.matches[0].missing).toBe(true);
  await expect(page.getByTestId("ads-reel").nth(2).locator('[data-missing="true"]')).toHaveCount(1);

  // the shared body is cut from the same place in every reel; the reel = hook → body → CTA
  const comp1 = (await (await request.get(`/api/admin/compositions/${r1.compositionId}`)).json()).composition.document;
  const comp2 = (await (await request.get(`/api/admin/compositions/${data.reels[1].compositionId}`)).json()).composition.document;
  expect(comp1.clips.map((c: { label: string }) => c.label)).toEqual(["HOOK", "BODY", "CTA"]);
  expect(comp1.clips[1].sourceIn).toBeCloseTo(comp2.clips[1].sourceIn, 3);
  expect(comp1.clips[0].sourceIn).toBeLessThan(comp1.clips[1].sourceIn);
  expect(comp1.clips[1].start).toBeCloseTo(comp1.clips[0].sourceOut - comp1.clips[0].sourceIn, 1);
  expect(comp1.subtitles.segments.length).toBeGreaterThan(0);

  // a second file through the page (sliced upload in the browser)
  await page.getByTestId("ads-video-input").setInputFiles({ name: "nagranie-2.mp4", mimeType: "video/mp4", buffer: buf });
  await expect(page.getByTestId("ads-footage-row")).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("ads-footage-row").nth(1)).toHaveAttribute("data-status", "READY", { timeout: 120_000 });

  // opens in the Studio like any video
  await page.getByTestId("ads-open-studio").first().click();
  await expect(page.getByTestId("timeline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("HOOK").first()).toBeVisible();
});

test("ads campaign settings keep the campaign format and stay off the projects list", async ({ page, request }) => {
  await adminRequest(request);
  const p = await (await request.post("/api/admin/ads", { data: { name: "Kampania ustawienia" } })).json();
  await login(page);
  await page.goto("/admin");
  await expect(page.getByText("Kampania ustawienia")).toHaveCount(0);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("tab", { name: "Ustawienia" }).click();
  await expect(page.getByText("Kampania Ads Studio")).toBeVisible();
  await page.getByRole("button", { name: /Zapisz/ }).first().click();
  await expect.poll(async () => (await (await request.get(`/api/admin/projects/${p.id}`)).json()).project.format).toBe("ADS");
});
