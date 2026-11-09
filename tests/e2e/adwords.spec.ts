import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { adminRequest, login } from "./helpers";

const CSV = fs.readFileSync("tests/fixtures/adwords/nowy_etap_google_adwords_pmax.csv", "utf-8");
const ffprobe = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString());

test("Google Adwords API: idempotent CSV import, real PNG renders, ZIP with manifest, storyboard MP4", async ({ request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap", preset: "nowy-etap" } })).json();
  const base = `/api/admin/adwords/${project.id}`;

  // preview: counts, no errors, nothing written yet
  const dry = await (await request.post(`${base}/import`, { data: { text: CSV, dryRun: true } })).json();
  expect(dry.total).toBe(81);
  expect(dry.counts).toEqual({ image: 18, image_clean: 2, video: 15, video_scene: 21, headline: 15, long_headline: 5, description: 5, sitelink: 0, experiment_plan: 0, historical_reference: 0, landing_page: 0 });
  expect(dry.concepts).toEqual({ images: 6, cleanPhotos: 2, videos: 5, scenes: 21, texts: 25, experiments: 0, meta: 0, sitelinks: 0, landing: 0 });
  expect(dry.issues.filter((i: { level: string }) => i.level === "error")).toEqual([]);
  expect(dry.projectSlugMismatch).toEqual([]);
  expect(dry.applied).toBe(false);
  expect((await (await request.get(base)).json()).assets).toHaveLength(0);

  const first = await (await request.post(`${base}/import`, { data: { text: CSV, dryRun: false } })).json();
  expect([first.created, first.updated, first.unchanged, first.campaignsCreated]).toEqual([81, 0, 0, 2]);
  // the same file again: nothing new, nothing duplicated
  const again = await (await request.post(`${base}/import`, { data: { text: CSV, dryRun: false } })).json();
  expect([again.created, again.updated, again.unchanged]).toEqual([0, 0, 81]);
  const data = await (await request.get(base)).json();
  expect(data.assets).toHaveLength(81);
  expect(data.campaigns.map((c: { code: string; goal: string }) => [c.code, c.goal])).toEqual([["NE-PMAX-SPRZ", "sprzedaz"], ["NE-PMAX-PORADNIK", "poradnik"]]);
  // G05 (a client count to confirm) is blocked whatever its score
  const g05 = data.evaluation.images.find((e: { assetKey: string }) => e.assetKey === "G05-L");
  expect(g05.gate.status).toBe("blokada");

  // a file with an error in row 3 is refused with the row number, nothing written
  const bad = await (await request.post(`${base}/import`, { data: { text: "row_type;asset_id;ad_text\nheadline;HX1;Ok\nheadline;HX1;Dubel\n", dryRun: false } })).json();
  expect(bad.applied).toBe(false);
  expect(bad.issues[0]).toMatchObject({ row: 3, column: "asset_id" });

  // real PNGs at the three sizes, under 5 MB
  const g02 = (k: string) => data.assets.find((a: { assetKey: string }) => a.assetKey === k).id;
  for (const [k, w, h] of [["G02-L", 1200, 628], ["G02-SQ", 1200, 1200], ["G02-P", 960, 1200]] as const) {
    const r = await request.get(`${base}/render/${g02(k)}?fmt=png`);
    expect(r.status()).toBe(200);
    const buf = await r.body();
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([w, h]);
    expect(buf.length).toBeLessThan(5120 * 1024);
    expect(r.headers()["content-disposition"]).toContain(`nowy-etap_G02_${w > h ? "landscape" : w === h ? "square" : "portrait"}_${w}x${h}.png`);
    expect(r.headers()["x-render-overflow"]).toBe("false");
  }
  const jpg = await (await request.get(`${base}/render/${g02("G02-L")}?fmt=jpg`)).body();
  expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);

  // the package
  const zip = unzipSync(new Uint8Array(await (await request.get(`${base}/zip?fmt=png`)).body()));
  const names = Object.keys(zip);
  expect(names.filter((n) => n.startsWith("grafiki/") && n.endsWith(".png"))).toHaveLength(20);
  expect(names).toEqual(expect.arrayContaining(["manifest.csv", "manifest.json", "brief.md", "nowy-etap_google_adwords.csv", "wideo/shotlista.csv", "wideo/V01/napisy.srt", "wideo/V01/teleprompter.txt"]));
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(manifest.files).toHaveLength(20);
  expect(manifest.files[0]).toEqual(expect.objectContaining({ asset_id: expect.any(String), width: expect.any(Number), height: expect.any(Number), score_a: expect.any(Number), status: expect.any(String), file: expect.stringMatching(/^grafiki\/nowy-etap_/) }));
  // the CSV round trip: exported and imported back = unchanged
  const exported = strFromU8(zip["nowy-etap_google_adwords.csv"]);
  const back = await (await request.post(`${base}/import`, { data: { text: exported, dryRun: false } })).json();
  expect([back.created, back.updated, back.unchanged]).toEqual([0, 0, 81]);

  // the storyboard MP4 of V01, three orientations, with voice and subtitles
  const { jobId } = await (await request.post(`${base}/videos/V01`, { data: { voice: true } })).json();
  await expect.poll(async () => (await (await request.get(`/api/admin/jobs/${jobId}`)).json()).status, { timeout: 180_000 }).toBe("SUCCEEDED");
  const files = (await (await request.get(`${base}/videos/V01`)).json()).files as Array<{ url: string; width: number; height: number }>;
  expect(files.map((f) => `${f.width}x${f.height}`).sort()).toEqual(["1080x1080", "1080x1920", "1920x1080"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adw-"));
  for (const f of files) {
    const file = path.join(dir, `${f.width}x${f.height}.mp4`);
    fs.writeFileSync(file, await (await request.get(f.url)).body());
    const info = ffprobe(file);
    const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const a = info.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
    const sub = info.streams.find((s: { codec_type: string }) => s.codec_type === "subtitle");
    expect([v.codec_name, v.width, v.height]).toEqual(["h264", f.width, f.height]);
    expect(a.codec_name).toBe("aac");
    expect(sub.codec_name).toBe("mov_text");
    expect(Number(info.format.duration)).toBeGreaterThan(24.5);
    expect(Number(info.format.duration)).toBeLessThan(25.6);
  }
});

test("Google Adwords UI: import, gallery, editor (preview = export), expert photo with consent, texts, video, brief", async ({ page, request }) => {
  test.setTimeout(300_000);
  await adminRequest(request);
  const project = await (await request.post("/api/admin/projects", { data: { name: "Nowy Etap UI", preset: "nowy-etap" } })).json();
  await login(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  // from the menu: the project's Google Adwords
  await page.goto(`/admin/projects/${project.id}`);
  await page.getByTestId("nav-project").getByRole("link", { name: "Google Adwords" }).click();
  await expect(page.getByTestId("adwords")).toBeVisible();
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Import CSV" }).click();
  await page.getByTestId("import-file").setInputFiles({ name: "nowy_etap_google_adwords_pmax.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf-8") });
  await expect(page.getByTestId("import-counts")).toContainText("6 koncepty graficzne, 2 czyste zdjęcia, 5 koncepty wideo, 21 scen, 25 tekstów");
  await expect(page.getByTestId("import-table").locator("tbody tr")).toHaveCount(10);
  await page.getByTestId("import-confirm").click();
  await expect(page.getByText("Zaimportowano: 81 nowych")).toBeVisible();

  // campaigns: sales and educational kept apart, completeness, the landing URL
  await expect(page.getByTestId("campaign")).toHaveCount(2);
  await expect(page.getByTestId("policy-note")).toContainText("trudności w związkach");
  await expect(page.getByTestId("campaign").first().getByTestId("group-checklist")).toContainText("Krótki nagłówek: 15/15");
  await page.getByTestId("campaign").first().getByLabel("Docelowy URL").fill("https://nowyetap.pl/konsultacja");
  await page.getByTestId("campaign").first().getByLabel("Nazwa firmy").click();
  await expect(page.getByTestId("campaign").first().getByTestId("group-checklist")).toContainText("URL: https://nowyetap.pl/konsultacja");

  // expert photo (private upload) with consent, assigned to the CSV key
  const photo = path.join(os.tmpdir(), `ekspert-${Date.now()}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=800x1000:duration=1", "-frames:v", "1", photo]);
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Zdjęcia ekspertów" }).click();
  await page.getByLabel("Klucz zdjęcia").fill("ekspert_marek");
  await page.getByLabel("Imię i nazwisko").fill("Marek Mediator");
  await page.getByTestId("photo-file").setInputFiles(photo);
  await page.getByTestId("photo-add").click();
  await expect(page.getByTestId("expert-photo")).toHaveCount(1);
  await expect(page.getByTestId("photo-keys")).toContainText("ekspert_marek");
  // a text file renamed to .jpg is refused
  await page.getByLabel("Klucz zdjęcia").fill("zly_plik");
  await page.getByLabel("Imię i nazwisko").fill("Ktoś");
  await page.getByTestId("photo-file").setInputFiles({ name: "zdjecie.jpg", mimeType: "image/jpeg", buffer: Buffer.from("to nie jest obraz") });
  await page.getByTestId("photo-add").click();
  await expect(page.getByText(/uszkodzony|format/)).toBeVisible();

  // the gallery: 6 concepts + 2 clean photos; G02 uses the photo → blocked until consent is confirmed
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Kreacje graficzne" }).click();
  await expect(page.getByTestId("concept-card")).toHaveCount(8);
  await page.getByTestId("concept-card").filter({ hasText: "G02" }).click();
  const editor = page.getByTestId("concept-editor");
  await expect(editor.getByTestId("gate-problems")).toContainText("zgody");
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Zdjęcia ekspertów" }).click();
  await page.getByTestId("photo-consent").check();
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Kreacje graficzne" }).click();
  await page.getByTestId("concept-card").filter({ hasText: "G02" }).click();
  await expect(editor).not.toContainText("Brak potwierdzonej zgody");

  // edit in all three formats, save; the export is the same picture as the preview
  await editor.getByTestId("edit-headline").fill("Najpierw plan, potem pozew — ąęż");
  await editor.getByTestId("concept-save").click();
  await expect(page.getByText("Zapisano koncept")).toBeVisible();
  const data = await (await request.get(`/api/admin/adwords/${project.id}`)).json();
  expect(data.assets.filter((a: { conceptId: string; headline: string }) => a.conceptId === "G02" && a.headline === "Najpierw plan, potem pozew — ąęż")).toHaveLength(3);
  await editor.getByText("Safe area (80%)").click(); // preview without the frame, like the export
  await page.waitForTimeout(800);
  const diff = await page.evaluate(async ({ id, pid }) => {
    const canvas = document.querySelector('[data-testid="concept-editor"] [data-testid="preview-landscape"]') as HTMLCanvasElement;
    const a = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const img = new Image();
    img.src = URL.createObjectURL(await (await fetch(`/api/admin/adwords/${pid}/render/${id}?fmt=png`)).blob());
    await img.decode();
    const c2 = document.createElement("canvas");
    c2.width = img.width;
    c2.height = img.height;
    const ctx = c2.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const b = ctx.getImageData(0, 0, img.width, img.height).data;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return { w: img.width, h: img.height, cw: canvas.width, ch: canvas.height, mean: sum / (a.length / 4) / 3 };
  }, { id: data.assets.find((a: { assetKey: string }) => a.assetKey === "G02-L").id, pid: project.id });
  expect([diff.w, diff.h, diff.cw, diff.ch]).toEqual([1200, 628, 1200, 628]);
  // the same drawing in Chrome and on the server (font anti-aliasing differs a little)
  expect(diff.mean).toBeLessThan(6);

  // G05 is blocked until its source is approved
  await page.getByTestId("concept-card").filter({ hasText: "G05" }).click();
  await expect(editor.getByTestId("gate-problems")).toContainText("Wymaga zatwierdzenia");
  await editor.getByTestId("approval").getByRole("button").click();
  await expect(editor.getByTestId("approval")).toContainText("Zatwierdzone przez");
  await expect(editor).not.toContainText("Wymaga zatwierdzenia źródła");

  // texts: live counter, a too long one is blocked
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Teksty reklam" }).click();
  const first = page.getByTestId("texts-headline").getByTestId("text-row").first();
  await first.getByRole("textbox").fill("Rozwód bez wojny i bez długich spraw");
  await expect(first.getByTestId("char-count")).toHaveText("36/30");
  await expect(first.getByTestId("gate")).toHaveAttribute("data-status", "blokada");
  await expect(page.getByTestId("combo-preview")).toContainText("Sponsorowane");

  // video: the scenes, the SRT
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Wideo" }).click();
  await expect(page.getByTestId("video-concept")).toHaveCount(5);
  await expect(page.getByTestId("scene-row")).toHaveCount(5);
  const srt = page.waitForEvent("download");
  await page.getByTestId("download-srt").click();
  expect((await srt).suggestedFilename()).toBe("nowy-etap-ui_V01.srt");

  // the brief: generated, edited, exported
  await page.getByTestId("adwords-tabs").getByRole("button", { name: "Raport dla agencji" }).click();
  const brief = page.getByLabel("Brief");
  await expect(brief).toHaveValue(/NOWY ETAP UI — PMAX/);
  await expect(brief).toHaveValue(/Top koncepty: G\d\d „[^”]*” \[A \d+ \/ B \d+/);
  await brief.fill(`${await brief.inputValue()}\nUwaga ręczna: test`);
  await page.getByTestId("brief-save").click();
  await expect(page.getByText("Zapisano brief")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Brief")).toHaveValue(/Uwaga ręczna: test/);
  if (process.env.AW_SHOT) {
    await page.getByTestId("adwords-tabs").getByRole("button", { name: "Kreacje graficzne" }).click();
    await page.getByTestId("concept-card").filter({ hasText: "G02" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: process.env.AW_SHOT, fullPage: true });
  }
});
