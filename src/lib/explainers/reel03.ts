/**
 * Reel 03 — „Pozew to nie plan”. The camera pushes into one petition (it holds a single question),
 * pulls back to the life around it (four areas, each bigger than the document), the petition tries
 * to grow over them and cannot — then the four areas become the plan and the petition takes its
 * place near the end of the road.
 */
import { at, camAt, camera, clamp, court, ease, finish, flow, hero, label, lerp, lifeArea, lock, mix, NE, outro, pr, rgba, rr, stage, useStyle, win, depth, outline, type StyleKey, type Beat, type C, type Reel } from "./kit";

const beats: Beat[] = [
  { id: "pozew", start: 0, end: 4.8, vo: "Pozew o rozwód odpowiada na jedno pytanie: czego żądasz od sądu.", screen: "POZEW O ROZWÓD → CZEGO ŻĄDASZ OD SĄDU?", visual: "Jeden dokument na środku. Kamera wjeżdża w niego; linie tekstu ustępują i zostaje jedno pytanie - tylko tyle mieści ta kartka." },
  { id: "zycie", start: 4.8, end: 10.8, vo: "Ale nie odpowiada na wszystkie pytania o to, jak będzie wyglądało Wasze życie po rozstaniu.", screen: "A ŻYCIE PO ROZSTANIU?", visual: "Kamera odjeżdża: wokół pozwu jest pusto. Dokument okazuje się mały wobec przestrzeni, której nie opisuje." },
  { id: "obszary", start: 10.8, end: 16, vo: "Co z dziećmi? Mieszkaniem? Finansami? Codziennością?", screen: "DZIECI · MIESZKANIE · FINANSE · CODZIENNOŚĆ", visual: "Każde pytanie stawia wokół pozwu jeden obszar życia - większy niż sam dokument: dwa domy i dzieci między nimi, plan mieszkania, wspólna linia, która się rozdziela, tydzień." },
  { id: "rownanie", start: 16, end: 21.2, vo: "Dlatego pozew jest dokumentem. Nie planem rozwodu.", screen: "POZEW = DOKUMENT → PLAN = CAŁA SYTUACJA", visual: "Pozew próbuje urosnąć na wszystkie cztery obszary i wraca do swojego rozmiaru. Złota rama obejmuje całość - to ona jest planem." },
  { id: "droga", start: 21.2, end: 26, vo: "Najpierw zaplanuj. Potem formalizuj.", screen: "PLAN → USTALENIA → POZEW → SĄD", visual: "Cztery obszary zsuwają się w jeden plan; z planu wychodzi droga: ustalenia, dopiero potem pozew - teraz jeden z ostatnich kroków - i sąd." },
  { id: "marka", start: 26, end: 30, vo: "Rozwód zaczyna się od planu, nie od pozwu.", screen: "NAJPIERW ZAPLANUJ. POTEM FORMALIZUJ.", visual: "Ciemna zieleń zamyka kadr schodkami; zostaje kolejność jako wniosek." },
];

const DX = 540;
const DY = 1050;
const AREAS: Array<{ kind: "children" | "home" | "finance" | "daily"; text: string; x: number; y: number; to: [number, number] }> = [
  { kind: "children", text: "DZIECI", x: 40, y: 130, to: [350, 250] },
  { kind: "home", text: "MIESZKANIE", x: 1040, y: 130, to: [730, 250] },
  { kind: "finance", text: "FINANSE", x: 40, y: 2060, to: [350, 590] },
  { kind: "daily", text: "CODZIENNOŚĆ", x: 1040, y: 2060, to: [730, 590] },
];

