/**
 * Reel 01 — „Pozew za wcześnie”. One continuous move: a petition goes into the court and comes back
 * as an answer; positions start crossing between two sides; the camera pulls back, travels down a
 * clean line and follows the other order — plan → agreements → documents → court.
 */
import { at, bez, camAt, camera, clamp, court, doc, ease, finish, flow, flying, hero, label, lerp, mix, NE, outro, pr, rgba, rng, rr, stage, win, type Beat, type C, type DocProps, type Reel, W } from "./kit";

const beats: Beat[] = [
  { id: "blad", start: 0, end: 5.2, vo: "Jednym z największych błędów przed rozwodem może być wysłanie pozwu za wcześnie.", screen: "NAJWIĘKSZY BŁĄD? → POZEW ZA WCZEŚNIE", visual: "Na pustym blacie pojawia się pytanie; wsuwa się czysty pozew i to on staje się odpowiedzią - „za wcześnie” ląduje w przygaszonej czerwieni." },
  { id: "sad", start: 5.2, end: 12.4, vo: "Bo jeśli wcześniej nie ustalicie najważniejszych kwestii, pozew nie kończy rozmowy. On może ją dopiero rozpocząć.", screen: "NIE KOŃCZY ROZMOWY → DOPIERO JĄ ZACZYNA", visual: "Pozew jedzie do sądu i wchodzi w szczelinę. Sąd nie zamyka sprawy: z tej samej szczeliny wychodzi ODPOWIEDŹ i wraca w przeciwną stronę." },
  { id: "strony", start: 12.4, end: 16.3, vo: "Ty wysyłasz swoje stanowisko. Druga strona odpowiada swoim.", screen: "TWOJE STANOWISKO ↔ STANOWISKO DRUGIEJ STRONY", visual: "Odpowiedź ląduje po Twojej stronie i wypycha kolejne pismo. Każde pismo, które doleci, powoduje następne z drugiej strony - zaczyna się wymiana." },
  { id: "pisma", start: 16.3, end: 20.9, vo: "Pozew. Odpowiedź. Kolejne różnice. Kolejne pisma.", screen: "POZEW · ODPOWIEDŹ · RÓŻNICE · KOLEJNE PISMA", visual: "Każde słowo to jedno pismo, które fizycznie spada na środek. Stos rośnie, tory lotów się krzyżują, tło powoli ciepleje w stronę czerwieni." },
  { id: "pytanie", start: 20.9, end: 25.2, vo: "Dlatego tam, gdzie sytuacja na to pozwala, my odwracamy kolejność.", screen: "A GDYBY ODWRÓCIĆ KOLEJNOŚĆ?", visual: "Wszystko zastyga. Kamera odjeżdża w dół, pisma bledną w tle, pod nimi rysuje się jedna czysta linia - miejsce na inną kolejność." },
  { id: "droga", start: 25.2, end: 31.6, vo: "Najpierw plan. Potem ustalenia. Dokumenty. I dopiero wtedy sąd.", screen: "PLAN → USTALENIA → DOKUMENTY → SĄD", visual: "Zielona droga rysuje się sama. Plan (mapa) wypuszcza linię do ustaleń (dwie części, które się zamykają); z ustaleń powstaje jeden równy stos dokumentów; pozew ze stosu spokojnie wchodzi do sądu." },
  { id: "marka", start: 31.6, end: 35, vo: "Rozwód zaczyna się od planu, nie od pozwu.", screen: "ROZWÓD ZACZYNA SIĘ OD PLANU - nie od pozwu.", visual: "Ciemna zieleń zamyka kadr schodkami z logo. Zdanie marki jest wnioskiem z drogi, którą widz właśnie przeszedł." },
];

const L: [number, number] = [250, 1380];
const R: [number, number] = [830, 1380];
const COURT: [number, number] = [540, 400];
const SLOT: [number, number] = [540, 470];

