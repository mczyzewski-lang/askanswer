/**
 * Google Adwords — video concepts: variants (one per orientation) + scenes joined by concept_id, and
 * what is made from the scenes: subtitles (.srt), the teleprompter script and the shot list.
 */
import Papa from "papaparse";
import type { AdAsset, VideoConcept } from "./score";

export function videoConcepts(assets: AdAsset[]): VideoConcept[] {
  const ids = [...new Set(assets.filter((a) => a.rowType === "video" || a.rowType === "video_scene").map((a) => a.conceptId ?? "?"))];
  return ids.map((conceptId) => ({
    conceptId,
    variants: assets.filter((a) => a.rowType === "video" && (a.conceptId ?? "?") === conceptId),
    scenes: assets.filter((a) => a.rowType === "video_scene" && (a.conceptId ?? "?") === conceptId).sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0)),
  }));
}

export const videoDuration = (v: VideoConcept) => Math.max(v.variants[0]?.durationSec ?? 0, ...v.scenes.map((s) => s.endS ?? 0));

const ts = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** Lines of at most `max` characters, at most two per cue. */
function lines(text: string, max = 42): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (line && (line + " " + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Subtitles from the scenes' spoken text: a long scene is split into cues of two lines, timed in
 * proportion to their length within the scene.
 */
export function scenesToSrt(scenes: AdAsset[], field: "spokenText" | "screenText" = "spokenText"): string {
  const cues: Array<{ a: number; b: number; text: string }> = [];
  for (const s of scenes) {
    const text = (s[field] ?? "").trim();
    if (!text || s.startS == null || s.endS == null || s.endS <= s.startS) continue;
    const ls = lines(text);
    const chunks: string[] = [];
    for (let i = 0; i < ls.length; i += 2) chunks.push(ls.slice(i, i + 2).join("\n"));
    const total = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let t = s.startS;
    for (const c of chunks) {
      const len = ((s.endS - s.startS) * c.length) / total;
      cues.push({ a: t, b: Math.min(s.endS, t + len), text: c });
      t += len;
    }
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(c.b)}\n${c.text}\n`).join("\n");
}

/** The expert's full text for the teleprompter, scene by scene. */
export function teleprompterScript(v: VideoConcept, title?: string): string {
  const head = `${title ?? v.conceptId} — tekst do telepromptera\n\n`;
  return head + v.scenes.map((s) => `[${s.sceneIndex}] ${fmt(s.startS)}–${fmt(s.endS)}${s.screenText ? `  (napis: ${s.screenText})` : ""}\n${(s.spokenText ?? "").trim()}`).join("\n\n") + "\n";
}

const fmt = (t: number | null | undefined) => (t == null ? "?" : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`);

/** The shot list: what to record (one row per scene). */
export function shotlistCsv(concepts: VideoConcept[]): string {
  const rows = concepts.flatMap((v) =>
    v.scenes.map((s) => ({
      koncept: v.conceptId,
      scena: s.sceneIndex ?? "",
      start_s: s.startS ?? "",
      koniec_s: s.endS ?? "",
      czas_s: s.startS != null && s.endS != null ? Math.round((s.endS - s.startS) * 10) / 10 : "",
      kadr: s.visualBrief ?? "",
      napis: s.screenText ?? "",
      slowa_eksperta: s.spokenText ?? "",
      ekspert: s.expertPhotoKey ?? "",
      formaty: v.variants.map((x) => x.aspectRatio).filter(Boolean).join(" / "),
    })),
  );
  return "﻿" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n" });
}

export function shotlistMarkdown(concepts: VideoConcept[]): string {
  return concepts
    .map((v) => {
      const head = `## ${v.conceptId} (${v.variants.map((x) => x.aspectRatio).filter(Boolean).join(", ") || "bez wariantów"}) — ${Math.max(v.variants[0]?.durationSec ?? 0, ...v.scenes.map((s) => s.endS ?? 0))} s`;
      const rows = v.scenes.map((s) => `| ${s.sceneIndex} | ${fmt(s.startS)}–${fmt(s.endS)} | ${md(s.visualBrief)} | ${md(s.screenText)} | ${md(s.spokenText)} |`);
      return [head, "", "| # | Czas | Kadr / obraz | Napis | Słowa eksperta |", "|---|---|---|---|---|", ...rows].join("\n");
    })
    .join("\n\n");
}
const md = (s: string | null | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
