/**
 * Best practices and limits per platform — a separate, versioned module. Every AI generation stores
 * RULES_VERSION, so it is known which rules a text was written by. Update the values here (and bump
 * the version) when a platform changes its limits; the numbers are the platforms' published limits
 * at the time of writing and should be re-checked against their documentation now and then.
 */
import { PLATFORM_META, type Platform } from "./platforms";

export const RULES_VERSION = "2026-10-29.1";

export interface PlatformRules {
  limits: {
    /** YouTube title, LinkedIn / Facebook video title */
    title?: number;
    /** caption / description / post text */
    text: number;
    hashtagsMax: number;
    hashtagsRecommended: [number, number];
    firstComment?: number;
    /** YouTube tags, total characters */
    tagsTotal?: number;
  };
  video: {
    minSec: number;
    maxSec: number;
    /** vertical 9:16 expected (Reels / Shorts) */
    vertical: boolean;
    /** a square film still counts (YouTube Shorts) */
    squareOk?: boolean;
    maxBytes: number;
    codecs: string[];
    minHeight: number;
    note?: string;
  };
  /** what the AI is asked to follow for this platform */
  writing: string[];
  /** fields the editor shows for this platform */
  fields: { title: boolean; firstComment: boolean; tags: boolean };
}

export const BANNED_HASHTAGS = ["viral", "fyp", "foryou", "foryoupage", "fy", "reels", "reelsinstagram", "explore", "explorepage", "trending", "viralvideo", "xyzbca", "tiktok", "shorts", "instagood", "like4like", "follow4follow"];

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  INSTAGRAM: {
    limits: { text: 2200, hashtagsMax: 30, hashtagsRecommended: [3, 5], firstComment: 2200 },
    video: { minSec: 3, maxSec: 15 * 60, vertical: true, maxBytes: 300 * 1024 * 1024, codecs: ["h264", "hevc"], minHeight: 960, note: "Reels: 9:16, 1080×1920 zalecane, 23–60 fps." },
    writing: [
      "Pierwsze zdanie zatrzymuje kciuk: konkretny problem, liczba albo pytanie — bez powitań.",
      "Opis naturalny, w tonie marki, krótkie akapity; słowa kluczowe wplecione naturalnie (wyszukiwarka Instagrama).",
      "3–5 trafnych hashtagów (tematycznych i niszowych), nigdy ogólnych typu #viral #reels #explore.",
      "Jedno jasne CTA (zapisz / wyślij komuś / napisz w wiadomości).",
      "Opcjonalnie pierwszy komentarz: dopowiedzenie, pytanie do widzów albo dodatkowe słowa kluczowe — nie powtarzaj opisu.",
      "Zaproponuj okładkę: moment filmu z czytelną twarzą i napisem (sekunda filmu).",
    ],
    fields: { title: false, firstComment: true, tags: false },
  },
  TIKTOK: {
    limits: { text: 2200, hashtagsMax: 10, hashtagsRecommended: [3, 5] },
    video: { minSec: 3, maxSec: 10 * 60, vertical: true, maxBytes: 4 * 1024 * 1024 * 1024, codecs: ["h264", "hevc"], minHeight: 720, note: "Maksymalna długość zależy od konta (ustawienia publikacji TikTok)." },
    writing: [
      "Mocne, krótkie otwarcie w pierwszych słowach opisu.",
      "Zwięzły, naturalny opis (1–3 zdania); frazy, które ktoś wpisałby w wyszukiwarkę TikToka.",
      "3–5 trafnych hashtagów bez spamowania; żadnych #fyp #foryou #viral.",
      "Krótkie CTA (zapisz, wyślij komuś, zapytaj w komentarzu).",
      "Nie obiecuj zasięgów ani efektów algorytmu.",
    ],
    fields: { title: false, firstComment: true, tags: false },
  },
  YOUTUBE: {
    limits: { title: 100, text: 5000, hashtagsMax: 15, hashtagsRecommended: [1, 3], firstComment: 10000, tagsTotal: 500 },
    video: { minSec: 1, maxSec: 3 * 60, vertical: true, squareOk: true, maxBytes: 256 * 1024 * 1024 * 1024, codecs: ["h264", "hevc", "vp9", "av1"], minHeight: 720, note: "Shorts: pionowy lub kwadratowy, do 3 minut." },
    writing: [
      "Tytuł do 100 znaków (najlepiej do 60): konkretny, z główną frazą wyszukiwania, bez clickbaitu.",
      "Opis: 2–4 zdania kontekstu z frazami, których ludzie szukają; na końcu CTA.",
      "1–3 hashtagi tylko, jeśli mają sens (np. temat); #shorts nie jest potrzebny.",
      "Osobno 5–12 tagów YouTube (frazy, odmiany, synonimy) — razem do 500 znaków.",
      "Opcjonalnie pierwszy komentarz z pytaniem do widzów.",
    ],
    fields: { title: true, firstComment: true, tags: true },
  },
  FACEBOOK: {
    limits: { title: 255, text: 63206, hashtagsMax: 5, hashtagsRecommended: [0, 3], firstComment: 8000 },
    video: { minSec: 3, maxSec: 90, vertical: true, maxBytes: 1024 * 1024 * 1024, codecs: ["h264", "hevc"], minHeight: 960, note: "Reels: 3–90 s, 9:16. Dłuższy lub poziomy film idzie jako zwykły post wideo." },
    writing: [
      "Opis skłaniający do obejrzenia: kontekst sytuacji widza, 1–3 krótkie akapity.",
      "Najlepiej do ~500 znaków, mimo dużego limitu.",
      "CTA dopasowane do Facebooka (komentarz, udostępnienie znajomemu, wiadomość do strony).",
      "Hashtagi tylko gdy mają sens — 0–3.",
    ],
    fields: { title: false, firstComment: true, tags: false },
  },
  LINKEDIN: {
    limits: { title: 200, text: 3000, hashtagsMax: 5, hashtagsRecommended: [2, 4], firstComment: 1250 },
    video: { minSec: 3, maxSec: 30 * 60, vertical: false, maxBytes: 5 * 1024 * 1024 * 1024, codecs: ["h264"], minHeight: 360, note: "Pionowe i poziome filmy są obsługiwane." },
    writing: [
      "Profesjonalny, ale naturalny styl — bez korpomowy i pustych sloganów.",
      "Otwarcie (pierwsze 1–2 linijki przed „…więcej”) z obserwacją lub insightem, który zachęca do rozwinięcia.",
      "Krótkie akapity, kontekst biznesowy: dlaczego to ważne dla firmy / klienta.",
      "Na końcu CTA albo pytanie do dyskusji.",
      "2–4 hashtagi branżowe.",
    ],
    fields: { title: false, firstComment: true, tags: false },
  },
};

