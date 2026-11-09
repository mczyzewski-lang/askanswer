import { route } from "@/lib/server/http";
import { adwordsZip } from "@/lib/server/adwords";
import { shareHeaders, shareOf } from "@/lib/server/adwords-share";

export const runtime = "nodejs";
export const maxDuration = 300;

/** the agency's package: only components that passed the gates; ?concepts=G01&parts=texts&fmt=jpg narrow it */
export const GET = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const s = await shareOf(token, { count: true });
  const q = new URL(req.url).searchParams;
  const list = (k: string) => (q.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const z = await adwordsZip(s.projectId, q.get("fmt") === "jpg" ? "jpg" : "png", { conceptIds: list("concepts"), parts: list("parts").filter((x) => ["images", "videos", "texts", "report", "landing"].includes(x)), onlyReady: true });
  return new Response(new Uint8Array(z.zip), { headers: { ...shareHeaders, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"` } });
});
