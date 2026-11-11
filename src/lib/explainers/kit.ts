/**
 * Nowy Etap — Explainery: the shared motion kit. Everything is drawn in code on a Canvas 2D context
 * (the same in the browser preview and in the server export, @napi-rs/canvas), as a pure function of
 * time: a frame at `t` never depends on the frames before it, so the timeline can be scrubbed.
 *
 * World: 1080 × 1920 (9:16), 30 fps. Components take a centre point, a scale, an alpha and a progress
 * 0..1; scenes (the reels) only choreograph them over the beat table.
 */
export type C = CanvasRenderingContext2D;
export const W = 1080;
export const H = 1920;
export const FPS = 30;

/** the Nowy Etap reel theme (the colours of the style in use — see `useStyle`) */
export const NE = {
  cream: "#F6F1E8",
  paper: "#FFFDF8",
  line: "#E3DBCD",
  ink: "#1F3330",
  green: "#2A4742",
  gold: "#B79559",
  goldSoft: "#DCC9A3",
  red: "#CF8377",
  redSoft: "#F1D6CF",
  ok: "#7FB08A",
  okSoft: "#D6E7D6",
  muted: "#7C867F",
  /** the closing card: its background and the text on it */
  deep: "#1F3330",
  onDeep: "#F6F1E8",
  font: "DM Sans",
};
type Palette = Omit<typeof NE, "font">;
const EDITORIAL: Palette = { ...NE };

export type StyleKey = "editorial" | "papercut" | "blueprint" | "riso";
/**
 * The same choreography in four looks. A style is a palette plus how the kit draws depth:
 * editorial — soft shadows on a cream page; papercut — stacked sheets of cut paper with crisp
 * shadows and parallax layers behind; blueprint — the architect's plan: thin lines on dark green,
 * a grid, no fills; riso — a two-ink print: flat shapes, a hard gold offset instead of a shadow, grain.
 */
export const STYLES: Array<{ key: StyleKey; label: string; hint: string }> = [
  { key: "editorial", label: "Redakcyjny", hint: "kremowa strona, miękkie cienie" },
  { key: "papercut", label: "Papercut", hint: "warstwy wyciętego papieru z głębią" },
  { key: "blueprint", label: "Plan architekta", hint: "cienkie złote linie na ciemnej zieleni, siatka" },
  { key: "riso", label: "Druk riso", hint: "płaski plakat w dwóch farbach, ziarno" },
];
const PALETTES: Record<StyleKey, Palette> = {
  editorial: EDITORIAL,
  papercut: { ...EDITORIAL, cream: "#EFE6D6", paper: "#FBF6EC", line: "#DDD0BA", goldSoft: "#E2CFA6", redSoft: "#EBC9C0", okSoft: "#CFE0CC" },
  blueprint: { cream: "#17302C", paper: "#1E3B36", line: "#3A5A54", ink: "#F3EDE0", green: "#234540", gold: "#D2B274", goldSoft: "#E6D2A6", red: "#E79C8E", redSoft: "#4A2F2B", ok: "#9AD3A9", okSoft: "#1F4A3F", muted: "#9FB0A9", deep: "#0F2320", onDeep: "#F3EDE0" },
  riso: { ...EDITORIAL, cream: "#F2EBDD", paper: "#FBF7EE", line: "#D9CFBC", ink: "#1B3530", gold: "#C19A4B", goldSoft: "#E3C98F", red: "#D9765F", redSoft: "#F0CFC3", ok: "#5FA57A", okSoft: "#CDE3CF", deep: "#1B3530" },
};
let STYLE: StyleKey = "editorial";
/** choose the look for the frame about to be drawn (every reel calls it first) */
export function useStyle(key: StyleKey | null | undefined) {
  STYLE = key && PALETTES[key] ? key : "editorial";
  Object.assign(NE, PALETTES[STYLE]);
}
export const styleNow = () => STYLE;

