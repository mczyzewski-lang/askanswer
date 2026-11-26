import { embedHtml, variantOf } from "@/lib/server/embed";

export const dynamic = "force-dynamic";

/** The player shown in the iframe: cover, play button, the film (?p=0 - without the end card). */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const html = await embedHtml(token, variantOf(new URL(req.url).searchParams.get("p"))).catch(() => null);
  if (!html) return new Response("Film nie jest dostępny.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
