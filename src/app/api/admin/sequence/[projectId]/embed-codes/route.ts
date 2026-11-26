import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { embedCodesText } from "@/lib/server/embed";

/** The embed codes of every film (with and without the end card) as a text file. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") === "testimonial" ? "testimonial" : "sequence";
  const origin = req.headers.get("x-forwarded-host") ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host")}` : u.origin;
  return new Response(await embedCodesText(projectId, kind, origin), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="kody-embed-${kind === "testimonial" ? "testimoniale" : "sekwencja"}.txt"` } });
});
