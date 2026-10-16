/**
 * Shared frame compositor.
 *
 * The SAME function draws the browser preview (HTMLCanvasElement + <video>) and
 * every frame of the server-side export (@napi-rs/canvas + FFmpeg-decoded frames).
 * Both environments use Skia and the same TTF font files from /public/fonts,
 * which is what gives preview/export parity. Editor-only UI (selection handles,
 * safe-area guides) is never drawn here.
 */
import type { CalloutOverlay, ColorRef, EditorDocument, FontRef, ImageOverlay, Overlay, ShapeOverlay, TextOverlay, ThemeTokens, VideoOverlay } from "../editor/types";
import { clipAt, docDuration, overlayEnd, segmentAt, timedSegments, type TimedSegment } from "../editor/timeline";
import { zoomAt } from "../editor/zoom";

// Minimal structural type satisfied by both DOM and @napi-rs/canvas contexts.
export type Ctx = CanvasRenderingContext2D;
export type Drawable = CanvasImageSource;

export interface FrameSource {
  image: Drawable;
  width: number;
  height: number;
}

export interface RenderEnv {
  /** Return the decoded video frame for a clip at the given source time. */
  getFrame: (clipId: string, assetId: string, sourceTime: number) => FrameSource | null;
  getImage: (assetId: string) => FrameSource | null;
  includeSuggestedZooms?: boolean;
  /** Overlay ids to skip (e.g. the one being edited in place). */
  hideOverlayIds?: Set<string>;
  /** Frame of a video overlay at its local time (seconds inside the uploaded file). */
  getOverlayFrame?: (overlay: VideoOverlay, localTime: number) => FrameSource | null;
  /** Paused editor preview: show entrance animations in their final state so elements stay editable. */
  settled?: boolean;
  /** Person mask of a recording (alpha = person) at a source time, for background blur. */
  getMask?: (assetId: string, sourceTime: number) => FrameSource | null;
  /** Reusable offscreen canvas (browser: <canvas>, server: @napi-rs/canvas). */
  scratch?: (key: string, width: number, height: number) => { canvas: Drawable; ctx: Ctx };
}

export const ENTRANCE = 0.55;

/** Local time inside a video overlay's file (handles looping). */
export function overlayVideoTime(o: VideoOverlay, t: number, fileDuration: number | null): number {
  const local = o.sourceIn + Math.max(0, t - o.start);
  if (o.loop && fileDuration && fileDuration > 0.1) {
    const span = fileDuration - o.sourceIn;
    return span > 0.05 ? o.sourceIn + ((local - o.sourceIn) % span) : o.sourceIn;
  }
  return fileDuration ? Math.min(local, Math.max(0, fileDuration - 0.04)) : local;
}

export function unit(doc: Pick<EditorDocument, "width" | "height">): number {
  return Math.min(doc.width, doc.height) / 1080;
}

export function resolveColor(ref: ColorRef | null | undefined, theme: ThemeTokens): string {
  if (!ref) return "transparent";
  switch (ref) {
    case "$primary":
      return theme.primary;
    case "$accent":
      return theme.accent;
    case "$secondary":
      return theme.secondary;
    case "$text":
      return theme.text;
    case "$highlight":
      return theme.highlight;
    case "$background":
      return theme.background;
    default:
      return ref;
  }
}

export function resolveFont(ref: FontRef, theme: ThemeTokens): string {
  if (ref === "$question") return theme.questionFont;
  if (ref === "$subtitle") return theme.subtitleFont;
  if (ref === "$label") return theme.labelFont;
  return ref;
}

export function fontString(weight: number, sizePx: number, family: string): string {
  return `${weight} ${Math.max(1, Math.round(sizePx * 10) / 10)}px "${family}"`;
}

