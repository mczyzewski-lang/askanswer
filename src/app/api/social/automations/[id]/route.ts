import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";
import { AutomationInput, automationView } from "@/lib/server/social/automation-input";
import { fold } from "@/lib/social/automation";
import type { SocialPlatform } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const cur = await prisma.commentAutomation.findUniqueOrThrow({ where: { id } });
  const a = await projectAccess(cur.projectId, "brand.edit");
  const b = AutomationInput.parse({ ...cur, ...(await req.json()) });
  const others = await prisma.commentAutomation.findMany({ where: { projectId: cur.projectId, id: { not: id } }, select: { keyword: true } });
  if (others.some((o) => fold(o.keyword) === fold(b.keyword))) throw new HttpError(409, `Automatyzacja dla słowa „${b.keyword}” już istnieje.`);
  const row = await prisma.commentAutomation.update({ where: { id }, data: { ...b, platforms: b.platforms as SocialPlatform[] } });
  await audit({ userId: a.user.id, projectId: cur.projectId, action: "automation.updated", entityType: "CommentAutomation", entityId: id, data: { keyword: row.keyword, enabled: row.enabled } });
  return json(automationView(row));
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const cur = await prisma.commentAutomation.findUniqueOrThrow({ where: { id } });
  const a = await projectAccess(cur.projectId, "brand.edit");
  await prisma.commentAutomation.delete({ where: { id } });
  await audit({ userId: a.user.id, projectId: cur.projectId, action: "automation.deleted", entityType: "CommentAutomation", entityId: id, data: { keyword: cur.keyword } });
  return json({ ok: true });
});