/** the depth of an object above the page, the way the style shows it (set before a fill) */
export function depth(c: C, lift = 1) {
  if (STYLE === "papercut") {
    // a sheet lying on another sheet: a crisp, close shadow to the lower right
    c.shadowColor = "rgba(58,44,20,0.34)";
    c.shadowBlur = 5 + 7 * lift;
    c.shadowOffsetX = 5 + 5 * lift;
    c.shadowOffsetY = 9 + 11 * lift;
  } else if (STYLE === "blueprint") {
    c.shadowColor = "rgba(210,178,116,0.22)";
    c.shadowBlur = 22;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
  } else if (STYLE === "riso") {
    // no shadow in print: the second ink, slightly off register
    c.shadowColor = "rgba(193,154,75,0.9)";
    c.shadowBlur = 0;
    c.shadowOffsetX = 9 + 3 * lift;
    c.shadowOffsetY = 9 + 3 * lift;
  } else {
    c.shadowColor = "rgba(43,36,22,0.2)";
    c.shadowBlur = 26 + 30 * lift;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 10 + 22 * lift;
  }
}
/** the outline of a shape in the line-drawing style (call after the fill, same path) */
export function outline(c: C, color?: string, width = 3) {
  if (STYLE !== "blueprint") return;
  c.save();
  c.shadowColor = "transparent";
  c.strokeStyle = color ?? rgba(NE.ink, 0.85);
  c.lineWidth = width;
  c.stroke();
  c.restore();
}

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const ease = {
  out: (p: number) => 1 - Math.pow(1 - clamp(p), 3),
  in: (p: number) => Math.pow(clamp(p), 3),
  inOut: (p: number) => ((p = clamp(p)) < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  /** a soft overshoot (objects settling) */
  back: (p: number) => ((p = clamp(p)) >= 1 ? 1 : 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2)),
  /** slow start and slow stop, gentler than inOut (camera) */
  sine: (p: number) => 0.5 - Math.cos(Math.PI * clamp(p)) / 2,
};
/** progress 0..1 of the span a..b at time t */
export const pr = (t: number, a: number, b: number) => clamp((t - a) / Math.max(1e-6, b - a));
/** 1 inside a..b with soft edges of `f` seconds (appear, hold, disappear) */
export const win = (t: number, a: number, b: number, f = 0.35) => Math.min(ease.out(pr(t, a, a + f)), 1 - ease.in(pr(t, b - f, b)));

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function mix(a: string, b: string, k: number) {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, i) => Math.round(lerp(v, y[i], clamp(k))).toString(16).padStart(2, "0")).join("")}`;
}
export const rgba = (c: string, a: number) => {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${clamp(a)})`;
};

export function rr(c: C, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ------------------------------------------------------------------------------------------ the stage

/** the page of the style; `tint` 0..1 warms it towards the pastel red, `cam` lets the back layers move slower than the scene (parallax) */
export function stage(c: C, opts: { tint?: number; dark?: number; cam?: Cam } = {}) {
  const tint = opts.tint ?? 0;
  const base = mix(mix(NE.cream, NE.redSoft, tint * 0.75), NE.deep, opts.dark ?? 0);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = base;
  c.fillRect(0, 0, W, H);
  const cx = opts.cam?.x ?? W / 2;
  const cy = opts.cam?.y ?? H / 2;
  if (STYLE === "blueprint") {
    // the drawing sheet: a fine grid that scrolls with the camera, heavier every fifth line
    const step = 60;
    const ox = -((cx * 0.5) % step);
    const oy = -((cy * 0.5) % step);
    for (let i = -1; i < W / step + 2; i++) {
      c.fillStyle = rgba(NE.gold, Math.round(i + Math.floor((cx * 0.5) / step)) % 5 === 0 ? 0.16 : 0.07);
      c.fillRect(ox + i * step, 0, 1.5, H);
    }
    for (let j = -1; j < H / step + 2; j++) {
      c.fillStyle = rgba(NE.gold, Math.round(j + Math.floor((cy * 0.5) / step)) % 5 === 0 ? 0.16 : 0.07);
      c.fillRect(0, oy + j * step, W, 1.5);
    }
    // the frame of the sheet and its corner marks
    c.strokeStyle = rgba(NE.gold, 0.4);
    c.lineWidth = 2;
    c.strokeRect(34, 34, W - 68, H - 68);
    for (const [x, y] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
      c.fillStyle = rgba(NE.gold, 0.8);
      c.fillRect(x - 14, y - 1, 28, 2);
      c.fillRect(x - 1, y - 14, 2, 28);
    }
    return;
  }
  if (STYLE === "papercut") {
    // sheets of paper stacked behind the scene, each cut along a soft curve and casting a shadow on
    // the next; the further back, the slower it follows the camera
    const layers: Array<{ col: string; y: number; amp: number; par: number; seed: number }> = [
      { col: mix(mix(NE.goldSoft, NE.cream, 0.45), NE.redSoft, tint * 0.3), y: 0.2, amp: 70, par: 0.05, seed: 1 },
      { col: mix(mix(NE.okSoft, NE.cream, 0.35), NE.redSoft, tint * 0.55), y: 0.44, amp: 90, par: 0.1, seed: 2 },
      { col: mix(mix(NE.goldSoft, NE.cream, 0.7), NE.redSoft, tint * 0.4), y: 0.66, amp: 80, par: 0.17, seed: 3 },
      { col: mix(mix(NE.green, NE.cream, 0.78), NE.redSoft, tint * 0.25), y: 0.84, amp: 60, par: 0.26, seed: 4 },
    ];
    for (const l of layers) {
      const dy = -((cy - H / 2) * l.par) % (H * 0.9);
      const dx = -(cx - W / 2) * l.par;
      c.save();
      c.shadowColor = "rgba(58,44,20,0.26)";
      c.shadowBlur = 22;
      c.shadowOffsetY = -10;
      c.fillStyle = l.col;
      c.beginPath();
      const y0 = H * l.y + dy;
      c.moveTo(-200, H + 400);
      c.lineTo(-200, y0);
      for (let x = -200; x <= W + 200; x += 40) c.lineTo(x, y0 + Math.sin((x + dx) / 210 + l.seed * 1.7) * l.amp + Math.sin((x + dx) / 97 + l.seed) * l.amp * 0.3);
      c.lineTo(W + 200, H + 400);
      c.closePath();
      c.fill();
      c.restore();
    }
  } else if (STYLE === "riso") {
    // a halftone fade in two corners (the print screen)
    for (const [ox, oy, col] of [[W, 0, NE.gold], [0, H, NE.ok]] as const) {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++) {
          const d = Math.hypot(i, j) / 16;
          if (d >= 1) continue;
          c.fillStyle = rgba(col, 0.2);
          c.beginPath();
          c.arc(ox + (ox ? -1 : 1) * (i * 34 + 17), oy + (oy ? -1 : 1) * (j * 34 + 17), 11 * (1 - d), 0, Math.PI * 2);
          c.fill();
        }
    }
  } else {
    // soft light from the top
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba("#FFFFFF", 0.35 * (1 - (opts.dark ?? 0))));
    g.addColorStop(0.5, rgba("#FFFFFF", 0));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  // paper fibres: fixed specks (the same on every frame)
  const r = rng(7);
  for (let i = 0; i < 420; i++) {
    const x = r() * W;
    const y = r() * H;
    const l = 6 + r() * 26;
    c.fillStyle = rgba(r() > 0.5 ? "#FFFFFF" : "#1F3330", 0.018 + r() * 0.02);
    c.fillRect(x, y, l, 1.4);
  }
}

