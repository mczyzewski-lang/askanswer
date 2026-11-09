import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { importAdwordsCsv } from "@/lib/server/adwords";
import { ADWORDS_COLUMNS } from "@/lib/adwords/csv";

export const runtime = "nodejs";

/** Read the CSV (dryRun = only the preview, mapping and errors) or import it (upsert by asset_id). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z
    .object({
      text: z.string().min(1).max(5_000_000),
      dryRun: z.boolean().default(true),
      mapping: z.record(z.string(), z.enum(ADWORDS_COLUMNS).nullable()).optional(),
    })
    .parse(await req.json());
  const out = await importAdwordsCsv(projectId, b.text, { mapping: b.mapping, dryRun: b.dryRun });
  return json({ ...out, assets: undefined, total: out.assets.length });
});
