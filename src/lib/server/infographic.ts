import fsp from "node:fs/promises";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { registerFonts } from "../render/server-render";
import type { ThemeTokens } from "../editor/types";

export interface InfographicData {
  headline: string;
  items: Array<{ value: string; label: string }>;
  note?: string | null;
}

/**
 * Vertical infographic rendered with the theme's own fonts and colours, so Polish text stays crisp
 * (image models garble lettering). Content sits in the middle band: the question box covers the top
 * and the captions the bottom of the video.
 */
const BAND = { top: 0.245, bottom: 0.665 };

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function rgba(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrink the font until the text fits in `maxLines` lines. */
function fit(ctx: SKRSContext2D, text: string, font: (px: number) => string, start: number, min: number, maxWidth: number, maxLines: number) {
  for (let px = start; px >= min; px -= 2) {
    ctx.font = font(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { px, lines };
  }
  ctx.font = font(min);
  return { px: min, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) };
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderInfographic(data: InfographicData, theme: ThemeTokens, out: string, opts: { width?: number; height?: number; background?: string | null } = {}) {
  registerFonts();
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // background: AI illustration (cover) or the theme background with a soft accent glow
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, W, H);
  if (opts.background) {
    const img = await loadImage(await fsp.readFile(opts.background));
    const s = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const g = ctx.createRadialGradient(W * 0.8, H * 0.2, 0, W * 0.8, H * 0.2, W * 1.1);
    g.addColorStop(0, rgba(theme.accent, 0.28));
    g.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const card = theme.primary;
  const ink = contrast(theme.text, card) >= 3 ? theme.text : luminance(card) > 0.4 ? "#111111" : "#FFFFFF";
  const strong = [theme.highlight, theme.accent, ink].find((c) => contrast(c, card) >= 2.6) ?? ink;
  const pad = Math.round(W * 0.065);
  const x = Math.round(W * 0.065);
  const w = W - x * 2;
  const inner = w - pad * 2;
  const qFont = (px: number, weight = 800) => `${weight} ${px}px "${theme.questionFont}", "Inter", sans-serif`;
  const lFont = (px: number, weight = 600) => `${weight} ${px}px "${theme.labelFont}", "Inter", sans-serif`;

  // measure everything first so the card is vertically centred in the band
  const items = data.items.slice(0, 4);
  const head = fit(ctx, data.headline.toUpperCase(), (px) => qFont(px), 66, 40, inner, 3);
  const valueW = Math.round(inner * 0.36);
  const rows = items.map((it) => {
    const v = fit(ctx, it.value, (px) => qFont(px, 800), items.length > 3 ? 64 : 76, 34, valueW, 1);
    const l = fit(ctx, it.label, (px) => lFont(px, 600), 38, 26, inner - valueW - 28, 3);
    const h = Math.max(v.px * 1.1, l.lines.length * l.px * 1.22);
    return { v, l, h };
  });
  const note = data.note ? fit(ctx, data.note, (px) => lFont(px, 500), 28, 22, inner, 2) : null;
  const gap = 30;
  const headH = head.lines.length * head.px * 1.12;
  let h = pad + headH + 26 + rows.reduce((a, r) => a + r.h + gap, 0) + (note ? note.lines.length * note.px * 1.3 + 8 : 0) + pad - gap + 20;
  const bandTop = H * BAND.top;
  const bandH = H * (BAND.bottom - BAND.top);
  h = Math.min(h, bandH);
  const y = Math.round(bandTop + (bandH - h) / 2);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, x, y, w, h, 34);
  ctx.fillStyle = rgba(card, 0.94);
  ctx.fill();
  ctx.restore();

  let cy = y + pad;
  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  ctx.font = qFont(head.px);
  for (const line of head.lines) {
    ctx.fillText(line, x + pad, cy);
    cy += head.px * 1.12;
  }
  // accent rule under the headline
  ctx.fillStyle = theme.accent;
  roundRect(ctx, x + pad, cy + 6, 120, 8, 4);
  ctx.fill();
  cy += 26 + 20;

  rows.forEach((r, i) => {
    ctx.fillStyle = strong;
    ctx.font = qFont(r.v.px, 800);
    ctx.fillText(r.v.lines[0] ?? "", x + pad, cy + (r.h - r.v.px * 1.1) / 2);
    ctx.fillStyle = ink;
    ctx.font = lFont(r.l.px, 600);
    let ly = cy + (r.h - r.l.lines.length * r.l.px * 1.22) / 2;
    for (const line of r.l.lines) {
      ctx.fillText(line, x + pad + valueW + 28, ly);
      ly += r.l.px * 1.22;
    }
    cy += r.h + gap;
    if (i < rows.length - 1) {
      ctx.fillStyle = rgba(ink, 0.18);
      ctx.fillRect(x + pad, cy - gap / 2 - 1, inner, 2);
    }
  });

  if (note) {
    ctx.fillStyle = rgba(ink, 0.75);
    ctx.font = lFont(note.px, 500);
    let ny = cy + 4;
    for (const line of note.lines) {
      ctx.fillText(line, x + pad, ny);
      ny += note.px * 1.3;
    }
  }

  await fsp.writeFile(out, await canvas.encode("png"));
}
