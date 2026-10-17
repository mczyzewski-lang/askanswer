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

  // automatic illustrations of the expert's thoughts: placed by the worker right after processing, without any acceptance (OpenAI mock)
  let auto: { document: { overlays: Array<{ kind: string; name: string }>; meta: { autoVisuals?: string; aiBroll?: Array<{ status: string; kind?: string; engine?: string }> } } } | null = null;
  for (let i = 0; i < 60 && !auto?.document.meta.autoVisuals; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    auto = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition;
  }
  expect(auto?.document.meta.autoVisuals).toBe("done");
  const placedAuto = (auto!.document.meta.aiBroll ?? []).filter((i) => i.status === "done");
  expect(placedAuto.length).toBeGreaterThan(0);
  expect(placedAuto.every((i) => i.kind === "illustration" && i.engine === "openai")).toBeTruthy();
  expect(auto!.document.overlays.filter((o) => o.kind === "image" && o.name.startsWith("Ilustracja")).length).toBe(placedAuto.length);
  // the expert stays visible in a face bubble over each full-screen illustration (exported below too)
  expect(auto!.document.overlays.filter((o) => o.kind === "image" && o.name.startsWith("Ilustracja")).every((o) => !!(o as { bubble?: { size: number } }).bubble?.size)).toBeTruthy();
  // drawn from whole passages of the answer, full screen, minimal Polish text, in the theme colours
  const autoStats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
  const illu = (autoStats.openai as Array<{ prompt: string; size: string }>).filter((c) => c.prompt.includes("Full-screen vertical 9:16 illustration"));
  expect(illu.length).toBeGreaterThanOrEqual(placedAuto.length);
  expect(illu[0].prompt).toMatch(/one short headline \(max 5 words\)/);
  expect(illu[0].prompt).toMatch(/background [a-z -]+ \(#[0-9A-Fa-f]{6}\)/);
  // the passage of the answer, verbatim from the transcript (its length depends on the fixture speech)
  expect(illu[0].prompt).toMatch(/What the expert says at this moment \(Polish\): «[^»]+»/);
  // three variants per illustration, to choose from
  expect((illu.at(-1) as { n?: number }).n).toBe(3);
  const autoItems = auto!.document.meta.aiBroll as Array<{ status: string; variants?: string[] }>;
  expect(autoItems.filter((i) => i.status === "done").every((i) => i.variants?.length === 3)).toBeTruthy();

  // the project's default finishing, also right after processing: blurred background, voice podcast + ElevenLabs, dynamic zooms
  let polished: { document: { clips: Array<{ background?: { blur: number }; audioAssetId?: string | null }>; zooms: unknown[]; meta: { autoPolish?: string } } } | null = null;
  for (let i = 0; i < 80 && !polished?.document.meta.autoPolish; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    polished = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition;
  }
  expect(polished?.document.meta.autoPolish).toBeTruthy();
  expect(polished!.document.clips.every((c) => (c.background?.blur ?? 0) > 0)).toBeTruthy();
  expect(polished!.document.clips.every((c) => !!c.audioAssetId)).toBeTruthy();
  expect(polished!.document.zooms.length).toBeGreaterThan(0);

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
  // pick another variant of the placed illustration: the layer switches to it
  const picker = page.getByTestId("ai-variants").first();
  await expect(picker.getByTestId("ai-variant")).toHaveCount(3);
  await expect(picker.getByTestId("ai-variant").first()).toHaveAttribute("aria-pressed", "true");
  await picker.getByTestId("ai-variant").nth(1).click();
  await expect(picker.getByTestId("ai-variant").nth(1)).toHaveAttribute("aria-pressed", "true");
  // …also from the right-hand column after clicking the illustration layer on the timeline
  await page.getByTestId("timeline").locator('[title^="Ilustracja:"]').first().click();
  const layerProps = page.getByTestId("ai-layer-props");
  await expect(layerProps.getByTestId("ai-variant")).toHaveCount(3);
  await expect(layerProps.getByTestId("ai-variant").nth(1)).toHaveAttribute("aria-pressed", "true");
  await layerProps.getByTestId("ai-variant").nth(2).click();
  await expect(layerProps.getByTestId("ai-variant").nth(2)).toHaveAttribute("aria-pressed", "true");
  await waitSaved(page);
  await expect(page.getByTestId("auto-visuals-status")).toContainText("ilustracje myśli");
  await page.getByTestId("auto-visuals-run").click();
  await expect(page.getByText(/AI dodało \d+ grafik/)).toBeVisible({ timeout: 90_000 });
  await waitSaved(page);
  await page.getByTestId("ai-suggest").click();
  await expect(page.getByTestId("ai-item").first()).toBeVisible({ timeout: 30_000 });
  // proposals default to illustrations; switch one to an AI video scene
  const first = page.getByTestId("ai-item").filter({ has: page.getByTestId("ai-accept") }).first();
  await expect(first).toHaveAttribute("data-kind", "illustration");
  await first.getByRole("button", { name: "Wideo AI" }).click();
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
  expect(call.size).toBe("864x1536");
  expect(call.prompt).toContain("«Ile trwa rozwód?»");
  // own illustration from the timeline: click on the graphics layer, the passage around it is shown and sent with the idea
  const lane = page.getByTestId("overlay-lane");
  const laneBox = (await lane.boundingBox())!;
  await lane.click({ position: { x: 140, y: laneBox.height - 3 } });
  const pop = page.getByTestId("new-illustration");
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId("new-illustration-context")).toContainText("„");
  const ctxText = ((await pop.getByTestId("new-illustration-context").textContent()) ?? "").replace(/^„|”$/g, "").trim();
  await pop.getByLabel("Pomysł na ilustrację").fill("Labirynt z jednym podświetlonym wyjściem i strzałką");
  await pop.getByTestId("new-illustration-submit").click();
  await expect(pop).toBeHidden();
  const own = page.getByTestId("ai-item").filter({ hasText: "Labirynt z jednym podświetlonym" });
  await expect(own.getByTestId("ai-done")).toBeVisible({ timeout: 90_000 });
  await expect(own.getByTestId("ai-variant")).toHaveCount(3);
  const ownStats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
  const ownCall = (ownStats.openai as Array<{ prompt: string }>).find((c) => c.prompt.includes("Labirynt z jednym podświetlonym wyjściem"))!;
  expect(ownCall.prompt).toContain(`«${ctxText}»`);
  expect(ownCall.prompt).toMatch(/background [a-z -]+ \(#[0-9A-Fa-f]{6}\)/);

  await waitSaved(page);
  const saved = await (await request.get(`/api/admin/compositions/${compId}`)).json();
  const doc = saved.document ?? saved.composition?.document;
  expect(doc.overlays.some((o: { kind: string; w: number }) => o.kind === "video" && o.w === 1)).toBeTruthy();
  expect(doc.overlays.some((o: { kind: string; w: number; name: string }) => o.kind === "image" && o.w === 1 && o.name.includes("Trzy kroki"))).toBeTruthy();

  // Test 12 — theme accent/highlight change propagates (stored on the project theme)
  await page.getByTestId("tab-theme").click();
  // question style from the theme: plain text in the middle, no card
  await page.getByTestId("question-style").getByRole("button", { name: "Sam tekst", exact: true }).click();
  await page.getByTestId("question-style").getByRole("button", { name: "Środek", exact: true }).click();
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
  await expect(page.getByTestId("question-style").getByRole("button", { name: "Sam tekst", exact: true })).toHaveAttribute("aria-pressed", "true");
  const restyled = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;
  const qOv = restyled.overlays.find((o: { kind: string; role?: string }) => o.kind === "text" && o.role === "question");
  expect(qOv.style.background).toBeNull();
  expect(qOv.y).toBeCloseTo(0.4);

  // SRT reflects the edit and the cuts
  const srt = await (await request.get(`/api/admin/compositions/${compId}/export?type=srt`)).text();
  expect(srt).toContain("EDYTOWANY NAPIS testowy");

  // Background blur: person mask computed by the worker (ONNX), used by the preview and the export below
  await page.getByTestId("tab-takes").click();
  // magic picture correction (measured from the recording, applied in the preview and the export)
  await page.getByRole("button", { name: "Magiczna poprawa" }).click();
  await expect(page.getByTestId("look-on")).toContainText("Jasność");
  await page.getByRole("button", { name: "Rozmyte" }).click();
  await expect(page.getByTestId("blur-on")).toBeVisible({ timeout: 120_000 });
  // the recording is cut into clips: blur can be switched off for one clip only
  const clip1 = page.getByTestId("blur-clips").getByLabel("Rozmycie w klipie 1");
  await clip1.uncheck();
  await expect(clip1).not.toBeChecked();
  await expect(page.getByTestId("blur-clips").getByLabel("Rozmycie w klipie 2")).toBeChecked();
  await clip1.check();
  await waitSaved(page);
  const blurred = await (await request.get(`/api/admin/compositions/${compId}`)).json();
  expect(blurred.composition.document.clips.every((c: { background?: { blur: number } }) => (c.background?.blur ?? 0) > 0)).toBeTruthy();
  expect(blurred.assets.some((a: { maskUrl?: string | null }) => !!a.maskUrl)).toBeTruthy();

  // AI background instead of the room: OpenAI plates (mock), pick one → every clip uses it, also in the export below
  await page.getByRole("button", { name: "Tło AI" }).click();
  await page.getByTestId("ai-background").getByLabel("Pomysł na tło").fill("jasna kancelaria z regałem książek");
  await page.getByTestId("ai-background-generate").click();
  await expect(page.getByTestId("ai-background-variant")).toHaveCount(3, { timeout: 90_000 });
  await page.getByTestId("ai-background-variant").nth(1).click();
  await expect(page.getByTestId("ai-background-variant").nth(1)).toHaveAttribute("aria-pressed", "true");
  await waitSaved(page);
  const withBg = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;
  expect(withBg.clips.every((c: { background?: { imageAssetId?: string } }) => !!c.background?.imageAssetId)).toBeTruthy();
  const bgStats = await (await request.get("http://127.0.0.1:4010/__stats", { headers: { "xi-api-key": "mock-key" } })).json();
  const bgCall = (bgStats.openai as Array<{ prompt: string }>).find((c) => c.prompt.includes("background plate"))!;
  expect(bgCall.prompt).toContain("jasna kancelaria z regałem książek");
  expect(bgCall.prompt).toMatch(/No people/);
  // the AI plate can be softened
  await page.getByLabel("Rozmycie tła AI").fill("40");
  await waitSaved(page);
  const softBg = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;
  expect(softBg.clips.every((c: { background?: { imageBlur?: number } }) => c.background?.imageBlur === 40)).toBeTruthy();
  // the recording's status straight from the Studio
  await page.getByTestId("studio-status").selectOption("TO_ACCEPT");
  await expect.poll(async () => (await (await request.get(`/api/admin/compositions/${compId}`)).json()).question.status).toBe("TO_ACCEPT");
  // backgrounds are kept in the project: every video of it can pick an earlier one
  const lib = await (await request.get(`/api/admin/compositions/${compId}/background`)).json();
  expect(lib.assets.length).toBeGreaterThanOrEqual(3);

  // "Blur behind": blurs what is under it, then fades away — also in the export below
  await page.getByTestId("tab-graphics").click();
  await page.getByRole("button", { name: "Blur behind", exact: true }).click();
  await page.getByRole("button", { name: "Koło", exact: true }).click();
  await waitSaved(page);
  const withBlur = (await (await request.get(`/api/admin/compositions/${compId}`)).json()).composition.document;
  expect(withBlur.overlays.find((o: { kind: string }) => o.kind === "blur")).toMatchObject({ shape: "circle", strength: 60 });

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
