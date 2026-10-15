import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { masteringChain } from "@/lib/server/enhance";
import { buildInitialDocument } from "@/lib/editor/factory";
import { DEFAULT_THEME } from "@/lib/themes";
import { mixAudio } from "@/lib/render/server-render";

const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args]);
function rmsDb(file: string, ss: number, t: number, filter = "anull"): number {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-af", `${filter},astats`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r.stderr);
  return m && m[1] !== "-inf" ? Number(m[1]) : -120;
}

describe("voice enhancement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "askby-enh-"));
  const noisy = path.join(dir, "noisy.wav");
  // speech-like bursts (0.6–2.6 s, 4.6–7 s) + pink noise + room echo — a clearly synthetic TEST signal
  const gate = "between(t,0.6,2.6)+between(t,4.6,7.0)";
  ff([
    "-f", "lavfi", "-i", `aevalsrc='0.18*(sin(2*PI*180*t)+0.6*sin(2*PI*360*t)+0.3*sin(2*PI*540*t))*(0.55+0.45*sin(2*PI*4*t))*(${gate})':s=48000:d=8`,
    "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.02:d=8:r=48000",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,aecho=0.6:0.4:40:0.25", "-ac", "1", noisy,
  ]);

  it("podcast mastering raises speech to podcast loudness and pushes noise in pauses down", () => {
    const out = path.join(dir, "podcast.wav");
    ff(["-i", noisy, "-af", masteringChain("podcast"), "-ar", "48000", out]);
    const rawSnr = rmsDb(noisy, 5, 1.8) - rmsDb(noisy, 3.0, 1.4);
    const newSnr = rmsDb(out, 5, 1.8) - rmsDb(out, 3.0, 1.4);
    expect(newSnr).toBeGreaterThan(rawSnr + 15); // clearly cleaner, not just louder
    expect(rmsDb(out, 5, 1.8)).toBeGreaterThan(rmsDb(noisy, 5, 1.8) + 10); // speech brought up
  });

  it("strengths are ordered: radio cleans more than natural", () => {
    const nat = path.join(dir, "nat.wav");
    const rad = path.join(dir, "rad.wav");
    ff(["-i", noisy, "-af", masteringChain("natural"), "-ar", "48000", nat]);
    ff(["-i", noisy, "-af", masteringChain("radio"), "-ar", "48000", rad]);
    expect(rmsDb(rad, 3.0, 1.4)).toBeLessThan(rmsDb(nat, 3.0, 1.4));
  });

  it("the export mix uses the enhanced track (audioAssetId), not the original clip audio", async () => {
    const video = path.join(dir, "v.mp4");
    const enhanced = path.join(dir, "enh.m4a");
    ff(["-f", "lavfi", "-i", "color=c=black:s=320x568:d=3:r=30", "-f", "lavfi", "-i", "sine=f=300:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
    ff(["-f", "lavfi", "-i", "sine=f=2000:d=3", "-c:a", "aac", enhanced]);
    let doc = buildInitialDocument({ questionText: "x", theme: DEFAULT_THEME, mode: "ANSWER_ONLY", recording: { assetId: "v", duration: 3 }, narration: null, segments: [], pauses: [], visibility: "FULL", questionSeconds: 4 });
    doc = { ...doc, clips: doc.clips.map((c) => ({ ...c, audioAssetId: "e" })) };
    const mix = path.join(dir, "mix.wav");
    await mixAudio(
      doc,
      new Map([
        ["v", { id: "v", path: video, width: 320, height: 568, hasAudio: true, hasVideo: true, kind: "x" }],
        ["e", { id: "e", path: enhanced, width: null, height: null, hasAudio: true, hasVideo: false, kind: "AUDIO_ENHANCED" }],
      ]),
      mix,
    );
    const at2k = rmsDb(mix, 0.5, 1.5, "bandpass=f=2000:w=200");
    const at300 = rmsDb(mix, 0.5, 1.5, "bandpass=f=300:w=60");
    expect(at2k).toBeGreaterThan(at300 + 20);
  });
});
