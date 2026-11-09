import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { adminRequest } from "./helpers";

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
  expect(dry.counts).toEqual({ image: 18, image_clean: 2, video: 15, video_scene: 21, headline: 15, long_headline: 5, description: 5 });
  expect(dry.concepts).toEqual({ images: 6, cleanPhotos: 2, videos: 5, scenes: 21, texts: 25 });
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
