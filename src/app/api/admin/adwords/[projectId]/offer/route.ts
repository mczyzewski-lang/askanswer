import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { offerMissing } from "@/lib/adwords/landing-content";

const f = z.string().max(1000).optional();
/** What the free Plan Rozwodu really is — and a person's confirmation that it is delivered. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ projectId: string }> }) => {
  const me = await requireAdmin();
  const { projectId } = await ctx.params;
  const b = z.object({ producer: f, when: f, form: f, contents: f, requiresCall: f, whatIsFree: f, servicePrice: f, confirmed: z.boolean().optional() }).parse(await req.json());
  const { confirmed, ...fields } = b;
  if (confirmed && offerMissing(fields).length) throw new HttpError(400, `Nie można potwierdzić — uzupełnij: ${offerMissing(fields).join(", ")}.`);
  const offer = { ...fields, confirmed: !!confirmed, confirmedBy: confirmed ? me.email : null, confirmedAt: confirmed ? new Date().toISOString() : null };
  await prisma.project.update({ where: { id: projectId }, data: { adwordsOffer: offer as Prisma.InputJsonValue } });
  return json(offer);
});
