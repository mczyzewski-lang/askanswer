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
});
