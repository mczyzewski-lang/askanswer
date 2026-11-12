import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adminRequest, login } from "./helpers";

test("Performance Ads → AI Video: explainers preview (scrub, beat table, narration), MP4 render through the worker, frame PNG", async ({ page, request }) => {
  test.setTimeout(420_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}/explainers`;
  await login(page);
  // the module is called Performance Ads; the Google tabs say Google
  await page.goto(`/admin/projects/${project.id}`);
  await page.getByTestId("nav-project").getByRole("link", { name: "Performance Ads" }).click();
  await expect(page.getByTestId("adwords-tabs")).toContainText("Google: kreacje graficzne");
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "AI Video" }).click();
  await expect(page.getByTestId("explainer-list").locator("button")).toHaveCount(6);
  await expect(page.getByTestId("beat-row")).toHaveCount(7);
  await expect(page.getByTestId("explainer-canvas")).toBeVisible();
  // a click on a beat jumps there and pauses; the narration of that beat is shown
  await page.getByTestId("beat-row").nth(5).getByRole("button").click();
  await expect(page.getByTestId("explainer-time")).toContainText("00:29.");
  await expect(page.getByTestId("explainer-vo-now")).toContainText("Najpierw plan.");
  // the canvas really draws (not one flat colour) — once the fonts are in and the frame is painted
  await expect.poll(() => page.getByTestId("explainer-canvas").evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20_000 }).toBe(1080);
  const colours = await page.getByTestId("explainer-canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const s = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 997) s.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return [c.width, c.height, s.size];
  });
  expect(colours[0]).toBe(1080);
  expect(colours[1]).toBe(1920);
  expect(colours[2]).toBeGreaterThan(8);
  if (process.env.LP_SHOTS) await page.screenshot({ path: `${process.env.LP_SHOTS}/explainers-page.png`, fullPage: true });
  // the narration is editable per beat and goes into the full text
  await page.getByLabel("Lektor, beat 7").fill("Rozwód zaczyna się od planu.");
  await page.locator("summary", { hasText: "Cały tekst lektora" }).click();
  await expect(page.getByTestId("explainer-vo-full")).toContainText("Rozwód zaczyna się od planu.");
  // a planned reel shows its beat table, and cannot be rendered yet
  await page.getByTestId("explainer-4").click();
  await expect(page.getByTestId("beat-row")).toHaveCount(5);
  await expect(page.getByTestId("explainer-render")).toBeDisabled();

  // reel 3 (the shortest) in the papercut style: MP4 through the worker
  await page.getByTestId("explainer-3").click();
  await expect(page.getByTestId("explainer-styles").locator("button")).toHaveCount(5);
  await page.getByTestId("explainer-style-papercut").click();
  const voice = page.getByTestId("explainer-render-voice");
  if (await voice.isEnabled()) await voice.click();
  else await page.getByTestId("explainer-render").click();
  await expect(page.getByTestId("explainer-done")).toBeVisible({ timeout: 300_000 });
  const state = await (await request.get(base)).json();
  const done = state.renders["pozew-to-nie-plan:papercut"];
  expect(done.duration).toBeCloseTo(30, 0);
  const res = await request.get(done.url);
  expect(res.ok()).toBeTruthy();
  const out = path.resolve("test-results", "explainer.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await res.body());
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  expect([v.codec_name, v.width, v.height, v.r_frame_rate]).toEqual(["h264", 1080, 1920, "30/1"]);
  expect(probe.streams.some((s: { codec_type: string; codec_name: string }) => s.codec_type === "audio" && s.codec_name === "aac")).toBe(true);
  // a frame as PNG (the thumbnail)
  const png = await request.get(`${base}/pozew-za-wczesnie?t=4.4&style=blueprint`);
  expect(png.status()).toBe(200);
  const buf = await png.body();
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1080, 1920]);
});