/** the exchange: each flight starts when the one before it lands (a landing causes the next) */
const FLIGHTS = (() => {
  const out: Array<{ t0: number; dur: number; from: "L" | "R"; tone: DocProps["tone"]; i: number }> = [];
  let t = 0.75;
  let dur = 1.0;
  for (let i = 0; i < 12; i++) {
    out.push({ t0: t, dur, from: i % 2 === 0 ? "L" : "R", tone: i % 2 === 0 ? "plain" : "red", i });
    t += dur * 0.86;
    dur = Math.max(0.5, dur * 0.9);
  }
  return out;
})();
const WORDS = ["POZEW", "ODPOWIEDŹ", "RÓŻNICE", "KOLEJNE PISMA"];

function drawConflict(c: C, t: number, r: Reel) {
  const b1 = at(r, "blad").start;
  const b2 = at(r, "sad").start;
  const b3 = at(r, "strony").start;
  const b4 = at(r, "pisma").start;
  const b5 = at(r, "pytanie").start;
  // after the freeze nothing moves any more
  const tf = Math.min(t, b5 + 0.25);
  const fade = ease.inOut(pr(t, b5 + 0.2, b5 + 1.4));
  c.save();
  c.globalAlpha *= 1 - fade * 0.7;

  // the two sides: a place for each position
  for (const [p, name, k0] of [[L, ["TWOJE", "STANOWISKO"], b3 + 0.5], [R, ["STANOWISKO", "DRUGIEJ STRONY"], b3 + 1.7]] as const) {
    const k = ease.out(pr(tf, k0, k0 + 0.6));
    if (k <= 0) continue;
    c.save();
    c.globalAlpha *= k;
    c.fillStyle = rgba(NE.ink, 0.07);
    rr(c, p[0] - 170, p[1] - 190, 340, 380, 28);
    c.fill();
    label(c, name[0], p[0], 1640 + (1 - k) * 20, 46, { color: NE.ink });
    label(c, name[1], p[0], 1694 + (1 - k) * 20, 46, { color: p === R ? mix(NE.red, NE.ink, 0.4) : NE.ink });
    c.restore();
  }

  // the petition: slides in, travels to the court, goes into the slot
  const pin = ease.out(pr(t, b1 + 1.3, b1 + 2.4));
  const go = ease.inOut(pr(t, b2 + 1.0, b2 + 3.4));
  if (pin > 0 && go < 1) {
    const x = lerp(540, SLOT[0], go);
    const y = lerp(lerp(2250, 1190, pin), SLOT[1], go);
    doc(c, { x, y, w: 400, s: lerp(1, 0.4, go), rot: lerp(-7, -3, pin) * (1 - go), title: "POZEW", lift: 1 + go, alpha: 1 - pr(t, b2 + 3.25, b2 + 3.4) });
  }
  // the answer comes out of the same slot and flies back
  const ans = ease.inOut(pr(t, b2 + 5.2, b2 + 6.5));
  const toL = ease.inOut(pr(t, b3 + 0.05, b3 + 0.75));
  if (ans > 0) {
    const p = bez(SLOT, [760, 900], [540, 1240], ans);
    doc(c, { x: lerp(p[0], L[0] - 14, toL), y: lerp(p[1], L[1] + 10, toL), w: lerp(360, 210, toL), s: lerp(0.4, 1, ans), rot: lerp(0, 6, ans) + toL * -10, title: "ODPOWIEDŹ", tone: "red", lift: 1.4 - ans * 0.6 });
  }

  // the exchange between the two sides
  const landed = { L: 0, R: 0 };
  for (const f of FLIGHTS) {
    const k = pr(tf, b3 + f.t0, b3 + f.t0 + f.dur);
    if (k <= 0) continue;
    const a = f.from === "L" ? L : R;
    const b = f.from === "L" ? R : L;
    const n = landed[f.from === "L" ? "R" : "L"]++;
    const rd = rng(f.i * 31 + 5);
    const end: [number, number] = [b[0] + (rd() - 0.5) * 70, b[1] + (rd() - 0.5) * 90 - n * 6];
    const rot = (rd() - 0.5) * 26;
    const e = ease.inOut(k);
    const mid: [number, number] = [540 + (rd() - 0.5) * 160, 980 + (f.i % 3) * 70];
    flying(c, (q) => {
      const p = bez(a, mid, end, q);
      return { x: p[0], y: p[1], w: 210, rot: lerp((f.from === "L" ? -1 : 1) * 14, rot, q), tone: f.tone, lift: 0.3 + Math.sin(q * Math.PI) * 1.5, title: f.i < 2 ? (f.from === "L" ? "PISMO" : "ODPOWIEDŹ") : undefined };
    }, e);
  }

  // every word is one more document landing in the middle
  WORDS.forEach((_, i) => {
    const t0 = b4 + 0.1 + i * 1.1;
    const k = ease.out(pr(tf, t0, t0 + 0.55));
    if (k <= 0) return;
    const rd = rng(90 + i);
    doc(c, { x: 540 + (rd() - 0.5) * 60, y: lerp(820, 1330 - i * 16, k), w: 240, rot: (rd() - 0.5) * 30 * k, tone: i % 2 ? "red" : "plain", lift: 2 - k * 1.6, alpha: Math.min(1, k * 3), title: i === 0 ? "POZEW" : undefined });
  });

  // the court (drawn over the documents that go in and out of it)
  const ck = ease.out(pr(t, b2 + 0.1, b2 + 0.9));
  court(c, { x: COURT[0], y: COURT[1] - (1 - ck) * 120, s: 0.9, alpha: ck, pulse: pr(t, b2 + 3.3, b2 + 4.0) || pr(t, b2 + 4.9, b2 + 5.6) });
  c.restore();
}

