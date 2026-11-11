/**
 * Reel 02 — „Dwa sposoby rozpoczęcia rozwodu”. One decision, two columns: the camera goes down the
 * left one (petition first: it hits the other side, an answer comes back, open questions branch
 * out), then down the right one (plan first: three areas checked, then documents, then the court),
 * and pulls back to show both histories ending at the same word.
 */
import { at, bez, camAt, camera, clamp, court, doc, ease, finish, flow, hero, label, lerp, lifeArea, mix, NE, node, outro, pr, rgba, rng, roadmap, rr, stage, type Beat, type C, type Reel } from "./kit";

const beats: Beat[] = [
  { id: "cel", start: 0, end: 5.4, vo: "Te dwie osoby chcą dokładnie tego samego: rozwodu. Ale zaczynają zupełnie inaczej.", screen: "TEN SAM CEL → DWA POCZĄTKI", visual: "Jedna decyzja u góry. Wychodzą z niej dwie linie: kadr dzieli się na dwie drogi - lewą (czerwień) i prawą (zieleń)." },
  { id: "pozew", start: 5.4, end: 11.4, vo: "Pierwsza zaczyna od pozwu. Wpisuje swoje oczekiwania i wysyła je drugiej stronie.", screen: "POZEW → ODPOWIEDŹ → DZIECI? PIENIĄDZE? MIESZKANIE?", visual: "Pozew wypełnia się sam i uderza w drugą stronę; odbija się jako odpowiedź. Z odpowiedzi rozchodzą się trzy otwarte pytania - droga zaczyna się rozgałęziać." },
  { id: "plan", start: 11.4, end: 18.4, vo: "Druga najpierw sprawdza: dzieci, finanse, mieszkanie, i to, co można uzgodnić.", screen: "PLAN → DZIECI · FINANSE · MIESZKANIE", visual: "Z planu wychodzi jedna prosta linia przez trzy obszary życia. Tam, gdzie to możliwe, pojawia się znak uzgodnienia; jeden obszar zostaje otwarty - bez obietnic." },
  { id: "dokumenty", start: 18.4, end: 21.6, vo: "Dopiero potem powstają dokumenty.", screen: "DOKUMENTY → SĄD", visual: "Uzgodnione obszary składają się w jeden równy stos; pozew z tego stosu spokojnie trafia do sądu." },
  { id: "razem", start: 21.6, end: 25.6, vo: "Ten sam cel. Zupełnie inny początek.", screen: "ROZWÓD (obie drogi)", visual: "Kamera odjeżdża: obie drogi kończą się tym samym słowem, ale historia za każdą wygląda zupełnie inaczej - splątana po lewej, prosta po prawej." },
  { id: "marka", start: 25.6, end: 29.6, vo: "Dlatego rozwód zaczyna się od planu, nie od pozwu.", screen: "TEN SAM CEL. INNY POCZĄTEK. - Rozwód zaczyna się od planu, nie od pozwu.", visual: "Ciemna zieleń zamyka kadr; kontrast obu dróg zostaje nazwany jednym zdaniem i wnioskiem marki." },
];

const LX = 270;
const RX = 810;
const red = mix(NE.red, NE.ink, 0.25);
const green = mix(NE.ok, NE.ink, 0.25);

