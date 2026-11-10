/**
 * Auto Reels (server): the recordings of the project are transcribed by the Ads Studio footage
 * pipeline; here the AI picks the best hooks with their context and each becomes a reel in the Studio:
 * hook → passage, the long pauses cut out (pace), title on top, subtitles in the project style, then
 * the project finishing (zooms) and AI graphics by length.
 */
import { NO_LONG_DASH_RULE } from "../dashes";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env, openaiConfigured } from "./env";
import { enqueue } from "./jobs";
import { openaiErrorText } from "./reel-review";
import { reelDocument, type Footage, type FootageWord, type StoredMatch } from "./ads";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { transcriptSegments } from "../edu";
import { applyAcceptedPauses } from "../editor/timeline";
import { candidatesFor, resolvePicks, type ArClip, type ArRawPick, type ArSegment } from "../auto-reels";
import type { EditorDocument, Waveform } from "../editor/types";

export const AUTO_REELS_SYSTEM = `AUTO_REELS
Jesteś montażystą krótkich form (Instagram Reels, TikTok, YouTube Shorts). Dostajesz transkrypcję długiego nagrania (podcast, rozmowa, webinar) podzieloną na ponumerowane zdania z czasem. Wybierz najlepsze momenty na osobne reelsy.
Każdy reels to:
- HOOK: 1–2 zdania z nagrania, które zatrzymują przewijanie w pierwszych 3 sekundach — mocna teza, zaskakująca liczba, kontrowersja, obietnica konkretu, pytanie, które każdy sobie zadaje. Hook musi być zrozumiały bez kontekstu. Może pochodzić z dalszej części fragmentu (zajawka), a potem reels pokazuje kontekst od początku.
- KONTEKST: ciągły fragment nagrania (kolejne zdania), który rozwija hook i daje pełną, zamkniętą myśl — widz ma zrozumieć temat bez reszty nagrania. Zaczyna się tam, gdzie myśl się zaczyna, kończy pointą (nie w połowie wątku).
Długość hook + kontekst: od {MIN} do {MAX} sekund. Różne reelsy mają dotyczyć różnych tematów — bez powtórek tej samej myśli.
Oceń każdy reels w skali 0–100 (siła hooka, wartość dla widza, czy myśl jest zamknięta). Nie wybieraj powitań, autopromocji, dygresji technicznych.
Odpowiedz wyłącznie JSON: {"reels": [{"hook_from": nr, "hook_to": nr, "from": nr pierwszego zdania kontekstu, "to": nr ostatniego zdania kontekstu, "title": "krótki tytuł nad reelsem, max 60 znaków, po polsku", "score": 0-100, "reason": "dlaczego ten hook działa, 1 zdanie"}]}
Podaj około {N} propozycji.`;

const setStep = (projectId: string, step: string) => prisma.project.update({ where: { id: projectId }, data: { autoReelsStep: step } });

async function chat(model: string, system: string, user: string) {
  return fetch(`${env.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${system}\n${NO_LONG_DASH_RULE}` }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(300_000),
  });
}

/** The AI's candidates for one window of sentences. */
async function askWindow(win: ArSegment[], n: number, opts: { min: number; max: number }): Promise<ArRawPick[]> {
  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(0).padStart(2, "0")}`;
  const system = AUTO_REELS_SYSTEM.replace("{MIN}", String(opts.min)).replace("{MAX}", String(opts.max)).replace("{N}", String(n));
  const user = win.map((s) => `${s.id} [${fmt(s.start)}–${fmt(s.end)}] ${s.text}`).join("\n");
  let model = env.openaiTextModel;
  let res = await chat(model, system, user);
  if ((res.status === 400 || res.status === 404) && /model/i.test(JSON.stringify(await res.clone().json().catch(() => ({})))) && model !== "gpt-4.1") res = await chat((model = "gpt-4.1"), system, user);
  const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(openaiErrorText(res.status, data));
  try {
    const parsed = JSON.parse((data.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?\s*|\s*```$/g, "").replace(/[—–]/g, "-")) as { reels?: ArRawPick[] };
    return Array.isArray(parsed.reels) ? parsed.reels : [];
  } catch {
    throw new Error("OpenAI zwrócił odpowiedź, której nie da się odczytać — spróbuj ponownie.");
  }
}

/** Remove what an earlier run made (its reels and their Studio edits). */
async function clearAutoReels(projectId: string) {
  const old = await prisma.adReel.findMany({ where: { projectId }, select: { compositionId: true } });
  const ids = old.map((r) => r.compositionId).filter((x): x is string => !!x);
  if (ids.length) await prisma.videoComposition.deleteMany({ where: { id: { in: ids }, projectId } });
  await prisma.adReel.deleteMany({ where: { projectId } });
}

