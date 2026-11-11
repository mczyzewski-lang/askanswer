/**
 * Typo animations — kinetic typography drawn by the shared compositor (the same frames in the
 * Studio preview and in the export). Every preset takes its colours and fonts from the project's
 * theme; the accent shape ("motif") is the brand's: three steps going up to the right (the Nowy
 * Etap logo) or a plain bar.
 *
 * Text markup: a new line or "|" starts a new line / step; *word* is drawn in the accent colour.
 */
import type { EditorDocument, TypoOverlay } from "../editor/types";
import { fontString, luminance, resolveColor, resolveFont, roundRect, unit, type Ctx } from "./compositor";

export const TYPO_PRESETS: Array<{ key: TypoOverlay["preset"]; label: string; hint: string; sample: string; sub?: string; box: { x: number; y: number; w: number; h: number }; size: number; seconds: number; plate?: boolean }> = [
  { key: "stairTitle", label: "Schodki: tytuł", hint: "Schodki rysują się jak w logo, linie tekstu wjeżdżają po kolei", sample: "Najpierw *plan*\npotem pozew", sub: "Rozwód krok po kroku", box: { x: 0.07, y: 0.26, w: 0.86, h: 0.24 }, size: 124, seconds: 4 },
  { key: "stairSteps", label: "Schodki: trzy kroki", hint: "Kroki procesu rosną jak stopnie w prawo (rozdziel |)", sample: "Plan | Ustalenia | Pozew", box: { x: 0.06, y: 0.22, w: 0.88, h: 0.3 }, size: 62, seconds: 5 },
  { key: "stairWipe", label: "Przejście schodkowe", hint: "Trzy pasy zasłaniają kadr schodkami, w środku tytuł, potem odsłaniają dalszy ciąg", sample: "Krok *drugi*", sub: "Ustalenia", box: { x: 0, y: 0, w: 1, h: 1 }, size: 150, seconds: 2.2 },
  { key: "kinetic", label: "Słowo po słowie", hint: "Każde słowo wskakuje osobno, *wyróżnione* w kolorze akcentu", sample: "Rozwód bez *walki* w sądzie", box: { x: 0.06, y: 0.27, w: 0.88, h: 0.22 }, size: 140, seconds: 3.5 },
  { key: "curtain", label: "Kurtyna", hint: "Złoty pas przejeżdża przez linię i odsłania tekst", sample: "Cena znana\n*z góry*", box: { x: 0.07, y: 0.28, w: 0.86, h: 0.2 }, size: 132, seconds: 3.5 },
  { key: "underline", label: "Podkreślenie", hint: "Tekst wjeżdża, potem rysuje się odręczne podkreślenie", sample: "Porozumienie zamiast *sporu*", box: { x: 0.06, y: 0.28, w: 0.88, h: 0.2 }, size: 120, seconds: 3.5 },
  { key: "stamp", label: "Plakietka", hint: "Krótka etykieta z motywem marki, wskakuje z odbiciem", sample: "Bezpłatny webinar", box: { x: 0.12, y: 0.13, w: 0.76, h: 0.06 }, size: 52, seconds: 4 },
];

