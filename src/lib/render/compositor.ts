/**
 * Shared frame compositor.
 *
 * The SAME function draws the browser preview (HTMLCanvasElement + <video>) and
 * every frame of the server-side export (@napi-rs/canvas + FFmpeg-decoded frames).
 * Both environments use Skia and the same TTF font files from /public/fonts,
 * which is what gives preview/export parity. Editor-only UI (selection handles,
 * safe-area guides) is never drawn here.
 */
import type { BlurOverlay, CallStyle, CalloutOverlay, ColorRef, EditorDocument, FaceBubble, FontRef, ImageOverlay, Overlay, ShapeOverlay, TextOverlay, ThemeTokens, VideoOverlay } from "../editor/types";
import { DEFAULT_BUBBLE } from "../editor/types";
import { clipAt, clipEnd, docDuration, endCardStart, overlayEnd, segmentAt, timedSegments, type TimedSegment } from "../editor/timeline";
import { zoomAt } from "../editor/zoom";

// Minimal structural type satisfied by both DOM and @napi-rs/canvas contexts.
export type Ctx = CanvasRenderingContext2D;
export type Drawable = CanvasImageSource;

export interface FrameSource {
  image: Drawable;
  width: number;
  height: number;
  /**
   * Source time of the picture actually in `image` (a playing <video> can be a few frames off
   * the playhead): the person mask is taken for this time so it sits exactly on the expert.
   */
  time?: number;
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

type AnimState = { alpha: number; scale: number; dx: number; dy: number };

function animState(o: Overlay, t: number, duration: number, settled = false): AnimState {
  const end = overlayEnd(o, duration);
  const inP = settled ? 1 : Math.min(1, Math.max(0, (t - o.start) / ENTRANCE));
  const outKind = o.animationOut ?? o.animation;
  // a fade-out takes a little longer than the other exits
  const outP = o.end == null || settled ? 1 : Math.min(1, Math.max(0, (end - t) / (outKind === "fade" ? 0.5 : 0.3)));
  const a = animAt(o.animation, inP);
  if (outP >= 1) return a;
  const b = animAt(outKind, outP);
  return { alpha: a.alpha * b.alpha, scale: a.scale * b.scale, dx: a.dx + b.dx, dy: a.dy + b.dy };
}

function animAt(kind: Overlay["animation"], p: number): AnimState {
  const k = 1 - Math.pow(1 - p, 3); // ease-out cubic
  const back = p >= 1 ? 1 : 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2); // ease-out-back (slight overshoot)
  switch (kind) {
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
  if (s.outline && s.outline > 0) {
    // contour first, then the letters on top of it
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = s.outline * u * 2;
    ctx.strokeStyle = "rgba(0,0,0,0.88)";
    lines.forEach((line, i) => ctx.strokeText(line, x, rect.y + pad + lineH * (i + 0.5)));
    ctx.restore();
  }
  lines.forEach((line, i) => ctx.fillText(line, x, rect.y + pad + lineH * (i + 0.5)));
  ctx.restore();
  if (s.accentBar) {
    const bw = Math.min(rect.w * 0.24, 240 * u);
    const bh = 9 * u;
    const by = rect.y + pad + lineH * lines.length + 10 * u;
    const bx = s.align === "left" ? rect.x + pad : s.align === "right" ? rect.x + rect.w - pad - bw : rect.x + (rect.w - bw) / 2;
    ctx.save();
    ctx.fillStyle = resolveColor("$accent", doc.theme);
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.restore();
  }
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

/** The expert's picture as placed in this frame (for the face bubble over full-screen graphics). */
export interface MainVideo {
  frame: FrameSource;
  rect: Rect;
  /** picture correction filter of the clip ("none" = off) */
  look?: string;
  /** the frame as composed (blurred / AI background), in output pixels — the bubble cuts from it */
  composite?: Drawable;
}

/**
 * The expert's face in a circle (like Loom) over a full-screen image: a square around the face is
 * cut from the expert's picture as it is placed in the frame, drawn in a circle with a theme ring.
 */
export function drawFaceBubble(ctx: Ctx, doc: EditorDocument, b: FaceBubble, main: MainVideo) {
  const W = doc.width;
  const H = doc.height;
  const R = (Math.max(0.08, b.size) * W) / 2;
  const cx = b.x * W;
  const cy = b.y * H;
  const r = main.rect;
  // face square in output coordinates, then in source pixels
  const side = Math.min(r.w, r.h, (W * 0.62) / Math.max(0.5, b.zoom ?? DEFAULT_BUBBLE.zoom!));
  const fx = r.x + r.w / 2;
  const fy = r.y + r.h * (b.fy ?? DEFAULT_BUBBLE.fy!);
  const kx = main.frame.width / r.w;
  const ky = main.frame.height / r.h;
  let sx = (fx - side / 2 - r.x) * kx;
  let sy = (fy - side / 2 - r.y) * ky;
  const sw = side * kx;
  const sh = side * ky;
  sx = Math.max(0, Math.min(main.frame.width - sw, sx));
  sy = Math.max(0, Math.min(main.frame.height - sh, sy));
  ctx.save();
  // soft shadow under the bubble
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = R * 0.18;
  ctx.shadowOffsetY = R * 0.05;
  ctx.fillStyle = resolveColor("$accent", doc.theme);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  const ring = Math.max(3, R * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy, R - ring, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  if (main.composite) {
    // background already blurred / replaced (and the look applied): cut the same square in output pixels
    const s = Math.min(side, W, H);
    const ox = Math.max(0, Math.min(W - s, fx - s / 2));
    const oy = Math.max(0, Math.min(H - s, fy - s / 2));
    ctx.drawImage(main.composite, ox, oy, s, s, cx - R + ring, cy - R + ring, (R - ring) * 2, (R - ring) * 2);
  } else {
    ctx.filter = main.look ?? "none";
    ctx.drawImage(main.frame.image, sx, sy, sw, sh, cx - R + ring, cy - R + ring, (R - ring) * 2, (R - ring) * 2);
  }
  ctx.restore();
}

export function drawOverlay(ctx: Ctx, doc: EditorDocument, o: Overlay, t: number, env: RenderEnv, duration: number, main?: MainVideo | null) {
  const a = animState(o, t, duration, env.settled);
  if (a.alpha <= 0.001) return;
  if (o.kind === "blur") {
    // stays in place (no slide / pop); appears and disappears by fading the blur
    drawBlurBehind(ctx, doc, o, Math.max(0, Math.min(1, o.opacity)) * a.alpha, env);
    return;
  }
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
      if (o.kind === "image" && o.bubble && main) drawFaceBubble(ctx, doc, o.bubble, main);
      break;
    case "video":
      drawVideoOverlay(ctx, doc, o, t, env);
      break;
  }
  ctx.restore();
}

/**
 * Blur behind: the pixels already drawn under the shape are read back, blurred (downscale + box blur,
 * the same in the browser and the export) and drawn back inside the rectangle / circle.
 */
function drawBlurBehind(ctx: Ctx, doc: EditorDocument, o: BlurOverlay, alpha: number, env: RenderEnv) {
  if (alpha <= 0.001 || o.strength <= 0 || !env.scratch) return;
  const r = overlayRect(ctx, doc, o);
  // device pixels (thumbnails draw scaled)
  const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const sx = m ? m.a : 1;
  const sy = m ? m.d : 1;
  const ox = m ? m.e : 0;
  const oy = m ? m.f : 0;
  const cw = (ctx.canvas as { width?: number } | undefined)?.width ?? doc.width;
  const ch = (ctx.canvas as { height?: number } | undefined)?.height ?? doc.height;
  const x0 = Math.max(0, Math.floor(r.x * sx + ox));
  const y0 = Math.max(0, Math.floor(r.y * sy + oy));
  const x1 = Math.min(cw, Math.ceil((r.x + r.w) * sx + ox));
  const y1 = Math.min(ch, Math.ceil((r.y + r.h) * sy + oy));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return;
  const src = ctx.getImageData(x0, y0, w, h);
  const full = env.scratch(`blurbehind-full:${o.id}`, w, h);
  full.ctx.putImageData(src, 0, 0);
  const f = 3 + (Math.min(100, o.strength) / 100) * 27; // 3..30 × smaller
  const smW = Math.max(2, Math.round(w / f));
  const smH = Math.max(2, Math.round(h / f));
  const sm = env.scratch(`blurbehind-sm:${o.id}`, smW, smH);
  sm.ctx.imageSmoothingEnabled = true;
  sm.ctx.clearRect(0, 0, smW, smH);
  sm.ctx.drawImage(full.canvas, 0, 0, smW, smH);
  const d = sm.ctx.getImageData(0, 0, smW, smH);
  boxBlur(d.data, smW, smH, 1);
  boxBlur(d.data, smW, smH, 1);
  sm.ctx.putImageData(d, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  const rx = r.x * sx + ox;
  const ry = r.y * sy + oy;
  const rw = r.w * sx;
  const rh = r.h * sy;
  if (o.shape === "circle") ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
  else {
    const rad = Math.min(rw / 2, rh / 2, o.radius * unit(doc) * sx);
    ctx.moveTo(rx + rad, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rad);
    ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rad);
    ctx.arcTo(rx, ry + rh, rx, ry, rad);
    ctx.arcTo(rx, ry, rx + rw, ry, rad);
    ctx.closePath();
  }
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  ctx.drawImage(sm.canvas, x0, y0, w, h);
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
  const cy = (seg.seg.y ?? st.y) * doc.height;
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
 * Replace pixels covered by the person (mask alpha, slightly grown) with a weighted average of the
 * nearby background: blur(colour·w) / blur(w) with w = 1 − person. Far inside the person (no
 * background in reach) the original colour stays — it is hidden under the sharp person anyway.
 */
export function fillBehindPerson(px: Uint8ClampedArray, maskPx: Uint8ClampedArray, w: number, h: number) {
  const N = w * h;
  const wt = new Float32Array(N);
  const acc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const person = Math.min(1, (maskPx[i * 4 + 3] / 255) * 1.6);
    const k = (1 - person) ** 2;
    wt[i] = k;
    acc[i * 3] = px[i * 4] * k;
    acc[i * 3 + 1] = px[i * 4 + 1] * k;
    acc[i * 3 + 2] = px[i * 4 + 2] * k;
  }
  const rad = Math.max(2, Math.round(Math.max(w, h) / 14));
  for (let pass = 0; pass < 3; pass++) {
    floatBoxBlur(wt, w, h, 1, rad);
    floatBoxBlur(acc, w, h, 3, rad);
  }
  for (let i = 0; i < N; i++) {
    const person = maskPx[i * 4 + 3] / 255;
    if (person < 0.02 || wt[i] < 1e-3) continue;
    // fully filled where the person is, faded in over the soft edge
    const t = Math.min(1, person * 1.6) * Math.min(1, wt[i] / 0.05);
    for (let c = 0; c < 3; c++) px[i * 4 + c] = px[i * 4 + c] * (1 - t) + (acc[i * 3 + c] / wt[i]) * t;
  }
}

/** Separable running-sum box blur of an interleaved float image (ch channels), edges clamped. */
function floatBoxBlur(a: Float32Array, w: number, h: number, ch: number, r: number) {
  const tmp = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++)
    for (let c = 0; c < ch; c++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[(y * w + Math.min(w - 1, Math.max(0, k))) * ch + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * ch + c] = s / n;
        s += a[(y * w + Math.min(w - 1, x + r + 1)) * ch + c] - a[(y * w + Math.max(0, x - r)) * ch + c];
      }
    }
  for (let x = 0; x < w; x++)
    for (let c = 0; c < ch; c++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * ch + c];
      for (let y = 0; y < h; y++) {
        a[(y * w + x) * ch + c] = s / n;
        s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * ch + c] - tmp[(Math.max(0, y - r) * w + x) * ch + c];
      }
    }
}

