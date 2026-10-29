import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const unreadOnly = new URL(req.url).searchParams.get("unread") === "1";
  const items = await prisma.notification.findMany({ where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 50 });
  return json({ items, unread: await prisma.notification.count({ where: { userId: user.id, readAt: null } }) });
});

/** mark read: { ids } or { all: true } */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const b = z.object({ ids: z.array(z.string().max(64)).max(200).optional(), all: z.boolean().optional() }).parse(await req.json());
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) }, data: { readAt: new Date() } });
  return json({ ok: true });
});
