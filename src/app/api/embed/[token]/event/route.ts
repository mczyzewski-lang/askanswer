import { recordEmbedEvent } from "@/lib/server/embed";

export const dynamic = "force-dynamic";

/** What an embedded player reports (cover shown, play, how far). Always answers 204: the player never waits for it. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const text = await req.text();
    if (text.length < 2000) await recordEmbedEvent(token, JSON.parse(text), req.headers.get("user-agent") ?? "");
  } catch {
    // a broken report is not worth an error
  }
  return new Response(null, { status: 204 });
}
