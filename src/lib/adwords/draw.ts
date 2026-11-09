/**
 * Google Adwords — the image creative, drawn with the Canvas 2D API. The same function draws the
 * preview in the browser and the exported PNG / JPG on the server (@napi-rs/canvas, the theme's real
 * font files), so what you see is what you export. Each format gets its own layout (not a crop of
 * one design); all text, the logo and the CTA sit inside the safe area (the middle 80%), and the
 * function reports what did not fit.
 */
import type { ThemeTokens } from "../editor/types";
import type { Measure } from "./score";

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
  left: string;
  rightLabel?: string | null;
  right: string;
}
/** comparison_* fields of a record → the comparison copy (null when a side is missing) */
export function comparisonOf(lp: Record<string, string | undefined> | null | undefined): ComparisonCopy | null {
  if (!lp?.comparison_left?.trim() || !lp?.comparison_right?.trim()) return null;
  return { title: lp.comparison_title ?? null, leftLabel: lp.comparison_left_label ?? null, left: lp.comparison_left, rightLabel: lp.comparison_right_label ?? null, right: lp.comparison_right };
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
  copy: { headline: string; subheadline?: string | null; body?: string | null; cta?: string | null; comparison?: ComparisonCopy | null };
  theme: ThemeTokens;
  logo?: ImageLike | null;
  photo?: PhotoInput | null;
  /** preview only: the safe-area frame */
  showSafeArea?: boolean;
  /** draw the sub-line and the proof chip too (off: a feed banner carries the headline + CTA only) */
  showDetails?: boolean;
  safeMargin?: number;
}

