import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const GET = route(async () => {
  await requireAdmin();
  return json(
    await prisma.voiceCollection.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { items: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    }),
  );
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await req.json());
  const count = await prisma.voiceCollection.count();
  return json(await prisma.voiceCollection.create({ data: { name, order: count }, include: { items: true } }), 201);
});
