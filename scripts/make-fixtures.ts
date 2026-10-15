/**
 * TEST FIXTURES ONLY — synthetic media for automated tests. These files are
 * generated test patterns (colour bars + tone bursts), not expert recordings.
 *
 *  - fake-camera.y4m  : portrait test pattern fed to Chromium as a fake webcam
 *  - fake-mic.wav     : tone bursts with known pauses fed as a fake microphone
 *  - sample-take.mp4  : the same pattern+audio as a ready-made upload
 *
 * Audio timeline (repeats every 12 s): speech-like bursts 0.6–2.6 s, 4.6–7.0 s, 8.0–11.4 s.
 * Pauses: 0–0.6 s, 2.6–4.6 s (2.0 s), 7.0–8.0 s (1.0 s), 11.4–12 s.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("tests/fixtures/generated");
fs.mkdirSync(out, { recursive: true });
const ff = process.env.FFMPEG_PATH || "ffmpeg";
const gate = "between(t,0.6,2.6)+between(t,4.6,7.0)+between(t,8.0,11.4)";
// a voice-like signal: harmonics with syllable-rate amplitude modulation inside the bursts
const voice = `0.35*(sin(2*PI*180*t)+0.6*sin(2*PI*360*t)+0.3*sin(2*PI*540*t))*(0.55+0.45*sin(2*PI*4*t))*(${gate})`;

function run(args: string[]) {
  execFileSync(ff, ["-hide_banner", "-v", "error", "-y", ...args], { stdio: "inherit" });
}

const wav = path.join(out, "fake-mic.wav");
if (!fs.existsSync(wav)) run(["-f", "lavfi", "-i", `aevalsrc='${voice}':s=48000:d=12`, "-ac", "1", wav]);

const y4m = path.join(out, "fake-camera.y4m");
if (!fs.existsSync(y4m))
  run(["-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4", "-vf", "drawtext=text='TEST FIXTURE':fontcolor=white:fontsize=28:x=(w-tw)/2:y=h*0.45:box=1:boxcolor=black@0.6,format=yuv420p", "-pix_fmt", "yuv420p", y4m]);

const mp4 = path.join(out, "sample-take.mp4");
if (!fs.existsSync(mp4))
  run([
    "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=12",
    "-f", "lavfi", "-i", `aevalsrc='${voice}':s=48000:d=12`,
    "-vf", "drawtext=text='TEST FIXTURE — not a real recording':fontcolor=white:fontsize=26:x=(w-tw)/2:y=h*0.45:box=1:boxcolor=black@0.6",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4,
  ]);

console.log("fixtures ready in", out);