/** a slight film grain (changes every frame) and a soft vignette — drawn last */
export function finish(c: C, t: number, opts: { dark?: number } = {}) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  const r = rng(1000 + Math.round(t * FPS));
  // (the print grain is heavier; the plan has almost none)
  const n = STYLE === "riso" ? 2600 : STYLE === "blueprint" ? 220 : 520;
  for (let i = 0; i < n; i++) {
    c.fillStyle = rgba(r() > 0.5 ? "#FFFFFF" : "#000000", (STYLE === "riso" ? 0.04 : 0.022) + r() * 0.02);
    c.fillRect(r() * W, r() * H, 2.2, 2.2);
  }
  const v = c.createRadialGradient(W / 2, H * 0.48, H * 0.38, W / 2, H * 0.5, H * 0.78);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, rgba(opts.dark ? "#000000" : "#3A2E1E", 0.16));
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}

export interface Cam {
  /** the world point at the centre of the frame */
  x: number;
  y: number;
  /** zoom (1 = the whole world) */
  s: number;
  /** tilt in degrees */
  r?: number;
}
/** the camera between keyframes [time, cam] (slow in, slow out — never a jump) */
export function camAt(t: number, keys: Array<[number, Cam]>): Cam {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b] = keys[i];
      const k = ease.sine(pr(t, t0, t1));
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), s: lerp(a.s, b.s, k), r: lerp(a.r ?? 0, b.r ?? 0, k) };
    }
  }
  return keys[keys.length - 1][1];
}
/** draw the world through the camera; `drift` adds a slow, barely visible float (alive, not static) */
export function camera(c: C, cam: Cam, t: number, fn: () => void, drift = 1) {
  c.save();
  const dx = Math.sin(t * 0.55) * 7 * drift;
  const dy = Math.cos(t * 0.43) * 9 * drift;
  c.translate(W / 2, H / 2);
  c.rotate((((cam.r ?? 0) + Math.sin(t * 0.3) * 0.25 * drift) * Math.PI) / 180);
  c.scale(cam.s, cam.s);
  c.translate(-cam.x + dx, -cam.y + dy);
  fn();
  c.restore();
}

// ------------------------------------------------------------------------------------------- the type

export const font = (size: number, weight = 800) => `${weight} ${Math.round(size * 10) / 10}px "${NE.font}"`;

export function label(c: C, s: string, x: number, y: number, size: number, o: { color?: string; weight?: number; align?: CanvasTextAlign; alpha?: number; track?: number } = {}) {
  if ((o.alpha ?? 1) <= 0.003) return;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.font = font(size, o.weight ?? 800);
  c.fillStyle = o.color ?? NE.ink;
  c.textAlign = o.align ?? "center";
  c.textBaseline = "middle";
  try {
    (c as unknown as { letterSpacing: string }).letterSpacing = `${o.track ?? 0}px`;
  } catch {
    /* cosmetic */
  }
  c.fillText(s, x, y);
  c.restore();
}

export type HeroLine = string | { t: string; color?: string; size?: number; weight?: number };
/**
 * HeroText: 1–3 huge lines, each rising out of its own mask, one after another. `k` 0..1 is the
 * entrance, `out` 0..1 the exit (the lines sink back). Centred on (x, y).
 */