function petition(c: C, x: number, y: number, w: number, t: number, open: number, alpha = 1) {
  const h = w * 1.36;
  c.save();
  c.translate(x, y);
  c.globalAlpha *= alpha;
  c.save();
  depth(c, 1.8);
  c.fillStyle = NE.paper;
  rr(c, -w / 2, -h / 2, w, h, w * 0.035);
  c.fill();
  outline(c);
  c.restore();
  c.fillStyle = NE.ink;
  rr(c, -w / 2, -h / 2, w, w * 0.03, w * 0.02);
  c.fill();
  label(c, "POZEW", -w / 2 + w * 0.1, -h / 2 + w * 0.17, w * 0.1, { align: "left", track: 2 });
  c.fillStyle = NE.gold;
  c.fillRect(-w / 2 + w * 0.1, -h / 2 + w * 0.25, w * 0.16, w * 0.012);
  // the text lines give way to the one question the document holds
  const rows = [0.92, 0.78, 0.86, 0.6, 0.82, 0.7, 0.5];
  rows.forEach((f, i) => {
    const a = 1 - ease.inOut(clamp(open * 1.6 - i * 0.08));
    if (a <= 0) return;
    c.fillStyle = rgba(NE.line, a);
    rr(c, -w / 2 + w * 0.1, -h / 2 + w * 0.36 + i * w * 0.11, w * 0.8 * f, w * 0.036, w * 0.018);
    c.fill();
  });
  const q = clamp(open * 1.5 - 0.5);
  if (q > 0) hero(c, ["CZEGO", "ŻĄDASZ", { t: "OD SĄDU?", color: mix(NE.gold, NE.ink, 0.25) }], 0, w * 0.16, w * 0.135, q, { color: NE.ink });
  void t;
  c.restore();
}