/** the brand motif of a theme: the steps for Nowy Etap, else a bar */
export function defaultMotif(themeName: string | null | undefined): NonNullable<TypoOverlay["motif"]> {
  return /nowy\s*etap/i.test(themeName ?? "") ? "stairs" : "bar";
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const outCubic = (p: number) => 1 - Math.pow(1 - clamp(p), 3);
const inOutCubic = (p: number) => ((p = clamp(p)) < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const outBack = (p: number) => ((p = clamp(p)) >= 1 ? 1 : 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2));
/** progress of a part that starts at `from` seconds and lasts `len` */
const seg = (lt: number, from: number, len: number) => clamp((lt - from) / len);

interface Word {
  t: string;
  acc: boolean;
}
/** lines of words; *x* marks accent words (the mark may span several words) */
export function parseTypo(text: string): Word[][] {
  let acc = false;
  return text
    .split(/\n|\|/)
    .map((line) => {
      const out: Word[] = [];
      for (const raw of line.trim().split(/\s+/).filter(Boolean)) {
        let w = raw;
        const opens = w.startsWith("*");
        if (opens) w = w.slice(1);
        const closes = /\*[.,!?:;…]*$/.test(w);
        const tail = closes ? w.slice(w.lastIndexOf("*") + 1) : "";
        if (closes) w = w.slice(0, w.lastIndexOf("*"));
        if (opens) acc = true;
        if (w) out.push({ t: w + tail, acc });
        if (closes) acc = false;
      }
      return out;
    })
    .filter((l) => l.length);
}

function wrapWords(ctx: Ctx, lines: Word[][], maxW: number): Word[][] {
  const out: Word[][] = [];
  const space = ctx.measureText(" ").width;
  for (const line of lines) {
    let cur: Word[] = [];
    let w = 0;
    for (const word of line) {
      const ww = ctx.measureText(word.t).width;
      if (cur.length && w + space + ww > maxW) {
        out.push(cur);
        cur = [];
        w = 0;
      }
      w += (cur.length ? space : 0) + ww;
      cur.push(word);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

interface Laid {
  size: number;
  lineH: number;
  lines: Array<{ words: Array<Word & { x: number; w: number }>; w: number }>;
  w: number;
  h: number;
}
/** the text wrapped at the largest size (≤ start) at which it fits the box */
function layout(ctx: Ctx, text: string, family: string, weight: number, start: number, maxW: number, maxH: number, wrap = true): Laid {
  const src = parseTypo(text);
  for (let size = start; ; size *= 0.94) {
    ctx.font = fontString(weight, size, family);
    const rows = wrap ? wrapWords(ctx, src, maxW) : src;
    const space = ctx.measureText(" ").width;
    const lineH = size * 1.12;
    const lines = rows.map((row) => {
      let x = 0;
      const words = row.map((wd) => {
        const w = ctx.measureText(wd.t).width;
        const o = { ...wd, x, w };
        x += w + space;
        return o;
      });
      return { words, w: Math.max(0, x - space) };
    });
    const w = Math.max(0, ...lines.map((l) => l.w));
    const h = lines.length * lineH;
    if ((w <= maxW + 0.5 && h <= maxH + 0.5) || size <= start * 0.3) return { size, lineH, lines, w, h };
  }
}

/** three steps going up to the right (the Nowy Etap mark), drawn progressively; or a bar */
function drawMotif(ctx: Ctx, motif: TypoOverlay["motif"], x: number, y: number, w: number, h: number, p: number, color: string, thick: number) {
  if (p <= 0 || motif === "none") return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  if (motif !== "stairs") {
    // a vertical bar growing upwards
    const hh = h * outCubic(p);
    ctx.fillRect(x + w / 2 - thick / 2, y + h - hh, thick, hh);
    ctx.restore();
    return;
  }
  // bottom-left → top-right: run, rise, run, rise, run
  const pts: Array<[number, number]> = [
    [x, y + h],
    [x + w * 0.4, y + h],
    [x + w * 0.4, y + h * 0.5],
    [x + w * 0.7, y + h * 0.5],
    [x + w * 0.7, y],
    [x + w, y],
  ];
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let left = total * inOutCubic(p);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < lens.length && left > 0; i++) {
    const k = Math.min(1, left / lens[i]);
    ctx.lineTo(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k);
    left -= lens[i];
  }
  ctx.stroke();
  ctx.restore();
}

function shadowOn(ctx: Ctx, u: number, on: boolean) {
  ctx.shadowColor = on ? "rgba(0,0,0,0.5)" : "transparent";
  ctx.shadowBlur = on ? 14 * u : 0;
  ctx.shadowOffsetY = on ? 3 * u : 0;
}

/** one laid-out line; each word drawn through `each` (which may transform / clip it) */
function drawLine(ctx: Ctx, l: Laid["lines"][number], x: number, y: number, ink: string, accent: string, each?: (i: number, draw: () => void, wx: number, ww: number) => void, from = 0) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  l.words.forEach((wd, i) => {
    const draw = () => {
      ctx.fillStyle = wd.acc ? accent : ink;
      ctx.fillText(wd.t, x + wd.x, y);
    };
    if (each) each(from + i, draw, x + wd.x, wd.w);
    else draw();
  });
}

/**
 * Draw a typo animation at timeline time `t`. `settled` (paused editor): the finished state, so the
 * layer can be placed and edited — except the transition, which always shows its real frame.
 */
export function drawTypo(ctx: Ctx, doc: EditorDocument, o: TypoOverlay, t: number, duration: number, settled = false) {
  const W = doc.width;
  const H = doc.height;
  const u = unit(doc);
  const end = o.end == null ? duration : o.end;
  const speed = clamp(o.speed ?? 1, 0.4, 2.5);
  const lt = settled && o.preset !== "stairWipe" ? 99 : Math.max(0, t - o.start) * speed;
  // the exit: 0.35 s before the end
  const out = settled || o.end == null ? 1 : clamp((end - t) / 0.35);
  const R = { x: o.x * W, y: o.y * H, w: o.w * W, h: o.h * H };
  const theme = doc.theme;
  const accent = resolveColor(o.accent ?? "$accent", theme);
  const plateC = resolveColor(o.plateColor ?? "$background", theme);
  const plate = !!o.plate;
  // on a plate: the theme's text colour when it reads on it; on the video: white with a shadow
  const ink = resolveColor(o.color ?? (plate ? (Math.abs(luminance(theme.text) - luminance(plateC)) > 0.3 ? "$text" : luminance(plateC) > 0.5 ? "#111111" : "#FFFFFF") : "#FFFFFF"), theme);
  const family = resolveFont("$question", theme);
  const subFamily = resolveFont("$subtitle", theme);
  const motif = o.motif ?? defaultMotif(theme.name);
  const size = Math.max(12, o.size) * u;
  const centre = (o.align ?? "left") === "center";

  ctx.save();
  if (o.preset !== "stairWipe") {
    ctx.globalAlpha *= outCubic(out);
    ctx.translate(0, -(1 - outCubic(out)) * 24 * u);
  }

  switch (o.preset) {
    case "stairTitle": {
      const pad = plate ? 28 * u : 0;
      const subSize = size * 0.42;
      const subH = o.sub?.trim() ? subSize * 1.5 : 0;
      const mw0 = R.h * 0.42;
      const L = layout(ctx, o.text, family, 800, size, R.w - pad * 2 - (motif === "none" ? 0 : mw0 + 26 * u), R.h - pad * 2 - subH);
      const blockH = L.h + subH;
      const mh = Math.min(blockH, L.h);
      const mw = motif === "none" ? 0 : motif === "stairs" ? mh * 0.62 : 10 * u;
      const gap = motif === "none" ? 0 : 26 * u;
      const bw = mw + gap + Math.max(L.w, 1);
      const x0 = centre ? R.x + (R.w - bw) / 2 : R.x + pad;
      const y0 = R.y + (R.h - blockH) / 2;
      if (plate) {
        const k = outCubic(seg(lt, 0, 0.35));
        ctx.save();
        ctx.globalAlpha *= 0.9 * k;
        ctx.fillStyle = plateC;
        roundRect(ctx, x0 - pad, y0 - pad, (bw + pad * 2) * k, blockH + pad * 2, 22 * u);
        ctx.fill();
        ctx.restore();
      }
      drawMotif(ctx, motif, x0, y0 + L.lineH * 0.14, mw, mh - L.lineH * 0.28, seg(lt, 0.05, 0.6), accent, Math.max(6 * u, L.size * 0.11));
      shadowOn(ctx, u, !plate);
      ctx.font = fontString(800, L.size, family);
      L.lines.forEach((l, i) => {
        // each line rises out of its own baseline (masked)
        const p = outCubic(seg(lt, 0.22 + i * 0.13, 0.45));
        if (p <= 0) return;
        const top = y0 + i * L.lineH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + mw + gap - 20 * u, top - L.lineH * 0.1, L.w + 60 * u, L.lineH * 1.2);
        ctx.clip();
        ctx.globalAlpha *= Math.min(1, p * 1.5);
        drawLine(ctx, l, x0 + mw + gap, top + L.lineH * 0.82 + (1 - p) * L.lineH, ink, accent);
        ctx.restore();
      });
      if (subH) {
        const p = outCubic(seg(lt, 0.3 + L.lines.length * 0.13, 0.4));
        ctx.globalAlpha *= p;
        ctx.font = fontString(600, subSize, subFamily);
        ctx.fillStyle = accent;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(o.sub!.trim(), x0 + mw + gap + (1 - p) * -18 * u, y0 + L.h + subSize * 1.15);
      }
      break;
    }

    case "stairSteps": {
      const items = parseTypo(o.text).slice(0, 4);
      const n = Math.max(1, items.length);
      const gap = 10 * u;
      const cw = (R.w - gap * (n - 1)) / n;
      const minH = R.h * 0.5;
      const dark = luminance(plateC) < 0.5;
      const label = dark ? "#FFFFFF" : "#111111";
      items.forEach((words, i) => {
        const full = minH + ((R.h - minH) * i) / Math.max(1, n - 1 || 1);
        const hFull = n === 1 ? R.h : full;
        const p = outBack(seg(lt, 0.08 + i * 0.2, 0.55));
        if (p <= 0) return;
        const h = hFull * p;
        const x = R.x + i * (cw + gap);
        const y = R.y + R.h - h;
        // the riser (plate) and its gold tread
        ctx.save();
        ctx.globalAlpha *= 0.94;
        ctx.fillStyle = plateC;
        roundRect(ctx, x, y, cw, h, 14 * u);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = accent;
        roundRect(ctx, x, y, cw, Math.max(8 * u, size * 0.2), 6 * u);
        ctx.fill();
        const q = outCubic(seg(lt, 0.3 + i * 0.2, 0.4));
        if (q <= 0) return;
        ctx.save();
        ctx.globalAlpha *= q;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        const pad = 16 * u;
        const numSize = Math.min(size * 1.5, hFull * 0.36);
        ctx.font = fontString(800, numSize, family);
        ctx.fillStyle = accent;
        ctx.fillText(String(i + 1), x + pad, y + size * 0.26 + numSize * 1.02);
        const txt = words.map((w) => (w.acc ? `*${w.t}*` : w.t)).join(" ");
        const Lb = layout(ctx, txt, family, 700, Math.min(size, hFull * 0.3), cw - pad * 2, hFull - numSize * 1.2 - pad * 1.6);
        ctx.font = fontString(700, Lb.size, family);
        Lb.lines.forEach((l, k) => drawLine(ctx, l, x + pad, y + size * 0.26 + numSize * 1.2 + (k + 0.85) * Lb.lineH, label, accent));
        ctx.restore();
      });
      break;
    }

    case "stairWipe": {
      // real time (not `settled`): cover in 0.5 s, hold with the title, uncover in the last 0.5 s
      const local = Math.max(0, t - o.start);
      const total = Math.max(1.2, end - o.start);
      const inLen = Math.min(0.5, total / 3) / speed;
      const outLen = inLen;
      const cover = clamp(local / inLen); // bands arriving from the left
      const leave = clamp((local - (total - outLen)) / outLen); // bands leaving to the right
      const bands = 3;
      const bh = H / bands;
      const lag = 0.22;
      for (let k = 0; k < bands; k++) {
        // the bottom band leads: the edge is a staircase going up to the right
        const order = bands - 1 - k;
        const a = inOutCubic(clamp((cover - order * lag) / (1 - lag * (bands - 1))));
        const b = inOutCubic(clamp((leave - order * lag) / (1 - lag * (bands - 1))));
        const x0 = b * W;
        const x1 = a * W;
        if (x1 <= x0) continue;
        ctx.fillStyle = plateC;
        ctx.fillRect(x0, k * bh - 1, x1 - x0, bh + 2);
        // the gold leading and trailing edges
        ctx.fillStyle = accent;
        const e = Math.max(8 * u, W * 0.012);
        if (a < 1) ctx.fillRect(x1 - e, k * bh - 1, e, bh + 2);
        if (b > 0) ctx.fillRect(x0, k * bh - 1, e, bh + 2);
      }
      // the title while the frame is covered
      const tp = outCubic(clamp((local - inLen * 0.7) / 0.4)) * (1 - clamp(leave * 2.2));
      if (tp > 0 && o.text.trim()) {
        const subSize = size * 0.4;
        const subH = o.sub?.trim() ? subSize * 1.6 : 0;
        const L = layout(ctx, o.text, family, 800, size, W * 0.8, H * 0.4);
        const ms = L.size * 0.9;
        const blockH = ms + 24 * u + L.h + subH;
        let y = (H - blockH) / 2;
        const tInk = luminance(plateC) < 0.5 ? "#FFFFFF" : "#111111";
        ctx.save();
        ctx.globalAlpha *= tp;
        drawMotif(ctx, motif, W / 2 - (ms * 0.62) / 2, y, ms * 0.62, ms, clamp((local - inLen * 0.6) / 0.6), accent, Math.max(6 * u, L.size * 0.11));
        y += ms + 24 * u;
        ctx.font = fontString(800, L.size, family);
        L.lines.forEach((l, i) => drawLine(ctx, l, (W - l.w) / 2, y + (i + 0.82) * L.lineH + (1 - tp) * 30 * u, tInk, accent));
        if (subH) {
          ctx.font = fontString(600, subSize, subFamily);
          ctx.fillStyle = accent;
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(o.sub!.trim(), W / 2, y + L.h + subSize * 1.2);
        }
        ctx.restore();
      }
      break;
    }

    case "kinetic": {
      const pad = plate ? 26 * u : 0;
      const L = layout(ctx, o.text, family, 800, size, R.w - pad * 2, R.h - pad * 2);
      // nothing marked: the last word carries the accent
      if (!L.lines.some((l) => l.words.some((w) => w.acc))) {
        const last = L.lines[L.lines.length - 1]?.words;
        if (last?.length) last[last.length - 1].acc = true;
      }
      const y0 = R.y + (R.h - L.h) / 2;
      if (plate) {
        ctx.save();
        ctx.globalAlpha *= 0.9 * outCubic(seg(lt, 0, 0.3));
        ctx.fillStyle = plateC;
        roundRect(ctx, R.x + (R.w - L.w) / 2 - pad, y0 - pad, L.w + pad * 2, L.h + pad * 2, 22 * u);
        ctx.fill();
        ctx.restore();
      }
      shadowOn(ctx, u, !plate);
      ctx.font = fontString(800, L.size, family);
      let idx = 0;
      L.lines.forEach((l, i) => {
        const x = centre || !o.align ? R.x + (R.w - l.w) / 2 : R.x + pad;
        drawLine(
          ctx,
          l,
          x,
          y0 + (i + 0.82) * L.lineH,
          ink,
          accent,
          (k, draw, wx, ww) => {
            const p = seg(lt, 0.05 + k * 0.11, 0.34);
            if (p <= 0) return;
            const s = 0.55 + 0.45 * outBack(p);
            const cx = wx + ww / 2;
            const cy = y0 + (i + 0.5) * L.lineH;
            ctx.save();
            ctx.globalAlpha *= Math.min(1, p * 2.2);
            ctx.translate(cx, cy + (1 - outCubic(p)) * 26 * u);
            ctx.scale(s, s);
            ctx.translate(-cx, -cy);
            draw();
            ctx.restore();
          },
          idx,
        );
        idx += l.words.length;
      });
      break;
    }

    case "curtain": {
      const L = layout(ctx, o.text, family, 800, size, R.w, R.h);
      const y0 = R.y + (R.h - L.h) / 2;
      ctx.font = fontString(800, L.size, family);
      L.lines.forEach((l, i) => {
        const x = centre ? R.x + (R.w - l.w) / 2 : R.x;
        const top = y0 + i * L.lineH;
        const padX = 14 * u;
        const a = inOutCubic(seg(lt, i * 0.14, 0.3)); // the bar grows
        const b = inOutCubic(seg(lt, 0.3 + i * 0.14, 0.34)); // then leaves to the right, the text stays
        if (a <= 0) return;
        const bx = x - padX;
        const bw = l.w + padX * 2;
        if (b > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(bx, top, bw * b, L.lineH);
          ctx.clip();
          if (plate) {
            ctx.fillStyle = plateC;
            ctx.globalAlpha *= 0.92;
            ctx.fillRect(bx, top + L.lineH * 0.04, bw, L.lineH * 0.96);
            ctx.globalAlpha /= 0.92;
          }
          shadowOn(ctx, u, !plate);
          drawLine(ctx, l, x, top + L.lineH * 0.82, ink, accent);
          ctx.restore();
        }
        if (b < 1) {
          ctx.fillStyle = accent;
          ctx.fillRect(bx + bw * b, top + L.lineH * 0.04, bw * (a - b), L.lineH * 0.96);
        }
      });
      break;
    }

    case "underline": {
      const pad = plate ? 26 * u : 0;
      const L = layout(ctx, o.text, family, 800, size, R.w - pad * 2, R.h - pad * 2 - size * 0.3);
      const y0 = R.y + (R.h - L.h - L.size * 0.3) / 2;
      const p = outCubic(seg(lt, 0, 0.45));
      if (plate) {
        ctx.save();
        ctx.globalAlpha *= 0.9 * p;
        ctx.fillStyle = plateC;
        roundRect(ctx, (centre || !o.align ? R.x + (R.w - L.w) / 2 : R.x) - pad, y0 - pad, L.w + pad * 2, L.h + L.size * 0.3 + pad * 2, 22 * u);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha *= p;
      shadowOn(ctx, u, !plate);
      ctx.font = fontString(800, L.size, family);
      L.lines.forEach((l, i) => drawLine(ctx, l, centre || !o.align ? R.x + (R.w - l.w) / 2 : R.x + pad, y0 + (i + 0.82) * L.lineH + (1 - p) * 28 * u, ink, accent));
      ctx.restore();
      // the hand-drawn stroke under the accent words of the last line (or under the whole line)
      const last = L.lines[L.lines.length - 1];
      if (last) {
        const lx = centre || !o.align ? R.x + (R.w - last.w) / 2 : R.x + pad;
        const marked = last.words.filter((w) => w.acc);
        const from = marked.length ? marked[0].x : 0;
        const to = marked.length ? marked[marked.length - 1].x + marked[marked.length - 1].w : last.w;
        const q = inOutCubic(seg(lt, 0.4, 0.5));
        if (q > 0) {
          const ux = lx + from;
          const uw = (to - from) * q;
          const uy = y0 + L.h + L.size * 0.06;
          ctx.save();
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(5 * u, L.size * 0.085);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(ux, uy + L.size * 0.05);
          ctx.quadraticCurveTo(ux + uw / 2, uy - L.size * 0.07, ux + uw, uy + L.size * 0.02);
          ctx.stroke();
          ctx.restore();
        }
      }
      break;
    }

    case "stamp": {
      const p = seg(lt, 0, 0.45);
      if (p <= 0) break;
      const padX = R.h * 0.45;
      const ms = motif === "none" ? 0 : R.h * 0.42;
      const L = layout(ctx, o.text.replace(/\n|\|/g, " "), resolveFont("$label", theme), 700, Math.min(size, R.h * 0.5), R.w - padX * 2 - (ms ? ms + 14 * u : 0), R.h, false);
      const bw = L.w + padX * 2 + (ms ? ms + 14 * u : 0);
      const bx = centre || !o.align ? R.x + (R.w - bw) / 2 : R.x;
      const cx = bx + bw / 2;
      const cy = R.y + R.h / 2;
      const s = 0.7 + 0.3 * outBack(p);
      ctx.globalAlpha *= Math.min(1, p * 2.5);
      ctx.translate(cx, cy);
      ctx.rotate(((1 - outBack(p)) * -6 * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      // the label: accent plate, dark ink (or the dark plate with the accent motif)
      const fill = plate ? plateC : accent;
      const tInk = luminance(fill) > 0.4 ? resolveColor("$background", theme) : "#FFFFFF";
      ctx.save();
      shadowOn(ctx, u, true);
      ctx.fillStyle = fill;
      roundRect(ctx, bx, R.y, bw, R.h, R.h / 2);
      ctx.fill();
      ctx.restore();
      drawMotif(ctx, motif, bx + padX, cy - ms / 2, ms * 0.8, ms, seg(lt, 0.2, 0.5), plate ? accent : tInk, Math.max(3 * u, ms * 0.16));
      ctx.font = fontString(700, L.size, resolveFont("$label", theme));
      const l = L.lines[0];
      if (l) drawLine(ctx, l, bx + padX + (ms ? ms + 14 * u : 0), cy + L.size * 0.35, tInk, plate ? accent : tInk);
      break;
    }
  }
  ctx.restore();
}