function draw(c: C, t: number, env: { logo?: { width: number; height: number } | null }) {
  const r = reel02;
  const b1 = at(r, "cel").start;
  const b2 = at(r, "pozew").start;
  const b3 = at(r, "plan").start;
  const b4 = at(r, "dokumenty").start;
  const b5 = at(r, "razem").start;
  const b6 = at(r, "marka").start;
  stage(c);
  const cam = camAt(t, [
    [b1, { x: 540, y: 940, s: 1.02 }],
    [b2 - 0.5, { x: 540, y: 960, s: 1.0 }],
    [b2 + 0.9, { x: LX + 20, y: 800, s: 1.7 }],
    [b2 + 2.6, { x: LX + 30, y: 830, s: 1.72 }],
    [b2 + 3.8, { x: LX + 20, y: 1180, s: 1.7 }],
    [b2 + 5.6, { x: LX + 10, y: 1560, s: 1.62 }],
    [b3 - 0.2, { x: LX + 10, y: 1590, s: 1.62 }],
    [b3 + 1.1, { x: RX - 20, y: 760, s: 1.7 }],
    [b3 + 2.0, { x: RX - 20, y: 800, s: 1.72 }],
    [b3 + 3.0, { x: RX - 20, y: 1090, s: 1.72 }],
    [b3 + 4.3, { x: RX - 20, y: 1390, s: 1.72 }],
    [b3 + 5.6, { x: RX - 20, y: 1690, s: 1.72 }],
    [b4 - 0.1, { x: RX - 20, y: 1720, s: 1.7 }],
    [b4 + 1.0, { x: RX - 20, y: 2080, s: 1.62 }],
    [b5 - 0.4, { x: RX - 20, y: 2330, s: 1.55 }],
    [b5 + 1.6, { x: 540, y: 1560, s: 0.64 }],
    [b6, { x: 540, y: 1590, s: 0.66 }],
  ]);
  camera(c, cam, t, () => {
    // the two halves: the same page, two temperatures
    const split = ease.inOut(pr(t, b1 + 3.2, b1 + 4.6));
    if (split > 0) {
      c.fillStyle = rgba(NE.redSoft, 0.55 * split);
      c.fillRect(-900, 470, 1440, 2600 * split);
      c.fillStyle = rgba(NE.okSoft, 0.6 * split);
      c.fillRect(540, 470, 1440, 2600 * split);
    }
    // the decision, and the two ways out of it
    hero(c, ["TEN SAM", "CEL"], 540, 1010, 150, pr(t, b1 + 0.2, b1 + 1.0), { out: pr(t, b1 + 3.1, b1 + 3.6) });
    hero(c, ["DWA", "POCZĄTKI"], 540, 1010, 150, pr(t, b1 + 3.6, b1 + 4.4), { out: pr(t, b2 - 0.5, b2 + 0.1) });
    const dk = pr(t, b1 + 0.5, b1 + 1.3);
    if (dk > 0) {
      c.save();
      c.globalAlpha *= Math.min(1, dk * 2);
      c.fillStyle = NE.ink;
      rr(c, 540 - 330 * ease.back(dk), 250, 660 * ease.back(dk), 130, 65);
      c.fill();
      label(c, "DECYZJA O ROZWODZIE", 540, 317, 46, { color: NE.cream, track: 2, alpha: ease.out(pr(t, b1 + 0.9, b1 + 1.4)) });
      c.restore();
    }
    flow(c, [[440, 380], [LX, 470], [LX, 560]], ease.inOut(pr(t, b1 + 3.4, b1 + 4.5)), { color: red, width: 9 });
    flow(c, [[640, 380], [RX, 470], [RX, 560]], ease.inOut(pr(t, b1 + 3.4, b1 + 4.5)), { color: green, width: 9 });

    // ---------------------------------------------------------------- left: the petition first
    {
      // the petition writes itself, then is sent to the other side (the middle line)
      const w = pr(t, b2 + 0.6, b2 + 2.2);
      const send = ease.in(pr(t, b2 + 2.3, b2 + 2.8));
      const back = ease.out(pr(t, b2 + 2.8, b2 + 3.6));
      if (w > 0 && back <= 0) doc(c, { x: lerp(LX, 430, send), y: 800, w: 250, rot: -4 + send * 10, title: "POZEW", tone: "red", write: w, alpha: Math.min(1, w * 4), lift: 1 + send });
      // the hit on the dividing line
      const hit = pr(t, b2 + 2.75, b2 + 3.3);
      if (hit > 0 && hit < 1) {
        c.strokeStyle = rgba(NE.red, 1 - hit);
        c.lineWidth = 7;
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(540, 800 + i * 60);
          c.lineTo(540 - 40 - hit * 50, 800 + i * (60 + hit * 50));
          c.stroke();
        }
      }
      if (back > 0) {
        doc(c, { x: lerp(430, LX - 60, back), y: lerp(800, 830, back), w: 250, rot: lerp(6, -9, back), title: "POZEW", tone: "red", fade: 0.5 * back, lift: 0.4 });
        const p = bez([520, 800], [420, 980], [LX + 40, 1180], back);
        doc(c, { x: p[0], y: p[1], w: 250, rot: lerp(14, 5, back), title: "ODPOWIEDŹ", tone: "red", lift: 1.6 - back });
      }
      flow(c, [[LX, 560], [LX, 640]], pr(t, b2 + 0.2, b2 + 0.7), { color: red, width: 9, head: false });
      // the open questions branch out of the answer
      const qs: Array<[string, number, number]> = [["DZIECI?", LX - 110, 1500], ["PIENIĄDZE?", LX + 60, 1620], ["MIESZKANIE?", LX - 40, 1760]];
      qs.forEach(([q, x, y], i) => {
        const k = pr(t, b2 + 3.9 + i * 0.45, b2 + 4.6 + i * 0.45);
        if (k <= 0) return;
        const p = bez([LX + 40, 1350], [x + (i - 1) * 160, 1420], [x, y - 40], ease.inOut(k));
        c.strokeStyle = red;
        c.lineWidth = 7;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(LX + 40, 1350);
        c.quadraticCurveTo(lerp(LX + 40, x + (i - 1) * 160, ease.inOut(k)), lerp(1350, 1420, ease.inOut(k)), p[0], p[1]);
        c.stroke();
        const a = ease.back(pr(t, b2 + 4.4 + i * 0.45, b2 + 4.9 + i * 0.45));
        if (a > 0) {
          c.save();
          c.translate(x, y);
          c.scale(a, a);
          c.rotate(((i - 1) * 4 * Math.PI) / 180);
          c.fillStyle = NE.paper;
          c.shadowColor = rgba("#2B2416", 0.16);
          c.shadowBlur = 26;
          c.shadowOffsetY = 10;
          rr(c, -165, -44, 330, 88, 44);
          c.fill();
          c.shadowColor = "transparent";
          label(c, q, 0, 3, 46, { color: mix(NE.red, NE.ink, 0.45) });
          c.restore();
        }
      });
      // more documents, then the court has to decide
      for (let i = 0; i < 5; i++) {
        const k = ease.out(pr(t, b3 + 0.3 + i * 0.3, b3 + 1.0 + i * 0.3));
        if (k <= 0) continue;
        const rd = rng(40 + i);
        doc(c, { x: LX - 130 + i * 62 + rd() * 20, y: lerp(1900, 1990 + rd() * 70, k), w: 150, rot: (rd() - 0.5) * 46, tone: i % 2 ? "red" : "plain", alpha: Math.min(1, k * 3), lift: 0.6 });
      }
      const ck = ease.out(pr(t, b3 + 1.6, b3 + 2.4));
      court(c, { x: LX, y: 2330, s: 0.62, alpha: ck });
      label(c, "ROZSTRZYGA", LX, 2478, 44, { color: NE.ink, alpha: ck });
      flow(c, [[LX, 2110], [LX, 2200]], pr(t, b3 + 1.4, b3 + 1.9), { color: red, width: 9 });
    }

    // ----------------------------------------------------------------- right: the plan first
    {
      roadmap(c, { x: RX, y: 760, k: pr(t, b3 + 0.9, b3 + 2.1), s: 0.82 });
      label(c, "PLAN", RX, 596, 62, { color: NE.ink, alpha: ease.out(pr(t, b3 + 0.9, b3 + 1.5)), track: 3 });
      const areas: Array<["children" | "finance" | "home", string, number]> = [["children", "DZIECI", 1090], ["finance", "FINANSE", 1390], ["home", "MIESZKANIE", 1690]];
      const T = [b3 + 2.4, b3 + 3.7, b3 + 5.0];
      let prevY = 880;
      areas.forEach(([kind, name, y], i) => {
        flow(c, [[RX, prevY], [RX, y - 140]], ease.inOut(pr(t, T[i] - 0.5, T[i] + 0.1)), { color: green, width: 9 });
        // two of the three can be agreed; the third stays open (no promise that everything will be)
        lifeArea(c, kind, { x: RX, y, w: 300, k: pr(t, T[i], T[i] + 0.7), text: name, ok: i < 2 ? pr(t, T[i] + 0.75, T[i] + 1.15) : 0, tone: i < 2 && t > T[i] + 0.9 ? "green" : "plain" });
        prevY = y + 132;
      });
      const open = ease.out(pr(t, T[2] + 0.8, T[2] + 1.3));
      if (open > 0) label(c, "do ustalenia", RX, 1690 + 172, 34, { color: NE.muted, weight: 600, alpha: open });
      // the documents: one tidy stack out of what was agreed
      flow(c, [[RX, 1900], [RX, 1960]], ease.inOut(pr(t, b4, b4 + 0.4)), { color: green, width: 9 });
      const leave = ease.inOut(pr(t, b4 + 1.6, b4 + 2.8));
      for (let i = 0; i < 3; i++) {
        const k = ease.out(pr(t, b4 + 0.25 + i * 0.2, b4 + 0.9 + i * 0.2));
        if (k <= 0 || (i === 2 && leave > 0)) continue;
        doc(c, { x: RX, y: lerp(2020, 2100 - i * 10, k), w: 190, tone: "green", alpha: Math.min(1, k * 3), title: i === 2 ? "POZEW" : undefined, lift: 0.5, write: k });
      }
      if (leave > 0) doc(c, { x: RX, y: lerp(2080, 2360, leave), w: 190, s: lerp(1, 0.5, leave), tone: "green", title: "POZEW", alpha: 1 - pr(t, b4 + 2.65, b4 + 2.8) });
      const ck = ease.out(pr(t, b4 + 1.0, b4 + 1.7));
      court(c, { x: RX, y: 2330, s: 0.62, alpha: ck, tone: "green", pulse: pr(t, b4 + 2.7, b4 + 3.3) });
    }

    // ------------------------------------------------------------- both reach the same word
    flow(c, [[LX, 2520], [LX, 2600], [440, 2690]], ease.inOut(pr(t, b5 + 0.4, b5 + 1.3)), { color: red, width: 9 });
    flow(c, [[RX, 2450], [RX, 2600], [640, 2690]], ease.inOut(pr(t, b5 + 0.4, b5 + 1.3)), { color: green, width: 9 });
    const end = pr(t, b5 + 1.1, b5 + 1.9);
    if (end > 0) {
      c.save();
      c.globalAlpha *= Math.min(1, end * 2);
      c.fillStyle = NE.ink;
      rr(c, 540 - 250 * ease.back(end), 2650, 500 * ease.back(end), 170, 85);
      c.fill();
      label(c, "ROZWÓD", 540, 2738, 86, { color: NE.cream, track: 6, alpha: ease.out(pr(t, b5 + 1.5, b5 + 2.0)) });
      c.restore();
    }
    void node;
  });
  outro(c, t, b6, { big: ["TEN SAM CEL.", { t: "INNY POCZĄTEK.", color: NE.goldSoft }], small: "Rozwód zaczyna się\nod planu, nie od pozwu.", note: "Wcześniejsze przygotowanie porządkuje sprawę, ale nie gwarantuje jej przebiegu.", logo: env.logo, size: 112 });
  finish(c, t, { dark: clamp((t - b6) / 0.8) });
}

export const reel02: Reel = {
  id: "dwa-sposoby",
  n: 2,
  title: "Dwa sposoby rozpoczęcia rozwodu",
  idea: "Ten sam cel, inny początek: pozew jako pierwszy krok kontra plan jako pierwszy krok.",
  duration: 29.6,
  beats,
  status: "ready",
  draw,
};