function draw(c: C, t: number, env: { logo?: { width: number; height: number } | null; style?: StyleKey | null }) {
  useStyle(env.style);
  const r = reel03;
  const b1 = at(r, "pozew").start;
  const b2 = at(r, "zycie").start;
  const b3 = at(r, "obszary").start;
  const b4 = at(r, "rownanie").start;
  const b5 = at(r, "droga").start;
  const b6 = at(r, "marka").start;
  const cam = camAt(t, [
    [b1, { x: DX, y: 940, s: 1.0 }],
    [b1 + 1.6, { x: DX, y: 960, s: 1.04 }],
    [b1 + 3.6, { x: DX, y: DY + 60, s: 1.42 }],
    [b2 - 0.2, { x: DX, y: DY + 60, s: 1.46 }],
    [b2 + 2.4, { x: DX, y: DY, s: 0.6 }],
    [b4, { x: DX, y: DY, s: 0.58 }],
    [b5, { x: DX, y: DY, s: 0.6 }],
    [b5 + 1.8, { x: DX, y: 1090, s: 0.76 }],
    [b6, { x: DX, y: 1100, s: 0.78 }],
  ]);
  // the areas glide into one plan (beat 5)
  const gather = ease.inOut(pr(t, b5 + 0.1, b5 + 1.5));
  // the petition: tries to grow (beat 4), then takes its place on the road (beat 5)
  const grow = Math.sin(pr(t, b4 + 0.2, b4 + 1.7) * Math.PI) * 0.34;
  const place = ease.inOut(pr(t, b5 + 0.5, b5 + 1.9));
  stage(c, { cam });
  camera(c, cam, t, () => {
    // the plan: one gold frame around everything the petition does not describe
    const fr = ease.inOut(pr(t, b4 + 2.9, b4 + 4.2));
    if (fr > 0 && gather < 1) {
      const x0 = lerp(-370, 150, gather);
      const y0 = lerp(-230, 75, gather);
      const w = lerp(1820, 780, gather);
      const h = lerp(2650, 690, gather);
      c.save();
      c.strokeStyle = NE.gold;
      c.lineWidth = 12;
      c.setLineDash([w * 2 + h * 2]);
      c.lineDashOffset = (w * 2 + h * 2) * (1 - fr);
      rr(c, x0, y0, w, h, 60);
      c.stroke();
      c.restore();
    }
    // the road out of the plan
    const green = mix(NE.ok, NE.ink, 0.25);
    flow(c, [[DX, 790], [DX, 900]], ease.inOut(pr(t, b5 + 1.5, b5 + 2.0)), { color: green, width: 12 });
    lock(c, { x: DX, y: 1040, k: pr(t, b5 + 1.9, b5 + 2.8), s: 0.9 });
    label(c, "USTALENIA", DX, 1205, 84, { alpha: ease.out(pr(t, b5 + 2.1, b5 + 2.7)) });
    flow(c, [[DX, 1270], [DX, 1360]], ease.inOut(pr(t, b5 + 2.7, b5 + 3.1)), { color: green, width: 12 });
    flow(c, [[DX, 1830], [DX, 1920]], ease.inOut(pr(t, b5 + 3.4, b5 + 3.8)), { color: green, width: 12 });
    const ck = ease.out(pr(t, b5 + 3.7, b5 + 4.4));
    court(c, { x: DX, y: 2110 + (1 - ck) * 50, alpha: ck, tone: "green", s: 0.95 });

    AREAS.forEach((a, i) => {
      const T0 = b3 + 0.15 + i * 1.25;
      lifeArea(c, a.kind, { x: lerp(a.x, a.to[0], gather), y: lerp(a.y, a.to[1], gather), w: lerp(760, 350, gather), k: pr(t, T0, T0 + 0.8), text: a.text });
    });
    label(c, "PLAN", DX, -20, 110, { alpha: ease.out(pr(t, b5 + 1.2, b5 + 1.8)), track: 6 });

    // (smaller once the camera has pulled back: the life around it is bigger than the document)
    const w = lerp(lerp(600, 440, ease.inOut(pr(t, b2 + 0.4, b2 + 2.4))), 330, place) * (1 + grow);
    petition(c, DX + Math.sin(pr(t, b4 + 1.7, b4 + 2.3) * Math.PI * 4) * 10 * (1 - pr(t, b4 + 1.7, b4 + 2.3)), lerp(DY, 1600, place), w, t, pr(t, b1 + 2.0, b1 + 3.6) * (1 - pr(t, b2 + 1.2, b2 + 2.2)));
    label(c, "POZEW", DX + 250, 1600, 84, { align: "left", alpha: ease.out(pr(t, b5 + 2.6, b5 + 3.2)) * 0 });
  });
  // the words (screen space: always the same size, whatever the camera does)
  hero(c, ["POZEW", "O ROZWÓD"], 540, 300, 150, pr(t, b1 + 0.2, b1 + 1.0), { out: pr(t, b1 + 1.9, b1 + 2.5) });
  hero(c, ["A ŻYCIE", { t: "PO ROZSTANIU?", color: mix(NE.gold, NE.ink, 0.3) }], 540, 430, 124, pr(t, b2 + 2.0, b2 + 2.9), { out: pr(t, b3 - 0.3, b3 + 0.2) });
  // one area named at a time, in the band above the petition
  AREAS.forEach((a, i) => {
    const T0 = b3 + 0.1 + i * 1.25;
    const al = win(t, T0, i === 3 ? b4 + 0.2 : T0 + 1.27, 0.2);
    if (al > 0) label(c, `${a.text}?`, 540, 694, a.text.length > 9 ? 96 : 116, { alpha: al, color: NE.ink });
  });
  const e1 = win(t, b4 + 1.4, b4 + 3.0, 0.3);
  if (e1 > 0) {
    label(c, "POZEW", 540, 1200, 92, { alpha: e1 });
    label(c, "= DOKUMENT", 540, 1294, 92, { alpha: e1 * ease.out(pr(t, b4 + 1.8, b4 + 2.2)), color: mix(NE.red, NE.ink, 0.4) });
  }
  const e2 = win(t, b4 + 3.2, b5 + 0.3, 0.3);
  if (e2 > 0) {
    label(c, "PLAN", 540, 640, 88, { alpha: e2, color: mix(NE.gold, NE.ink, 0.3) });
    label(c, "= CAŁA SYTUACJA", 540, 722, 78, { alpha: e2 * ease.out(pr(t, b4 + 3.6, b4 + 4.1)) });
  }
  outro(c, t, b6, { big: ["NAJPIERW", "ZAPLANUJ."], small: "Potem formalizuj.", note: "Rozwód zaczyna się od planu, nie od pozwu.", logo: env.logo, size: 138 });
  finish(c, t, { dark: clamp((t - b6) / 0.8) });
}

export const reel03: Reel = {
  id: "pozew-to-nie-plan",
  n: 3,
  title: "Pozew to nie plan",
  idea: "Pozew odpowiada na jedno pytanie - czego żądasz od sądu. Plan obejmuje całe życie po rozstaniu.",
  duration: 30,
  beats,
  status: "ready",
  draw,
};
