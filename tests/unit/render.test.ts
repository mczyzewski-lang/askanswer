import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInitialDocument } from "@/lib/editor/factory";
import { DEFAULT_THEME } from "@/lib/themes";
import { makeZoom } from "@/lib/editor/zoom";
import { renderComposition } from "@/lib/render/server-render";

/** Integration: real FFmpeg render of a generated TEST FIXTURE (solid colour halves) with a zoom. */
describe("server renderer", () => {
  it("renders an MP4 whose frames reflect the zoom and cut decisions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askby-render-"));
    const src = path.join(dir, "src.mp4");
    // left half red, right half blue, 540x960, 4 s, with a tone
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=270x960:d=4:r=30", "-f", "lavfi", "-i", "color=c=blue:s=270x960:d=4:r=30", "-f", "lavfi", "-i", "sine=f=300:d=4",
      "-filter_complex", "[0:v][1:v]hstack[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src]);
    let doc = buildInitialDocument({ questionText: "Test", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "v", duration: 4 }, narration: null, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    doc = { ...doc, overlays: [], zooms: [makeZoom("jump-in", 2, { end: 4, fromScale: 1.5, toScale: 1.5, cx: 0.75, cy: 0.5 })] };
    const out = path.join(dir, "out.mp4");
    const r = await renderComposition(doc, new Map([["v", { id: "v", path: src, width: 540, height: 960, hasAudio: true, hasVideo: true, kind: "x" }]]), out, { width: 540, height: 960, quality: "draft" });
    expect(r.duration).toBeCloseTo(4, 1);
    const pixel = (t: number, x: number) => {
      const buf = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", `crop=2:2:${x}:480,format=rgb24`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      return [...buf];
    };
    // before zoom: x=200 is red; with 150% zoom centred on the blue half: blue
    expect(pixel(1, 200)[0]).toBeGreaterThan(150);
    expect(pixel(3, 200)[2]).toBeGreaterThan(150);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
    expect(probe.streams.map((s: { codec_name: string }) => s.codec_name).sort()).toEqual(["aac", "h264"]);
  });
});

describe("video overlay layer", () => {
  it("draws an uploaded video as its own layer only within its time range", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askby-ov-"));
    const base = path.join(dir, "base.mp4");
    const ov = path.join(dir, "ov.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=540x960:d=3:r=30", "-f", "lavfi", "-i", "sine=f=300:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", base]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:d=1:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", ov]);
    let doc = buildInitialDocument({ questionText: "Test", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "v", duration: 3 }, narration: null, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    doc = {
      ...doc,
      overlays: [{ id: "o1", kind: "video", name: "ov", assetId: "ov", fit: "cover", sourceIn: 0, loop: true, volume: 0, radius: 0, start: 1, end: 2.5, x: 0.25, y: 0.4, w: 0.5, h: 0.2, opacity: 1, animation: "none" }],
    };
    const out = path.join(dir, "out.mp4");
    await renderComposition(
      doc,
      new Map([
        ["v", { id: "v", path: base, width: 540, height: 960, hasAudio: true, hasVideo: true, kind: "x", durationSec: 3 }],
        ["ov", { id: "ov", path: ov, width: 320, height: 180, hasAudio: false, hasVideo: true, kind: "OVERLAY_VIDEO", durationSec: 1 }],
      ]),
      out,
      { width: 540, height: 960, quality: "draft" },
    );
    const px = (t: number) => [...execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "crop=2:2:270:480,format=rgb24", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])];
    expect(px(0.5)[2]).toBeGreaterThan(150); // blue: before the layer starts
    expect(px(1.8)[1]).toBeGreaterThan(150); // green: overlay visible (looped past its 1 s length)
    expect(px(2.8)[2]).toBeGreaterThan(150); // blue again after it ends
  });
});
