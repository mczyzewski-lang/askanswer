import { z } from "zod";
import { prisma } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

const ExpertInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  title: z.string().trim().max(160).nullable().optional(),
});

export const GET = route(async () => {
  await requireAdmin();
  return json(await prisma.expert.findMany({ orderBy: { name: "asc" } }));
});

export const POST = route(async (req: Request) => {
  await requireAdmin();
  const body = ExpertInput.parse(await req.json());
  return json(await prisma.expert.create({ data: body }), 201);
});
