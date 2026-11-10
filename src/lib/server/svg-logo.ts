/**
 * Logos uploaded as SVG: checked for active content, then drawn to a PNG (the creatives, videos
 * and exports use bitmaps; an SVG is never served back). From one SVG the other-background version
 * can be made by swapping its light and dark colours (white ↔ the theme's dark colour).
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { HttpError } from "./errors";

const COLOR = /(fill|stroke)\s*(=\s*"|:\s*)(#[0-9a-f]{3,8}|white|black)\b/gi;

/** an SVG with scripts, event handlers, external references or embedded HTML is refused */
export function assertSafeSvg(svg: string) {
  if (!/<svg[\s>]/i.test(svg)) throw new HttpError(415, "To nie jest plik SVG");
  if (/<script|<foreignObject|\son\w+\s*=|javascript:|<!ENTITY|(?:xlink:)?href\s*=\s*"(?!#)/i.test(svg)) throw new HttpError(415, "SVG zawiera skrypty lub odwołania zewnętrzne — zapisz je jako zwykłą grafikę");
}

function hexOf(c: string) {
  const v = c.toLowerCase();
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  if (/^#[0-9a-f]{3,4}$/.test(v)) return `#${v.slice(1, 4).split("").map((x) => x + x).join("")}`;
  return v.slice(0, 7);
}
function lum(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** "light": made for light backgrounds (dark colours); "dark": for dark backgrounds (white) */
export function svgTone(svg: string): "light" | "dark" {
  let white = 0;
  let darkC = 0;
  for (const m of svg.matchAll(COLOR)) {
    const l = lum(hexOf(m[3]));
    if (l > 0.8) white++;
    else if (l < 0.2) darkC++;
  }
  return white > darkC ? "dark" : "light";
}

/** the version for the other background: white parts → `darkColor` (or dark parts → white); accents stay */
export function swapTone(svg: string, darkColor: string): string {
  const tone = svgTone(svg);
  return svg.replace(COLOR, (all, prop: string, sep: string, c: string) => {
    const l = lum(hexOf(c));
    if (tone === "dark" && l > 0.8) return `${prop}${sep}${darkColor}`;
    if (tone === "light" && l < 0.2) return `${prop}${sep}#FFFFFF`;
    return all;
  });
}

/** the SVG drawn at `targetW` px wide (its own proportions) → PNG */
export async function svgToPng(svg: string, targetW = 1600): Promise<Buffer> {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const vb = open.match(/viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const wAttr = open.match(/\swidth\s*=\s*"([\d.]+)/i);
  const hAttr = open.match(/\sheight\s*=\s*"([\d.]+)/i);
  const w0 = Number(vb?.[1] ?? wAttr?.[1] ?? 0);
  const h0 = Number(vb?.[2] ?? hAttr?.[1] ?? 0);
  if (!(w0 > 0 && h0 > 0)) throw new HttpError(415, "SVG nie ma rozmiaru (viewBox lub width/height)");
  const W = targetW;
  const H = Math.max(1, Math.round((targetW * h0) / w0));
  const sized = open.replace(/\s(width|height)\s*=\s*"[^"]*"/gi, "").replace(/<svg\b/i, `<svg width="${W}" height="${H}"`) + svg.slice(svg.indexOf(open) + open.length);
  const fixed = vb ? sized : sized.replace(/<svg\b/i, `<svg viewBox="0 0 ${w0} ${h0}"`);
  const img = await loadImage(Buffer.from(fixed));
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(img, 0, 0, W, H);
  return c.toBuffer("image/png");
}
