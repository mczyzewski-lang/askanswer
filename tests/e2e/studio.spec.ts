import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adminRequest, demoProject, login, newInvitation, uploadFixtureTake, waitForTakes } from "./helpers";

function parseTc(s: string): number {
  const m = /(\d+):(\d+):(\d+)/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 30 : NaN;
}
async function totalDuration(page: Page) {
  const txt = (await page.getByTestId("timecode").textContent()) ?? "";
  return parseTc(txt.split("/")[1] ?? "");
}
async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveText("Zapisano", { timeout: 20_000 });
}

/**
 * Tests 8–14 on a processed take uploaded through the real upload API
 * (TEST FIXTURE media: colour bars + tone bursts with a known 2 s pause at 2.6–4.6 s).
 */
test("studio: pauses, cuts, subtitles, zoom, theme, persistence and real MP4 export", async ({ page, request }) => {
  // the whole editing flow incl. AI generation, person segmentation and a real export
  test.setTimeout(480_000);
  await adminRequest(request);
  const data = await demoProject(request);
  const anna = data.experts.find((e) => e.name === "Anna Kowalska")!;
  const q = data.questions.find((x) => x.expertId === anna.id && x.text.startsWith("Ile kosztuje"))!;
  const { token } = await newInvitation(request, data.project.id, anna.id);
  await uploadFixtureTake(request, token, q.id);
  const [take] = await waitForTakes(request, q.id, 1);
  const info = await (await request.get(`/api/admin/takes/${take.id}`)).json();
  expect(info.transcriptWords).toBeGreaterThan(0);
  // Test 9: the real silent interval of the fixture is detected by the pipeline
  expect(info.silences.some((s: { start: number; end: number }) => s.start > 2.5 && s.start < 3.2 && s.end > 4.0 && s.end < 4.7)).toBeTruthy();
  const compId = info.compositionIds[0];

  // automatic infographics: placed by the worker right after processing, without any acceptance (OpenAI mock)
  let auto: { document: { overlays: Array<{ kind: string; name: string }>; meta: { autoVisuals?: string; aiBroll?: Array<{ status: string; kind?: string; engine?: string }> } } } | null = null;
  for (let i = 0; i < 60 && !auto?.document.meta.autoVisuals; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    auto = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition;
  }
  expect(auto?.document.meta.autoVisuals).toBe("done");
  const placedAuto = (auto!.document.meta.aiBroll ?? []).filter((i) => i.status === "done");
  expect(placedAuto.length).toBeGreaterThan(0);
  expect(placedAuto.every((i) => i.kind === "infographic" && i.engine === "openai")).toBeTruthy();
  expect(auto!.document.overlays.filter((o) => o.kind === "image" && o.name.startsWith("Infografika")).length).toBe(placedAuto.length);

  await login(page);
  await page.goto(`/studio/${compId}`);
  await expect(page.getByTestId("timeline")).toBeVisible();
  const d0 = await totalDuration(page);
  expect(d0).toBeGreaterThan(11);

  // Test 9 — "Wykryj pauzy" in the editor + remove one selected pause
  await page.getByTestId("tab-pauses").click();
  await page.getByRole("button", { name: "Wykryj pauzy" }).first().click();
  await expect(page.getByTestId("pause-summary")).toContainText("Znaleziono");
  const items = page.getByTestId("pause-item");
  expect(await items.count()).toBeGreaterThan(0);
  await items.first().getByText("Pauza 1").click();
  await page.getByRole("button", { name: "Usuń zaznaczoną pauzę" }).click();
  const d1 = await totalDuration(page);
  expect(d1).toBeLessThan(d0 - 0.4);

  // Test 10 — select a range on the waveform and cut it; video+audio stay linked
  const track = page.getByTestId("audio-track");
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId("delete-range").click();
  const d2 = await totalDuration(page);
  expect(d2).toBeLessThan(d1 - 0.5);

  // Test 8 — edit subtitle text
  await page.getByTestId("tab-subs").click();
  const firstSub = page.getByLabel("Tekst napisu").first();
  await firstSub.fill("EDYTOWANY NAPIS testowy");
  await firstSub.press("Enter");

  // Test 11 — smooth zoom 100% → 115% at the playhead
  await page.getByTestId("tab-zoom").click();
  await page.getByRole("button", { name: "Płynne przybliżenie" }).click();
  await expect(page.getByText(/100→115%/)).toBeVisible();

  // Voice enhancement (ElevenLabs isolator + mastering) runs as a background job
  await page.getByTestId("tab-audio").click();
  await page.getByTestId("enhance-isolator").click();
  await expect(page.getByText(/Aktywny ulepszony dźwięk/)).toBeVisible({ timeout: 90_000 });
  await waitSaved(page);

  // AI B-roll: proposals from the transcript → accept → Higgsfield (mock) clip lands on the timeline
  await page.getByTestId("tab-ai").click();
  await page.getByTestId("ai-check").click();
  await expect(page.getByTestId("ai-check-result")).toContainText("Połączenie z Higgsfield działa");
  await expect(page.getByTestId("ai-check-result")).toContainText("Połączenie z OpenAI działa");
  // the automatic run is visible in the AI tab and can be started again on demand
  await expect(page.getByTestId("auto-visuals-status")).toContainText("Dodano");
  await expect(page.getByTestId("auto-visuals-status")).toContainText("(OpenAI)");
  await page.getByTestId("auto-visuals-run").click();
  await expect(page.getByText(/AI dodało \d+ infografik/)).toBeVisible({ timeout: 90_000 });
  await waitSaved(page);
  await page.getByTestId("ai-suggest").click();
  await expect(page.getByTestId("ai-item").first()).toBeVisible({ timeout: 30_000 });
  const videoItem = page.locator('[data-testid="ai-item"][data-kind="video"]').filter({ has: page.getByTestId("ai-accept") }).first();
  await videoItem.getByTestId("ai-accept").click();
  await expect(page.locator('[data-testid="ai-item"][data-kind="video"]').getByTestId("ai-done").first()).toBeVisible({ timeout: 120_000 });
  // …and an infographic (custom proposal switched to "Infografika", AI illustration from the image mock)
  await page.getByPlaceholder(/Close-up of hands/).fill("Hands holding a calendar, slow push-in");
  await page.getByRole("button", { name: "Dodaj propozycję" }).click();
  const custom = page.getByTestId("ai-item").filter({ hasText: "Hands holding a calendar" });
  await custom.getByRole("button", { name: "Infografika" }).click();
  await custom.getByLabel("Nagłówek infografiki").fill("Trzy kroki do rozwodu");
  await custom.getByLabel("Wartość 1").fill("6 mies.");
  await custom.getByLabel("Opis 1").fill("średni czas sprawy w sądzie");
  await custom.getByTestId("ai-accept").click();
  await expect(custom.getByTestId("ai-done")).toBeVisible({ timeout: 90_000 });
  // …and a whole infographic drawn by OpenAI (text in Polish, theme colours)
  await page.getByPlaceholder(/Close-up of hands/).fill("Grafika OpenAI o terminach sądowych");
  await page.getByRole("button", { name: "Dodaj propozycję" }).click();
  const oai = page.getByTestId("ai-item").filter({ hasText: "Grafika OpenAI o terminach" });
  await oai.getByRole("button", { name: "Infografika" }).click();
  await oai.getByLabel("Nagłówek infografiki").fill("Ile trwa rozwód?");
  await oai.getByRole("button", { name: "Cała grafika z OpenAI" }).click();
  await oai.getByTestId("ai-accept").click();
  await expect(oai.getByTestId("ai-done")).toBeVisible({ timeout: 90_000 });
  const oaiStats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
  const call = oaiStats.openai.at(-1);
  expect(call.model).toBe("gpt-image-2");
  expect(call.size).toBe("1024x1824");
  expect(call.prompt).toContain("«Ile trwa rozwód?»");
  await waitSaved(page);
  const saved = await (await request.get(`/api/admin/compositions/${compId}`)).json();
  const doc = saved.document ?? saved.composition?.document;
  expect(doc.overlays.some((o: { kind: string; w: number }) => o.kind === "video" && o.w === 1)).toBeTruthy();
  expect(doc.overlays.some((o: { kind: string; w: number; name: string }) => o.kind === "image" && o.w === 1 && o.name.includes("Trzy kroki"))).toBeTruthy();

  // Test 12 — theme accent/highlight change propagates (stored on the project theme)
  await page.getByTestId("tab-theme").click();
  const themeSaved = page.waitForResponse((r) => r.url().includes("/api/admin/themes/") && r.request().method() === "PATCH", { timeout: 30_000 });
  await page.getByTestId("theme-highlight").evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, "#ff0066");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitSaved(page);
  expect((await themeSaved).ok()).toBeTruthy();

  // Test 14 — refresh restores the editing state
  await page.reload();
  await expect(page.getByTestId("timeline")).toBeVisible();
  expect(Math.abs((await totalDuration(page)) - d2)).toBeLessThan(0.05);
  await page.getByTestId("tab-subs").click();
  await expect(page.getByLabel("Tekst napisu").first()).toHaveValue("EDYTOWANY NAPIS testowy");
  await page.getByTestId("tab-theme").click();
  await expect(page.getByTestId("theme-highlight")).toHaveValue("#ff0066");

  // SRT reflects the edit and the cuts
  const srt = await (await request.get(`/api/admin/compositions/${compId}/export?type=srt`)).text();
  expect(srt).toContain("EDYTOWANY NAPIS testowy");

  // Background blur: person mask computed by the worker (ONNX), used by the preview and the export below
  await page.getByTestId("tab-takes").click();
  await page.getByRole("button", { name: "Rozmyte" }).click();
  await expect(page.getByTestId("blur-on")).toBeVisible({ timeout: 120_000 });
  await waitSaved(page);
  const blurred = await (await request.get(`/api/admin/compositions/${compId}`)).json();
  expect(blurred.composition.document.clips.every((c: { background?: { blur: number } }) => (c.background?.blur ?? 0) > 0)).toBeTruthy();
  expect(blurred.assets.some((a: { maskUrl?: string | null }) => !!a.maskUrl)).toBeTruthy();

  // Test 13 — real server-side MP4 export
  await page.getByRole("button", { name: "Eksportuj" }).click();
  await page.getByRole("button", { name: "Renderuj MP4" }).click();
  const dl = page.getByTestId("download-mp4");
  await expect(dl).toBeVisible({ timeout: 200_000 });
  const href = await dl.getAttribute("href");
  const res = await request.get(href!);
  expect(res.ok()).toBeTruthy();
  const out = path.resolve("test-results", "export.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await res.body());
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out]).toString());
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  expect(v.codec_name).toBe("h264");
  expect(v.width).toBe(1080);
  expect(v.height).toBe(1920);
  expect(a.codec_name).toBe("aac");
  expect(Math.abs(Number(probe.format.duration) - d2)).toBeLessThan(0.15);
});