/**
 * Background blur behind the expert: the frame is blurred (down- and up-sampling, identical in the
 * browser and in the export), then the sharp person is drawn on top through the segmentation mask.
 * `blur` 1..100 = strength.
 */
/** CSS filter string for a picture look (brightness/contrast/saturation factors). */
export function lookFilter(l: { brightness: number; contrast: number; saturate: number }): string {
  const f = (v: number) => Math.round(v * 1000) / 1000;
  return `brightness(${f(l.brightness)}) contrast(${f(l.contrast)}) saturate(${f(l.saturate)})`;
}

function drawWithBlurredBackground(
  ctx: Ctx,
  doc: EditorDocument,
  frame: FrameSource,
  mask: FrameSource,
  r: Rect,
  blur: number,
  scratch: NonNullable<RenderEnv["scratch"]>,
  look = "none",
  bgImage: FrameSource | null = null,
  despill = false,
  imageBlur = 0,
) {
  const W = doc.width;
  const H = doc.height;
  if (bgImage) {
    // replacement background (AI image) instead of the room: cover the frame, the person goes on top
    if (imageBlur > 0) ctx.drawImage(blurredPlate(bgImage, imageBlur, W, H, scratch), 0, 0, W, H);
    else {
      const k = Math.max(W / bgImage.width, H / bgImage.height);
      ctx.drawImage(bgImage.image, (W - bgImage.width * k) / 2, (H - bgImage.height * k) / 2, bgImage.width * k, bgImage.height * k);
    }
    drawPerson(ctx, doc, frame, mask, r, scratch, look, despill);
    return;
  }
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
  mid.ctx.filter = look;
  mid.ctx.drawImage(frame.image, (r.x * midW) / W, (r.y * midH) / H, (r.w * midW) / W, (r.h * midH) / H);
  mid.ctx.filter = "none";
  sm.ctx.clearRect(0, 0, smW, smH);
  sm.ctx.drawImage(mid.canvas, 0, 0, smW, smH);
  // the person's own colours are removed from the background first and the hole is filled from the
  // surrounding room (normalised blur), so no blurred "ghost" of the expert glows around the edges
  const img = sm.ctx.getImageData(0, 0, smW, smH);
  const ms = scratch("blur-msk", smW, smH);
  ms.ctx.imageSmoothingEnabled = true;
  ms.ctx.clearRect(0, 0, smW, smH);
  ms.ctx.drawImage(mask.image, (r.x * smW) / W, (r.y * smH) / H, (r.w * smW) / W, (r.h * smH) / H);
  fillBehindPerson(img.data, ms.ctx.getImageData(0, 0, smW, smH).data, smW, smH);
  // smooth the tiny image (box blur ×2 ≈ gaussian) so the upscale has no blocky edges
  boxBlur(img.data, smW, smH, 2);
  boxBlur(img.data, smW, smH, 2);
  sm.ctx.putImageData(img, 0, 0);
  mid.ctx.clearRect(0, 0, midW, midH);
  mid.ctx.drawImage(sm.canvas, 0, 0, midW, midH);
  ctx.drawImage(mid.canvas, 0, 0, W, H);

  drawPerson(ctx, doc, frame, mask, r, scratch, look, despill);
}

