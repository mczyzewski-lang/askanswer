import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";

/** proof, date and approval of a claim — approval needs a source and the date it was checked */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ projectId: string; claimId: string }> }) => {
  const me = await requireAdmin();
  const { projectId, claimId } = await ctx.params;
  const b = z
    .object({
      claimText: z.string().trim().min(2).max(500).optional(),
      proofSource: z.string().max(1000).nullable().optional(),
      dateChecked: z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional(),
      claimScope: z.string().max(500).nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
      approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
    })
    .parse(await req.json());
  const c = await prisma.adwordsClaim.findFirstOrThrow({ where: { id: claimId, projectId } });
  const next = { proofSource: b.proofSource !== undefined ? b.proofSource : c.proofSource, dateChecked: b.dateChecked !== undefined ? (b.dateChecked ? new Date(b.dateChecked) : null) : c.dateChecked };
  if (b.approvalStatus === "approved" && (!next.proofSource?.trim() || !next.dateChecked)) throw new HttpError(400, "Zatwierdzenie wymaga źródła dowodu i daty sprawdzenia.");
  const status = b.approvalStatus ?? (c.approvalStatus === "approved" && (!next.proofSource?.trim() || !next.dateChecked) ? "pending" : c.approvalStatus);
  const u = await prisma.adwordsClaim.update({
    where: { id: c.id },
    data: { ...b, dateChecked: next.dateChecked, approvalStatus: status, approvedBy: status === "approved" ? (b.approvalStatus === "approved" ? me.email : c.approvedBy) : null },
  });
  return json(u);
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ projectId: string; claimId: string }> }) => {
  await requireAdmin();
  const { projectId, claimId } = await ctx.params;
  await prisma.adwordsClaim.deleteMany({ where: { id: claimId, projectId } });
  return json({ ok: true });
});
