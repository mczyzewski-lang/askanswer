import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeRecording, normalizedSize, probe } from "../../src/lib/server/ffmpeg";

describe("normalization", () => {
  it("sizes a portrait recording for 9:16 and keeps landscape within 1920", () => {
    expect(normalizedSize({ width: 1440, height: 2560 })).toEqual({ width: 1080, height: 1920 });
    expect(normalizedSize({ width: 2560, height: 1440 })).toEqual({ width: 1920, height: 1080 });
    expect(normalizedSize({ width: 1280, height: 720 }, 90)).toEqual({ width: 720, height: 1280 });
  });

  it("does not stretch a recording whose camera resolution changes mid-way", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "norm-"));
    const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
    // the first second landscape (camera warming up), then portrait — like a phone browser
    ff(["-f", "lavfi", "-i", "testsrc2=s=640x480:r=30:d=1", "-c:v", "libvpx", "-b:v", "1M", path.join(d, "a.webm")]);
    ff(["-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=3", "-c:v", "libvpx", "-b:v", "1M", path.join(d, "b.webm")]);
    fs.writeFileSync(path.join(d, "l.txt"), "file a.webm\nfile b.webm\n");
    ff(["-f", "concat", "-i", path.join(d, "l.txt"), "-c", "copy", path.join(d, "mix.webm")]);
    await normalizeRecording(path.join(d, "mix.webm"), path.join(d, "out.mp4"), undefined, 4);
    const p = await probe(path.join(d, "out.mp4"));
    expect([p.width, p.height]).toEqual([720, 1280]);
    fs.rmSync(d, { recursive: true, force: true });
  }, 60_000);

  it("un-squeezes a portrait camera picture the browser saved as landscape", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "norm-"));
    // portrait 720×1280 picture squeezed into 1280×720 (what a browser encoder can bake in)
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=3", "-vf", "scale=1280:720,setsar=1", "-c:v", "libx264", path.join(d, "sq.mp4")]);
    await normalizeRecording(path.join(d, "sq.mp4"), path.join(d, "out.mp4"), undefined, 3, false, { w: 720, h: 1280 });
    const p = await probe(path.join(d, "out.mp4"));
    expect(p.height! / p.width!).toBeCloseTo(1280 / 720, 1);
    fs.rmSync(d, { recursive: true, force: true });
  }, 60_000);

  it("crops a portrait picture the browser boxed into a landscape frame", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "norm-"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=404x720:r=30:d=3", "-vf", "pad=1280:720:(ow-iw)/2:0:black,setsar=1", "-c:v", "libx264", path.join(d, "box.mp4")]);
    await normalizeRecording(path.join(d, "box.mp4"), path.join(d, "out.mp4"), undefined, 3, false, { w: 720, h: 1280 });
    const p = await probe(path.join(d, "out.mp4"));
    expect(p.height! > p.width!).toBe(true);
    expect(p.height! / p.width!).toBeCloseTo(720 / 404, 1);
    fs.rmSync(d, { recursive: true, force: true });
  }, 60_000);

  it("leaves a normal portrait recording alone", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "norm-"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=2", "-c:v", "libx264", path.join(d, "ok.mp4")]);
    await normalizeRecording(path.join(d, "ok.mp4"), path.join(d, "out.mp4"), undefined, 2, true, { w: 720, h: 1280 });
    const p = await probe(path.join(d, "out.mp4"));
    expect([p.width, p.height]).toEqual([720, 1280]);
    fs.rmSync(d, { recursive: true, force: true });
  }, 60_000);
});
