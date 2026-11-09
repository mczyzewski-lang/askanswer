/**
 * Google Adwords — more creatives from the concepts already there:
 * - "z ekspertem": the same headline / CTA with a real photo of an expert from the library (layout
 *   expert_split), one new concept per source concept (G03 → G03E), photos taken in turn;
 * - "z infografiką": an infographic drawn by OpenAI (the reels' infographic rules, the theme's palette),
 *   one picture per format, shown full-bleed with the CTA and the gold frame (G03 → G03I). The text in
 *   the picture is AI's: the new concept needs a person's approval before it is published.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { enqueue } from "./jobs";
import { makeTempDir, putFile } from "./storage";
import { randomToken } from "./crypto";
import { generateOpenAIImage } from "./openai-images";
import { openaiConfigured, openaiKeyDiagnostics } from "./env";
import { themeFromRow, DEFAULT_THEME } from "../themes";
import { adInfographicPrompt } from "../infographic-prompt";
import { fillStyle } from "../broll-style";
import { stepsOf } from "../adwords/draw";
import { formatKeyOf } from "../adwords/spec";

type Row = Prisma.AdwordsAssetGetPayload<object>;
const COPY_SKIP = new Set(["id", "projectId", "createdAt", "updatedAt", "assetKey", "conceptId", "approvedAt", "approvedBy", "order"]);
const keyFor = (src: Row, c: string, suffix: string) => (src.assetKey.startsWith(c) ? `${c}${suffix}${src.assetKey.slice(c.length)}` : `${src.assetKey}-${suffix}`);

async function sourceConcepts(projectId: string, conceptIds?: string[]) {
  const rows = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image", ...(conceptIds?.length ? { conceptId: { in: conceptIds } } : {}) }, orderBy: { order: "asc" } });
  const by = new Map<string, Row[]>();
  for (const r of rows) if (r.conceptId) by.set(r.conceptId, [...(by.get(r.conceptId) ?? []), r]);
  return by;
}
const taken = async (projectId: string) => new Set((await prisma.adwordsAsset.findMany({ where: { projectId }, select: { conceptId: true } })).map((r) => r.conceptId).filter((x): x is string => !!x));

/**
 * Copies of each concept with an expert's photo — one per chosen photo (default: the photos with consent).
 * A concept that already shows a photo gets copies with the OTHER photos. Concept ids: G03E, G03E2, G03E3…
 */
export async function expertVariants(projectId: string, conceptIds?: string[], photoIds?: string[]) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: { include: { expertPhotos: { orderBy: { createdAt: "asc" } } } } } });
  const all = project.theme?.expertPhotos ?? [];
  if (!all.length) throw new HttpError(400, "Najpierw dodaj zdjęcia ekspertów (zakładka Zdjęcia ekspertów).");
  const chosen = photoIds?.length ? all.filter((p) => photoIds.includes(p.id)) : all.filter((p) => p.consentConfirmed).length ? all.filter((p) => p.consentConfirmed) : all;
  if (!chosen.length) throw new HttpError(400, "Wybierz zdjęcia.");
  const used = await taken(projectId);
  // which photo each existing variant uses (no duplicates of the same concept + photo)
  const existing = await prisma.adwordsAsset.findMany({ where: { projectId, rowType: "image" }, select: { conceptId: true, expertPhotoId: true, edit: true } });
  const has = new Set(existing.filter((e) => e.expertPhotoId).map((e) => `${((e.edit ?? {}) as { variantOf?: string }).variantOf ?? e.conceptId}|${e.expertPhotoId}`));
  const made: string[] = [];
  const skipped: string[] = [];
  let max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  for (const [c, rows] of await sourceConcepts(projectId, conceptIds)) {
    const edit = (rows[0].edit ?? {}) as { variantOf?: string };
    if (edit.variantOf || rows.some((r) => r.layout === "infographic")) {
      skipped.push(c);
      continue;
    }
    for (const photo of chosen) {
      if (has.has(`${c}|${photo.id}`) || rows[0].expertPhotoId === photo.id) continue;
      let id = `${c}E`;
      for (let n = 2; used.has(id); n++) id = `${c}E${n}`;
      used.add(id);
      has.add(`${c}|${photo.id}`);
      for (const r of rows) {
        const data = Object.fromEntries(Object.entries(r).filter(([key]) => !COPY_SKIP.has(key))) as Record<string, unknown>;
        await prisma.adwordsAsset.create({
          data: {
            ...(data as object),
            projectId,
            conceptId: id,
            assetKey: keyFor(r, c, id.slice(c.length)),
            layout: "expert_split",
            expertPhotoId: photo.id,
            expertPhotoKey: photo.key,
            experimentId: null,
            variant: null,
            pairedAssetId: null,
            lp: r.lp ? ({ ...(r.lp as object), layout_id: "expert_split" } as Prisma.InputJsonValue) : Prisma.JsonNull,
            edit: { variantOf: c } as Prisma.InputJsonValue,
            extra: (r.extra ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            order: ++max,
          } as Prisma.AdwordsAssetUncheckedCreateInput,
        });
      }
      made.push(id);
    }
  }
  return { made, skipped, photos: chosen.length };
}

