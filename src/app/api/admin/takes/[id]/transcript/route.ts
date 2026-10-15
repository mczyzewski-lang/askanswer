import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";

/** Original (unedited) transcript as TXT, or JSON with word timestamps (?format=json). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const tr = await prisma.transcript.findUnique({ where: { takeId: id }, include: { words: { orderBy: { index: "asc" } } } });
  if (!tr) return new Response("Brak transkrypcji", { status: 404 });
  if (new URL(req.url).searchParams.get("format") === "json") {
    return Response.json({ text: tr.text, language: tr.languageCode, model: tr.model, words: tr.words.map((w) => ({ text: w.text, start: w.start, end: w.end, type: w.type })) });
  }
  return new Response(tr.text, {
    headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="transkrypcja-${id}.txt"` },
  });
});
