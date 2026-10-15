import type { EditorDocument, SubtitlePresetKey, SubtitleSegment, SubtitleStyle, SubWord } from "./types";
import { timedSegments } from "./timeline";
import { uid } from "./id";

export interface RawWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

const SENTENCE_END = /[.!?…]["»”)]?$/;
const CLAUSE_END = /[,;:–—]$/;

/**
 * Group word-level timestamps into readable subtitle segments of ~3–7 words.
 * Breaks on sentence ends, long gaps and character budget; prefers breaking
 * after commas once a group has at least 3 words. Timing comes only from the
 * real word timestamps — never estimated from sentence duration.
 */
export function groupWords(
  words: RawWord[],
  opts: { minWords?: number; maxWords?: number; maxChars?: number; maxGap?: number } = {},
): RawWord[][] {
  const minWords = opts.minWords ?? 3;
  const maxWords = opts.maxWords ?? 7;
  const maxChars = opts.maxChars ?? 38;
  const maxGap = opts.maxGap ?? 0.7;
  const list = words.filter((w) => (w.type ?? "word") === "word" && w.text.trim());
  const groups: RawWord[][] = [];
  let cur: RawWord[] = [];
  const chars = (g: RawWord[]) => g.reduce((n, w) => n + w.text.length + 1, 0);
  for (let i = 0; i < list.length; i++) {
    const w = { ...list[i], text: list[i].text.trim() };
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > maxGap) {
      groups.push(cur);
      cur = [];
    }
    if (cur.length && (cur.length >= maxWords || chars(cur) + w.text.length > maxChars)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    if (SENTENCE_END.test(w.text) && cur.length >= 1) {
      groups.push(cur);
      cur = [];
    } else if (CLAUSE_END.test(w.text) && cur.length >= minWords) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  // merge tiny trailing groups (1 word) into the previous group if close in time and within budget
  const merged: RawWord[][] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (
      last &&
      g.length === 1 &&
      !SENTENCE_END.test(last[last.length - 1].text) &&
      g[0].start - last[last.length - 1].end < 0.4 &&
      last.length < maxWords + 1 &&
      chars(last) + g[0].text.length <= maxChars + 6
    ) {
      merged[merged.length - 1] = [...last, ...g];
    } else merged.push(g);
  }
  return merged;
}

export function buildSegments(assetId: string, words: RawWord[]): SubtitleSegment[] {
  return groupWords(words).map((g) => ({
    id: uid("seg"),
    assetId,
    words: g.map<SubWord>((w) => ({ id: uid("w"), text: w.text, start: w.start, end: w.end })),
  }));
}

export const SUBTITLE_PRESETS: Record<SubtitlePresetKey, { label: string; style: SubtitleStyle }> = {
  "minimal-white": {
    label: "Minimal White",
    style: {
      fontFamily: "$subtitle",
      fontSize: 54,
      fontWeight: 600,
      color: "#FFFFFF",
      highlightColor: "$highlight",
      highlightMode: "none",
      case: "normal",
      y: 0.74,
      maxWidth: 0.82,
      background: null,
      backgroundOpacity: 0,
      stroke: 0,
      shadow: 14,
      animation: "fade",
      lineHeight: 1.18,
    },
  },
  "bold-social": {
    label: "Bold Social",
    style: {
      fontFamily: "Montserrat",
      fontSize: 74,
      fontWeight: 800,
      color: "#FFFFFF",
      highlightColor: "$highlight",
      highlightMode: "color",
      case: "upper",
      y: 0.72,
      maxWidth: 0.86,
      background: null,
      backgroundOpacity: 0,
      stroke: 7,
      shadow: 10,
      animation: "pop",
      lineHeight: 1.08,
    },
  },
  "dynamic-highlight": {
    label: "Dynamic Highlight",
    style: {
      fontFamily: "$subtitle",
      fontSize: 64,
      fontWeight: 800,
      color: "#FFFFFF",
      highlightColor: "$highlight",
      highlightMode: "box",
      case: "normal",
      y: 0.73,
      maxWidth: 0.84,
      background: null,
      backgroundOpacity: 0,
      stroke: 0,
      shadow: 16,
      animation: "pop",
      lineHeight: 1.22,
    },
  },
  "elegant-premium": {
    label: "Elegant Premium",
    style: {
      fontFamily: "$question",
      fontSize: 52,
      fontWeight: 500,
      color: "#FFFFFF",
      highlightColor: "$accent",
      highlightMode: "color",
      case: "normal",
      y: 0.76,
      maxWidth: 0.78,
      background: "#000000",
      backgroundOpacity: 0.42,
      stroke: 0,
      shadow: 0,
      animation: "fade",
      lineHeight: 1.25,
    },
  },
  "clean-corporate": {
    label: "Clean Corporate",
    style: {
      fontFamily: "$subtitle",
      fontSize: 50,
      fontWeight: 600,
      color: "#111827",
      highlightColor: "$primary",
      highlightMode: "color",
      case: "normal",
      y: 0.77,
      maxWidth: 0.8,
      background: "#FFFFFF",
      backgroundOpacity: 0.94,
      stroke: 0,
      shadow: 0,
      animation: "none",
      lineHeight: 1.22,
    },
  },
};

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

/** SRT in timeline time — reflects all cuts, reorders and subtitle edits. */
export function toSRT(doc: EditorDocument): string {
  const segs = timedSegments(doc);
  return segs
    .map((s, i) => {
      const text = s.words.map((w) => w.text).join(" ");
      return `${i + 1}\n${srtTime(s.t0)} --> ${srtTime(Math.max(s.t0 + 0.1, s.words[s.words.length - 1].t1))}\n${text}\n`;
    })
    .join("\n");
}

export function toPlainText(doc: EditorDocument): string {
  return timedSegments(doc)
    .map((s) => s.words.map((w) => w.text).join(" "))
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1");
}