export const GLOBAL_RULES = [
  "Nie wymyślaj faktów, statystyk, cen, terminów ani obietnic — używaj tylko informacji z filmu, transkrypcji i ustawień marki.",
  "Nie obiecuj wyników (zasięgów, wygranych spraw, „gwarancji”).",
  "Nie kopiuj tego samego tekstu na wszystkie platformy — każda wersja jest napisana pod swoją platformę.",
  "Szanuj ton marki, wybrany język i listę zakazanych sformułowań.",
  "Emoji z umiarem (0–3 w opisie), nigdy zamiast treści.",
  "Nie używaj #viral, #fyp, #reels, #foryou, #explore ani podobnych ogólnych hashtagów.",
];

/** "#Upadłość konsumencka" → "#upadloscKonsumencka"? No — keep Polish letters, drop spaces and symbols, dedupe, cut banned ones. */
export function normalizeHashtags(tags: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = String(raw)
      .trim()
      .replace(/^#+/, "")
      .replace(/[\s ]+/g, "")
      .replace(/[^\p{L}\p{N}_]/gu, "");
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k) || BANNED_HASHTAGS.includes(k)) continue;
    seen.add(k);
    out.push(`#${t}`);
    if (out.length >= max) break;
  }
  return out;
}

export interface PostTexts {
  title?: string;
  description: string;
  hashtags: string[];
  cta?: string;
  firstComment?: string;
  options?: Record<string, unknown>;
}

/** the caption that goes out: text + CTA (if not already in it) + hashtags */
export function composeCaption(p: PostTexts): string {
  const parts = [p.description.trim()];
  const cta = (p.cta ?? "").trim();
  if (cta && !p.description.includes(cta)) parts.push(cta);
  const tags = p.hashtags.filter((t) => !p.description.includes(t));
  if (tags.length) parts.push(tags.join(" "));
  return parts.filter(Boolean).join("\n\n");
}

export interface Issue {
  level: "error" | "warning";
  field: string;
  message: string;
}

const count = (s: string) => [...s].length;

