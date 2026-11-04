import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { adminRequest, login } from "./helpers";

/** EduStudio: upload (sliced) → transcript + pauses + AI cuts → review → one compressed MP4 to download. */
test("EduStudio: remarks for the editor and long pauses cut, a smaller MP4 to download", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const buf = fs.readFileSync("tests/fixtures/generated/sample-take.mp4");
  const { id, sessionId } = await (await request.post("/api/admin/edu", { data: { name: "Lekcja 1.mp4", size: buf.length } })).json();
  const half = Math.ceil(buf.length / 2);
  for (const [i, part] of [buf.subarray(0, half), buf.subarray(half)].entries()) expect((await request.put(`/api/admin/uploads/${sessionId}/chunks/${i}`, { data: part })).ok()).toBeTruthy();
  expect((await request.post(`/api/admin/uploads/${sessionId}/complete`, { data: { totalChunks: 2 } })).status()).toBe(202);
  await expect.poll(async () => (await (await request.get(`/api/admin/edu/${id}`)).json()).status, { timeout: 180_000 }).toBe("READY");
  const d = await (await request.get(`/api/admin/edu/${id}`)).json();
  expect(d.words).toBeGreaterThan(0);
  expect(d.cuts).toHaveLength(1);
  expect(d.cuts[0]).toMatchObject({ kind: "editor", enabled: true, reason: "Polecenie dla montażysty" });
  // the fixture has a 2 s silence at 2.6–4.6 s
  expect(d.pauses.some((p: { start: number; end: number }) => p.end - p.start > 1.5)).toBe(true);

  await login(page);
  await page.goto("/admin/edu");
  await expect(page.getByTestId("edu-row").first()).toContainText("Lekcja 1.mp4");
  await page.getByTestId("edu-row").first().click();
  await expect(page.getByTestId("edu-cuts-editor")).toContainText("Polecenie dla montażysty");
  const after = async () => (await page.getByTestId("edu-after").textContent()) ?? "";
  const withCut = await after();
  // turning the cut off gives a longer result
  await page.getByTestId("edu-cut").first().getByRole("switch").click();
  await expect.poll(after).not.toBe(withCut);
  await page.getByTestId("edu-cut").first().getByRole("switch").click();
  await expect.poll(after).toBe(withCut);

  if (process.env.EDU_SHOT) await page.screenshot({ path: process.env.EDU_SHOT, fullPage: true });
  await page.getByLabel("Jakość / rozmiar").selectOption("small");
  await page.getByLabel("Rozdzielczość").selectOption("720");
  await page.getByTestId("edu-export-button").click();
  await expect(page.getByTestId("edu-download")).toBeVisible({ timeout: 180_000 });
  const done = await (await request.get(`/api/admin/edu/${id}`)).json();
  expect(done.status).toBe("DONE");
  expect(done.export.durationSec).toBeLessThan(done.durationSec - 1);
  expect(done.export.size).toBeLessThan(done.originalSize);
  const mp4 = await request.get(done.export.url);
  expect(mp4.status()).toBe(200);
  expect((await mp4.body()).subarray(4, 8).toString()).toBe("ftyp");
});
