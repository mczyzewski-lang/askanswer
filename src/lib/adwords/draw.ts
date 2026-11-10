/**
 * Google Adwords — the image creative, drawn with the Canvas 2D API. The same function draws the
 * preview in the browser and the exported PNG / JPG on the server (@napi-rs/canvas, the theme's real
 * font files), so what you see is what you export. Each format gets its own layout (not a crop of
 * one design); all text, the logo and the CTA sit inside the safe area (the middle 80%), and the
 * function reports what did not fit.
 */
import type { ThemeTokens } from "../editor/types";
import type { Measure } from "./score";
import { plainDashes, plainDashesDeep } from "../dashes";

export type LayoutKey = "typographic" | "expert_split" | "process_steps" | "comparison" | "infographic" | "clean_photo";
export const LAYOUTS: Record<Exclude<LayoutKey, "clean_photo">, string> = {
  typographic: "Typograficzny",
  expert_split: "Ekspert + tekst",
  process_steps: "Kroki procesu",
  comparison: "Porównanie (A vs B)",
  infographic: "Infografika AI",
};

/** the two sides of a comparison creative (CSV v5 comparison_*) */
export interface ComparisonCopy {
  title?: string | null;
  leftLabel?: string | null;
  /** the left card's bold line (e.g. "Najpierw pozew"); without it `left` is the bold line */
  leftTitle?: string | null;
  left: string;
  rightLabel?: string | null;
  rightTitle?: string | null;
  right: string;
  /** a calm line under the cards (e.g. "Najpierw plan i ustalenia, dopiero potem pozew o rozwód.") */
  note?: string | null;
}
/** comparison_* fields of a record → the comparison copy (null when a side is missing) */
export function comparisonOf(lp: Record<string, string | undefined> | null | undefined): ComparisonCopy | null {
  if (!lp?.comparison_left?.trim() || !lp?.comparison_right?.trim()) return null;
  const opt = (k: "leftTitle" | "rightTitle" | "note", v: string | undefined) => (v?.trim() ? { [k]: v.trim() } : {});
  return { title: lp.comparison_title ?? null, leftLabel: lp.comparison_left_label ?? null, left: lp.comparison_left, rightLabel: lp.comparison_right_label ?? null, right: lp.comparison_right, ...opt("leftTitle", lp.comparison_left_title), ...opt("rightTitle", lp.comparison_right_title), ...opt("note", lp.comparison_note) };
}

export interface ImageLike {
  width: number;
  height: number;
}

