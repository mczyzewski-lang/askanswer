import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { historyOf, importHistory } from "@/lib/server/adwords-history";

export const runtime = "nodejs";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  return json(await historyOf(projectId));
});

/** Import the Google Ads asset report (dryRun = preview only). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ text: z.string().min(1).max(10_000_000), fileName: z.string().max(300).default("raport.csv"), dryRun: z.boolean().default(true) }).parse(await req.json());
  try {
    return json(await importHistory(projectId, b.text, b.fileName, b.dryRun));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