/** start the infographic versions (a background job per concept) */
export async function startInfographics(projectId: string, conceptIds: string[]) {
  if (!openaiConfigured()) throw new HttpError(400, `Infografiki wymagają klucza OpenAI. ${openaiKeyDiagnostics()}`);
  if (!conceptIds.length) throw new HttpError(400, "Zaznacz koncepty (pole wyboru na karcie).");
  if (conceptIds.length > 6) throw new HttpError(400, "Najwyżej 6 konceptów naraz (każdy to 3 obrazy AI).");
  const used = await taken(projectId);
  const jobs: string[] = [];
  for (const c of conceptIds) {
    if (used.has(`${c}I`)) continue;
    const j = await enqueue("adwords-infographic", { projectId, conceptId: c }, { idempotencyKey: `adwords-infographic:${projectId}:${c}`, maxAttempts: 2 });
    jobs.push(j.id);
  }
  return { jobs: jobs.length };
}

const RATIO: Record<string, "1.91:1" | "1:1" | "4:5"> = { landscape: "1.91:1", square: "1:1", portrait: "4:5" };

/** worker "adwords-infographic": three pictures (one per format) → a new concept G…I awaiting approval */
export async function runAdInfographic(projectId: string, conceptId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { theme: true } });
  const rows = (await sourceConcepts(projectId, [conceptId])).get(conceptId) ?? [];
  if (!rows.length) throw new Error(`Brak konceptu ${conceptId}`);
  if (await prisma.adwordsAsset.findFirst({ where: { projectId, conceptId: `${conceptId}I` } })) return { skipped: true };
  const theme = project.theme ? themeFromRow(project.theme) : DEFAULT_THEME;
  const style = project.theme?.brollStyle ? fillStyle(project.theme.brollStyle, theme) : null;
  const src = rows[0];
  const steps = stepsOf(src.body);
  const items = (steps.length ? steps : [src.subheadline, src.body].filter((x): x is string => !!x?.trim()).slice(0, 3)).map((t) => ({ value: t, label: "" }));
  const dir = await makeTempDir("adwords-infographic");
  const max = (await prisma.adwordsAsset.aggregate({ where: { projectId }, _max: { order: true } }))._max.order ?? 0;
  try {
    const made: string[] = [];
    for (const [k, r] of rows.entries()) {
      const fk = formatKeyOf(r.aspectRatio, r.width, r.height) ?? "square";
      const W = r.width ?? 1200;
      const H = r.height ?? 1200;
      const raw = path.join(dir, `${k}-raw.png`);
      await generateOpenAIImage(adInfographicPrompt({ headline: src.headline ?? "", items }, theme, style, RATIO[fk] ?? "1:1"), { width: W, height: H, out: raw });
      // cover-crop to the exact format pixels
      const img = await loadImage(await fsp.readFile(raw));
      const cv = createCanvas(W, H);
      const s = Math.max(W / img.width, H / img.height);
      cv.getContext("2d").drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      const out = path.join(dir, `${k}.png`);
      await fsp.writeFile(out, cv.toBuffer("image/png"));
      const key = `projects/${projectId}/uploads/${randomToken(12)}.png`;
      const size = await putFile(key, out, "image/png");
      const asset = await prisma.mediaAsset.create({ data: { kind: "IMAGE", projectId, storageKey: key, mimeType: "image/png", sizeBytes: size, width: W, height: H, hasAudio: false, hasVideo: true, originalName: `Infografika Adwords ${conceptId} ${fk}`, meta: { source: "adwords-infographic", conceptId } } });
      const data = Object.fromEntries(Object.entries(r).filter(([key2]) => !COPY_SKIP.has(key2))) as Record<string, unknown>;
      const a = await prisma.adwordsAsset.create({
        data: {
          ...(data as object),
          projectId,
          conceptId: `${conceptId}I`,
          assetKey: keyFor(r, conceptId, "I"),
          layout: "infographic",
          expertPhotoId: null,
          expertPhotoKey: null,
          experimentId: null,
          variant: null,
          pairedAssetId: null,
          // the text in the picture is AI's — a person checks the spelling and approves it
          approvalRequired: true,
          claimSource: "Infografika wygenerowana przez AI — sprawdź pisownię i liczby przed publikacją",
          lp: r.lp ? ({ ...(r.lp as object), layout_id: "infographic" } as Prisma.InputJsonValue) : Prisma.JsonNull,
          edit: { variantOf: conceptId, infographicAssetId: asset.id } as Prisma.InputJsonValue,
          extra: (r.extra ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          order: max + 1 + k,
        } as Prisma.AdwordsAssetUncheckedCreateInput,
      });
      made.push(a.id);
    }
    return { conceptId: `${conceptId}I`, assets: made };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}