function withAlpha(color: string, alpha: number): string {
  if (/^#([0-9a-f]{6})$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  if (/^#([0-9a-f]{3})$/i.test(color)) {
    const r = parseInt(color[1] + color[1], 16);
    const g = parseInt(color[2] + color[2], 16);
    const b = parseInt(color[3] + color[3], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/** Relative luminance (0..1) of a #rrggbb colour; used to keep highlighted words readable. */
export function luminance(color: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function setLetterSpacing(ctx: Ctx, px: number) {
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    /* not supported — ignore (purely cosmetic) */
  }
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Greedy word wrap with explicit newlines. */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (ctx.measureText(cand).width <= maxWidth || !line) line = cand;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel layout of a text overlay — shared by drawing and editor hit-testing. */
export function layoutTextOverlay(ctx: Ctx, doc: EditorDocument, o: TextOverlay): { rect: Rect; lines: string[]; font: string; lineH: number } {
  const u = unit(doc);
  const W = doc.width;
  const H = doc.height;
  const s = o.style;
  const fam = resolveFont(s.fontFamily, doc.theme);
  const size = s.fontSize * u;
  const font = fontString(s.fontWeight, size, fam);
  ctx.save();
  ctx.font = font;
  setLetterSpacing(ctx, s.letterSpacing * u);
  const pad = s.padding * u;
  const boxW = o.w * W;
  const text = s.uppercase ? o.text.toLocaleUpperCase("pl-PL") : o.text;
  const lines = wrapText(ctx, text, Math.max(10, boxW - pad * 2));
  ctx.restore();
  const lineH = size * s.lineHeight;
  const h = lines.length * lineH + pad * 2;
  return { rect: { x: o.x * W, y: o.y * H, w: boxW, h }, lines, font, lineH };
}

export function overlayRect(ctx: Ctx, doc: EditorDocument, o: Overlay): Rect {
  if (o.kind === "text") return layoutTextOverlay(ctx, doc, o).rect;
  if (o.kind === "callout" || o.kind === "lowerThird") {
    // a bar grows to fit larger fonts
    const u = unit(doc);
    const need = calloutSizes(o, o.h * doc.height, u);
    return { x: o.x * doc.width, y: o.y * doc.height, w: o.w * doc.width, h: Math.max(o.h * doc.height, need.minH) };
  }
  return { x: o.x * doc.width, y: o.y * doc.height, w: o.w * doc.width, h: o.h * doc.height };
}

function animState(o: Overlay, t: number, duration: number, settled = false): { alpha: number; scale: number; dx: number; dy: number } {
  const end = overlayEnd(o, duration);
  const inP = settled ? 1 : Math.min(1, Math.max(0, (t - o.start) / ENTRANCE));
  const outP = o.end == null || settled ? 1 : Math.min(1, Math.max(0, (end - t) / 0.3));
  const p = Math.min(inP, outP);
  const k = 1 - Math.pow(1 - p, 3); // ease-out cubic
  const back = p >= 1 ? 1 : 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2); // ease-out-back (slight overshoot)
  switch (o.animation) {
    case "fade":
      return { alpha: p, scale: 1, dx: 0, dy: 0 };
    case "pop":
      return { alpha: Math.min(1, p * 2), scale: 0.86 + 0.14 * back, dx: 0, dy: 0 };
    case "slide":
      return { alpha: Math.min(1, p * 1.6), scale: 1, dx: 0, dy: (1 - k) * 60 };
    case "slideDown":
      return { alpha: Math.min(1, p * 1.6), scale: 1, dx: 0, dy: -(1 - k) * 90 };
    case "slideLeft":
      return { alpha: Math.min(1, p * 1.6), scale: 1, dx: (1 - k) * 140, dy: 0 };
    case "zoom":
      return { alpha: Math.min(1, p * 1.8), scale: 1.25 - 0.25 * k, dx: 0, dy: 0 };
    default:
      return { alpha: 1, scale: 1, dx: 0, dy: 0 };
  }
}

function calloutSizes(o: CalloutOverlay, boxH: number, u: number) {
  const titleSize = o.titleSize ? o.titleSize * u : Math.min(boxH * 0.4, 46 * u);
  const subSize = o.subtitleSize ? o.subtitleSize * u : Math.min(boxH * 0.26, 30 * u);
  const hasSub = !!o.subtitle.trim();
  const minH = 20 * u + titleSize * 1.15 + (hasSub ? subSize * 1.35 : 0) + 8 * u;
  return { titleSize, subSize, minH, hasSub };
}

function drawTextOverlay(ctx: Ctx, doc: EditorDocument, o: TextOverlay) {
  const u = unit(doc);
  const s = o.style;
  const { rect, lines, font, lineH } = layoutTextOverlay(ctx, doc, o);
  const pad = s.padding * u;
  if (s.background && s.backgroundOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= s.backgroundOpacity;
    ctx.fillStyle = resolveColor(s.background, doc.theme);
    if (s.shadow > 0) {
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = s.shadow * u;
      ctx.shadowOffsetY = s.shadow * u * 0.25;
    }
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, s.radius * u);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.font = font;
  setLetterSpacing(ctx, s.letterSpacing * u);
  ctx.fillStyle = resolveColor(s.color, doc.theme);
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align;
  if (s.shadow > 0 && !(s.background && s.backgroundOpacity > 0.5)) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = s.shadow * u;
    ctx.shadowOffsetY = 2 * u;
  }
  const x = s.align === "left" ? rect.x + pad : s.align === "right" ? rect.x + rect.w - pad : rect.x + rect.w / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, rect.y + pad + lineH * (i + 0.5)));
  ctx.restore();
}

