import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { audit } from "@/lib/server/social/audit";

const list = z.array(z.string().trim().max(200)).max(200);
const Brand = z.object({
  description: z.string().max(5000),
  audience: z.string().max(3000),
  goal: z.string().max(2000),
  tone: z.string().max(2000),
  website: z.string().max(300),
  products: z.string().max(5000),
  usp: z.string().max(3000),
  preferredCta: z.string().max(500),
  forbiddenPhrases: list,
  keywords: list,
  knowledgeBase: z.string().max(50_000),
  moderationRules: z.string().max(5000),
  autoReplyEnabled: z.boolean(),
  autoReplyCategories: z.array(z.enum(["positive", "question"])).max(2),
  autoReplyMaxPerHour: z.number().int().min(1).max(30),
  commentRetentionDays: z.number().int().min(30).max(3650),
}).partial();

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id);
  const brand = await prisma.brandSettings.upsert({ where: { projectId: id }, create: { projectId: id }, update: {} });
  const docs = await prisma.knowledgeDoc.findMany({ where: { projectId: id }, select: { id: true, name: true, updatedAt: true, content: true }, orderBy: { updatedAt: "desc" } });
  return json({ brand, docs: docs.map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, size: d.content.length })), canEdit: a.perms.has("brand.edit") });
});

export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "brand.edit");
  const b = Brand.parse(await req.json());
  const brand = await prisma.brandSettings.upsert({ where: { projectId: id }, create: { projectId: id, ...b }, update: b });
  await audit({ userId: a.user.id, projectId: id, action: "brand.updated", entityType: "BrandSettings", entityId: brand.id, data: { fields: Object.keys(b) } });
  return json({ brand });
});
