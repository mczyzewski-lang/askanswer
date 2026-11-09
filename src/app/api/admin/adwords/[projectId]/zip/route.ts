import { requireAdmin } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { adwordsZip } from "@/lib/server/adwords";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Every image (PNG or JPG), the manifest (CSV + JSON), the CSV, subtitles, teleprompter, shot list and brief. */
export const GET = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const fmt = q.get("fmt") === "jpg" ? "jpg" : "png";
  const list = (k: string) => (q.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // a selection: ?assets=id,id / ?concepts=G02 / ?experiment=T01&variant=B, ?parts=texts,landing (nothing = everything)
  const z = await adwordsZip(projectId, fmt, { assetIds: list("assets"), conceptIds: list("concepts"), experimentId: q.get("experiment") ?? undefined, variant: q.get("variant") ?? undefined, parts: list("parts").filter((x) => ["images", "videos", "texts", "report", "landing"].includes(x)) });
  return new Response(new Uint8Array(z.zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.name}"`, "Cache-Control": "no-store" } });
});