/** the subset of CanvasRenderingContext2D both canvases provide */
export interface Ctx2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap?: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  measureText(t: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  save(): void;
  restore(): void;
  clip(): void;
  rect(x: number, y: number, w: number, h: number): void;
  setLineDash(d: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  drawImage(img: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

export interface PhotoInput {
  image: ImageLike;
  focalX: number;
  focalY: number;
  /** 1 = cover; more = closer */
  zoom?: number;
  /** shift of the focal point, in parts of the region (−0.5…0.5) */
  offsetX?: number;
  offsetY?: number;
}

export interface CreativeInput {
  width: number;
  height: number;
  layout: LayoutKey;
  copy: { headline: string; subheadline?: string | null; body?: string | null; cta?: string | null; comparison?: ComparisonCopy | null; /** a short pill above the headline (e.g. "Bezpłatny webinar on-line") */ badge?: string | null; /** a gold line under the pill (e.g. "Wtorek 19:00,\n24 Listopada") */ dateLine?: string | null };
  theme: ThemeTokens;
  /** the logo for light backgrounds (or the only one) */
  logo?: ImageLike | null;
  /** the logo for dark backgrounds (e.g. white) — used on dark banners when given */
  logoDark?: ImageLike | null;
  /** the project's topic (e.g. "rozwód"): the comparison cards show it on top when the headline lacks it */
  topic?: string | null;
  photo?: PhotoInput | null;
  /** preview only: the safe-area frame */
  showSafeArea?: boolean;
  /** draw the sub-line and the proof chip too (off: a feed banner carries the headline + CTA only) */
  showDetails?: boolean;
  /** text-free margins per side, as parts of the size (e.g. Meta Reels: top 0.14, bottom 0.35, sides 0.06) */
  safeInsets?: { top: number; bottom: number; left: number; right: number } | null;
  safeMargin?: number;
}

// --------------------------------------------------------------------------------------- colours

function rgb(hex: string): [number, number, number] {
  // "#abc" / "#aabbcc" / "#aabbccdd"; anything else → black, so a bad theme colour never breaks a gradient
  let h = String(hex ?? "").trim().replace("#", "");
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  const n = /^[0-9a-f]{6}/i.test(h) ? parseInt(h.slice(0, 6), 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
/** the theme's text colour when it reads on `bg`, else black or white (whichever reads better) */
function inkOn(bg: string, preferred: string) {
  if (contrast(preferred, bg) >= 4.5) return preferred;
  return contrast("#111111", bg) >= contrast("#FFFFFF", bg) ? "#111111" : "#FFFFFF";
}

// --------------------------------------------------------------------------------------- text

function wrap(ctx: Ctx2D, text: string, maxW: number): { lines: string[]; tooWide: boolean } {
  const lines: string[] = [];
  let line = "";
  let tooWide = false;
  // a no-break space (U+00A0) keeps two words together on one line
  for (const w of text.split(/[ \t\n\r]+/).filter(Boolean)) {
    if (ctx.measureText(w).width > maxW) tooWide = true;
    const t = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(t).width > maxW) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return { lines, tooWide };
}

interface Fitted {
  px: number;
  lines: string[];
  overflow: boolean;
  lineH: number;
  /** headline: the first line is the gold prefix ("Rozwód:") */
  prefix?: boolean;
  /** headline: the gold prefix starts the first line (wide formats) */
  prefixInline?: string;
}

const NBSP = "\u00A0";
/**
 * Headline typography (Polish): "Rozwód: …" → the prefix on its own line (gold); a number stays with its
 * word ("4 lata", "3 miesiące"); a one-letter word ("i", "w", "z"…) never ends a line; the final
 * punctuation is drawn in gold — a full stop is added when the headline has none.
 */
export function typesetHeadline(text: string): { prefix: string | null; body: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const m = /^([^:?!.]{2,24}:)\s+(.+)$/.exec(t);
  const prefix = m && m[1].split(" ").length <= 3 ? m[1] : null;
  let body = prefix ? m![2] : t;
  body = body
    .replace(/(^|\s)(\d+[.,]?\d*)\s+(?=\S)/g, (_, a, n) => `${a}${n}${NBSP}`)
    .replace(/(^|\s)([aiouwzAIOUWZ])\s+(?=\S)/g, (_, a, w) => `${a}${w}${NBSP}`);
  if (body && !/[.?!…:;”"»)]$/.test(body)) body += ".";
  return { prefix, body };
}

/** fit the headline: its prefix on a line of its own (tall / square) or starting the first line (wide) */
function fitHeadline(ctx: Ctx2D, text: string, font: (px: number) => string, start: number, min: number, maxW: number, maxLines: number, lineH = 1.12, prefixOwnLine = true): Fitted {
  const { prefix, body } = typesetHeadline(text);
  if (!body) return { px: start, lines: [], overflow: false, lineH: start * lineH };
  const own = !!prefix && prefixOwnLine;
  const tryAt = (px: number) => {
    ctx.font = font(px);
    if (prefix && !own) {
      const w = wrap(ctx, `${prefix}${NBSP}${body}`.replace(`${prefix}${NBSP}`, `${prefix} `), maxW);
      return { ok: !w.tooWide && w.lines.length <= maxLines, lines: w.lines };
    }
    const w = wrap(ctx, body, maxW);
    const preOk = !prefix || ctx.measureText(prefix).width <= maxW;
    const lines = own ? [prefix!, ...w.lines] : w.lines;
    // the prefix ("Rozwód:") is short — it does not take a line from the body
    return { ok: preOk && !w.tooWide && lines.length <= maxLines + (own ? 1 : 0), lines };
  };
  const meta = { prefix: own, ...(prefix && !own ? { prefixInline: prefix } : {}) };
  for (let px = Math.round(start); px >= min; px -= Math.max(1, Math.round(px * 0.04))) {
    const r = tryAt(px);
    if (r.ok) return { px, lines: r.lines, overflow: false, lineH: px * lineH, ...meta };
  }
  const r = tryAt(min);
  return { px: min, lines: r.lines.slice(0, maxLines + (own ? 1 : 0)), overflow: true, lineH: min * lineH, ...meta };
}

/** the headline: the prefix line and the final punctuation in the accent colour */
function drawHeadline(ctx: Ctx2D, f: Fitted, font: (px: number) => string, x0: number, y: number, ink: string, accent: string, centerW = 0) {
  ctx.font = font(f.px);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  f.lines.forEach((l, i) => {
    const ly = y + i * f.lineH;
    const x = centerW ? x0 + (centerW - ctx.measureText(l).width) / 2 : x0;
    if (i === 0 && f.prefix) {
      ctx.fillStyle = accent;
      ctx.fillText(l, x, ly);
      return;
    }
    const last = i === f.lines.length - 1 && /[.?!…]$/.test(l);
    let main = last ? l.slice(0, -1) : l;
    let lx = x;
    if (i === 0 && f.prefixInline && main.startsWith(f.prefixInline)) {
      ctx.fillStyle = accent;
      ctx.fillText(f.prefixInline, lx, ly);
      lx += ctx.measureText(f.prefixInline).width;
      main = main.slice(f.prefixInline.length);
    }
    ctx.fillStyle = ink;
    ctx.fillText(main, lx, ly);
    if (last) {
      ctx.fillStyle = accent;
      ctx.fillText(l.slice(-1), lx + ctx.measureText(main).width, ly);
    }
  });
  return f.lines.length * f.lineH;
}

/** the largest size from `start` down to `min` at which the text fits in `maxLines` lines of `maxW` */
function fit(ctx: Ctx2D, text: string, font: (px: number) => string, start: number, min: number, maxW: number, maxLines: number, lineH = 1.12): Fitted {
  if (!text.trim()) return { px: start, lines: [], overflow: false, lineH: start * lineH };
  for (let px = Math.round(start); px >= min; px -= Math.max(1, Math.round(px * 0.04))) {
    ctx.font = font(px);
    const w = wrap(ctx, text, maxW);
    if (w.lines.length <= maxLines && !w.tooWide) return { px, lines: w.lines, overflow: false, lineH: px * lineH };
  }
  ctx.font = font(min);
  const w = wrap(ctx, text, maxW);
  return { px: min, lines: w.lines.slice(0, maxLines), overflow: true, lineH: min * lineH };
}

/** fixed lines (no re-wrap) at the largest size where the widest one fits */
function fitLines(ctx: Ctx2D, lines: string[], font: (px: number) => string, start: number, min: number, maxW: number, lineH = 1.12): Fitted {
  for (let px = Math.round(start); px >= min; px -= Math.max(1, Math.round(px * 0.04))) {
    ctx.font = font(px);
    if (lines.every((l) => ctx.measureText(l).width <= maxW)) return { px, lines, overflow: false, lineH: px * lineH };
  }
  return { px: min, lines, overflow: true, lineH: min * lineH };
}

function drawLines(ctx: Ctx2D, f: Fitted, font: (px: number) => string, x: number, y: number, color: string, align: "left" | "center" = "left", maxW = 0) {
  ctx.font = font(f.px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  f.lines.forEach((l, i) => ctx.fillText(l, align === "center" ? x + maxW / 2 : x, y + i * f.lineH));
  return f.lines.length * f.lineH;
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  // a box squeezed to nothing (text overflowing its layout) must not throw — it is reported as overflow
  w = Math.max(0, w);
  h = Math.max(0, h);
  const rr = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// --------------------------------------------------------------------------------------- images

/** cover-fit the photo into a region with its focal point (and zoom / shift) as the centre */
function drawPhoto(ctx: Ctx2D, p: PhotoInput, rx: number, ry: number, rw: number, rh: number) {
  const iw = p.image.width;
  const ih = p.image.height;
  const scale = Math.max(rw / iw, rh / ih) * Math.max(1, p.zoom ?? 1);
  const sw = rw / scale;
  const sh = rh / scale;
  const cx = p.focalX * iw - (p.offsetX ?? 0) * sw;
  const cy = p.focalY * ih - (p.offsetY ?? 0) * sh;
  const sx = Math.max(0, Math.min(iw - sw, cx - sw / 2));
  const sy = Math.max(0, Math.min(ih - sh, cy - sh / 2));
  ctx.drawImage(p.image as never, sx, sy, sw, sh, rx, ry, rw, rh);
  // where the focal point (the face) landed
  return { fx: rx + ((p.focalX * iw - sx) / sw) * rw, fy: ry + ((p.focalY * ih - sy) / sh) * rh };
}

function drawLogo(ctx: Ctx2D, logo: ImageLike, x: number, y: number, maxW: number, maxH: number) {
  const s = Math.min(maxW / logo.width, maxH / logo.height);
  const w = logo.width * s;
  const h = logo.height * s;
  ctx.drawImage(logo as never, 0, 0, logo.width, logo.height, x, y, w, h);
  return { w, h };
}

/** "1. Rozmowa | 2. Plan | 3. Pozew" / lines / "; " → up to 3 steps without their numbers */
export function stepsOf(body: string | null | undefined): string[] {
  const raw = (body ?? "").trim();
  if (!raw) return [];
  const parts = raw.includes("|") ? raw.split("|") : raw.includes("\n") ? raw.split("\n") : raw.includes("→") ? raw.split("→") : raw.split(/;\s*/);
  return parts
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

// --------------------------------------------------------------------------------------- the creative

export function drawCreative(ctx: Ctx2D, input: CreativeInput): Measure {
  // content never shows the long dash
  input = { ...input, copy: plainDashesDeep(input.copy) };
  const { width: W, height: H, theme } = input;
  const M = input.safeMargin ?? 0.1;
  const I = input.safeInsets;
  const S = I ? { x: W * I.left, y: H * I.top, w: W * (1 - I.left - I.right), h: H * (1 - I.top - I.bottom) } : { x: W * M, y: H * M, w: W * (1 - 2 * M), h: H * (1 - 2 * M) };
  const kind = W / H > 1.4 ? "landscape" : W / H < 0.9 ? "portrait" : "square";
  const head = (px: number) => `800 ${px}px "${theme.questionFont}"`;
  const sub = (px: number) => `500 ${px}px "${theme.subtitleFont}"`;
  const label = (px: number) => `700 ${px}px "${theme.labelFont}"`;
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  const fonts: number[] = [];
  const contrasts: number[] = [];
  let overflow = false;
  let outsideSafe = false;
  const bg = theme.background;
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const unit = Math.min(W, H);

  const photo = input.photo ?? null;
  const layout: LayoutKey = input.layout === "expert_split" && !photo ? "typographic" : input.layout;

  // comparison: the light "cards" design (logo on top, the topic on top, two cards with VS, gold CTA)
  if (layout === "comparison" && input.copy.comparison) return drawComparisonCards(ctx, input, S, kind);

  if (layout === "clean_photo") {
    if (photo) {
      const f = drawPhoto(ctx, photo, 0, 0, W, H);
      if (f.fx < S.x || f.fx > S.x + S.w || f.fy < S.y || f.fy > S.y + S.h) outsideSafe = true;
    }
    if (input.showSafeArea) safeFrame(ctx, S);
    return { overflow: false, outsideSafe, minFontPx: 0, contrast: 21, height: H };
  }

  // an AI infographic (its text is in the picture): the image full-bleed, the CTA on a calm strip, the frame
  if (layout === "infographic" && photo) {
    drawPhoto(ctx, { ...photo, focalX: 0.5, focalY: 0.5 }, 0, 0, W, H);
    const ctaText = (input.copy.cta ?? "").trim();
    let minFont = 0;
    let c = 21;
    let over = false;
    if (ctaText) {
      const lab = `${ctaText} →`;
      const px = unit * (kind === "landscape" ? 0.062 : 0.056);
      const lf = (n: number) => `700 ${n}px "${theme.labelFont}"`;
      const f = fit(ctx, lab, lf, px, px * 0.6, S.w - px * 2.2, 1, 1);
      const h = f.px * 2.5;
      const g = ctx.createLinearGradient(0, H - h * 2.6, 0, H);
      g.addColorStop(0, rgba(bg, 0));
      g.addColorStop(1, rgba(bg, 0.92));
      ctx.fillStyle = g;
      ctx.fillRect(0, H - h * 2.6, W, h * 2.6);
      ctx.font = lf(f.px);
      const bw = kind === "portrait" ? S.w : Math.min(S.w, ctx.measureText(f.lines[0] ?? lab).width + f.px * 2.4);
      const bx = kind === "portrait" ? S.x : (W - bw) / 2;
      const by = S.y + S.h - h - unit * 0.035;
      c = drawCta(ctx, theme, bx, by, bw, h, f.lines[0] ?? lab, lf(f.px), f.px);
      minFont = f.px;
      over = f.overflow;
    }
    goldFrame(ctx, W, H, theme.accent);
    if (input.showSafeArea) safeFrame(ctx, S);
    return { overflow: over, outsideSafe: false, minFontPx: minFont, contrast: c, height: H };
  }

  // text area (and the photo region) per layout and format
  let T = { ...S };
  let panelBg = bg;
  let photoBelow = false;
  if (layout === "expert_split" && photo) {
    let region: { x: number; y: number; w: number; h: number };
    if (kind === "landscape") {
      region = { x: W * 0.56, y: 0, w: W * 0.44, h: H };
      T = { x: S.x, y: S.y, w: W * 0.56 - S.x - W * 0.04, h: S.h };
    } else if (kind === "square") {
      region = { x: W * 0.5, y: 0, w: W * 0.5, h: H };
      T = { x: S.x, y: S.y, w: W * 0.5 - S.x - W * 0.035, h: S.h };
    } else if (W / H < 0.65) {
      // 9:16 story: the text on top (below the Reels / Stories top zone), the expert at the bottom — the
      // bottom 35% is covered by the app's interface, which suits a photo, never text
      const top = H * 0.52;
      photoBelow = true;
      region = { x: 0, y: top, w: W, h: H - top };
      T = { x: S.x, y: S.y, w: S.w, h: Math.min(S.y + S.h, H * 0.6) - S.y };
    } else {
      // 4:5: a pill and a date line take room — the photo gets a bit less
      const ph = H * (0.5 - (input.copy.badge?.trim() ? 0.05 : 0) - (input.copy.dateLine?.trim() ? 0.075 : 0));
      region = { x: 0, y: 0, w: W, h: ph };
      T = { x: S.x, y: ph, w: S.w, h: S.y + S.h - ph };
    }
    const f = drawPhoto(ctx, photo, region.x, region.y, region.w, region.h);
    // (a photo under the 9:16 bottom zone is meant to be there — only text must stay out of it)
    if (!photoBelow && (f.fx < S.x || f.fx > S.x + S.w || f.fy < S.y || f.fy > S.y + S.h)) outsideSafe = true;
    // soft blend from the photo into the background
    const storyPhoto = kind === "portrait" && region.y > 0;
    if (storyPhoto) {
      // the photo below the text: a soft fade from the background at its top
      const g = ctx.createLinearGradient(0, region.y - 1, 0, region.y + region.h * 0.3);
      g.addColorStop(0, rgba(bg, 1));
      g.addColorStop(1, rgba(bg, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, region.y - 1, W, region.h * 0.3 + 1);
    } else {
      const g = kind === "portrait" ? ctx.createLinearGradient(0, region.y + region.h * 0.72, 0, region.y + region.h) : ctx.createLinearGradient(region.x, 0, region.x + region.w * 0.28, 0);
      g.addColorStop(0, kind === "portrait" ? rgba(bg, 0) : rgba(bg, 1));
      g.addColorStop(1, kind === "portrait" ? rgba(bg, 1) : rgba(bg, 0));
      ctx.fillStyle = g;
      if (kind === "portrait") ctx.fillRect(0, region.y + region.h * 0.72, W, region.h * 0.28 + 2);
      else ctx.fillRect(region.x - 1, 0, region.w * 0.28, H);
    }
    panelBg = bg;
  } else {
    // clean brand background: the theme colour with a soft light from the top (no shapes competing with the text)
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(theme.primary, 0.55));
    g.addColorStop(1, rgba(theme.primary, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (kind === "landscape" && layout === "typographic") T = { ...S, w: S.w * 0.8 };
  }
  const ink = inkOn(panelBg, theme.text);
  contrasts.push(contrast(ink, panelBg));

  let y = T.y;
  // logo: top of the text area (portrait with a photo: over the photo, top-left of the safe area)
  if (logoOn(input, panelBg) && layout === "expert_split" && photo && kind === "portrait" && !photoBelow) {
    const d = drawLogo(ctx, logoOn(input, panelBg)!, S.x, S.y, S.w * 0.36, H * 0.06);
    boxes.push({ x: S.x, y: S.y, w: d.w, h: d.h });
  } else if (logoOn(input, panelBg)) {
    const lh = (kind === "landscape" ? 0.1 : 0.075) * H;
    const d = drawLogo(ctx, logoOn(input, panelBg)!, T.x, y, T.w * 0.42, lh);
    boxes.push({ x: T.x, y, w: d.w, h: d.h });
    y += d.h + unit * 0.035;
  }
  // CTA at the bottom of the text area — measured first, so the copy knows its room
  const ctaText = (input.copy.cta ?? "").trim();
  let ctaH = 0;
  let ctaFit: Fitted | null = null;
  // the CTA is the action: big, bold, the brand's gold, an arrow
  const ctaLabel = ctaText ? `${ctaText} →` : "";
  const ctaPx = unit * (kind === "landscape" ? 0.068 : kind === "portrait" ? 0.06 : 0.062);
  // a narrow text column (next to the photo): a CTA that does not fit there spans the banner's safe width
  let ctaWide = false;
  if (ctaText) {
    ctaFit = fit(ctx, ctaLabel, label, ctaPx, ctaPx * 0.6, T.w - ctaPx * 2.2, 1, 1);
    if (ctaFit.overflow && T.w < S.w - 1) {
      ctaFit = fit(ctx, ctaLabel, label, ctaPx, ctaPx * 0.6, S.w - ctaPx * 2.2, 1, 1);
      ctaWide = true;
    }
    ctaH = ctaFit.px * 2.5;
  }
  // room under the CTA (away from the frame)
  const ctaLift = ctaText ? unit * 0.035 : 0;
  const bottom = T.y + T.h - (ctaText ? ctaH + ctaLift + unit * 0.04 : 0);

  const headline = input.copy.headline.trim();
  const subline = (input.copy.subheadline ?? "").trim();
  const steps = layout === "process_steps" ? stepsOf(input.copy.body) : [];
  const proof = layout !== "process_steps" && input.showDetails ? (input.copy.body ?? "").trim() : "";
  const room = bottom - y;
  // a narrow text column (next to the photo) starts smaller
  // a pill above the headline (the webinar date)
  const badgeText = (input.copy.badge ?? "").trim();
  // too long for a narrow column: the shorter forms ("WEBINAR · WT., 24 LIS · 19:00" → "24 LIS · 19:00")
  let bdf: Fitted | null = null;
  if (badgeText && layout !== "process_steps") {
    const parts = badgeText.split(" · ");
    const forms = [badgeText, ...(parts.length > 2 ? [`${parts[0]} · ${parts.slice(1).join(" · ").replace(/^[^,]+,\s*/, "")}`, parts.slice(1).join(" · ").replace(/^[^,]+,\s*/, "")] : [])];
    for (const f of forms) {
      bdf = fit(ctx, f.toUpperCase(), label, unit * 0.036, unit * 0.026, T.w - unit * 0.05, 1, 1);
      if (!bdf.overflow) break;
    }
  }
  const dateText = (input.copy.dateLine ?? "").trim();
  // the date: its own lines ("Wtorek 20:00," / "17 Listopada"), one size, each line kept whole
  const ddf = dateText && layout !== "process_steps" ? fitLines(ctx, dateText.split("\n").map((l) => l.trim()).filter(Boolean), label, unit * 0.05, unit * 0.03, T.w, 1.15) : null;
  const dateH = ddf ? ddf.lines.length * ddf.lineH : 0;
  const badgeBlock = (bdf ? bdf.px * 2 + unit * (ddf ? 0.02 : 0.035) : 0) + (ddf ? dateH + unit * 0.03 : 0);
  const headStart = unit * (kind === "landscape" ? 0.12 : kind === "portrait" ? 0.115 : 0.11) * Math.min(1, T.w / unit / 0.55);
  let hf = fitHeadline(ctx, headline, head, headStart, headStart * 0.45, T.w, kind === "landscape" ? 3 : 4, 1.08, kind !== "landscape");
  // the headline also has to fit the HEIGHT of its room (with the underline), not only the line count
  if (layout !== "process_steps") {
    for (let hs = headStart * 0.92; hf.lines.length * hf.lineH + unit * 0.06 + badgeBlock > room && hs > headStart * 0.45; hs *= 0.92) hf = fitHeadline(ctx, headline, head, hs, Math.min(hs, headStart * 0.45), T.w, kind === "landscape" ? 3 : 4, 1.08, kind !== "landscape");
  }
  overflow ||= hf.overflow;
  fonts.push(hf.px);
  // small print is not read in a feed: the sub-line / proof only when asked for
  const sf = subline && input.showDetails ? fit(ctx, subline, sub, hf.px * 0.46, Math.max(14, hf.px * 0.3), T.w, 2, 1.25) : null;
  if (sf) {
    overflow ||= sf.overflow;
    fonts.push(sf.px);
  }
  const used = hf.lines.length * hf.lineH + unit * 0.03 + (sf ? unit * 0.03 + sf.lines.length * sf.lineH : 0);

  if (layout === "process_steps" && steps.length) {
    // headline on top, then the steps (columns when wide, rows when tall)
    y += drawHeadline(ctx, hf, head, T.x, y, ink, theme.accent);
    boxes.push({ x: T.x, y: y - hf.lines.length * hf.lineH, w: T.w, h: hf.lines.length * hf.lineH });
    y += unit * 0.04;
    const horizontal = kind === "landscape";
    const gap = unit * 0.03;
    const cellW = horizontal ? (T.w - gap * (steps.length - 1)) / steps.length : T.w;
    const avail = bottom - y;
    const cellH = horizontal ? avail : (avail - gap * (steps.length - 1)) / steps.length;
    const r = Math.min(unit * (horizontal ? 0.06 : 0.05), cellH * 0.32);
    steps.forEach((st, i) => {
      const cx = horizontal ? T.x + i * (cellW + gap) : T.x;
      const cy = horizontal ? y : y + i * (cellH + gap);
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(cx + r, cy + r, r, 0, Math.PI * 2);
      ctx.fill();
      const numInk = inkOn(theme.accent, "#FFFFFF");
      contrasts.push(contrast(numInk, theme.accent));
      ctx.font = label(r * 1.05);
      ctx.fillStyle = numInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), cx + r, cy + r * 1.04);
      const tx = horizontal ? cx : cx + r * 2 + unit * 0.025;
      const ty = horizontal ? cy + r * 2 + unit * 0.02 : cy;
      const tw = horizontal ? cellW : T.w - (tx - T.x);
      const lines = horizontal ? 3 : 2;
      // the step text fits its cell's width AND height (smaller when the cell is short)
      const roomH = horizontal ? cellH - r * 2 - unit * 0.02 : cellH;
      let sp = unit * (horizontal ? 0.06 : 0.045);
      let sfit = fit(ctx, st, label, sp, unit * (horizontal ? 0.04 : 0.03), tw, lines, 1.2);
      while (sfit.lines.length * sfit.lineH > roomH + 1 && sp > unit * 0.024) {
        sp *= 0.92;
        sfit = fit(ctx, st, label, sp, Math.min(sp, unit * 0.024), tw, lines, 1.2);
      }
      overflow ||= sfit.overflow || (horizontal ? r * 2 + unit * 0.02 + sfit.lines.length * sfit.lineH > cellH + 1 : sfit.lines.length * sfit.lineH > cellH + 1);
      fonts.push(sfit.px);
      drawLines(ctx, sfit, label, tx, horizontal ? ty : cy + Math.max(0, (r * 2 - sfit.lines.length * sfit.lineH) / 2), ink);
      boxes.push({ x: cx, y: cy, w: horizontal ? cellW : T.w, h: horizontal ? cellH : r * 2 });
    });
  } else {
    // the copy block, vertically centred in its room
    let proofFit = proof && proof.length <= 70 ? fit(ctx, proof, label, unit * 0.032, unit * 0.024, T.w - unit * 0.05, 2, 1.2) : null;
    // the proof chip is optional: left out when the format has no room for it
    if (proofFit && (proofFit.overflow || used + proofFit.lines.length * proofFit.lineH + unit * 0.065 > room)) proofFit = null;
    const proofH = proofFit ? proofFit.lines.length * proofFit.lineH + unit * 0.035 + unit * 0.03 : 0;
    const block = used + proofH + badgeBlock;
    if (block > room + 1) overflow = true;
    let by = y + Math.max(0, (room - block) / 2);
    if (bdf) {
      const bt = bdf.lines[0] ?? badgeText.toUpperCase();
      ctx.font = label(bdf.px);
      const bw = Math.min(T.w, ctx.measureText(bt).width + bdf.px * 1.6);
      const bh = bdf.px * 2;
      ctx.fillStyle = theme.accent;
      roundRect(ctx, T.x, by, bw, bh, bh / 2);
      ctx.fill();
      const bInk = inkOn(theme.accent, theme.background);
      contrasts.push(contrast(bInk, theme.accent));
      ctx.fillStyle = bInk;
      ctx.textBaseline = "middle";
      ctx.fillText(bt, T.x + bdf.px * 0.8, by + bh / 2 + bdf.px * 0.04);
      ctx.textBaseline = "top";
      fonts.push(bdf.px);
      overflow ||= bdf.overflow;
      boxes.push({ x: T.x, y: by, w: bw, h: bh });
      by += bh + unit * (ddf ? 0.02 : 0.035);
    }
    if (ddf) {
      drawLines(ctx, ddf, label, T.x, by, theme.accent);
      fonts.push(ddf.px);
      overflow ||= ddf.overflow;
      boxes.push({ x: T.x, y: by, w: T.w, h: dateH });
      by += dateH + unit * 0.03;
    }
    const hh = drawHeadline(ctx, hf, head, T.x, by, ink, theme.accent);
    boxes.push({ x: T.x, y: by, w: T.w, h: hh });
    by += hh;
    // the brand's gold underline under the headline
    ctx.fillStyle = theme.accent;
    ctx.fillRect(T.x, by + unit * 0.018, unit * 0.14, Math.max(4, unit * 0.01));
    if (sf) {
      by += unit * 0.045;
      const sh = drawLines(ctx, sf, sub, T.x, by, ink);
      boxes.push({ x: T.x, y: by, w: T.w, h: sh });
      by += sh;
    }
    if (proofFit) {
      by += unit * 0.035;
      ctx.font = label(proofFit.px);
      const pw = Math.min(T.w, Math.max(...proofFit.lines.map((l) => ctx.measureText(l).width)) + unit * 0.05);
      const ph = proofFit.lines.length * proofFit.lineH + unit * 0.03;
      ctx.fillStyle = rgba(theme.primary, 0.12);
      roundRect(ctx, T.x, by, pw, ph, unit * 0.02);
      ctx.fill();
      const pInk = inkOn(bg, theme.primary);
      contrasts.push(contrast(pInk, bg));
      drawLines(ctx, proofFit, label, T.x + unit * 0.025, by + unit * 0.015, pInk);
      fonts.push(proofFit.px);
      boxes.push({ x: T.x, y: by, w: pw, h: ph });
    }
  }

  // CTA button: gold, dark bold label; full width on the tall format
  if (ctaFit) {
    ctx.font = label(ctaFit.px);
    const tw = ctx.measureText(ctaFit.lines[0] ?? ctaLabel).width;
    const cw = ctaWide ? S.w : T.w;
    const bw = kind === "portrait" ? cw : Math.min(cw, tw + ctaFit.px * 2.4);
    const bx = ctaWide ? S.x : T.x;
    const by = T.y + T.h - ctaH - ctaLift;
    contrasts.push(drawCta(ctx, theme, bx, by, bw, ctaH, ctaFit.lines[0] ?? ctaLabel, label(ctaFit.px), ctaFit.px));
    overflow ||= ctaFit.overflow;
    fonts.push(ctaFit.px);
    boxes.push({ x: bx, y: by, w: bw, h: ctaH });
  }
  // the gold frame in the margin, around the whole banner
  goldFrame(ctx, W, H, theme.accent);

  for (const b of boxes) if (b.x < S.x - 1 || b.y < S.y - 1 || b.x + b.w > S.x + S.w + 1 || b.y + b.h > S.y + S.h + 1) outsideSafe = true;
  if (input.showSafeArea) safeFrame(ctx, S);
  return { overflow, outsideSafe, minFontPx: fonts.length ? Math.min(...fonts) : 0, contrast: contrasts.length ? Math.min(...contrasts) : 21, height: H };
}

/**
 * The CTA must be the most visible thing after the headline: of the theme's light colours the one that
 * stands out most on the background (on a dark green: the cream / light gold), dark bold label, a gold rim.
 */
export function ctaColors(theme: ThemeTokens) {
  const cands = [theme.highlight, theme.accent, theme.secondary, "#FFFFFF"].filter((c) => /^#[0-9a-f]{6}$/i.test(c ?? ""));
  const bgc = cands.reduce((best, c) => (contrast(c, theme.background) > contrast(best, theme.background) ? c : best), theme.accent);
  return { bg: bgc, ink: inkOn(bgc, theme.background), rim: bgc.toLowerCase() === theme.accent.toLowerCase() ? null : theme.accent };
}
function drawCta(ctx: Ctx2D, theme: ThemeTokens, x: number, y: number, w: number, h: number, text: string, font: string, px: number) {
  const c = ctaColors(theme);
  ctx.fillStyle = c.bg;
  roundRect(ctx, x, y, w, h, h * 0.22);
  ctx.fill();
  if (c.rim) {
    ctx.strokeStyle = c.rim;
    ctx.lineWidth = Math.max(2, Math.round(h * 0.05));
    roundRect(ctx, x, y, w, h, h * 0.22);
    ctx.stroke();
  }
  ctx.font = font;
  ctx.fillStyle = c.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + px * 0.04);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  return contrast(c.ink, c.bg);
}

/** the gold frame inside the margin of the banner (thick: ~1.5% of the short side, 9–15 px) */
export function goldFrame(ctx: Ctx2D, W: number, H: number, color: string) {
  const unit = Math.min(W, H);
  const lw = Math.max(9, Math.min(15, Math.round(unit * 0.015)));
  const inset = Math.round(unit * 0.035);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(inset + lw / 2, inset + lw / 2, W - 2 * inset - lw, H - 2 * inset - lw);
  ctx.restore();
}

function safeFrame(ctx: Ctx2D, S: { x: number; y: number; w: number; h: number }) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,0,90,0.9)";
  ctx.lineWidth = Math.max(2, S.w * 0.003);
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(S.x, S.y, S.w, S.h);
  ctx.setLineDash([]);
  ctx.restore();
}

export interface SceneFrameInput {
  width: number;
  height: number;
  theme: ThemeTokens;
  screenText: string;
  /** what the shot should show (written small at the top — this is a storyboard) */
  visualBrief?: string | null;
  sceneLabel: string;
  logo?: ImageLike | null;
  photo?: PhotoInput | null;
  /** the last scene: the CTA styling */
  isCta?: boolean;
}

/** One frame of the storyboard video (animatic): the shot's photo, the on-screen text in the safe area, the brand. */
export function drawSceneFrame(ctx: Ctx2D, f: SceneFrameInput): Measure {
  f = { ...f, screenText: plainDashes(f.screenText ?? "") };
  const { width: W, height: H, theme } = f;
  const S = { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.8 };
  const unit = Math.min(W, H);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);
  let panel = theme.background;
  if (f.photo && !f.isCta) {
    drawPhoto(ctx, f.photo, 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    panel = "#111111";
  } else {
    ctx.fillStyle = rgba(theme.accent, 0.16);
    ctx.beginPath();
    ctx.arc(W * 0.95, H * 0.1, unit * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  const ink = f.photo && !f.isCta ? "#FFFFFF" : inkOn(theme.background, theme.text);
  // storyboard label (small, top)
  const lab = (px: number) => `600 ${px}px "${theme.labelFont}"`;
  const labFit = fit(ctx, `${f.sceneLabel}${f.visualBrief ? ` · ${f.visualBrief}` : ""}`, lab, unit * 0.026, unit * 0.018, S.w, 2, 1.2);
  ctx.globalAlpha = 0.85;
  drawLines(ctx, labFit, lab, S.x, S.y, ink);
  ctx.globalAlpha = 1;
  // on-screen text, large, in the lower-middle band of the safe area
  const head = (px: number) => `800 ${px}px "${theme.questionFont}"`;
  const tf = fit(ctx, f.screenText, head, unit * (f.isCta ? 0.085 : 0.075), unit * 0.04, S.w, 4, 1.12);
  const blockH = tf.lines.length * tf.lineH;
  const ty = f.isCta ? S.y + (S.h - blockH) / 2 - unit * 0.05 : S.y + S.h * 0.62 - blockH / 2;
  if (f.isCta) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(S.x, ty - unit * 0.04, unit * 0.09, Math.max(4, unit * 0.01));
  }
  drawLines(ctx, tf, head, S.x, ty, ink);
  if (f.logo) drawLogo(ctx, f.logo, S.x, S.y + S.h - unit * 0.08, S.w * 0.4, unit * 0.08);
  return { overflow: tf.overflow, outsideSafe: false, minFontPx: tf.px, contrast: contrast(ink, panel), height: H };
}

// --------------------------------------------------------------------------- comparison: light cards

type Box = { x: number; y: number; w: number; h: number };
const foldPl = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ({ ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" })[c]!);
/** the text names the topic ("Rozwód…", "rozwodu", "po rozwodzie" — by the stem) */
function namesTopic(text: string, topic: string) {
  const first = foldPl(topic.split(/[,;]/)[0].trim()).split(/\s+/)[0] ?? "";
  if (!first) return true;
  return foldPl(text).includes(first.slice(0, Math.max(4, first.length - 2)));
}
/** the logo that reads on this background: the dark-background version on dark, else the main one */
function logoOn(input: CreativeInput, bgHex: string): ImageLike | null {
  return luminance(bgHex) < 0.35 ? (input.logoDark ?? input.logo ?? null) : (input.logo ?? input.logoDark ?? null);
}
function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The comparison creative in the light "cards" style: a cream background, the small logo on top
 * between two gold rules, the headline (the topic always on top — "Rozwód:" in gold when the
 * headline does not say it), two cards (the usual way on a soft rose, ours on the brand's dark
 * green) with a gold VS between them, an optional calm line, the gold CTA.
 */
function drawComparisonCards(ctx: Ctx2D, input: CreativeInput, S: Box, kind: "landscape" | "portrait" | "square"): Measure {
  const { width: W, height: H, theme } = input;
  const cmp = input.copy.comparison!;
  const unit = Math.min(W, H);
  const bg = luminance(theme.secondary) > 0.75 ? theme.secondary : "#FBF8F4";
  const dark = luminance(theme.background) < 0.2 ? theme.background : luminance(theme.primary) < 0.2 ? theme.primary : "#24413C";
  const gold = theme.accent;
  const goldInk = contrast(gold, bg) >= 3 ? gold : mix(gold, "#000000", 0.28);
  // the gold of buttons / pills: light enough for the dark label to read (≥ 4.5:1)
  let btnGold = gold;
  for (let t = 0.04; contrast(dark, btnGold) < 4.6 && t <= 0.6; t += 0.04) btnGold = mix(gold, "#FFFFFF", t);
  const ink = dark;
  const head = (px: number) => `800 ${px}px "${theme.questionFont}"`;
  const title = (px: number) => `700 ${px}px "${theme.questionFont}"`;
  const body = (px: number) => `500 ${px}px "${theme.subtitleFont}"`;
  const italic = (px: number) => `italic 500 ${px}px "${theme.subtitleFont}"`;
  const label = (px: number) => `700 ${px}px "${theme.labelFont}"`;
  const fonts: number[] = [];
  const contrasts: number[] = [contrast(ink, bg)];
  const boxes: Box[] = [];
  let overflow = false;

  // the cream page and two thin gold arcs in the corners
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = rgba(gold, 0.75);
  ctx.lineWidth = Math.max(2, unit * 0.004);
  ctx.beginPath();
  ctx.moveTo(0, H * 0.13);
  ctx.quadraticCurveTo(W * 0.05, H * 0.03, W * 0.14, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W, H * 0.87);
  ctx.quadraticCurveTo(W * 0.95, H * 0.97, W * 0.86, H);
  ctx.stroke();
  ctx.restore();

  const wide = kind === "landscape";
  // readable in a PMax thumbnail: no text under 3% of the height when it can fit at that size
  // (the PMax formats by the height, as Google scores them; the tall Meta story by its width)
  const floor = Math.ceil(W / H >= 0.7 ? H * 0.03 : unit * 0.025);
  // landscape: the words on the left, the cards on the right; else everything stacked and centred
  const L: Box = wide ? { x: S.x, y: S.y, w: S.w * 0.43, h: S.h } : { ...S };
  const centre = !wide;
  let y = L.y;

  // the logo: small, between two gold rules
  const logo = logoOn(input, bg);
  if (logo) {
    const lh = unit * (wide ? 0.065 : 0.045);
    const sc = Math.min((L.w * (wide ? 0.6 : 0.42)) / logo.width, lh / logo.height);
    const lw = logo.width * sc;
    const lhh = logo.height * sc;
    const lx = centre ? L.x + (L.w - lw) / 2 : L.x;
    ctx.drawImage(logo as never, 0, 0, logo.width, logo.height, lx, y, lw, lhh);
    boxes.push({ x: lx, y, w: lw, h: lhh });
    if (centre) {
      const gap = unit * 0.03;
      const len = Math.min(unit * 0.16, (L.w - lw) / 2 - gap);
      if (len > unit * 0.03) {
        ctx.fillStyle = gold;
        const ly = y + lhh / 2 - 1;
        ctx.fillRect(lx - gap - len, ly, len, Math.max(2, unit * 0.003));
        ctx.fillRect(lx + lw + gap, ly, len, Math.max(2, unit * 0.003));
      }
    }
    y += lhh + unit * (wide ? 0.04 : 0.03);
  }

  // a pill (e.g. "Bezpłatny webinar on-line") and the date lines (Meta webinar)
  const badgeText = (input.copy.badge ?? "").trim().toUpperCase();
  if (badgeText) {
    const bf = fit(ctx, badgeText, label, unit * 0.032, unit * 0.024, L.w - unit * 0.05, 1, 1);
    ctx.font = label(bf.px);
    const bt = bf.lines[0] ?? badgeText;
    const bw = Math.min(L.w, ctx.measureText(bt).width + bf.px * 1.6);
    const bh = bf.px * 2;
    const bx = centre ? L.x + (L.w - bw) / 2 : L.x;
    ctx.fillStyle = btnGold;
    roundRect(ctx, bx, y, bw, bh, bh / 2);
    ctx.fill();
    const bInk = dark;
    contrasts.push(contrast(bInk, btnGold));
    ctx.fillStyle = bInk;
    ctx.textBaseline = "middle";
    ctx.fillText(bt, bx + bf.px * 0.8, y + bh / 2 + bf.px * 0.04);
    ctx.textBaseline = "top";
    fonts.push(bf.px);
    overflow ||= bf.overflow;
    boxes.push({ x: bx, y, w: bw, h: bh });
    y += bh + unit * 0.02;
  }
  const dateLines = (input.copy.dateLine ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (dateLines.length) {
    const df = fitLines(ctx, dateLines, label, unit * (W / H < 0.65 ? 0.034 : 0.04), unit * 0.026, L.w, 1.15);
    drawLines(ctx, df, label, L.x, y, goldInk, centre ? "center" : "left", L.w);
    fonts.push(df.px);
    overflow ||= df.overflow;
    boxes.push({ x: L.x, y, w: L.w, h: df.lines.length * df.lineH });
    y += df.lines.length * df.lineH + unit * 0.025;
  }

  // the bottom: CTA (and the note above it)
  const ctaText = (input.copy.cta ?? "").trim();
  const ctaLabel = ctaText ? `${ctaText} →` : "";
  const ctaPx = unit * (wide ? 0.058 : W / H < 0.65 ? 0.042 : input.photo ? 0.044 : 0.05);
  // (with the expert's photo beside it, the button is narrower)
  const avatarD = input.photo ? Math.round(ctaPx * 2.4) : 0;
  const ctaRoom = L.w - (avatarD ? avatarD + unit * 0.025 : 0);
  let ctaFit = ctaText ? fit(ctx, ctaLabel, label, ctaPx, Math.max(floor, ctaPx * 0.6), ctaRoom - ctaPx * 1.6, 1, 1) : null;
  if (ctaFit?.overflow) ctaFit = fit(ctx, ctaLabel, label, ctaPx, ctaPx * 0.45, ctaRoom - ctaPx * 1.6, 1, 1);
  const ctaH = ctaFit ? Math.max(ctaFit.px * 2.4, avatarD ? avatarD * 0.86 : 0) : 0;
  const noteText = (cmp.note ?? "").trim();
  // (no note on the landscape, nor on a banner that already carries a webinar pill / date)
  const noteFit = noteText && !wide && !badgeText && !dateLines.length ? fit(ctx, noteText, italic, unit * 0.03, unit * 0.024, L.w - unit * 0.2, 2, 1.25) : null;
  const noteH = noteFit ? noteFit.lines.length * noteFit.lineH + unit * 0.035 : 0;
  const bottomH = (ctaFit ? Math.max(ctaH, avatarD) + unit * 0.035 : 0) + noteH;

  // the headline: the topic always on top
  let headline = (input.copy.headline || cmp.title || "").trim();
  const topic = input.topic?.split(/[,;]/)[0].trim();
  if (topic && headline && !namesTopic(headline, topic)) headline = `${topic.charAt(0).toLocaleUpperCase("pl-PL")}${topic.slice(1)}: ${headline}`;
  const subText = (input.copy.subheadline ?? "").trim();
  const minCards = wide ? 0 : W / H < 0.65 ? S.h * 0.36 : Math.min(unit * 0.22, S.h * 0.24);
  const room = L.y + L.h - y - bottomH - minCards;
  const hStart = unit * (wide ? 0.075 : 0.085);
  let hf = fitHeadline(ctx, headline, head, hStart, hStart * 0.5, L.w, wide ? 4 : 2, 1.08, true);
  let sfit = subText ? fit(ctx, subText, italic, Math.max(floor, hf.px * 0.48), Math.max(floor, unit * 0.028), L.w, 2, 1.25) : null;
  const textH = () => hf.lines.length * hf.lineH + unit * 0.045 + (sfit ? sfit.lines.length * sfit.lineH + unit * 0.02 : 0) + unit * 0.035;
  for (let hs = hStart * 0.94; textH() > room && hs > Math.max(floor, hStart * 0.38); hs *= 0.94) {
    hf = fitHeadline(ctx, headline, head, hs, Math.min(hs, Math.max(floor, hStart * 0.38)), L.w, wide ? 4 : 3, 1.08, true);
    if (subText) sfit = fit(ctx, subText, italic, Math.max(floor, unit * 0.028, hs * 0.48), Math.max(floor, unit * 0.026), L.w, 2, 1.25);
  }
  overflow ||= hf.overflow || textH() > room + 1;
  fonts.push(hf.px);
  const hh = drawHeadline(ctx, hf, head, L.x, y, ink, goldInk, centre ? L.w : 0);
  boxes.push({ x: L.x, y, w: L.w, h: hh });
  y += hh;
  // the gold swoosh under the headline
  {
    const sw = Math.min(L.w * 0.5, unit * 0.36);
    const sx = centre ? L.x + (L.w - sw) / 2 : L.x;
    const sy = y + unit * 0.02;
    ctx.save();
    ctx.strokeStyle = gold;
    ctx.lineWidth = Math.max(3, unit * 0.006);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy + unit * 0.008);
    ctx.quadraticCurveTo(sx + sw / 2, sy - unit * 0.01, sx + sw, sy + unit * 0.004);
    ctx.stroke();
    ctx.restore();
    y += unit * 0.045;
  }
  if (sfit) {
    const sh = drawLines(ctx, sfit, italic, L.x, y, ink, centre ? "center" : "left", L.w);
    fonts.push(sfit.px);
    overflow ||= sfit.overflow;
    boxes.push({ x: L.x, y, w: L.w, h: sh });
    y += sh + unit * 0.02;
  }
  y += unit * 0.035;

  // the cards
  const C: Box = wide ? { x: S.x + S.w * 0.47, y: S.y, w: S.w * 0.53, h: S.h } : { x: S.x, y, w: S.w, h: L.y + L.h - bottomH - y };
  // side by side; stacked in the landscape's right column (wide cards keep the text readable)
  const stacked = wide || W / H < 0.65;
  const gap = unit * (stacked ? 0.045 : 0.05);
  const cw = stacked ? C.w : (C.w - gap) / 2;
  const ch = stacked ? (C.h - gap) / 2 : C.h;
  overflow ||= ch <= unit * 0.05;
  const pad = unit * 0.035;
  const leftFill = "#F1E6E2";
  const sides = [
    { fill: leftFill, lab: cmp.leftLabel || "Tradycyjnie", labInk: "#87584C", ttl: cmp.leftTitle || cmp.left, ttlInk: "#2F2624", desc: cmp.leftTitle ? cmp.left : "", descInk: "#5C4A45" },
    { fill: dark, lab: cmp.rightLabel || "Z nami", labInk: [theme.highlight, gold, mix(gold, "#FFFFFF", 0.3)].find((c) => contrast(c, dark) >= 4.5) ?? "#FFFFFF", ttl: cmp.rightTitle || cmp.right, ttlInk: "#FFFFFF", desc: cmp.rightTitle ? cmp.right : "", descInk: mix("#FFFFFF", dark, 0.15) },
  ];
  const r = unit * 0.03;
  sides.forEach((c, i) => {
    const cx = stacked ? C.x : C.x + i * (cw + gap);
    const cy = stacked ? C.y + i * (ch + gap) : C.y;
    ctx.fillStyle = c.fill;
    roundRect(ctx, cx, cy, cw, Math.max(0, ch), r);
    ctx.fill();
    // the padding shrinks with the words when the card is tight
    const padK = (kk: number) => pad * Math.max(0.55, Math.min(1, kk));
    // the VS circle bites into the inner side of each card (side by side): the words keep clear of it
    const vsR = Math.min(unit * 0.052, gap * 0.95);
    const bite = stacked ? 0 : Math.max(0, vsR - gap / 2 + unit * 0.012);
    const tx = cx + pad + (i === 1 ? bite : 0);
    const tw = cw - pad * 2 - bite;
    let desc = c.desc;
    // label, bold line and description scale together until they fit the card
    let k = 1;
    let useFloor = true;
    let lf: Fitted, tf: Fitted, df: Fitted | null;
    const base = { lab: unit * 0.026, ttl: unit * (wide ? 0.058 : 0.054), desc: unit * (wide ? 0.038 : 0.034) };
    for (;;) {
      const at = (v: number) => Math.max(useFloor ? floor : 8, Math.floor(v));
      lf = fit(ctx, c.lab.toUpperCase(), label, at(base.lab * Math.max(k, 0.8)), at(base.lab * Math.max(k, 0.8)), tw, 2, 1.2);
      tf = fit(ctx, c.ttl, title, at(base.ttl * k), at(base.ttl * k), tw, 3, 1.12);
      df = desc ? fit(ctx, desc, body, at(base.desc * k), at(base.desc * k), tw, 5, 1.3) : null;
      const total = lf.lines.length * lf.lineH + unit * 0.02 * k + tf.lines.length * tf.lineH + (df ? unit * 0.02 * k + df.lines.length * df.lineH : 0);
      const fits = !lf.overflow && !tf.overflow && !df?.overflow && total <= ch - padK(k) * 2;
      if (fits || (k < 0.4 && !useFloor)) {
        overflow ||= !fits;
        break;
      }
      // at the floor and still too much: first the description goes (label + the bold line stay readable)
      if (useFloor && desc && (k < 0.4 || [base.lab * Math.max(k, 0.8), base.ttl * k, base.desc * k].every((v) => v <= floor))) {
        desc = "";
        k = 1;
        continue;
      }
      // then let it get smaller than the floor
      if (useFloor && (k < 0.4 || [base.lab * Math.max(k, 0.8), base.ttl * k, base.desc * k].every((v) => v <= floor))) {
        useFloor = false;
        desc = c.desc;
        k = Math.min(1, floor / Math.max(base.desc, base.lab));
        continue;
      }
      k *= 0.94;
    }
    const sp = unit * 0.02 * k;
    const total = lf.lines.length * lf.lineH + sp + tf.lines.length * tf.lineH + (df ? sp + df.lines.length * df.lineH : 0);
    // the words sit in the middle of a roomy card (top-aligned when it is tight)
    let ty = cy + Math.max(padK(k), (ch - total) / 2);
    ty += drawLines(ctx, lf, label, tx, ty, c.labInk) + sp;
    ty += drawLines(ctx, tf, title, tx, ty, c.ttlInk);
    if (df) drawLines(ctx, df, body, tx, ty + sp, c.descInk);
    fonts.push(lf.px, tf.px, ...(df ? [df.px] : []));
    contrasts.push(contrast(c.ttlInk, c.fill), contrast(c.labInk, c.fill), ...(df ? [contrast(c.descInk, c.fill)] : []));
    boxes.push({ x: cx, y: cy, w: cw, h: ch });
  });
  // the gold VS between the cards
  {
    const rr = Math.min(unit * 0.052, gap * 0.95); // (= vsR above)
    const vx = stacked ? C.x + cw * 0.82 : C.x + cw + gap / 2;
    const vy = stacked ? C.y + ch + gap / 2 : C.y + Math.max(0, ch) / 2;
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.arc(vx, vy, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = Math.max(3, unit * 0.007);
    ctx.stroke();
    const vInk = contrast("#FFFFFF", gold) >= 2.5 ? "#FFFFFF" : dark;
    ctx.fillStyle = vInk;
    ctx.font = label(rr * 0.78);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VS", vx, vy + rr * 0.04);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }

  // the note with gold rules, then the CTA
  let by = L.y + L.h - bottomH;
  if (noteFit) {
    by += unit * 0.03;
    const nh = drawLines(ctx, noteFit, italic, L.x, by, ink, "center", L.w);
    ctx.font = italic(noteFit.px);
    const nw = Math.max(...noteFit.lines.map((l) => ctx.measureText(l).width));
    const rule = Math.min(unit * 0.06, (L.w - nw) / 2 - unit * 0.03);
    if (rule > unit * 0.015) {
      ctx.fillStyle = gold;
      const ry = by + nh / 2 - 1;
      ctx.fillRect(L.x + (L.w - nw) / 2 - unit * 0.025 - rule, ry, rule, Math.max(2, unit * 0.003));
      ctx.fillRect(L.x + (L.w + nw) / 2 + unit * 0.025, ry, rule, Math.max(2, unit * 0.003));
    }
    fonts.push(noteFit.px);
    overflow ||= noteFit.overflow;
    boxes.push({ x: L.x, y: by, w: L.w, h: nh });
    by += nh + unit * 0.005;
  }
  if (ctaFit) {
    ctx.font = label(ctaFit.px);
    const text = ctaFit.lines[0] ?? ctaLabel;
    const gapA = avatarD ? unit * 0.025 : 0;
    const bw = W / H < 0.65 ? ctaRoom : Math.min(ctaRoom, ctx.measureText(text).width + ctaFit.px * 2.4);
    const groupW = bw + (avatarD ? avatarD + gapA : 0);
    const gx = centre ? L.x + (L.w - groupW) / 2 : L.x;
    const bx = gx + (avatarD ? avatarD + gapA : 0);
    const cy = L.y + L.h - Math.max(ctaH, avatarD) / 2 - ctaH / 2;
    if (avatarD && input.photo) {
      // the real expert beside the action: a round photo in a gold ring
      const ay = L.y + L.h - Math.max(ctaH, avatarD);
      ctx.save();
      ctx.beginPath();
      ctx.arc(gx + avatarD / 2, ay + avatarD / 2, avatarD / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.fillRect(gx, ay, avatarD, avatarD);
      drawPhoto(ctx, { ...input.photo, zoom: Math.max(input.photo.zoom ?? 1, 1.6) }, gx, ay, avatarD, avatarD);
      ctx.restore();
      ctx.strokeStyle = gold;
      ctx.lineWidth = Math.max(3, unit * 0.006);
      ctx.beginPath();
      ctx.arc(gx + avatarD / 2, ay + avatarD / 2, avatarD / 2, 0, Math.PI * 2);
      ctx.stroke();
      boxes.push({ x: gx, y: ay, w: avatarD, h: avatarD });
    }
    const g = ctx.createLinearGradient(bx, cy, bx + bw, cy);
    g.addColorStop(0, mix(btnGold, "#FFFFFF", 0.14));
    g.addColorStop(1, btnGold);
    ctx.fillStyle = g;
    roundRect(ctx, bx, cy, bw, ctaH, ctaH / 2);
    ctx.fill();
    const cInk = dark;
    contrasts.push(contrast(cInk, btnGold));
    ctx.fillStyle = cInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, cy + ctaH / 2 + ctaFit.px * 0.04);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    fonts.push(ctaFit.px);
    overflow ||= ctaFit.overflow;
    boxes.push({ x: bx, y: cy, w: bw, h: ctaH });
  }

  let outsideSafe = false;
  for (const b of boxes) if (b.x < S.x - 1 || b.y < S.y - 1 || b.x + b.w > S.x + S.w + 1 || b.y + b.h > S.y + S.h + 1) outsideSafe = true;
  if (input.showSafeArea) safeFrame(ctx, S);
  return { overflow, outsideSafe, minFontPx: fonts.length ? Math.min(...fonts) : 0, contrast: contrasts.length ? Math.min(...contrasts) : 21, height: H };
}