export function checkPostText(platform: Platform, p: PostTexts, forbidden: string[] = []): Issue[] {
  const r = PLATFORM_RULES[platform];
  const issues: Issue[] = [];
  const caption = composeCaption(p);
  if (!p.description.trim()) issues.push({ level: "error", field: "description", message: "Opis jest pusty." });
  if (count(caption) > r.limits.text) issues.push({ level: "error", field: "description", message: `Opis z CTA i hashtagami ma ${count(caption)} znaków — limit ${PLATFORM_META[platform].name}: ${r.limits.text}.` });
  if (r.fields.title) {
    if (!(p.title ?? "").trim()) issues.push({ level: "error", field: "title", message: "Tytuł jest wymagany." });
    else if (r.limits.title && count(p.title!) > r.limits.title) issues.push({ level: "error", field: "title", message: `Tytuł ma ${count(p.title!)} znaków — limit ${r.limits.title}.` });
  }
  if (p.hashtags.length > r.limits.hashtagsMax) issues.push({ level: "error", field: "hashtags", message: `Za dużo hashtagów (${p.hashtags.length}, limit ${r.limits.hashtagsMax}).` });
  else if (p.hashtags.length > r.limits.hashtagsRecommended[1]) issues.push({ level: "warning", field: "hashtags", message: `Zalecane ${r.limits.hashtagsRecommended[0]}–${r.limits.hashtagsRecommended[1]} hashtagi.` });
  const banned = p.hashtags.filter((h) => BANNED_HASHTAGS.includes(h.replace(/^#/, "").toLowerCase()));
  if (banned.length) issues.push({ level: "warning", field: "hashtags", message: `Ogólne hashtagi nic nie dają: ${banned.join(" ")}.` });
  if (p.firstComment && r.limits.firstComment && count(p.firstComment) > r.limits.firstComment) issues.push({ level: "error", field: "firstComment", message: `Pierwszy komentarz jest za długi (limit ${r.limits.firstComment}).` });
  const tags = (p.options?.youtubeTags as string[] | undefined) ?? [];
  if (platform === "YOUTUBE" && r.limits.tagsTotal && tags.join(",").length > r.limits.tagsTotal) issues.push({ level: "error", field: "tags", message: `Tagi YouTube mają razem ${tags.join(",").length} znaków — limit ${r.limits.tagsTotal}.` });
  const lower = caption.toLowerCase();
  for (const f of forbidden.map((x) => x.trim()).filter(Boolean)) if (lower.includes(f.toLowerCase())) issues.push({ level: "error", field: "description", message: `Zakazane sformułowanie marki: „${f}”.` });
  return issues;
}

export interface VideoMeta {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
  container?: string | null;
}

export interface VideoCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** a derived file would make it compliant */
  conversion: "vertical-1080" | null;
}

export function checkVideo(platform: Platform, m: VideoMeta): VideoCheck {
  const r = PLATFORM_RULES[platform].video;
  const errors: string[] = [];
  const warnings: string[] = [];
  let conversion: VideoCheck["conversion"] = null;
  const d = m.durationSec ?? 0;
  if (m.durationSec == null) errors.push("Nie udało się odczytać długości filmu.");
  else {
    if (d < r.minSec) errors.push(`Film jest za krótki (${d.toFixed(1)} s, minimum ${r.minSec} s).`);
    if (d > r.maxSec) {
      if (platform === "FACEBOOK") warnings.push(`Dłuższy niż ${r.maxSec} s — pójdzie jako zwykły post wideo, nie Reels.`);
      else errors.push(`Film jest za długi (${Math.round(d)} s, maksimum ${r.maxSec} s${platform === "YOUTUBE" ? " dla Shorts" : ""}).`);
    }
  }
  if (m.width && m.height) {
    const ratio = m.width / m.height;
    const vertical = Math.abs(ratio - 9 / 16) < 0.03;
    const square = Math.abs(ratio - 1) < 0.03;
    if (r.vertical && !vertical && !(r.squareOk && square)) {
      if (platform === "FACEBOOK") warnings.push("Nie jest pionowy 9:16 — pójdzie jako zwykły post wideo.");
      else if (platform === "YOUTUBE" && ratio > 1) errors.push("Poziomy film nie zostanie Shortsem — potrzebny pionowy lub kwadratowy.");
      else warnings.push(`Proporcje ${m.width}×${m.height} — zalecane pionowe 9:16 (1080×1920).`);
      conversion = "vertical-1080";
    }
    if (Math.min(m.width, m.height) < 540 || m.height < r.minHeight * (r.vertical ? 1 : 0.5)) warnings.push(`Niska rozdzielczość (${m.width}×${m.height}).`);
  }
  if (m.videoCodec && !r.codecs.includes(m.videoCodec.toLowerCase())) {
    warnings.push(`Kodek ${m.videoCodec} może nie zostać przyjęty — zalecany H.264.`);
    conversion = conversion ?? "vertical-1080";
  }
  if (m.audioCodec && !["aac", "mp3"].includes(m.audioCodec.toLowerCase())) warnings.push(`Dźwięk ${m.audioCodec} — zalecany AAC.`);
  if (!m.audioCodec) warnings.push("Film nie ma ścieżki dźwiękowej.");
  if (m.sizeBytes > r.maxBytes) errors.push(`Plik jest za duży (${(m.sizeBytes / 1e6).toFixed(0)} MB, limit ${(r.maxBytes / 1e6).toFixed(0)} MB).`);
  return { ok: errors.length === 0, errors, warnings, conversion };
}

/** posting-time heuristics (used only when there is no history of the account) — NOT a guarantee */
export const HEURISTIC_HOURS: Record<Platform, { weekdays: number[]; hours: number[]; note: string }> = {
  INSTAGRAM: { weekdays: [1, 2, 3], hours: [11, 18, 20], note: "ogólna heurystyka dla kont B2C w Polsce" },
  TIKTOK: { weekdays: [1, 3, 4], hours: [17, 19, 21], note: "ogólna heurystyka — wieczory w dni robocze" },
  YOUTUBE: { weekdays: [3, 4, 5], hours: [15, 18, 20], note: "ogólna heurystyka — popołudnia" },
  FACEBOOK: { weekdays: [1, 2, 3], hours: [9, 13, 19], note: "ogólna heurystyka" },
  LINKEDIN: { weekdays: [1, 2, 3], hours: [8, 12, 17], note: "ogólna heurystyka — godziny pracy, wt–czw" },
};