export function hero(c: C, lines: HeroLine[], x: number, y: number, size: number, k: number, o: { color?: string; out?: number; align?: "center" | "left"; lh?: number } = {}) {
  const L = lines.map((l) => (typeof l === "string" ? { t: l } : l));
  const lh = (o.lh ?? 1.08) * size;
  const total = L.reduce((n, l) => n + (l.size ? (l.size / size) * lh : lh), 0);
  let top = y - total / 2;
  L.forEach((l, i) => {
    const sz = l.size ?? size;
    const h = (sz / size) * lh;
    const p = ease.out(clamp(k * (1 + 0.28 * (L.length - 1)) - i * 0.28));
    const q = ease.in(clamp((o.out ?? 0) * (1 + 0.2 * (L.length - 1)) - i * 0.2));
    if (p > 0 && q < 1) {
      c.save();
      c.beginPath();
      // (room above for the accents of capital letters: Ń, Ó, Ź)
      c.rect(0 - W, top - h * 0.3, W * 3, h * 1.34);
      c.clip();
      c.globalAlpha *= Math.min(1, p * 1.6) * (1 - q);
      const ty = top + h / 2 + (1 - p) * h * 0.9 - q * h * 0.7;
      // riso: the second ink printed slightly off; papercut: letters cut out and laid on the page
      if (STYLE === "riso") label(c, l.t, x + sz * 0.045, ty + sz * 0.045, sz, { color: rgba(NE.gold, 0.55), weight: l.weight ?? 800, align: o.align ?? "center", track: -sz * 0.012 });
      if (STYLE === "papercut") {
        c.shadowColor = "rgba(58,44,20,0.3)";
        c.shadowBlur = 3;
        c.shadowOffsetX = sz * 0.02;
        c.shadowOffsetY = sz * 0.045;
      }
      label(c, l.t, x, ty, sz, { color: l.color ?? o.color ?? NE.ink, weight: l.weight ?? 800, align: o.align ?? "center", track: -sz * 0.012 });
      c.restore();
    }
    top += h;
  });
}

// --------------------------------------------------------------------------------------- the objects

export interface DocProps {
  x: number;
  y: number;
  /** width of the sheet (height = 1.36 × width) */
  w?: number;
  rot?: number;
  s?: number;
  alpha?: number;
  title?: string;
  tone?: "plain" | "red" | "green" | "gold";
  /** how high above the desk (bigger = a softer, further shadow) */
  lift?: number;
  /** the text lines write themselves 0..1 */
  write?: number;
  /** washed out (a document that no longer matters) */
  fade?: number;
}
/** Document: a sheet of paper with a title, text lines and a soft shadow */
export function doc(c: C, d: DocProps) {
  const a = d.alpha ?? 1;
  if (a <= 0.003) return;
  const w = d.w ?? 300;
  const h = w * 1.36;
  const tone = d.tone ?? "plain";
  const col = tone === "red" ? NE.red : tone === "green" ? NE.ok : tone === "gold" ? NE.gold : NE.ink;
  const lift = d.lift ?? 1;
  c.save();
  c.translate(d.x, d.y);
  c.rotate(((d.rot ?? 0) * Math.PI) / 180);
  c.scale(d.s ?? 1, d.s ?? 1);
  c.globalAlpha *= a * (1 - (d.fade ?? 0) * 0.72);
  c.save();
  if (STYLE === "papercut") {
    // a second sheet under it, a little askew — paper is never one layer
    c.save();
    depth(c, lift * 0.6);
    c.rotate(0.035);
    c.fillStyle = mix(NE.paper, NE.goldSoft, 0.4);
    rr(c, -w / 2, -h / 2, w, h, w * 0.02);
    c.fill();
    c.restore();
  }
  depth(c, lift);
  c.fillStyle = NE.paper;
  rr(c, -w / 2, -h / 2, w, h, w * (STYLE === "papercut" || STYLE === "riso" ? 0.015 : 0.035));
  c.fill();
  outline(c);
  c.restore();
  // the coloured edge on top
  c.fillStyle = col;
  rr(c, -w / 2, -h / 2, w, w * 0.035, w * 0.02);
  c.fill();
  const pad = w * 0.11;
  if (d.title) label(c, d.title, -w / 2 + pad, -h / 2 + w * 0.2, Math.min(w * 0.125, (w - pad * 2) / (d.title.length * 0.62)), { align: "left", color: tone === "plain" ? NE.ink : mix(col, NE.ink, 0.35), track: 1 });
  c.fillStyle = NE.gold;
  c.fillRect(-w / 2 + pad, -h / 2 + w * 0.3, w * 0.16, w * 0.014);
  const k = d.write ?? 1;
  const rows = [0.92, 0.78, 0.86, 0.6, 0.82, 0.44];
  rows.forEach((f, i) => {
    const p = clamp(k * rows.length - i);
    if (p <= 0) return;
    c.fillStyle = NE.line;
    rr(c, -w / 2 + pad, -h / 2 + w * 0.42 + i * w * 0.115, (w - pad * 2) * f * p, w * 0.04, w * 0.02);
    c.fill();
  });
  c.restore();
}

/** a doc flying along a curve leaves two soft ghosts behind (motion blur) */
export function flying(c: C, at: (k: number) => DocProps, k: number, speed = 1) {
  if (k > 0 && k < 1) for (const [dk, a] of [[0.07, 0.14], [0.035, 0.26]] as const) doc(c, { ...at(Math.max(0, k - dk * speed)), alpha: (at(k).alpha ?? 1) * a, lift: 0.2 });
  doc(c, at(k));
}
/** a point on a quadratic curve */
export const bez = (a: [number, number], m: [number, number], b: [number, number], k: number): [number, number] => [(1 - k) * (1 - k) * a[0] + 2 * (1 - k) * k * m[0] + k * k * b[0], (1 - k) * (1 - k) * a[1] + 2 * (1 - k) * k * m[1] + k * k * b[1]];

