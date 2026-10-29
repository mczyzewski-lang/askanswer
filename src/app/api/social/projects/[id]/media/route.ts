import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { projectAccess } from "@/lib/server/social/access";
import { mediaView } from "@/lib/server/social/content";
import { assertPublicUrl, MAX_MEDIA_BYTES } from "@/lib/server/social/media";
import { enqueueSocial } from "@/lib/server/social/queue";
import { audit } from "@/lib/server/social/audit";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await projectAccess(id);
  const list = await prisma.socialMedia.findMany({ where: { projectId: id }, include: { variants: true, contentItems: { select: { id: true, title: true, posts: { select: { status: true, platform: true } } } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ media: await Promise.all(list.map(async (m) => ({ ...(await mediaView(m)), content: m.contentItems.map((c) => ({ id: c.id, title: c.title, posts: c.posts })) }))) });
});

/** start an upload (chunks follow) or import a film from a URL */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const a = await projectAccess(id, "content.edit");
  const b = z.object({ name: z.string().trim().max(200).optional(), size: z.number().int().min(1).optional(), url: z.string().url().max(2000).optional(), title: z.string().max(300).default(""), description: z.string().max(5000).default(""), transcribe: z.boolean().default(false) }).parse(await req.json());
  if (!b.url && !(b.name && b.size)) return json({ error: "Podaj plik albo adres URL filmu" }, 400);
  if (b.size && b.size > MAX_MEDIA_BYTES()) return json({ error: `Plik jest za duży (maks. ${Math.round(MAX_MEDIA_BYTES() / 1024 / 1024)} MB)` }, 413);
  if (b.url) await assertPublicUrl(b.url).catch((e) => Promise.reject(Object.assign(e, { status: 400 })));
  const m = await prisma.socialMedia.create({
    data: { projectId: id, uploadedById: a.user.id, title: b.title || (b.name ?? "").replace(/\.[a-z0-9]+$/i, ""), description: b.description, originalName: b.name ?? new URL(b.url!).pathname.split("/").pop() ?? "film.mp4", storageKey: `pending/${id}/${crypto.randomUUID()}`, sizeBytes: BigInt(b.size ?? 0), sourceUrl: b.url ?? null, status: b.url ? "PROCESSING" : "UPLOADING", isDemo: a.project.isDemo, transcriptStatus: b.transcribe ? "Zaplanowana" : null },
  });
  if (b.url) await enqueueSocial("social-import-url", { mediaId: m.id, projectId: id }, { idempotencyKey: `import:${m.id}`, maxAttempts: 2 });
  await audit({ userId: a.user.id, projectId: id, action: b.url ? "media.import_url" : "media.upload_started", entityType: "SocialMedia", entityId: m.id, data: { name: b.name, url: b.url ? new URL(b.url).host : undefined } });
  return json({ id: m.id }, 201);
});