/** Worker "autoreels-build": pick the reels with the AI and lay each out in the Studio. */
export async function generateAutoReels(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  await prisma.project.update({ where: { id: projectId }, data: { autoReelsStatus: "RUNNING", autoReelsError: null, autoReelsStep: "Szukanie hooków (AI)" } });
  try {
    const rows = await prisma.adFootage.findMany({ where: { projectId, status: "READY" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    const footage: Footage[] = rows
      .filter((f) => f.assetId && Array.isArray(f.words) && (f.words as unknown[]).length)
      .map((f) => ({ id: f.id, assetId: f.assetId!, name: f.name, duration: f.durationSec ?? 0, words: f.words as unknown as FootageWord[] }));
    if (!footage.length) throw new Error("Brak przetworzonego nagrania z mową — wgraj plik i poczekaj na transkrypcję.");
    if (!openaiConfigured()) throw new Error("Wybór hooków wymaga klucza OPENAI_API_KEY.");
    const opts = { count: project.autoReelsCount, min: project.autoReelsMin, max: project.autoReelsMax };

    // sentences of every recording, numbered across the project
    const segs: ArSegment[] = [];
    footage.forEach((f, src) => {
      for (const s of transcriptSegments(f.words)) segs.push({ id: segs.length, src, start: s.start, end: s.end, text: s.text });
    });
    const total = footage.reduce((n, f) => n + f.duration, 0);
    // windows of ~250 sentences (an hour is ~800–1000), overlapping a little so a thought on the border is seen whole
    const raw: ArRawPick[] = [];
    const W = 250;
    const windows: ArSegment[][] = [];
    for (let i = 0; i < segs.length; i += W - 20) {
      windows.push(segs.slice(i, i + W));
      if (i + W >= segs.length) break;
    }
    for (let k = 0; k < windows.length; k++) {
      const win = windows[k];
      await setStep(projectId, windows.length > 1 ? `Szukanie hooków (AI) — część ${k + 1} z ${windows.length}` : "Szukanie hooków (AI)");
      const winSec = win.reduce((n, s) => n + (s.end - s.start), 0) * 1.15;
      raw.push(...(await askWindow(win, candidatesFor(winSec, total, opts.count), opts)));
    }
    const clips = resolvePicks(segs, raw, opts);
    if (!clips.length) throw new Error("AI nie znalazło fragmentów o wybranej długości — spróbuj z szerszym zakresem długości.");

    await setStep(projectId, `Montaż reelsów (0 z ${clips.length})`);
    await clearAutoReels(projectId);
    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: footage.map((f) => f.assetId) } }, select: { id: true, waveform: true } });
    const waveOf = new Map(assets.map((a) => [a.id, a.waveform as unknown as Waveform | null]));
    const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
    let built = 0;
    for (const [i, c] of clips.entries()) {
      const code = `R${String(i + 1).padStart(2, "0")}`;
      const f = footage[c.src];
      const ms: StoredMatch[] = [
        { role: "hook", text: c.hookText, footageId: f.id, footageName: f.name, start: c.hook[0], end: c.hook[1], score: 1 },
        { role: "body", text: c.bodyText, footageId: f.id, footageName: f.name, start: c.body[0], end: c.body[1], score: 1 },
      ];
      const doc = autoReelDocument(c, ms, footage, waveOf, theme, project);
      const reel = await prisma.adReel.create({
        data: { projectId, code, title: c.title, parts: ms.map((m) => ({ role: m.role, text: m.text })) as unknown as Prisma.InputJsonValue, matches: ms as unknown as Prisma.InputJsonValue, order: i, autoScore: c.score, autoReason: c.reason || null },
      });
      if (!doc) continue;
      const comp = await prisma.videoComposition.create({ data: { projectId, name: `${code} — ${c.title}`, status: "READY_TO_EDIT", document: doc as unknown as Prisma.InputJsonValue } });
      await prisma.adReel.update({ where: { id: reel.id }, data: { compositionId: comp.id } });
      const { applyProjectDefaults } = await import("./project-defaults");
      await applyProjectDefaults(comp.id).catch(() => {});
      if (project.autoBlur || project.autoVoice || project.autoZooms || project.autoImageEnhance) await enqueue("auto-polish", { compositionId: comp.id }, { idempotencyKey: `auto-polish:${comp.id}`, maxAttempts: 2 });
      if (project.autoInfographics) await enqueue("auto-visuals", { compositionId: comp.id }, { idempotencyKey: `auto-visuals:${comp.id}`, maxAttempts: 2 });
      built++;
      await setStep(projectId, `Montaż reelsów (${built} z ${clips.length})`);
    }
    await prisma.project.update({ where: { id: projectId }, data: { autoReelsStatus: "DONE", autoReelsStep: `Gotowe: ${built} reelsów`, autoReelsError: null } });
    return { reels: built, candidates: raw.length };
  } catch (e) {
    await prisma.project.update({ where: { id: projectId }, data: { autoReelsStatus: "FAILED", autoReelsError: (e as Error).message.slice(0, 1000) } });
    throw e;
  }
}

/** Hook → passage like an Ads Studio reel, with the long pauses already cut out (a faster pace). */
function autoReelDocument(c: ArClip, ms: StoredMatch[], footage: Footage[], waveOf: Map<string, Waveform | null>, theme: ReturnType<typeof themeFromRow>, project: Parameters<typeof reelDocument>[5]): EditorDocument | null {
  let doc = reelDocument(c.title, ms, footage, waveOf, theme, project);
  if (!doc) return null;
  doc = { ...doc, pauses: doc.pauses.map((p) => ({ ...p, status: "accepted" as const })) };
  doc = applyAcceptedPauses(doc);
  doc.meta = { ...doc.meta, autoReels: true };
  return doc;
}

/** After a recording is processed: in an Auto Reels project with nothing else still processing, start. */
export async function autoReelsAfterFootage(footageId: string) {
  const f = await prisma.adFootage.findUnique({ where: { id: footageId }, select: { projectId: true, project: { select: { autoReels: true, autoReelsStatus: true } } } });
  if (!f?.project.autoReels || f.project.autoReelsStatus === "RUNNING") return { started: false };
  const pending = await prisma.adFootage.count({ where: { projectId: f.projectId, status: { in: ["UPLOADING", "PROCESSING"] } } });
  if (pending) return { started: false };
  await startAutoReels(f.projectId);
  return { started: true };
}

export async function startAutoReels(projectId: string) {
  await prisma.project.update({ where: { id: projectId }, data: { autoReelsStatus: "RUNNING", autoReelsStep: "W kolejce", autoReelsError: null } });
  await enqueue("autoreels-build", { projectId }, { idempotencyKey: `autoreels-build:${projectId}:${Date.now()}`, maxAttempts: 1 });
}