/**
 * Court: no columns, no hammer — a calm dark-green portal with one slot the documents go into.
 * `pulse` 0..1: it reacts (something came in / is about to come out).
 */
export function court(c: C, o: { x: number; y: number; s?: number; alpha?: number; pulse?: number; tone?: "ink" | "green"; text?: string }) {
  const a = o.alpha ?? 1;
  if (a <= 0.003) return;
  const s = (o.s ?? 1) * (1 + 0.035 * Math.sin((o.pulse ?? 0) * Math.PI));
  const w = 420;
  const h = 330;
  c.save();
  c.translate(o.x, o.y);
  c.scale(s, s);
  c.globalAlpha *= a;
  c.save();
  depth(c, 1.4);
  const body = STYLE === "blueprint" ? NE.paper : o.tone === "green" ? NE.green : NE.deep;
  c.fillStyle = body;
  rr(c, -w / 2, -h / 2, w, h, STYLE === "riso" ? 8 : 34);
  c.fill();
  outline(c, NE.gold, 4);
  c.restore();
  if (STYLE === "papercut") {
    // the portal cut in three layers, each a step deeper
    for (const [k, col] of [[0.4, mix(body, "#FFFFFF", 0.16)], [0.33, mix(body, "#FFFFFF", 0.08)], [0.26, mix(body, "#000000", 0.18)]] as const) {
      c.save();
      c.shadowColor = "rgba(0,0,0,0.35)";
      c.shadowBlur = 10;
      c.shadowOffsetY = 6;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-w * k, h * 0.5 - 40);
      c.lineTo(-w * k, -h * 0.08);
      c.arc(0, -h * 0.08, w * k, Math.PI, 0);
      c.lineTo(w * k, h * 0.5 - 40);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  // the arch: one thin gold line
  c.strokeStyle = rgba(NE.gold, 0.9);
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(-w * 0.33, h * 0.5 - 40);
  c.lineTo(-w * 0.33, -h * 0.08);
  c.arc(0, -h * 0.08, w * 0.33, Math.PI, 0);
  c.lineTo(w * 0.33, h * 0.5 - 40);
  c.stroke();
  label(c, o.text ?? "SĄD", 0, -h * 0.02, 74, { color: NE.onDeep, track: 10 });
  // the slot
  c.fillStyle = mix(NE.deep, "#000000", 0.45);
  rr(c, -w * 0.24, h * 0.5 - 62, w * 0.48, 16, 8);
  c.fill();
  if (o.pulse) {
    c.fillStyle = rgba(NE.gold, 0.55 * Math.sin(o.pulse * Math.PI));
    rr(c, -w * 0.24, h * 0.5 - 62, w * 0.48, 16, 8);
    c.fill();
  }
  c.restore();
}

/** FlowArrow: a line through the points that draws itself (k 0..1), with an arrow head at its tip */
export function flow(c: C, pts: Array<[number, number]>, k: number, o: { color?: string; width?: number; head?: boolean; alpha?: number; dash?: number[] } = {}) {
  if (k <= 0 || (o.alpha ?? 1) <= 0.003) return;
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let left = total * clamp(k);
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.strokeStyle = o.color ?? NE.ink;
  c.lineWidth = o.width ?? 8;
  c.lineCap = "round";
  c.lineJoin = "round";
  if (o.dash) c.setLineDash(o.dash);
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  let tip = pts[0];
  let dir: [number, number] = [1, 0];
  for (let i = 0; i < lens.length && left > 0; i++) {
    const f = Math.min(1, left / lens[i]);
    tip = [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
    dir = [(pts[i + 1][0] - pts[i][0]) / (lens[i] || 1), (pts[i + 1][1] - pts[i][1]) / (lens[i] || 1)];
    c.lineTo(tip[0], tip[1]);
    left -= lens[i];
  }
  c.stroke();
  c.setLineDash([]);
  if (o.head !== false) {
    const hs = (o.width ?? 8) * 2.6;
    c.fillStyle = o.color ?? NE.ink;
    c.beginPath();
    c.moveTo(tip[0] + dir[0] * hs, tip[1] + dir[1] * hs);
    c.lineTo(tip[0] - dir[1] * hs * 0.62, tip[1] + dir[0] * hs * 0.62);
    c.lineTo(tip[0] + dir[1] * hs * 0.62, tip[1] - dir[0] * hs * 0.62);
    c.closePath();
    c.fill();
  }
  c.restore();
}

/** ProcessNode: a station on a path — a disc that pops in, with its name under it */
export function node(c: C, o: { x: number; y: number; k: number; text: string; tone?: "green" | "red" | "ink" | "gold"; r?: number; size?: number; n?: number; side?: "below" | "right" | "left" | "above"; alpha?: number }) {
  if (o.k <= 0) return;
  const col = o.tone === "red" ? NE.red : o.tone === "ink" ? NE.ink : o.tone === "gold" ? NE.gold : NE.ok;
  const r = (o.r ?? 34) * ease.back(o.k);
  c.save();
  c.globalAlpha *= (o.alpha ?? 1) * Math.min(1, o.k * 2);
  c.fillStyle = NE.paper;
  c.beginPath();
  c.arc(o.x, o.y, r + 10, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = col;
  c.beginPath();
  c.arc(o.x, o.y, r, 0, Math.PI * 2);
  c.fill();
  if (o.n != null) label(c, String(o.n), o.x, o.y + 2, r * 1.05, { color: NE.paper });
  const size = o.size ?? 54;
  const side = o.side ?? "below";
  const p = ease.out(clamp(o.k * 1.6 - 0.5));
  const tx = side === "right" ? o.x + r + 30 : side === "left" ? o.x - r - 30 : o.x;
  const ty = side === "below" ? o.y + r + size * 0.95 : side === "above" ? o.y - r - size * 0.85 : o.y + 2;
  label(c, o.text, tx, ty + (1 - p) * 16, size, { color: o.tone === "red" ? mix(NE.red, NE.ink, 0.45) : NE.ink, align: side === "right" ? "left" : side === "left" ? "right" : "center", alpha: p });
  c.restore();
}

/**
 * LifeArea: a part of life drawn as a small scene on a card (not an icon): children — two small
 * figures between two homes; home — a floor plan; finance — one shared line splitting in two;
 * daily — a week with its days. `k` builds it, `ask` 0..1 puts a question mark on it, `ok` a tick.
 */
export function lifeArea(c: C, kind: "children" | "home" | "finance" | "daily" | "reason", o: { x: number; y: number; w?: number; k: number; text: string; ask?: number; ok?: number; tone?: "plain" | "red" | "green"; alpha?: number; size?: number }) {
  if (o.k <= 0 || (o.alpha ?? 1) <= 0.003) return;
  // drawn on a 400-wide card and scaled, so the little scene grows with the card
  const sc = (o.w ?? 400) / 400;
  const w = 400;
  const h = w * 0.86;
  const k = ease.back(o.k);
  const tone = o.tone ?? "plain";
  c.save();
  c.translate(o.x, o.y);
  c.scale(sc * (0.86 + 0.14 * k), sc * (0.86 + 0.14 * k));
  c.globalAlpha *= (o.alpha ?? 1) * Math.min(1, o.k * 2.2);
  c.save();
  depth(c, 0.8);
  c.fillStyle = tone === "red" ? mix(NE.paper, NE.redSoft, 0.7) : tone === "green" ? mix(NE.paper, NE.okSoft, 0.75) : NE.paper;
  rr(c, -w / 2, -h / 2, w, h, STYLE === "riso" ? 6 : 30);
  c.fill();
  outline(c);
  c.restore();
  const d = ease.out(clamp(o.k * 1.5 - 0.35));
  const ink = NE.ink;
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = 7;
  c.lineCap = "round";
  c.lineJoin = "round";
  const cy = -h * 0.12;
  if (kind === "children") {
    // two homes, two small figures on the line between them
    for (const sx of [-1, 1]) {
      c.strokeStyle = rgba(ink, 0.9);
      c.beginPath();
      c.moveTo(sx * w * 0.36, cy + 46);
      c.lineTo(sx * w * 0.36, cy - 4);
      c.lineTo(sx * w * 0.27, cy - 48 * d);
      c.lineTo(sx * w * 0.18, cy - 4);
      c.lineTo(sx * w * 0.18, cy + 46);
      c.stroke();
    }
    c.strokeStyle = NE.gold;
    c.setLineDash([4, 16]);
    c.beginPath();
    c.moveTo(-w * 0.16, cy + 46);
    c.lineTo(-w * 0.16 + w * 0.32 * d, cy + 46);
    c.stroke();
    c.setLineDash([]);
    for (const [fx, r] of [[-26, 17], [22, 13]] as const) {
      c.fillStyle = NE.gold;
      c.beginPath();
      c.arc(fx, cy - 6 - r, r * d, 0, Math.PI * 2);
      c.fill();
      rr(c, fx - r * 0.9, cy - 2, r * 1.8, (34 + r) * d, r * 0.8);
      c.fill();
    }
  } else if (kind === "home") {
    // a floor plan: outer wall, two inner walls, a door swing
    const pw = w * 0.56;
    const ph = h * 0.42;
    c.strokeStyle = ink;
    c.strokeRect(-pw / 2, cy - ph / 2, pw * d, ph);
    c.beginPath();
    c.moveTo(-pw * 0.1, cy - ph / 2);
    c.lineTo(-pw * 0.1, cy - ph / 2 + ph * 0.62 * d);
    c.moveTo(-pw * 0.1 + 2, cy + ph * 0.12);
    c.lineTo(-pw * 0.1 + pw * 0.6 * d, cy + ph * 0.12);
    c.stroke();
    c.strokeStyle = NE.gold;
    c.beginPath();
    c.arc(-pw / 2, cy + ph / 2, ph * 0.3, -Math.PI / 2, -Math.PI / 2 + (Math.PI / 2) * d);
    c.stroke();
  } else if (kind === "finance") {
    // one shared line that splits in two
    c.strokeStyle = ink;
    c.beginPath();
    c.moveTo(-w * 0.34, cy + 20);
    c.lineTo(-w * 0.34 + w * 0.3 * d, cy + 20);
    c.stroke();
    if (d > 0.45) {
      const e = (d - 0.45) / 0.55;
      for (const [dy, col] of [[-52, NE.gold], [58, ink]] as const) {
        c.strokeStyle = col;
        c.beginPath();
        c.moveTo(-w * 0.04, cy + 20);
        c.quadraticCurveTo(w * 0.08, cy + 20, lerp(-w * 0.04, w * 0.18, e), lerp(cy + 20, cy + 20 + dy, e));
        if (e >= 1) c.lineTo(w * 0.34, cy + 20 + dy);
        c.stroke();
      }
    }
    c.fillStyle = ink;
    c.beginPath();
    c.arc(-w * 0.34, cy + 20, 11, 0, Math.PI * 2);
    c.fill();
  } else if (kind === "daily") {
    // a week: seven days, some marked
    const cw = w * 0.085;
    for (let i = 0; i < 14; i++) {
      const p = clamp(d * 14 - i);
      if (p <= 0) continue;
      const x = -cw * 4 + (i % 7) * cw * 1.16;
      const y = cy - cw * 0.9 + Math.floor(i / 7) * cw * 1.3;
      c.fillStyle = [1, 2, 9, 10, 11].includes(i) ? NE.gold : rgba(ink, 0.16);
      rr(c, x, y, cw * p, cw, 8);
      c.fill();
    }
  } else {
    // the grounds: a paragraph with one line struck
    for (let i = 0; i < 4; i++) {
      c.fillStyle = rgba(ink, 0.2);
      rr(c, -w * 0.3, cy - 50 + i * 30, w * (i === 3 ? 0.34 : 0.6) * d, 12, 6);
      c.fill();
    }
  }
  label(c, o.text, 0, h * 0.32, o.size ?? (o.text.length > 9 ? 44 : 52), { color: ink, track: 2 });
  // the question / the tick in the corner
  for (const [v, sym, col] of [[o.ask ?? 0, "?", NE.red], [o.ok ?? 0, "✓", NE.ok]] as const) {
    if (v <= 0) continue;
    const s = ease.back(v);
    c.fillStyle = col;
    c.beginPath();
    c.arc(w / 2 - 24, -h / 2 + 24, 44 * s, 0, Math.PI * 2);
    c.fill();
    if (sym === "?") label(c, "?", w / 2 - 24, -h / 2 + 27, 58 * s, { color: NE.paper });
    else {
      c.strokeStyle = NE.paper;
      c.lineWidth = 9;
      c.beginPath();
      c.moveTo(w / 2 - 44, -h / 2 + 26);
      c.lineTo(w / 2 - 30, -h / 2 + 40);
      c.lineTo(w / 2 - 4, -h / 2 + 10);
      c.stroke();
    }
  }
  c.restore();
}

/** PLAN as an object: a small map with a route finding its way through three points (k 0..1) */
export function roadmap(c: C, o: { x: number; y: number; k: number; s?: number; alpha?: number }) {
  if (o.k <= 0) return;
  const k = ease.back(clamp(o.k * 2));
  c.save();
  c.translate(o.x, o.y);
  c.scale((o.s ?? 1) * (0.9 + 0.1 * k), (o.s ?? 1) * (0.9 + 0.1 * k));
  c.globalAlpha *= (o.alpha ?? 1) * Math.min(1, o.k * 4);
  c.save();
  depth(c, 0.8);
  c.fillStyle = NE.paper;
  rr(c, -250, -125, 500, 250, STYLE === "riso" ? 6 : 28);
  c.fill();
  outline(c);
  c.restore();
  const pts: Array<[number, number]> = [[-190, 55], [-80, -45], [40, 35], [180, -65]];
  flow(c, pts, ease.inOut(clamp(o.k * 1.6 - 0.3)), { color: mix(NE.ok, NE.ink, 0.25), width: 9, head: false });
  pts.forEach((p, i) => {
    const d = ease.back(clamp(o.k * 4 - 1.2 - i * 0.6));
    c.fillStyle = i === 3 ? NE.gold : NE.ink;
    c.beginPath();
    c.arc(p[0], p[1], 15 * d, 0, Math.PI * 2);
    c.fill();
  });
  c.restore();
}

/** USTALENIA as an object: two matching halves that slide together and lock (k 0..1) */
export function lock(c: C, o: { x: number; y: number; k: number; s?: number; alpha?: number }) {
  if (o.k <= 0) return;
  const j = ease.inOut(clamp(o.k * 1.25));
  const gap = (1 - j) * 150;
  c.save();
  c.translate(o.x, o.y);
  c.scale(o.s ?? 1, o.s ?? 1);
  c.globalAlpha *= (o.alpha ?? 1) * Math.min(1, o.k * 4);
  c.save();
  depth(c, 0.8);
  for (const sgn of [-1, 1]) {
    c.fillStyle = sgn < 0 ? NE.ink : NE.gold;
    c.beginPath();
    const ex = sgn * gap;
    c.moveTo(ex + sgn * 220, -90);
    c.lineTo(ex, -90);
    c.lineTo(ex, -30);
    c.arc(ex, 0, 30, -Math.PI / 2, Math.PI / 2, sgn > 0);
    c.lineTo(ex, 90);
    c.lineTo(ex + sgn * 220, 90);
    c.closePath();
    c.fill();
  }
  c.restore();
  const ok = clamp((o.k - 0.8) / 0.2);
  if (ok > 0 && ok < 1) {
    c.strokeStyle = rgba(NE.ok, 1 - ok);
    c.lineWidth = 8;
    c.beginPath();
    c.arc(0, 0, 60 + ok * 200, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}

export interface ImageLike {
  width: number;
  height: number;
}
/**
 * BrandOutro: the dark green closes over the scene (three stair-shaped bands, like the logo), then
 * the belief — big line, small line — the logo and the qualification. `t0` = when it starts.
 */
export function outro(c: C, t: number, t0: number, o: { big: HeroLine[]; small?: string; note?: string; logo?: ImageLike | null; size?: number }) {
  const k = t - t0;
  if (k <= 0) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  // the bands arrive from the left, the lowest first — a staircase edge
  for (let i = 0; i < 3; i++) {
    const p = ease.inOut(pr(k, (2 - i) * 0.1, 0.55 + (2 - i) * 0.1));
    c.save();
    // papercut: three sheets sliding in, each a shade apart and shadowing the scene
    if (STYLE === "papercut") {
      c.shadowColor = "rgba(0,0,0,0.4)";
      c.shadowBlur = 26;
      c.shadowOffsetX = 12;
    }
    c.fillStyle = STYLE === "papercut" ? mix(NE.deep, "#FFFFFF", (2 - i) * 0.045) : NE.deep;
    c.fillRect(-40, (H / 3) * i - 1, (W + 40) * p, H / 3 + 2);
    c.restore();
    if (p > 0 && p < 1) {
      c.fillStyle = NE.gold;
      c.fillRect(W * p - 10, (H / 3) * i - 1, 10, H / 3 + 2);
    }
  }
  const size = o.size ?? 118;
  hero(c, o.big, W / 2, H * 0.43, size, pr(k, 0.6, 1.5), { color: NE.onDeep });
  (o.small ?? "").split("\n").filter(Boolean).forEach((ln, i) => label(c, ln, W / 2, H * 0.43 + (o.big.length * size * 1.08) / 2 + 70 + i * 76 + (1 - ease.out(pr(k, 1.25 + i * 0.15, 1.8 + i * 0.15))) * 20, 62, { color: NE.gold, weight: 600, alpha: ease.out(pr(k, 1.25 + i * 0.15, 1.8 + i * 0.15)) }));
  // the mark: three steps drawing themselves, then the logo
  const la = ease.out(pr(k, 1.6, 2.2));
  if (o.logo && la > 0) {
    const lw = 440;
    const lh = (lw * o.logo.height) / o.logo.width;
    c.globalAlpha = la;
    c.drawImage(o.logo as never, W / 2 - lw / 2, H * 0.74 - lh / 2, lw, lh);
    c.globalAlpha = 1;
  } else if (la > 0) label(c, "NOWY ETAP", W / 2, H * 0.74, 54, { color: NE.onDeep, track: 14, alpha: la });
  // the qualification: small, but still readable on a phone (two lines when long)
  if (o.note) {
    const words = o.note.split(" ");
    const half = o.note.length > 34 ? Math.ceil(words.length / 2) : words.length;
    [words.slice(0, half).join(" "), words.slice(half).join(" ")].filter(Boolean).forEach((ln, i) => label(c, ln, W / 2, H * 0.84 + i * 50, 38, { color: rgba(NE.onDeep, 0.78), weight: 500, alpha: ease.out(pr(k, 1.9, 2.5)) }));
  }
  c.restore();
}

// ------------------------------------------------------------------------------------- the reel model

export interface Beat {
  id: string;
  start: number;
  end: number;
  /** what the narrator says during the beat */
  vo: string;
  /** the words on screen */
  screen: string;
  /** the visual metaphor: what is seen and why the next thing appears */
  visual: string;
}
export interface Reel {
  id: string;
  n: number;
  title: string;
  /** one line: the idea */
  idea: string;
  duration: number;
  beats: Beat[];
  status: "ready" | "planned";
  draw?: (c: C, t: number, env: { logo?: ImageLike | null; style?: StyleKey | null }) => void;
}
/** start of a beat (seconds) by id — scenes are timed off the beat table */
export const at = (r: Pick<Reel, "beats">, id: string) => r.beats.find((b) => b.id === id)!;
