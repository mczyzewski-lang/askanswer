import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/** who did what, when (never secrets: data is a small, already-sanitised summary) */
export async function audit(e: { userId?: string | null; organizationId?: string | null; projectId?: string | null; action: string; entityType: string; entityId?: string | null; data?: Record<string, unknown>; ip?: string | null }) {
  await prisma.auditLog
    .create({ data: { userId: e.userId ?? null, organizationId: e.organizationId ?? null, projectId: e.projectId ?? null, action: e.action, entityType: e.entityType, entityId: e.entityId ?? null, data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined, ip: e.ip ?? null } })
    .catch((err) => console.error("[audit]", (err as Error).message));
}
