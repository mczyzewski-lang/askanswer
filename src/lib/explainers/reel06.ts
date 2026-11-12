/**
 * Reel 06 - „Jeden błąd” (the social-campaign film). A number first: more than 120 000 people a
 * year, shown as a field of points. Some of them make the same move - one point becomes a petition
 * filed in emotion - and the months start filling a calendar. Then the order is reversed:
 * agreements with each side separately, documents, the court at the end - and the long calendar
 * shrinks to one short hearing.
 *
 * Facts on screen: the number of divorces (GUS: over 60 thousand in 2025, i.e. over 120 thousand
 * people). The lengths of cases are worded as possibilities, not as averages or promises.
 */
import { at, camAt, camera, clamp, court, doc, ease, finish, flow, hero, label, lerp, lock, mix, NE, outro, pr, rgba, rng, rr, stage, useStyle, win, depth, type Beat, type C, type Reel, type StyleKey } from "./kit";

const beats: Beat[] = [
  { id: "liczba", start: 0, end: 5, vo: "W Polsce co roku rozwodzi się ponad sto dwadzieścia tysięcy osób.", screen: "W POLSCE CO ROKU · 120 000 OSÓB", visual: "Licznik dochodzi do 120 000; pod nim pole punktów - każdy punkt to ludzie, nie statystyka. Źródło małym drukiem." },
  { id: "blad", start: 5, end: 10.8, vo: "Wiele z nich popełnia ten sam błąd: składa pozew w emocjach, zanim cokolwiek ustali.", screen: "TEN SAM BŁĄD → POZEW W EMOCJACH", visual: "Część punktów zapala się na czerwono. Kamera wjeżdża w jeden z nich: punkt staje się pozwem, który drży w dłoni i leci do sądu." },
  { id: "lata", start: 10.8, end: 17.2, vo: "Wtedy warunki rozstania ustala sąd. Świadkowie, kolejne rozprawy, kolejne miesiące. Czasem lata.", screen: "ŚWIADKOWIE · ROZPRAWY · MIESIĄCE · CZASEM LATA", visual: "Pozew wchodzi do sądu i uruchamia kalendarz: miesiąc po miesiącu, rząd po rzędzie. Na niektórych miesiącach lądują kolejne pisma. Tło ciepleje w stronę czerwieni." },
  { id: "droga", start: 17.2, end: 20.2, vo: "Jest lepsza droga: odwrócić kolejność.", screen: "JEST LEPSZA DROGA", visual: "Kalendarz zastyga i blednie. Światło wraca do zieleni - jedno zdanie na pustej scenie." },
  { id: "etapy", start: 20.2, end: 26.6, vo: "Najpierw ustalenia: z każdą ze stron osobno. Potem dokumenty. A dopiero na końcu sąd.", screen: "USTALENIA (osobno) → DOKUMENTY → SĄD", visual: "Dwie osoby po dwóch stronach. Linia rozmowy rysuje się najpierw do jednej, potem osobno do drugiej; dopiero wtedy obie części się zamykają. Z ustaleń powstaje równy stos dokumentów, a z niego pozew, który spokojnie wchodzi do sądu." },
  { id: "minuty", start: 26.6, end: 31.4, vo: "Gdy wszystko jest uzgodnione, rozprawa może trwać nawet piętnaście minut.", screen: "ROZPRAWA: NAWET 15 MINUT", visual: "Długi czerwony pasek miesięcy kurczy się do krótkiego zielonego; na tarczy zegara zapala się jeden kwadrans." },
  { id: "marka", start: 31.4, end: 35, vo: "Rozwód zaczyna się od planu, nie od pozwu.", screen: "ROZWÓD ZACZYNA SIĘ OD PLANU - nie od pozwu.", visual: "Ciemna zieleń zamyka kadr; zdanie marki i zastrzeżenie." },
];