function drawShape(ctx: Ctx, doc: EditorDocument, o: ShapeOverlay) {
  const u = unit(doc);
  const r = overlayRect(ctx, doc, o);
  ctx.save();
  if (o.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  } else roundRect(ctx, r.x, r.y, r.w, r.h, o.radius * u);
  if (o.fill) {
    ctx.fillStyle = o.kind === "highlight" ? withAlpha(resolveColor(o.fill, doc.theme), 0.28) : resolveColor(o.fill, doc.theme);
    ctx.fill();
  }
  if (o.stroke && o.strokeWidth > 0) {
    ctx.strokeStyle = resolveColor(o.stroke, doc.theme);
    ctx.lineWidth = o.strokeWidth * u;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCallout(ctx: Ctx, doc: EditorDocument, o: CalloutOverlay) {
  const u = unit(doc);
  const r = overlayRect(ctx, doc, o);
  const fam = resolveFont(o.fontFamily, doc.theme);
  ctx.save();
  ctx.fillStyle = resolveColor(o.fill, doc.theme);
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 18 * u;
  ctx.shadowOffsetY = 6 * u;
  roundRect(ctx, r.x, r.y, r.w, r.h, (o.kind === "lowerThird" ? 14 : 24) * u);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.fillStyle = resolveColor(o.accent, doc.theme);
  const barW = 12 * u;
  roundRect(ctx, r.x, r.y, barW + 10 * u, r.h, (o.kind === "lowerThird" ? 14 : 24) * u);
  ctx.save();
  ctx.clip();
  ctx.fillRect(r.x, r.y, barW, r.h);
  ctx.restore();
  ctx.restore();
  const padX = barW + 26 * u;
  const { titleSize, subSize, hasSub } = calloutSizes(o, o.h * doc.height, u);
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.fillStyle = resolveColor(o.textColor, doc.theme);
  ctx.font = fontString(800, titleSize, fam);
  // title + subtitle block centred vertically in the (possibly grown) box
  const blockH = titleSize * 1.15 + (hasSub ? subSize * 1.35 : 0);
  const top = r.y + (r.h - blockH) / 2;
  ctx.fillText(fitLine(ctx, o.title, r.w - padX - 20 * u), r.x + padX, top + titleSize * 0.575);
  if (hasSub) {
    ctx.globalAlpha *= 0.82;
    ctx.font = fontString(500, subSize, fam);
    ctx.fillText(fitLine(ctx, o.subtitle, r.w - padX - 20 * u), r.x + padX, top + titleSize * 1.15 + subSize * 0.675);
  }
  ctx.restore();
}

function fitLine(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
}

function drawImageOverlay(ctx: Ctx, doc: EditorDocument, o: ImageOverlay, env: RenderEnv) {
  const id = o.assetId ?? (o.kind === "logo" ? doc.theme.logoAssetId : null);
  if (!id) return;
  const img = env.getImage(id);
  if (!img) return;
  const r = overlayRect(ctx, doc, o);
  const k = o.fit === "cover" ? Math.max(r.w / img.width, r.h / img.height) : Math.min(r.w / img.width, r.h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, 0);
  ctx.clip();
  ctx.drawImage(img.image, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawVideoOverlay(ctx: Ctx, doc: EditorDocument, o: VideoOverlay, t: number, env: RenderEnv) {
  const f = env.getOverlayFrame?.(o, t);
  const r = overlayRect(ctx, doc, o);
  ctx.save();
  roundRect(ctx, r.x, r.y, r.w, r.h, o.radius * unit(doc));
  ctx.clip();
  if (!f) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
    return;
  }
  const k = o.fit === "cover" ? Math.max(r.w / f.width, r.h / f.height) : Math.min(r.w / f.width, r.h / f.height);
  const dw = f.width * k;
  const dh = f.height * k;
  ctx.drawImage(f.image, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  ctx.restore();
}

export function drawOverlay(ctx: Ctx, doc: EditorDocument, o: Overlay, t: number, env: RenderEnv, duration: number) {
  const a = animState(o, t, duration, env.settled);
  if (a.alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity)) * a.alpha;
  if (a.scale !== 1 || a.dy !== 0 || a.dx !== 0) {
    const r = overlayRect(ctx, doc, o);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.translate(cx + a.dx * unit(doc), cy + a.dy * unit(doc));
    ctx.scale(a.scale, a.scale);
    ctx.translate(-cx, -cy);
  }
  switch (o.kind) {
    case "text":
      drawTextOverlay(ctx, doc, o);
      break;
    case "rect":
    case "ellipse":
    case "highlight":
      drawShape(ctx, doc, o);
      break;
    case "callout":
    case "lowerThird":
      drawCallout(ctx, doc, o);
      break;
    case "image":
    case "logo":
      drawImageOverlay(ctx, doc, o, env);
      break;
    case "video":
      drawVideoOverlay(ctx, doc, o, t, env);
      break;
  }
  ctx.restore();
}

const segCache = new WeakMap<EditorDocument, TimedSegment[]>();
export function cachedSegments(doc: EditorDocument): TimedSegment[] {
  let s = segCache.get(doc);
  if (!s) {
    s = timedSegments(doc);
    segCache.set(doc, s);
  }
  return s;
}

function applyCase(text: string, c: "normal" | "upper" | "lower") {
  return c === "upper" ? text.toLocaleUpperCase("pl-PL") : c === "lower" ? text.toLocaleLowerCase("pl-PL") : text;
}

export interface SubtitleLayout {
  lines: Array<Array<{ text: string; width: number; t0: number; t1: number; id: string }>>;
  font: string;
  lineH: number;
  blockRect: Rect;
  spaceW: number;
}

export function layoutSubtitle(ctx: Ctx, doc: EditorDocument, seg: TimedSegment): SubtitleLayout {
  const u = unit(doc);
  const st = doc.subtitles.style;
  const size = st.fontSize * u;
  const font = fontString(st.fontWeight, size, resolveFont(st.fontFamily, doc.theme));
  ctx.save();
  ctx.font = font;
  setLetterSpacing(ctx, 0);
  const maxW = st.maxWidth * doc.width;
  const spaceW = ctx.measureText(" ").width;
  const lines: SubtitleLayout["lines"] = [[]];
  let lineW = 0;
  for (const w of seg.words) {
    const text = applyCase(w.text, st.case);
    const width = ctx.measureText(text).width;
    const cur = lines[lines.length - 1];
    if (cur.length && lineW + spaceW + width > maxW) {
      lines.push([]);
      lineW = 0;
    }
    const l = lines[lines.length - 1];
    lineW += (l.length ? spaceW : 0) + width;
    l.push({ text, width, t0: w.t0, t1: w.t1, id: w.id });
  }
  ctx.restore();
  // balance two lines so the second line is not a lonely word
  if (lines.length === 2 && lines[1].length === 1 && lines[0].length > 2) {
    lines[1].unshift(lines[0].pop()!);
  }
  const lineH = size * st.lineHeight;
  const blockH = lines.length * lineH;
  const widths = lines.map((l) => l.reduce((n, w) => n + w.width, 0) + spaceW * Math.max(0, l.length - 1));
  const blockW = Math.max(...widths);
  const cy = st.y * doc.height;
  return { lines, font, lineH, spaceW, blockRect: { x: (doc.width - blockW) / 2, y: cy - blockH / 2, w: blockW, h: blockH } };
}

function drawSubtitles(ctx: Ctx, doc: EditorDocument, t: number) {
  if (!doc.subtitles.enabled) return;
  const seg = segmentAt(cachedSegments(doc), t);
  if (!seg) return;
  const st = doc.subtitles.style;
  const u = unit(doc);
  const L = layoutSubtitle(ctx, doc, seg);
  const appear = Math.min(1, Math.max(0, (t - seg.t0) / 0.14));
  ctx.save();
  if (st.animation === "fade") ctx.globalAlpha = appear;
  if (st.animation === "pop") {
    const k = 0.9 + 0.1 * (1 - Math.pow(1 - appear, 3));
    const cx = doc.width / 2;
    const cy = L.blockRect.y + L.blockRect.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);
  }
  const padX = 22 * u;
  const padY = 12 * u;
  if (st.background && st.backgroundOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= st.backgroundOpacity;
    ctx.fillStyle = resolveColor(st.background, doc.theme);
    roundRect(ctx, L.blockRect.x - padX, L.blockRect.y - padY, L.blockRect.w + padX * 2, L.blockRect.h + padY * 2, 18 * u);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = L.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  const words = seg.words;
  // the active word stays highlighted through the gap until the next word starts
  let activeId: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (t >= words[i].t0 && (next ? t < next.t0 : t < words[i].t1 + 0.25)) activeId = words[i].id;
  }
  const color = resolveColor(st.color, doc.theme);
  const hl = resolveColor(st.highlightColor, doc.theme);
  L.lines.forEach((line, li) => {
    const lw = line.reduce((n, w) => n + w.width, 0) + L.spaceW * Math.max(0, line.length - 1);
    let x = (doc.width - lw) / 2;
    const y = L.blockRect.y + L.lineH * (li + 0.5);
    for (const w of line) {
      const active = w.id === activeId && st.highlightMode !== "none";
      if (active && st.highlightMode === "box") {
        ctx.save();
        ctx.fillStyle = hl;
        const bx = 10 * u;
        roundRect(ctx, x - bx, y - L.lineH * 0.46, w.width + bx * 2, L.lineH * 0.92, 12 * u);
        ctx.fill();
        ctx.restore();
      }
      if (st.stroke > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.92)";
        ctx.lineWidth = st.stroke * u * 2;
        ctx.strokeText(w.text, x, y);
        ctx.restore();
      }
      ctx.save();
      if (st.shadow > 0 && !(st.background && st.backgroundOpacity > 0.5) && !(active && st.highlightMode === "box")) {
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = st.shadow * u;
        ctx.shadowOffsetY = 2 * u;
      }
      ctx.fillStyle = active && st.highlightMode === "color" ? hl : active && st.highlightMode === "box" && luminance(hl) > 0.45 ? "#111111" : color;
      ctx.fillText(w.text, x, y);
      ctx.restore();
      x += w.width + L.spaceW;
    }
  });
  ctx.restore();
}

/** Cover-fit placement of a video frame with framing + zoom, clamped so no black borders appear. */
export function videoPlacement(
  doc: EditorDocument,
  srcW: number,
  srcH: number,
  framing: { scale: number; cx: number; cy: number },
  zoom: { scale: number; cx: number; cy: number },
): Rect {
  const W = doc.width;
  const H = doc.height;
  const base = Math.max(W / srcW, H / srcH);
  const total = base * Math.max(1, framing.scale) * Math.max(1, zoom.scale);
  const dw = srcW * total;
  const dh = srcH * total;
  const useZoom = zoom.scale > 1.0001;
  const cx = useZoom ? zoom.cx : framing.cx;
  const cy = useZoom ? zoom.cy : framing.cy;
  let x = W / 2 - cx * dw;
  let y = H / 2 - cy * dh;
  x = Math.min(0, Math.max(W - dw, x));
  y = Math.min(0, Math.max(H - dh, y));
  return { x, y, w: dw, h: dh };
}

/** In-place separable box blur of RGBA pixels (radius in px, edges clamped). */
function boxBlur(px: Uint8ClampedArray, w: number, h: number, r: number) {
  const tmp = new Float32Array(px.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += px[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c];
        tmp[(y * w + x) * 4 + c] = s / n;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c];
        px[(y * w + x) * 4 + c] = s / n;
      }
}

