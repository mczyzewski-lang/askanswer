import { prisma } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";
import { AutomationInput, automationView } from "@/lib/server/social/automation-input";
import { fold } from "@/lib/social/automation";
import type { SocialPlatform } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

/** comment automations of the project ("Skomentuj PLAN") */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "comments.view");
  const [rows, brand] = await Promise.all([prisma.commentAutomation.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" } }), prisma.brandSettings.findUnique({ where: { projectId: id }, select: { website: true } })]);
  return json({ automations: rows.map(automationView), canEdit: a.perms.has("brand.edit"), website: brand?.website ?? "" });
});

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "brand.edit");
  const b = AutomationInput.parse(await req.json());
  const others = await prisma.commentAutomation.findMany({ where: { projectId: id }, select: { keyword: true } });
  if (others.some((o) => fold(o.keyword) === fold(b.keyword))) throw new HttpError(409, `Automatyzacja dla słowa „${b.keyword}” już istnieje.`);
  const row = await prisma.commentAutomation.create({ data: { ...b, platforms: b.platforms as SocialPlatform[], projectId: id, createdById: a.user.id } });
  await audit({ userId: a.user.id, projectId: id, action: "automation.created", entityType: "CommentAutomation", entityId: row.id, data: { keyword: row.keyword } });
  return json(automationView(row), 201);
});