const COLS = 20;
const ROWS = 26;
const GX = 110;
const GY = 1010;
const STEP = 45.3;
/** the point that becomes the petition */
const PICK = { i: 9, j: 9 };
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** a person as a sign: a head and shoulders (no face, no gender) */
function person(c: C, x: number, y: number, s: number, col: string, k: number) {
  if (k <= 0) return;
  const e = ease.back(k);
  c.save();
  c.translate(x, y);
  c.scale(s * e, s * e);
  c.globalAlpha *= Math.min(1, k * 2);
  depth(c, 0.6);
  c.fillStyle = col;
  c.beginPath();
  c.arc(0, -78, 46, 0, Math.PI * 2);
  c.fill();
  rr(c, -86, -20, 172, 150, 70);
  c.fill();
  c.restore();
}

function draw(c: C, t: number, env: { logo?: { width: number; height: number } | null; style?: StyleKey | null }) {
  useStyle(env.style ?? "campaign");
  const r = reel06;
  const b1 = at(r, "liczba").start;
  const b2 = at(r, "blad").start;
  const b3 = at(r, "lata").start;
  const b4 = at(r, "droga").start;
  const b5 = at(r, "etapy").start;
  const b6 = at(r, "minuty").start;
  const b7 = at(r, "marka").start;
  const red = NE.red;
  const green = mix(NE.ok, NE.ink, 0.2);
  const px = GX + PICK.i * STEP;
  const py = GY + PICK.j * STEP;
  const cam = camAt(t, [
    [b1, { x: 540, y: 960, s: 1.0 }],
    [b2 + 0.6, { x: 540, y: 990, s: 1.04 }],
    [b2 + 2.6, { x: px, y: py - 40, s: 2.4 }],
    [b2 + 4.2, { x: 540, y: py - 330, s: 1.2 }],
    [b3 + 1.0, { x: 540, y: -1080, s: 1.0 }],
    [b4 + 0.2, { x: 540, y: -1040, s: 1.03 }],
    [b5 - 0.4, { x: 540, y: -1020, s: 1.0 }],
    // back down to where the people were: the other order starts with them
    [b5 + 0.9, { x: 540, y: 960, s: 1.0 }],
    [b5 + 3.2, { x: 540, y: 990, s: 1.03 }],
    [b5 + 4.2, { x: 540, y: 3090, s: 1.0 }],
    [b6 - 0.3, { x: 540, y: 3120, s: 1.02 }],
    [b6 + 0.7, { x: 540, y: 4960, s: 1.0 }],
    [b7, { x: 540, y: 4990, s: 1.03 }],
  ]);
  const tint = ease.inOut(pr(t, b3 + 0.6, b4)) * (1 - ease.inOut(pr(t, b4, b4 + 1.0)));
  stage(c, { tint, cam });
  camera(c, cam, t, () => {
    // ------------------------------------------------------------- 1. the number and the people
    const count = ease.out(pr(t, b1 + 0.3, b1 + 3.0));
    const head = win(t, b1 + 0.1, b2 + 0.5, 0.4);
    if (head > 0) {
      label(c, "W POLSCE CO ROKU", 540, 300, 54, { color: NE.muted, track: 8, alpha: head, weight: 700 });
      label(c, fmt(120000 * count), 540, 520, 250, { color: NE.ink, alpha: head, track: -6 });
      label(c, count >= 1 ? "PONAD" : "", 540, 370, 44, { color: NE.gold, track: 10, alpha: head * ease.out(pr(t, b1 + 3.0, b1 + 3.4)) });
      label(c, "OSÓB ROZWODZI SIĘ", 540, 720, 68, { color: NE.ink, alpha: head * ease.out(pr(t, b1 + 1.0, b1 + 1.6)), track: 2 });
      label(c, "Źródło: GUS, ponad 60 tys. rozwodów w 2025 r.", 540, 830, 30, { color: NE.muted, weight: 500, alpha: head * ease.out(pr(t, b1 + 3.2, b1 + 3.8)) });
    }
    // the field: every point stands for people; it fills with the counter
    const rd = rng(11);
    const leave = ease.inOut(pr(t, b2 + 3.6, b3 + 0.6));
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) {
        const order = (j * COLS + i) / (COLS * ROWS);
        const n = rd();
        const k = ease.out(clamp((count * 1.15 - order) * 6));
        if (k <= 0) continue;
        // an irregular share of them (no percentage is claimed) turns red, one after another
        const wrong = n < 0.42 ? ease.out(clamp((pr(t, b2 + 0.2, b2 + 2.0) - n * 1.6) * 4)) : 0;
        const isPick = i === PICK.i && j === PICK.j;
        const morph = isPick ? ease.inOut(pr(t, b2 + 2.2, b2 + 3.2)) : 0;
        if (morph >= 1) continue;
        c.globalAlpha = k * (1 - leave) * (isPick ? 1 : 1 - 0.55 * ease.inOut(pr(t, b2 + 2.0, b2 + 3.0)));
        c.fillStyle = mix(rgbaHex(NE.ink, 0.34), red, isPick ? ease.out(pr(t, b2 + 0.5, b2 + 1.1)) : wrong);
        c.beginPath();
        c.arc(GX + i * STEP, GY + j * STEP, (isPick ? 12 + morph * 6 : 9.5) * k, 0, Math.PI * 2);
        c.fill();
      }
    c.globalAlpha = 1;
    label(c, "WIELE Z NICH", 540, 620, 120, { color: red, alpha: win(t, b2 + 0.5, b2 + 1.7, 0.3) });

    // ------------------------------------------------------- 2. one point becomes a petition
    const born = ease.out(pr(t, b2 + 2.6, b2 + 3.4));
    const fly = ease.inOut(pr(t, b3 + 0.2, b3 + 1.5));
    if (born > 0 && fly < 1) {
      // in emotion: the sheet trembles until it is let go
      const shake = (1 - fly) * Math.sin(t * 34) * 2.2 * ease.out(pr(t, b2 + 3.2, b2 + 4.0));
      doc(c, { x: lerp(px, 540, fly) + shake, y: lerp(py - 10, -1500, fly), w: lerp(60, 250, born), s: lerp(1, 0.5, fly), rot: -5 + shake * 1.4, title: born > 0.6 ? "POZEW" : undefined, tone: "red", alpha: Math.min(1, born * 3) * (1 - pr(t, b3 + 1.35, b3 + 1.5)), lift: 1.2 });
    }
    hero(c, ["POZEW", { t: "W EMOCJACH", color: red }], 540, 800, 100, pr(t, b2 + 3.5, b2 + 4.3), { out: pr(t, b3 - 0.2, b3 + 0.4) });

    // --------------------------------------------------------------- 3. the months, then years
    {
      const ck = ease.out(pr(t, b3 + 0.3, b3 + 1.0));
      court(c, { x: 540, y: -1640, s: 0.78, alpha: ck * (1 - 0.6 * ease.inOut(pr(t, b4, b4 + 0.8))), pulse: pr(t, b3 + 1.4, b3 + 2.0) });
      const tf = Math.min(t, b4 + 0.1);
      const dim = 1 - 0.72 * ease.inOut(pr(t, b4, b4 + 0.9));
      const cell = 62;
      const x0 = 540 - (12 * cell + 11 * 10) / 2;
      const filled = pr(tf, b3 + 1.5, b3 + 6.0) * 36;
      const rd2 = rng(5);
      for (let m = 0; m < 36; m++) {
        const k = ease.out(clamp(filled - m));
        const x = x0 + (m % 12) * (cell + 10);
        const y = -1330 + Math.floor(m / 12) * (cell + 46);
        c.globalAlpha = dim;
        c.fillStyle = rgbaHex(NE.ink, 0.1);
        rr(c, x, y, cell, cell, 10);
        c.fill();
        if (k > 0) {
          c.fillStyle = mix(NE.gold, red, clamp(m / 20));
          rr(c, x, y + cell * (1 - k), cell, cell * k, 10);
          c.fill();
        }
        // another letter / another hearing lands on some months
        const hit = rd2() < 0.3;
        if (hit && k >= 1) doc(c, { x: x + cell / 2, y: y + cell / 2 - 4, w: 34, rot: (rd2() - 0.5) * 30, alpha: dim * ease.out(clamp(filled - m - 1)), lift: 0.2 });
      }
      c.globalAlpha = 1;
      ["ROK", "2 LATA", "3 LATA"].forEach((y, i) => label(c, y, x0 + 12 * (cell + 10) - 10, -1330 + i * (cell + 46) + cell + 24, 36, { align: "right", color: NE.muted, weight: 700, alpha: dim * ease.out(clamp(filled - (i + 1) * 12 + 1)) }));
      const words = ["ŚWIADKOWIE", "KOLEJNE ROZPRAWY", "KOLEJNE MIESIĄCE"];
      words.forEach((w, i) => {
        const t0 = b3 + 1.9 + i * 1.05;
        const a = win(t, t0, t0 + 1.1, 0.22);
        if (a > 0) label(c, w, 540, -880, w.length > 12 ? 82 : 104, { color: NE.ink, alpha: a });
      });
      hero(c, [{ t: "CZASEM", color: NE.ink }, { t: "LATA", color: red, size: 190 }], 540, -820, 104, pr(t, b3 + 5.1, b3 + 5.8), { out: pr(t, b4 - 0.1, b4 + 0.4) });
      // 4. the turn
      hero(c, ["JEST", { t: "LEPSZA DROGA", color: green }], 540, -840, 118, pr(t, b4 + 0.5, b4 + 1.3), { out: pr(t, b5 - 0.5, b5 + 0.1) });
    }

    // --------------------------------------------- 5. agreements with each side separately
    {
      const Y = 1000;
      hero(c, ["NAJPIERW", { t: "USTALENIA", color: green }], 540, Y - 520, 112, pr(t, b5 + 0.3, b5 + 1.0));
      person(c, 190, Y + 60, 1, NE.ink, pr(t, b5 + 0.7, b5 + 1.3));
      person(c, 890, Y + 60, 1, NE.gold, pr(t, b5 + 0.9, b5 + 1.5));
      // the talks: first with one side, then - separately - with the other
      flow(c, [[540, Y + 40], [320, Y + 40]], ease.inOut(pr(t, b5 + 1.4, b5 + 2.0)), { color: green, width: 10 });
      flow(c, [[540, Y + 40], [760, Y + 40]], ease.inOut(pr(t, b5 + 2.1, b5 + 2.7)), { color: green, width: 10 });
      c.fillStyle = green;
      c.beginPath();
      c.arc(540, Y + 40, 26 * ease.back(pr(t, b5 + 1.2, b5 + 1.6)), 0, Math.PI * 2);
      c.fill();
      label(c, "z każdą ze stron osobno", 540, Y - 300, 54, { color: NE.muted, weight: 600, alpha: ease.out(pr(t, b5 + 1.5, b5 + 2.1)) });
      lock(c, { x: 540, y: Y + 420, k: pr(t, b5 + 2.6, b5 + 3.4), s: 0.95 });
      flow(c, [[540, Y + 90], [540, Y + 290]], ease.inOut(pr(t, b5 + 2.5, b5 + 2.9)), { color: green, width: 10 });
    }
    // ------------------------------------------------------------ documents, then the court
    {
      const Y = 3000;
      flow(c, [[540, 1560], [540, Y - 580]], ease.inOut(pr(t, b5 + 3.3, b5 + 4.3)), { color: green, width: 10 });
      label(c, "POTEM DOKUMENTY", 540, Y - 470, 86, { alpha: ease.out(pr(t, b5 + 4.2, b5 + 4.7)) });
      const go = ease.inOut(pr(t, b5 + 5.3, b5 + 6.3));
      for (let i = 0; i < 3; i++) {
        const k = ease.out(pr(t, b5 + 4.3 + i * 0.18, b5 + 4.9 + i * 0.18));
        if (k <= 0 || (i === 2 && go > 0)) continue;
        doc(c, { x: 540, y: lerp(Y - 190, Y - 110 - i * 14, k), w: 280, tone: "green", alpha: Math.min(1, k * 3), title: i === 2 ? "POZEW" : undefined, write: k, lift: 0.5 });
      }
      if (go > 0) doc(c, { x: 540, y: lerp(Y - 138, Y + 420, go), w: 280, s: lerp(1, 0.46, go), tone: "green", title: "POZEW", alpha: 1 - pr(t, b5 + 6.15, b5 + 6.3) });
      const ck = ease.out(pr(t, b5 + 4.9, b5 + 5.5));
      flow(c, [[540, Y + 105], [540, Y + 190]], ease.inOut(pr(t, b5 + 4.8, b5 + 5.2)), { color: green, width: 10 });
      court(c, { x: 540, y: Y + 380, alpha: ck, tone: "green", pulse: pr(t, b5 + 6.2, b5 + 6.8) });
      label(c, "NA KOŃCU", 540, Y + 620, 60, { color: NE.muted, weight: 700, track: 6, alpha: ck });
    }
    // ------------------------------------------------------ 6. the long calendar → one hearing
    {
      const Y = 5000;
      const k = pr(t, b6 + 0.35, b6 + 1.1);
      // the long bar of months shrinks to the short green one
      const shrink = ease.inOut(pr(t, b6 + 1.4, b6 + 2.6));
      const w = lerp(860, 120, shrink);
      c.globalAlpha = ease.out(k);
      c.fillStyle = rgbaHex(NE.ink, 0.1);
      rr(c, 110, Y - 560, 860, 46, 23);
      c.fill();
      c.fillStyle = mix(red, green, shrink);
      rr(c, 110, Y - 560, w * ease.out(k), 46, 23);
      c.fill();
      c.globalAlpha = 1;
      label(c, shrink < 0.5 ? "MIESIĄCE, CZASEM LATA" : "JEDNA ROZPRAWA", 110, Y - 630, 54, { align: "left", color: shrink < 0.5 ? red : green, weight: 700, track: 3, alpha: ease.out(k) * (1 - Math.sin(clamp(shrink) * Math.PI) * 0.9) });
      // the clock: one quarter of an hour
      const q = ease.inOut(pr(t, b6 + 2.2, b6 + 3.3));
      const R = 250;
      const ca = ease.out(pr(t, b6 + 1.6, b6 + 2.3));
      if (ca > 0) {
        c.save();
        c.globalAlpha = ca;
        c.strokeStyle = rgbaHex(NE.ink, 0.22);
        c.lineWidth = 14;
        c.beginPath();
        c.arc(540, Y - 150, R, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          c.fillStyle = rgbaHex(NE.ink, 0.4);
          c.beginPath();
          c.arc(540 + Math.sin(a) * (R - 40), Y - 150 - Math.cos(a) * (R - 40), 7, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = rgbaHex(mix(NE.ok, NE.ink, 0.2), 0.9);
        c.beginPath();
        c.moveTo(540, Y - 150);
        c.arc(540, Y - 150, R - 7, -Math.PI / 2, -Math.PI / 2 + (Math.PI / 2) * q);
        c.closePath();
        c.fill();
        c.strokeStyle = NE.ink;
        c.lineWidth = 12;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(540, Y - 150);
        c.lineTo(540 + Math.sin((Math.PI / 2) * q) * (R - 60), Y - 150 - Math.cos((Math.PI / 2) * q) * (R - 60));
        c.stroke();
        c.restore();
      }
      hero(c, [{ t: "NAWET", color: NE.muted, size: 70 }, { t: "15 MINUT", color: green }], 540, Y + 290, 170, pr(t, b6 + 2.4, b6 + 3.2));
      label(c, "gdy wszystko jest uzgodnione", 540, Y + 500, 50, { color: NE.muted, weight: 600, alpha: ease.out(pr(t, b6 + 3.1, b6 + 3.7)) });
    }
  });
  outro(c, t, b7, { big: ["ROZWÓD", "ZACZYNA SIĘ", { t: "OD PLANU", color: NE.goldSoft }], small: "nie od pozwu.", note: "Tam, gdzie sytuacja pozwala na wcześniejsze ustalenia. To nie jest porada prawna.", logo: env.logo });
  finish(c, t, { dark: 1 });
}

/** a colour at an alpha over the page, as an opaque hex (so it can be mixed further) */
function rgbaHex(col: string, a: number) {
  return mix(NE.cream, col, a);
}
void rgba;

export const reel06: Reel = {
  id: "jeden-blad",
  n: 6,
  title: "Jeden błąd (kampania społeczna)",
  idea: "Ponad 120 tysięcy osób rocznie się rozwodzi; wiele z nich składa pozew w emocjach, zanim cokolwiek ustali. Jest lepsza kolejność: ustalenia, dokumenty, sąd.",
  duration: 35,
  beats,
  status: "ready",
  defaultStyle: "campaign",
  draw,
};
