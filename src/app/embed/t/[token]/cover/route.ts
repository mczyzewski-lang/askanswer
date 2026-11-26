import { embedMediaUrl, variantOf } from "@/lib/server/embed";

export const dynamic = "force-dynamic";

/** The player's cover: a stable address that leads to the file's current signed one. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = await embedMediaUrl(token, "cover", variantOf(new URL(req.url).searchParams.get("p"))).catch(() => null);
  if (!url) return new Response("Nie znaleziono.", { status: 404 });
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}
