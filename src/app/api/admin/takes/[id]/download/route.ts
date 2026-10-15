import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { signedUrl } from "@/lib/server/storage";

/** Redirect to a short-lived signed download URL of the untouched original recording. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const t = await prisma.recordingTake.findUniqueOrThrow({ where: { id }, include: { recording: { include: { question: true } } } });
  const which = new URL(req.url).searchParams.get("v") === "normalized" ? t.normalizedAssetId : t.originalAssetId;
  if (!which) return new Response("Plik niedostępny", { status: 404 });
  const a = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: which } });
  const ext = a.storageKey.split(".").pop();
  const name = `${t.recording.question.text.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 50).trim() || "nagranie"} — ujęcie ${t.takeNumber}.${ext}`;
  return NextResponse.redirect(new URL(await signedUrl(a.storageKey, { ttlSec: 600, download: name }), req.url));
});
