import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { parseAdsScript } from "@/lib/ads-script";
import Papa from "papaparse";

/**
 * The script file: one row per reel. Reels are matched by their id — an updated file changes their
 * texts (the edit stays until the reel is laid out again); reels no longer in the file are removed
 * unless they already have an edit.
 */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const { text } = z.object({ text: z.string().min(1).max(5_000_000) }).parse(await req.json());
  const { reels, errors } = parseAdsScript(text);
  if (!reels.length) return json({ error: errors[0] ?? "Nie znaleziono reelsów w pliku.", errors }, 400);
  await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  let created = 0;
  let updated = 0;
  for (const [i, r] of reels.entries()) {
    const existing = await prisma.adReel.findUnique({ where: { projectId_code: { projectId, code: r.code } } });
    const data = { title: r.title, groupCode: r.group, parts: r.parts as unknown as Prisma.InputJsonValue, order: i };
    if (existing) {
      await prisma.adReel.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.adReel.create({ data: { projectId, code: r.code, ...data } });
      created++;
    }
  }
  const removed = await prisma.adReel.deleteMany({ where: { projectId, code: { notIn: reels.map((r) => r.code) }, compositionId: null } });
  return json({ created, updated, removed: removed.count, errors });
});

/** The campaign's current script as a CSV (with texts swapped in from the scoring) — for the expert. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } });
  const reels = await prisma.adReel.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const roles = [...new Set(reels.flatMap((r) => (r.parts as unknown as Array<{ role: string }>).map((x) => x.role)))].sort((a, b) => (a === "hook" ? -1 : b === "hook" ? 1 : a === "cta" ? 1 : b === "cta" ? -1 : a.localeCompare(b)));
  const rows = [["reel", "hook-number", "tytuł", ...roles]];
  for (const r of reels) {
    const parts = r.parts as unknown as Array<{ role: string; text: string }>;
    const reel = r.groupCode ?? r.code;
    const hookNo = r.groupCode ? r.code.slice(r.groupCode.length + 1) : "";
    rows.push([reel, hookNo, r.title ?? "", ...roles.map((role) => parts.find((x) => x.role === role)?.text ?? "")]);
  }
  const csv = "\uFEFF" + Papa.unparse(rows, { delimiter: ";", newline: "\r\n", quotes: true });
  const name = `scenariusze-${p.name.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
});