/** The AI background softened (0–100), computed once per image and strength — the plate does not move. */
const plateSig = new WeakMap<object, { img: object; blur: number; w: number; h: number }>();
function blurredPlate(img: FrameSource, blur: number, W: number, H: number, scratch: NonNullable<RenderEnv["scratch"]>): Drawable {
  const out = scratch("bg-plate", W, H);
  const was = plateSig.get(out.canvas as object);
  if (was && was.img === img.image && was.blur === blur && was.w === W && was.h === H) return out.canvas;
  const f = 2 + (Math.min(100, blur) / 100) * 22; // 2..24 × smaller
  const smW = Math.max(4, Math.round(W / f));
  const smH = Math.max(4, Math.round(H / f));
  const sm = scratch("bg-plate-sm", smW, smH);
  sm.ctx.imageSmoothingEnabled = true;
  const k = Math.max(smW / img.width, smH / img.height);
  sm.ctx.clearRect(0, 0, smW, smH);
  sm.ctx.drawImage(img.image, (smW - img.width * k) / 2, (smH - img.height * k) / 2, img.width * k, img.height * k);
  const d = sm.ctx.getImageData(0, 0, smW, smH);
  boxBlur(d.data, smW, smH, 2);
  boxBlur(d.data, smW, smH, 2);
  sm.ctx.putImageData(d, 0, 0);
  out.ctx.imageSmoothingEnabled = true;
  (out.ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  out.ctx.clearRect(0, 0, W, H);
  out.ctx.drawImage(sm.canvas, 0, 0, W, H);
  plateSig.set(out.canvas as object, { img: img.image as object, blur, w: W, h: H });
  return out.canvas;
}

/** The sharp person through the mask (the mask covers the whole source frame, so it uses the same placement). */
function drawPerson(ctx: Ctx, doc: EditorDocument, frame: FrameSource, mask: FrameSource, r: Rect, scratch: NonNullable<RenderEnv["scratch"]>, look: string, despill = false) {
  const W = doc.width;
  const H = doc.height;
  const person = scratch("blur-person", W, H);
  person.ctx.globalCompositeOperation = "source-over";
  person.ctx.clearRect(0, 0, W, H);
  person.ctx.imageSmoothingEnabled = true;
  (person.ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  person.ctx.filter = look;
  person.ctx.drawImage(frame.image, r.x, r.y, r.w, r.h);
  person.ctx.filter = "none";
  person.ctx.globalCompositeOperation = "destination-in";
  person.ctx.drawImage(mask.image, r.x, r.y, r.w, r.h);
  person.ctx.globalCompositeOperation = "source-over";
  if (despill) despillGreen(person.ctx, W, H);
  ctx.drawImage(person.canvas, 0, 0);
}

/** Green-screen spill: green can't be brighter than the larger of red and blue (classic despill). */
export function despillGreen(c: Ctx, W: number, H: number) {
  const img = c.getImageData(0, 0, W, H);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const lim = Math.max(px[i], px[i + 2]);
    if (px[i + 1] > lim) px[i + 1] = lim;
  }
  c.putImageData(img, 0, 0);
}

/**
 * CTA end card: full frame in the theme colours, the logo (if any), the caption and the website
 * address on an accent pill, centred; fades in.
 */
export function drawEndCard(ctx: Ctx, doc: EditorDocument, local: number, env: RenderEnv) {
  const card = doc.endCard!;
  const W = doc.width;
  const H = doc.height;
  const u = unit(doc);
  const th = doc.theme;
  const k = Math.min(1, Math.max(0, local / 0.35));
  ctx.save();
  // over the video: the expert stays faintly visible (and audible) under the card
  ctx.globalAlpha = k * (card.placement === "overlay" ? 0.86 : 1);
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, resolveColor("$background", th));
  g.addColorStop(1, resolveColor("$primary", th));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = k;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const blocks: Array<{ h: number; draw: (y: number) => void }> = [];
  const logo = th.logoAssetId ? env.getImage(th.logoAssetId) : null;
  if (logo) {
    const lh = 150 * u;
    const lw = Math.min(W * 0.5, (logo.width / logo.height) * lh);
    blocks.push({ h: (lw * logo.height) / logo.width, draw: (y) => ctx.drawImage(logo.image, (W - lw) / 2, y, lw, (lw * logo.height) / logo.width) });
  }
  if (card.text) {
    ctx.font = fontString(700, 54 * u, resolveFont("$label", th));
    const lines = wrapText(ctx, card.text, W * 0.8).slice(0, 3);
    const lh = 66 * u;
    blocks.push({
      h: lines.length * lh,
      draw: (y) => {
        ctx.font = fontString(700, 54 * u, resolveFont("$label", th));
        ctx.fillStyle = resolveColor("$text", th);
        lines.forEach((l, i) => ctx.fillText(l, W / 2, y + lh * (i + 0.5)));
      },
    });
  }
  if (card.url) {
    let size = 72 * u;
    ctx.font = fontString(800, size, resolveFont("$question", th));
    while (ctx.measureText(card.url).width > W * 0.78 && size > 30 * u) {
      size -= 2 * u;
      ctx.font = fontString(800, size, resolveFont("$question", th));
    }
    const tw = ctx.measureText(card.url).width;
    const padX = 44 * u;
    const ph = size * 1.9;
    blocks.push({
      h: ph,
      draw: (y) => {
        ctx.fillStyle = resolveColor("$accent", th);
        roundRect(ctx, (W - tw) / 2 - padX, y, tw + padX * 2, ph, ph / 2);
        ctx.fill();
        ctx.font = fontString(800, size, resolveFont("$question", th));
        ctx.fillStyle = resolveColor("$background", th);
        ctx.fillText(card.url, W / 2, y + ph / 2);
      },
    });
  }
  const gap = 46 * u;
  const total = blocks.reduce((n, b) => n + b.h, 0) + gap * Math.max(0, blocks.length - 1);
  let y = (H - total) / 2 - H * 0.04 + (1 - k) * 30 * u;
  for (const b of blocks) {
    b.draw(y);
    y += b.h + gap;
  }
  ctx.restore();
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
  let main: MainVideo | null = null;
  if (clip) {
    const src = clip.sourceIn + (t - clip.start);
    const frame = env.getFrame(clip.id, clip.assetId, src);
    if (frame && frame.width > 0 && frame.height > 0) {
      const z = zoomAt(doc.zooms, t, env.includeSuggestedZooms);
      const r = videoPlacement(doc, frame.width, frame.height, clip.framing, z);
      ctx.imageSmoothingEnabled = true;
      (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
      const blur = clip.background?.blur ?? 0;
      const bgImage = clip.background?.imageAssetId ? env.getImage(clip.background.imageAssetId) : null;
      const mask = blur > 0 || bgImage ? env.getMask?.(clip.assetId, frame.time ?? src) : null;
      // automatic picture correction: the same filter in the browser and in the export
      const look = clip.look ? lookFilter(clip.look) : "none";
      let composite: Drawable | undefined;
      if ((blur > 0 || bgImage) && mask && env.scratch) {
        // composed off-screen so the face bubble can show the same blurred / AI background
        const comp = env.scratch("main-composite", W, H);
        comp.ctx.clearRect(0, 0, W, H);
        comp.ctx.imageSmoothingEnabled = true;
        (comp.ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
        drawWithBlurredBackground(comp.ctx, doc, frame, mask, r, blur, env.scratch, look, bgImage, !!clip.background?.despill, clip.background?.imageBlur ?? 0);
        ctx.drawImage(comp.canvas, 0, 0);
        composite = comp.canvas;
      } else {
        ctx.save();
        ctx.filter = look;
        ctx.drawImage(frame.image, r.x, r.y, r.w, r.h);
        ctx.restore();
      }
      drewVideo = true;
      main = { frame, rect: r, look, composite };
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
  // the question as a phone call: the call screen sits on the video, under the question card
  const call = callWindow(doc);
  if (call && doc.callStyle!.mode === "phone" && t >= call.start && t < call.end + CALL_EXIT) drawCallScreen(ctx, doc, doc.callStyle!, t, call, env, main);
  for (const o of doc.overlays) {
    if (o.hidden || env.hideOverlayIds?.has(o.id)) continue;
    if (t < o.start || t >= overlayEnd(o, duration)) continue;
    drawOverlay(ctx, doc, o, t, env, duration, main);
  }
  if (call && doc.callStyle!.mode === "bar" && t >= call.start && t < call.end + CALL_EXIT) drawCallBar(ctx, doc, doc.callStyle!, t, call, env);
  drawSubtitles(ctx, doc, t);
  // CTA end card after the last frame of the content
  const c0 = endCardStart(doc);
  if (c0 != null && t >= c0) drawEndCard(ctx, doc, t - c0, env);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Question as a phone call
// ---------------------------------------------------------------------------

const CALL_EXIT = 0.5;

/** While the narrator reads the question (until the answer starts). */
export function callWindow(doc: EditorDocument): { start: number; end: number } | null {
  const n = doc.narration[0];
  if (!doc.callStyle || !n || n.muted) return null;
  const nEnd = clipEnd(n);
  const listen = doc.clips.find((c) => c.muted && c.start <= n.start + 0.05 && Math.abs(clipEnd(c) - nEnd) < 1.5);
  return { start: Math.max(0, n.start - 0.25), end: listen ? Math.max(nEnd, clipEnd(listen)) : nEnd + 0.15 };
}

/** "Ongoing" call time: starts at a stable odd value per name, so it looks like the call is in progress. */
function callClock(cs: CallStyle, t: number, start: number): string {
  let h = 0;
  for (const ch of cs.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const sec = Math.floor(17 + (h % 140) + (t - start));
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function drawHandset(ctx: Ctx, cx: number, cy: number, s: number, color: string, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = s * 0.26;
  ctx.beginPath();
  ctx.arc(0, s * 0.62, s * 0.78, Math.PI * 1.22, Math.PI * 1.78);
  ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * s * 0.5, s * 0.08, s * 0.2, s * 0.14, sx * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Round avatar: the generated photo, or the system one (grey circle with the initial). */
function drawCallAvatar(ctx: Ctx, cs: CallStyle, cx: number, cy: number, r: number, env: RenderEnv, th: ThemeTokens) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const img = cs.avatarAssetId ? env.getImage(cs.avatarAssetId) : null;
  if (img) {
    const k = Math.max((2 * r) / img.width, (2 * r) / img.height);
    ctx.drawImage(img.image, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
  } else {
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, "#a3a8b4");
    g.addColorStop(1, "#7d838f");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontString(600, r * 0.95, resolveFont("$label", th));
    ctx.fillText((cs.name.trim()[0] ?? "?").toUpperCase(), cx, cy + r * 0.04);
  }
  ctx.restore();
}

/** In-call pill at the top (like the iPhone's Dynamic Island); after the question it flies up and fades. */
/** Where the call bar is (output pixels): bar.x = centre, bar.y = top edge (0–1), bar.scale = size. */
export function callBarRect(doc: Pick<EditorDocument, "width" | "height">, cs: CallStyle): { x: number; y: number; w: number; h: number; scale: number } {
  const u = unit(doc);
  const scale = Math.min(1.6, Math.max(0.5, cs.bar?.scale ?? 1));
  const w = 920 * u * scale;
  const h = 128 * u * scale;
  const cx = (cs.bar?.x ?? 0.5) * doc.width;
  const top = cs.bar?.y != null ? cs.bar.y * doc.height : 20 * u;
  return { x: cx - w / 2, y: top, w, h, scale };
}

export function drawCallBar(ctx: Ctx, doc: EditorDocument, cs: CallStyle, t: number, win: { start: number; end: number }, env: RenderEnv) {
  const u = unit(doc);
  const th = doc.theme;
  const inK = Math.min(1, Math.max(0, (t - win.start) / 0.35));
  const outK = t <= win.end ? 0 : Math.min(1, (t - win.end) / CALL_EXIT);
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const alpha = (env.settled ? 1 : ease(inK)) * (1 - ease(outK));
  if (alpha <= 0.001) return;
  // drawn at its base size around (0,0), then placed and scaled where the editor put it
  const R = callBarRect(doc, cs);
  const w = 920 * u;
  const h = 128 * u;
  const x = 0;
  const y = 0;
  const dy = -(1 - ease(inK)) * 60 * u - ease(outK) * Math.max(230 * u, R.y + R.h + 40 * u);
  ctx.save();
  ctx.translate(R.x, R.y + dy);
  ctx.scale(R.scale, R.scale);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 30 * u;
  ctx.fillStyle = "rgba(10,10,12,0.96)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  const ar = 46 * u;
  const acx = x + 22 * u + ar;
  const acy = y + h / 2;
  drawCallAvatar(ctx, cs, acx, acy, ar, env, th);
  // green call badge on the avatar
  ctx.fillStyle = "#30d158";
  ctx.beginPath();
  ctx.arc(acx + ar * 0.72, acy + ar * 0.72, 21 * u, 0, Math.PI * 2);
  ctx.fill();
  drawHandset(ctx, acx + ar * 0.72, acy + ar * 0.72, 17 * u, "#ffffff");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = fontString(600, 40 * u, resolveFont("$label", th));
  const tx = acx + ar + 30 * u;
  ctx.fillText(cs.name, tx, y + h * 0.47);
  ctx.fillStyle = "rgba(235,235,245,0.6)";
  ctx.font = fontString(500, 31 * u, resolveFont("$label", th));
  ctx.fillText(callClock(cs, t, win.start), tx, y + h * 0.8);
  // the caller is speaking: a small live waveform on the right
  const bars = 5;
  const bw = 9 * u;
  const gap = 9 * u;
  const bx = x + w - 60 * u - bars * (bw + gap);
  for (let i = 0; i < bars; i++) {
    const a = t <= win.end ? 0.35 + 0.65 * Math.abs(Math.sin(t * 7.3 + i * 1.7) * Math.cos(t * 3.1 + i)) : 0.2;
    const bh = (14 + 46 * a) * u;
    ctx.fillStyle = "#30d158";
    roundRect(ctx, bx + i * (bw + gap), y + (h - bh) / 2, bw, bh, bw / 2);
    ctx.fill();
  }
  ctx.restore();
}

const CALL_BUTTONS: Array<[string, (ctx: Ctx, cx: number, cy: number, s: number) => void]> = [
  ["wycisz", (c, x, y, s) => {
    roundRect(c, x - s * 0.16, y - s * 0.42, s * 0.32, s * 0.55, s * 0.16);
    c.fill();
    c.beginPath();
    c.arc(x, y - s * 0.05, s * 0.3, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.beginPath();
    c.moveTo(x, y + s * 0.25);
    c.lineTo(x, y + s * 0.42);
    c.moveTo(x - s * 0.42, y - s * 0.5);
    c.lineTo(x + s * 0.42, y + s * 0.42);
    c.stroke();
  }],
  ["klawiatura", (c, x, y, s) => {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        c.beginPath();
        c.arc(x + i * s * 0.32, y + j * s * 0.32, s * 0.1, 0, Math.PI * 2);
        c.fill();
      }
  }],
  ["głośnik", (c, x, y, s) => {
    c.beginPath();
    c.moveTo(x - s * 0.45, y - s * 0.14);
    c.lineTo(x - s * 0.25, y - s * 0.14);
    c.lineTo(x - s * 0.02, y - s * 0.36);
    c.lineTo(x - s * 0.02, y + s * 0.36);
    c.lineTo(x - s * 0.25, y + s * 0.14);
    c.lineTo(x - s * 0.45, y + s * 0.14);
    c.closePath();
    c.fill();
    for (const r of [0.2, 0.36]) {
      c.beginPath();
      c.arc(x + s * 0.02, y, s * r, -0.3 * Math.PI, 0.3 * Math.PI);
      c.stroke();
    }
  }],
  ["dodaj", (c, x, y, s) => {
    c.beginPath();
    c.moveTo(x - s * 0.36, y);
    c.lineTo(x + s * 0.36, y);
    c.moveTo(x, y - s * 0.36);
    c.lineTo(x, y + s * 0.36);
    c.stroke();
  }],
  ["FaceTime", (c, x, y, s) => {
    roundRect(c, x - s * 0.44, y - s * 0.24, s * 0.58, s * 0.48, s * 0.1);
    c.fill();
    c.beginPath();
    c.moveTo(x + s * 0.18, y - s * 0.06);
    c.lineTo(x + s * 0.44, y - s * 0.24);
    c.lineTo(x + s * 0.44, y + s * 0.24);
    c.lineTo(x + s * 0.18, y + s * 0.06);
    c.closePath();
    c.fill();
  }],
  ["kontakty", (c, x, y, s) => {
    c.beginPath();
    c.arc(x, y, s * 0.44, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(x, y - s * 0.1, s * 0.15, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(x, y + s * 0.34, s * 0.26, Math.PI * 1.15, Math.PI * 1.85);
    c.stroke();
  }],
];

/** Full-screen phone call while the question is read; the expert's face in a circle; it slides away after. */
export function drawCallScreen(ctx: Ctx, doc: EditorDocument, cs: CallStyle, t: number, win: { start: number; end: number }, env: RenderEnv, main: MainVideo | null) {
  const W = doc.width;
  const H = doc.height;
  const u = unit(doc);
  const th = doc.theme;
  const inK = Math.min(1, Math.max(0, (t - win.start) / 0.3));
  const outK = t <= win.end ? 0 : Math.min(1, (t - win.end) / CALL_EXIT);
  const ease = (x: number) => 1 - Math.pow(1 - x, 3);
  const alpha = (env.settled ? 1 : ease(inK)) * (1 - ease(outK));
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, -ease(outK) * H * 0.25);
  // background: the caller's photo heavily blurred and darkened, or a dark gradient
  const img = cs.avatarAssetId ? env.getImage(cs.avatarAssetId) : null;
  if (img && env.scratch) ctx.drawImage(blurredPlate(img, 100, W, H, env.scratch), 0, 0, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a3f47");
    g.addColorStop(0.55, "#1f2329");
    g.addColorStop(1, "#13161b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = fontString(500, 86 * u, resolveFont("$label", th));
  // below the question card at the top
  ctx.fillText(cs.name, W / 2, H * 0.245);
  ctx.fillStyle = "rgba(235,235,245,0.7)";
  ctx.font = fontString(500, 40 * u, resolveFont("$label", th));
  ctx.fillText(callClock(cs, t, win.start), W / 2, H * 0.245 + 66 * u);
  // the buttons
  const r = 96 * u;
  CALL_BUTTONS.forEach(([label, icon], i) => {
    const cx = W / 2 + ((i % 3) - 1) * 300 * u;
    const cy = H * (i < 3 ? 0.585 : 0.735);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 7 * u;
    ctx.lineCap = "round";
    icon(ctx, cx, cy, 90 * u);
    ctx.font = fontString(500, 32 * u, resolveFont("$label", th));
    ctx.fillText(label, cx, cy + r + 46 * u);
  });
  // end call
  ctx.fillStyle = "#ff3b30";
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.88, 100 * u, 0, Math.PI * 2);
  ctx.fill();
  drawHandset(ctx, W / 2, H * 0.88 + 6 * u, 70 * u, "#ffffff", Math.PI * 0.75);
  ctx.restore();
  // the expert's face, like a picture-in-picture during the call
  if (main) {
    ctx.save();
    ctx.globalAlpha = alpha;
    drawFaceBubble(ctx, doc, cs.bubble ?? CALL_BUBBLE, main);
    ctx.restore();
  }
}

export const CALL_BUBBLE = { x: 0.5, y: 0.415, size: 0.28, zoom: DEFAULT_BUBBLE.zoom, fy: DEFAULT_BUBBLE.fy };
