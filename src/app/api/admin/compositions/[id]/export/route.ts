import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import type { EditorDocument } from "@/lib/editor/types";
import { toPlainText, toSRT } from "@/lib/editor/subtitles";

/** Edited subtitles as SRT (timeline-mapped, reflects every cut) or plain TXT. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const comp = await prisma.videoComposition.findUniqueOrThrow({ where: { id } });
  const doc = comp.document as unknown as EditorDocument;
  const type = new URL(req.url).searchParams.get("type") === "txt" ? "txt" : "srt";
  const body = type === "srt" ? toSRT(doc) : toPlainText(doc);
  return new Response(body, {
    headers: { "content-type": `${type === "srt" ? "application/x-subrip" : "text/plain"}; charset=utf-8`, "content-disposition": `attachment; filename="napisy-${id}.${type}"` },
  });
});