// --------------------------------------------------------------------------------------- colours

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
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
  for (const w of text.split(/\s+/).filter(Boolean)) {
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

function drawLines(ctx: Ctx2D, f: Fitted, font: (px: number) => string, x: number, y: number, color: string, align: "left" | "center" = "left", maxW = 0) {
  ctx.font = font(f.px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  f.lines.forEach((l, i) => ctx.fillText(l, align === "center" ? x + maxW / 2 : x, y + i * f.lineH));
  return f.lines.length * f.lineH;
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
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
  const { width: W, height: H, theme } = input;
  const M = input.safeMargin ?? 0.1;
  const S = { x: W * M, y: H * M, w: W * (1 - 2 * M), h: H * (1 - 2 * M) };
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
  if (layout === "expert_split" && photo) {
    let region: { x: number; y: number; w: number; h: number };
    if (kind === "landscape") {
      region = { x: W * 0.56, y: 0, w: W * 0.44, h: H };
      T = { x: S.x, y: S.y, w: W * 0.56 - S.x - W * 0.04, h: S.h };
    } else if (kind === "square") {
      region = { x: W * 0.5, y: 0, w: W * 0.5, h: H };
      T = { x: S.x, y: S.y, w: W * 0.5 - S.x - W * 0.035, h: S.h };
    } else {
      region = { x: 0, y: 0, w: W, h: H * 0.5 };
      T = { x: S.x, y: H * 0.5, w: S.w, h: S.y + S.h - H * 0.5 };
    }
    const f = drawPhoto(ctx, photo, region.x, region.y, region.w, region.h);
    if (f.fx < S.x || f.fx > S.x + S.w || f.fy < S.y || f.fy > S.y + S.h) outsideSafe = true;
    // soft blend from the photo into the background
    const g = kind === "portrait" ? ctx.createLinearGradient(0, region.y + region.h * 0.72, 0, region.y + region.h) : ctx.createLinearGradient(region.x, 0, region.x + region.w * 0.28, 0);
    g.addColorStop(0, kind === "portrait" ? rgba(bg, 0) : rgba(bg, 1));
    g.addColorStop(1, kind === "portrait" ? rgba(bg, 1) : rgba(bg, 0));
    ctx.fillStyle = g;
    if (kind === "portrait") ctx.fillRect(0, region.y + region.h * 0.72, W, region.h * 0.28 + 2);
    else ctx.fillRect(region.x - 1, 0, region.w * 0.28, H);
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
  if (input.logo && layout === "expert_split" && photo && kind === "portrait") {
    const d = drawLogo(ctx, input.logo, S.x, S.y, S.w * 0.36, H * 0.06);
    boxes.push({ x: S.x, y: S.y, w: d.w, h: d.h });
  } else if (input.logo) {
    const lh = (kind === "landscape" ? 0.1 : 0.075) * H;
    const d = drawLogo(ctx, input.logo, T.x, y, T.w * 0.42, lh);
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
  const cmp = layout === "comparison" ? (input.copy.comparison ?? null) : null;
  const proof = layout !== "process_steps" && !cmp && input.showDetails ? (input.copy.body ?? "").trim() : "";
  const room = bottom - y;
  // a narrow text column (next to the photo) starts smaller
  const headStart = unit * (kind === "landscape" ? 0.12 : kind === "portrait" ? 0.115 : 0.11) * Math.min(1, T.w / unit / 0.55);
  let hf = fit(ctx, headline, head, headStart, headStart * 0.45, T.w, kind === "landscape" ? 3 : 4, 1.08);
  // the headline also has to fit the HEIGHT of its room (with the underline), not only the line count
  if (layout !== "process_steps" && !cmp) {
    for (let hs = headStart * 0.92; hf.lines.length * hf.lineH + unit * 0.06 > room && hs > headStart * 0.45; hs *= 0.92) hf = fit(ctx, headline, head, hs, Math.min(hs, headStart * 0.45), T.w, kind === "landscape" ? 3 : 4, 1.08);
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

  if (cmp) {
    // headline on top, then two cards: the usual way (muted) vs ours (accent) — side by side when wide, stacked when tall
    y += drawLines(ctx, hf, head, T.x, y, ink);
    boxes.push({ x: T.x, y: y - hf.lines.length * hf.lineH, w: T.w, h: hf.lines.length * hf.lineH });
    y += unit * 0.035;
    const side = kind !== "portrait";
    const gap = unit * 0.03;
    const cw = side ? (T.w - gap) / 2 : T.w;
    const avail = bottom - y;
    const ch = side ? avail : (avail - gap) / 2;
    const pad = unit * 0.03;
    const cards = [
      { label: cmp.leftLabel || "Tradycyjnie", text: cmp.left, ours: false },
      { label: cmp.rightLabel || "Z nami", text: cmp.right, ours: true },
    ];
    cards.forEach((c, i) => {
      const cx = side ? T.x + i * (cw + gap) : T.x;
      const cy = side ? y : y + i * (ch + gap);
      ctx.fillStyle = c.ours ? rgba(theme.accent, 0.18) : rgba(theme.text, 0.06);
      roundRect(ctx, cx, cy, cw, ch, unit * 0.025);
      ctx.fill();
      if (c.ours) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = Math.max(2, unit * 0.006);
        roundRect(ctx, cx, cy, cw, ch, unit * 0.025);
        ctx.stroke();
      }
      const lf = fit(ctx, c.label.toUpperCase(), label, unit * 0.03, unit * 0.022, cw - pad * 2, 1, 1.2);
      const labInk = c.ours ? inkOn(bg, theme.accent) : rgba(ink, 0.7);
      if (c.ours) contrasts.push(contrast(inkOn(bg, theme.accent), bg));
      // the text of a card fits its width AND its height
      let ts = unit * (side ? 0.06 : 0.055);
      let tf = fit(ctx, c.text, head, ts, unit * 0.03, cw - pad * 2, side ? 4 : 2, 1.12);
      while (lf.lines.length * lf.lineH + unit * 0.015 + tf.lines.length * tf.lineH > ch - pad * 2 && ts > unit * 0.026) {
        ts *= 0.92;
        tf = fit(ctx, c.text, head, ts, Math.min(ts, unit * 0.026), cw - pad * 2, side ? 4 : 3, 1.12);
      }
      const blockH = lf.lines.length * lf.lineH + unit * 0.015 + tf.lines.length * tf.lineH;
      overflow ||= tf.overflow || blockH > ch - pad * 2 + 1;
      fonts.push(lf.px, tf.px);
      // label + text centred in the card
      const ty = cy + Math.max(pad, (ch - blockH) / 2);
      drawLines(ctx, lf, label, cx + pad, ty, labInk);
      drawLines(ctx, tf, head, cx + pad, ty + lf.lines.length * lf.lineH + unit * 0.015, ink);
      boxes.push({ x: cx, y: cy, w: cw, h: ch });
    });
  } else if (layout === "process_steps" && steps.length) {
    // headline on top, then the steps (columns when wide, rows when tall)
    y += drawLines(ctx, hf, head, T.x, y, ink);
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
      const sfit = fit(ctx, st, label, unit * (horizontal ? 0.06 : 0.045), unit * (horizontal ? 0.04 : 0.03), tw, lines, 1.2);
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
    const block = used + proofH;
    if (block > room + 1) overflow = true;
    let by = y + Math.max(0, (room - block) / 2);
    const hh = drawLines(ctx, hf, head, T.x, by, ink);
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
