import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { OUTRO, setOutroAll } from "@/lib/server/sequence";

export const maxDuration = 300;

/** The outro in every film of the tab, or out of every one. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ on: z.boolean(), kind: z.enum(["sequence", "testimonial"]).default("sequence") }).parse(await req.json());
  return json(await setOutroAll(projectId, b.kind, b.on));
});

/** Remove an uploaded outro clip from the library (films that already carry it keep it until switched off). */
export const DELETE = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  await requireAdmin();
  const { projectId } = await ctx.params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  await prisma.sequenceClip.deleteMany({ where: { projectId, name: OUTRO + name } });
  return json({ ok: true });
});