function drawPath(c: C, t: number, r: Reel) {
  const b5 = at(r, "pytanie").start;
  const b6 = at(r, "droga").start;
  // the clean line under the mess, and the question
  flow(c, [[140, 2010], [940, 2010]], ease.inOut(pr(t, b5 + 1.0, b5 + 1.9)), { color: NE.ink, width: 6, head: false, alpha: 1 - pr(t, b6 + 0.4, b6 + 1) });
  hero(c, ["A GDYBY", "ODWRÓCIĆ", { t: "KOLEJNOŚĆ?", color: mix(NE.ok, NE.ink, 0.45) }], 540, 2290, 132, pr(t, b5 + 1.5, b5 + 2.6), { out: pr(t, b6 - 0.25, b6 + 0.45) });

  const S: Array<[number, number]> = [[540, 3080], [540, 3640], [540, 4200], [540, 4900]];
  const T = [b6 + 0.1, b6 + 1.5, b6 + 2.9, b6 + 4.1];
  const green = mix(NE.ok, NE.ink, 0.25);
  // the path: each stage sends the line on to the next
  for (let i = 0; i < 3; i++) flow(c, [[540, S[i][1] + (i === 2 ? 350 : 190)], [540, S[i + 1][1] - (i === 2 ? 215 : 310)]], ease.inOut(pr(t, T[i] + 0.9, T[i + 1] + 0.1)), { color: green, width: 10 });
  const names = ["PLAN", "USTALENIA", "DOKUMENTY", "SĄD"];
  names.forEach((n, i) => {
    const k = pr(t, T[i], T[i] + 0.7);
    if (i < 3) hero(c, [n], 540, S[i][1] - 190, 120, k, { color: NE.ink });
  });

  // PLAN — a roadmap: a card with a route that finds its way through three points
  {
    const k = ease.back(pr(t, T[0] + 0.1, T[0] + 0.8));
    if (k > 0) {
      const [x, y] = S[0];
      c.save();
      c.translate(x, y + 10);
      c.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
      c.globalAlpha *= Math.min(1, k * 2);
      c.save();
      c.shadowColor = rgba("#2B2416", 0.18);
      c.shadowBlur = 46;
      c.shadowOffsetY = 20;
      c.fillStyle = NE.paper;
      rr(c, -250, -110, 500, 250, 28);
      c.fill();
      c.restore();
      const pts: Array<[number, number]> = [[-190, 70], [-80, -30], [40, 50], [180, -50]];
      flow(c, pts, ease.inOut(pr(t, T[0] + 0.45, T[0] + 1.35)), { color: green, width: 9, head: false });
      pts.forEach((p, i) => {
        const d = ease.back(pr(t, T[0] + 0.45 + i * 0.25, T[0] + 0.75 + i * 0.25));
        c.fillStyle = i === 3 ? NE.gold : NE.ink;
        c.beginPath();
        c.arc(p[0], p[1], 15 * d, 0, Math.PI * 2);
        c.fill();
      });
      c.restore();
    }
  }
  // USTALENIA — two parts that match and lock together
  {
    const k = pr(t, T[1] + 0.15, T[1] + 1.0);
    if (k > 0) {
      const [x, y] = S[1];
      const j = ease.inOut(k);
      const gap = (1 - j) * 150;
      c.save();
      c.globalAlpha *= Math.min(1, k * 3);
      c.shadowColor = rgba("#2B2416", 0.18);
      c.shadowBlur = 40;
      c.shadowOffsetY = 18;
      for (const s of [-1, 1]) {
        c.fillStyle = s < 0 ? NE.ink : NE.gold;
        c.beginPath();
        const ex = x + s * gap;
        // a half with a tab / a notch on the inner edge
        c.moveTo(ex + s * 220, y - 90);
        c.lineTo(ex, y - 90);
        c.lineTo(ex, y - 30);
        c.arc(ex, y, 30, -Math.PI / 2, Math.PI / 2, s > 0);
        c.lineTo(ex, y + 90);
        c.lineTo(ex + s * 220, y + 90);
        c.closePath();
        c.fill();
      }
      c.restore();
      // locked: a soft ring confirms it
      const ok = pr(t, T[1] + 1.0, T[1] + 1.5);
      if (ok > 0 && ok < 1) {
        c.strokeStyle = rgba(NE.ok, 1 - ok);
        c.lineWidth = 8;
        c.beginPath();
        c.arc(x, y, 60 + ok * 200, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }
  // DOKUMENTY — the agreements become one tidy stack
  {
    const [x, y] = S[2];
    const leave = ease.inOut(pr(t, T[3] + 0.5, T[3] + 1.9));
    for (let i = 0; i < 3; i++) {
      const k = ease.out(pr(t, T[2] + 0.15 + i * 0.22, T[2] + 0.85 + i * 0.22));
      if (k <= 0) continue;
      const top = i === 2;
      // (the stack builds where the line arrives: each sheet settles from just above)
      const sy = lerp(y + 20, y + 120 - i * 14, k);
      if (top && leave > 0) continue;
      doc(c, { x: x + (i - 1) * 10 * (1 - k), y: sy, w: 300, rot: (i - 1) * 9 * (1 - k), tone: "green", lift: 0.5 + (1 - k), alpha: Math.min(1, k * 3), title: top ? "POZEW" : undefined, write: k });
    }
    // the petition from the top of the stack goes calmly into the court
    if (leave > 0) {
      const ty = lerp(y + 92, S[3][1] + 60, leave);
      doc(c, { x, y: ty, w: 300, s: lerp(1, 0.46, leave), tone: "green", title: "POZEW", lift: 1, alpha: 1 - pr(t, T[3] + 1.75, T[3] + 1.9) });
    }
  }
  // SĄD
  const ck = ease.out(pr(t, T[3], T[3] + 0.7));
  court(c, { x: S[3][0], y: S[3][1] + (1 - ck) * 60, alpha: ck, tone: "green", pulse: pr(t, T[3] + 1.8, T[3] + 2.5) });
}

function draw(c: C, t: number, env: { logo?: { width: number; height: number } | null }) {
  const r = reel01;
  const b1 = at(r, "blad").start;
  const b2 = at(r, "sad").start;
  const b4 = at(r, "pisma").start;
  const b5 = at(r, "pytanie").start;
  const b6 = at(r, "droga").start;
  const b7 = at(r, "marka").start;
  const tint = ease.inOut(pr(t, b4 - 1.5, b5)) * (1 - ease.inOut(pr(t, b5 + 0.3, b5 + 1.6)));
  stage(c, { tint });
  const cam = camAt(t, [
    [b1, { x: 540, y: 960, s: 1.0 }],
    [b2, { x: 540, y: 940, s: 1.05 }],
    [b2 + 3.4, { x: 540, y: 900, s: 1.0 }],
    [b4, { x: 540, y: 960, s: 0.97 }],
    [b5 + 0.1, { x: 540, y: 990, s: 1.02 }],
    [b5 + 1.7, { x: 540, y: 1560, s: 0.8 }],
    [b6 - 0.5, { x: 540, y: 1600, s: 0.8 }],
    [b6 + 0.6, { x: 540, y: 3060, s: 0.96 }],
    [b6 + 1.3, { x: 540, y: 3090, s: 0.98 }],
    [b6 + 2.1, { x: 540, y: 3620, s: 0.98 }],
    [b6 + 2.7, { x: 540, y: 3650, s: 1.0 }],
    [b6 + 3.5, { x: 540, y: 4230, s: 0.98 }],
    [b6 + 4.0, { x: 540, y: 4260, s: 1.0 }],
    [b6 + 4.9, { x: 540, y: 4600, s: 0.94 }],
    [b7 - 0.1, { x: 540, y: 4630, s: 0.97 }],
  ]);
  camera(c, cam, t, () => {
    drawConflict(c, t, r);
    drawPath(c, t, r);
    // beat 1: the question, then the petition answers it
    hero(c, ["NAJWIĘKSZY", "BŁĄD?"], 540, 560, 150, pr(t, b1 + 0.15, b1 + 1.0), { out: pr(t, b1 + 2.9, b1 + 3.4) });
    hero(c, ["POZEW", { t: "ZA WCZEŚNIE", color: NE.red }], 540, 560, 150, pr(t, b1 + 3.3, b1 + 4.1), { out: pr(t, b2 - 0.1, b2 + 0.5) });
    // beat 2: what the petition does — and does not — do
    hero(c, ["NIE KOŃCZY", "ROZMOWY"], 540, 1280, 124, pr(t, b2 + 3.5, b2 + 4.2), { out: pr(t, b2 + 5.0, b2 + 5.5) });
    hero(c, [{ t: "DOPIERO", color: NE.ink }, { t: "JĄ ZACZYNA", color: NE.red }], 540, 1640, 118, pr(t, b2 + 5.7, b2 + 6.4), { out: pr(t, b2 + 6.9, b2 + 7.4) });
    // beat 4: one word per document
    WORDS.forEach((w, i) => {
      const t0 = b4 + 0.05 + i * 1.1;
      const a = win(t, t0, i === 3 ? b5 + 0.9 : t0 + 1.12, 0.22);
      if (a > 0) label(c, w, 540, 800 + (1 - ease.out(pr(t, t0, t0 + 0.3))) * 30, w.length > 9 ? 104 : 136, { color: i >= 2 ? mix(NE.red, NE.ink, 0.35) : NE.ink, alpha: a, track: -1 });
    });
  });
  outro(c, t, b7, { big: ["ROZWÓD", "ZACZYNA SIĘ", { t: "OD PLANU", color: NE.goldSoft }], small: "nie od pozwu.", note: "Tam, gdzie sytuacja pozwala na wcześniejsze ustalenia.", logo: env.logo });
  finish(c, t, { dark: clamp((t - b7) / 0.8) });
  void W;
}

export const reel01: Reel = {
  id: "pozew-za-wczesnie",
  n: 1,
  title: "Pozew za wcześnie",
  idea: "Pozew wysłany przed ustaleniami nie kończy rozmowy - może ją dopiero zacząć. Tam, gdzie sytuacja pozwala, kolejność da się odwrócić.",
  duration: 35,
  beats,
  status: "ready",
  draw,
};