/**
 * Background blur behind the expert: the frame is blurred (down- and up-sampling, identical in the
 * browser and in the export), then the sharp person is drawn on top through the segmentation mask.
 * `blur` 1..100 = strength.
 */
function drawWithBlurredBackground(ctx: Ctx, doc: EditorDocument, frame: FrameSource, mask: FrameSource, r: Rect, blur: number, scratch: NonNullable<RenderEnv["scratch"]>) {
  const W = doc.width;
  const H = doc.height;
  // 1) blurred background: two-step downscale keeps it smooth instead of blocky
  const f = 6 + (Math.min(100, blur) / 100) * 34; // 6..40 × smaller
  const midW = Math.max(8, Math.round(W / Math.sqrt(f)));
  const midH = Math.max(8, Math.round(H / Math.sqrt(f)));
  const smW = Math.max(4, Math.round(W / f));
  const smH = Math.max(4, Math.round(H / f));
  const mid = scratch("blur-mid", midW, midH);
  const sm = scratch("blur-sm", smW, smH);
  for (const s of [mid, sm]) {
    s.ctx.imageSmoothingEnabled = true;
    (s.ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  }
  mid.ctx.clearRect(0, 0, midW, midH);
  mid.ctx.drawImage(frame.image, (r.x * midW) / W, (r.y * midH) / H, (r.w * midW) / W, (r.h * midH) / H);
  sm.ctx.clearRect(0, 0, smW, smH);
  sm.ctx.drawImage(mid.canvas, 0, 0, smW, smH);
  // smooth the tiny image (box blur ×2 ≈ gaussian) so the upscale has no blocky edges
  const img = sm.ctx.getImageData(0, 0, smW, smH);
  boxBlur(img.data, smW, smH, 2);
  boxBlur(img.data, smW, smH, 2);
  sm.ctx.putImageData(img, 0, 0);
  mid.ctx.clearRect(0, 0, midW, midH);
  mid.ctx.drawImage(sm.canvas, 0, 0, midW, midH);
  ctx.drawImage(mid.canvas, 0, 0, W, H);

  // 2) sharp person through the mask (the mask covers the whole source frame, so it uses the same placement)
  const person = scratch("blur-person", W, H);
  person.ctx.globalCompositeOperation = "source-over";
  person.ctx.clearRect(0, 0, W, H);
  person.ctx.imageSmoothingEnabled = true;
  (person.ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  person.ctx.drawImage(frame.image, r.x, r.y, r.w, r.h);
  person.ctx.globalCompositeOperation = "destination-in";
  person.ctx.drawImage(mask.image, r.x, r.y, r.w, r.h);
  person.ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(person.canvas, 0, 0);
}

export function drawFrame(ctx: Ctx, doc: EditorDocument, t: number, env: RenderEnv) {
  const W = doc.width;
  const H = doc.height;
  const duration = docDuration(doc);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = resolveColor(doc.background, doc.theme);
  ctx.fillRect(0, 0, W, H);
  const clip = clipAt(doc, t);
  let drewVideo = false;
  if (clip) {
    const src = clip.sourceIn + (t - clip.start);
    const frame = env.getFrame(clip.id, clip.assetId, src);
    if (frame && frame.width > 0 && frame.height > 0) {
      const z = zoomAt(doc.zooms, t, env.includeSuggestedZooms);
      const r = videoPlacement(doc, frame.width, frame.height, clip.framing, z);
      ctx.imageSmoothingEnabled = true;
      (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
      const blur = clip.background?.blur ?? 0;
      const mask = blur > 0 ? env.getMask?.(clip.assetId, src) : null;
      if (blur > 0 && mask && env.scratch) drawWithBlurredBackground(ctx, doc, frame, mask, r, blur, env.scratch);
      else ctx.drawImage(frame.image, r.x, r.y, r.w, r.h);
      drewVideo = true;
    }
  }
  if (!drewVideo) {
    // intro card / gaps: branded background
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, resolveColor("$background", doc.theme));
    g.addColorStop(1, resolveColor("$primary", doc.theme));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  for (const o of doc.overlays) {
    if (o.hidden || env.hideOverlayIds?.has(o.id)) continue;
    if (t < o.start || t >= overlayEnd(o, duration)) continue;
    drawOverlay(ctx, doc, o, t, env, duration);
  }
  drawSubtitles(ctx, doc, t);
  ctx.restore();
}
