import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession } from "./session-token";

import { HttpError } from "./errors";
export { HttpError };

export type StudioRole = "ADMIN" | "EDITOR" | "EXPERT" | "VIEWER";

export const ROLE_LABELS: Record<StudioRole, { name: string; hint: string }> = {
  ADMIN: { name: "Administrator", hint: "Wszystkie projekty, dodaje osoby i nadaje im dostęp." },
  EDITOR: { name: "Edytor", hint: "Edytuje przypisane projekty, korzysta z narzędzi globalnych." },
  EXPERT: { name: "Ekspert", hint: "Widzi swoje projekty i ich nagrania (bez edycji)." },
  VIEWER: { name: "Przeglądający", hint: "Tylko podgląd przypisanych projektów." },
};

export async function currentUser() {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  return prisma.user.findUnique({ where: { id: s.uid }, select: { id: true, email: true, name: true, role: true } });
}

/** people of the video studio (any role but MEMBER — those only see Social Media Studio) */
export const isStudioUser = (role: string) => role === "ADMIN" || role === "EDITOR" || role === "EXPERT" || role === "VIEWER";
/** the team running the platform: in Social Media Studio they see every organization and project */
export const isStaff = (role: string) => role === "ADMIN" || role === "EDITOR";
/** may change things (the others only look) */
export const canEdit = (role: string) => role === "ADMIN" || role === "EDITOR";

/** Project ids a person may open; null = all of them (an administrator). */
export async function accessibleProjectIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  return (await prisma.projectAccess.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((a) => a.projectId);
}

/** a Prisma `where` limiting projects to the ones the person may open */
export async function projectScope(user: { id: string; role: string }) {
  const ids = await accessibleProjectIds(user);
  return ids ? { id: { in: ids } } : {};
}

export async function canOpenProject(user: { id: string; role: string }, projectId: string) {
  if (user.role === "ADMIN") return true;
  return !!(await prisma.projectAccess.findUnique({ where: { userId_projectId: { userId: user.id, projectId } } }));
}

/** whoever creates a project may open it */
export async function grantCreator(user: { id: string; role: string }, projectId: string) {
  if (user.role === "ADMIN") return;
  await prisma.projectAccess.upsert({ where: { userId_projectId: { userId: user.id, projectId } }, create: { userId: user.id, projectId }, update: {} });
}

/** Global tools that are not part of any project (and so only for the team that edits). */
const EDITOR_ONLY = [/^\/api\/admin\/edu(\/|$)/, /^\/admin\/edu(\/|$)/, /^\/api\/admin\/ai(\/|$)/];
const ADMIN_ONLY = [/^\/api\/admin\/users(\/|$)/, /^\/admin\/users(\/|$)/];

/**
 * The project a request is about, from its path (/api/admin/projects/:id, …/compositions/:id, a page
 * /admin/projects/:id, /studio/:id …). null when the path is not about one project or it is not found.
 */
export async function projectOfPath(path: string): Promise<string | null> {
  const seg = path.split("?")[0].split("/").filter(Boolean);
  const api = seg[0] === "api" && seg[1] === "admin";
  const [kind, id, sub] = api ? seg.slice(2) : seg[0] === "admin" ? seg.slice(1) : seg[0] === "studio" ? ["compositions", seg[1]] : [];
  if (!kind || !id) return null;
  const pick = (r: { projectId: string | null } | null) => r?.projectId ?? null;
  switch (kind) {
    case "projects":
    case "auto-reels":
    case "adwords":
      return id;
    case "ads":
      if (id === "footage") return sub ? pick(await prisma.adFootage.findUnique({ where: { id: sub }, select: { projectId: true } })) : null;
      if (id === "reels") return sub ? pick(await prisma.adReel.findUnique({ where: { id: sub }, select: { projectId: true } })) : null;
      if (id === "broll") return sub ? pick(await prisma.mediaAsset.findUnique({ where: { id: sub }, select: { projectId: true } })) : null;
      return id;
    case "compositions":
      return pick(await prisma.videoComposition.findUnique({ where: { id }, select: { projectId: true } }));
    case "questions":
      return pick(await prisma.question.findUnique({ where: { id }, select: { projectId: true } }));
    case "takes": {
      const t = await prisma.recordingTake.findUnique({ where: { id }, select: { recording: { select: { projectId: true } } } });
      return t?.recording.projectId ?? null;
    }
    case "invitations":
      return pick(await prisma.invitation.findUnique({ where: { id }, select: { projectId: true } }));
    case "categories":
      return pick(await prisma.category.findUnique({ where: { id }, select: { projectId: true } }));
    case "subcategories": {
      const s = await prisma.subcategory.findUnique({ where: { id }, select: { category: { select: { projectId: true } } } });
      return s?.category.projectId ?? null;
    }
    case "render-jobs":
      return pick(await prisma.renderJob.findUnique({ where: { id }, select: { projectId: true } }));
    case "uploads": {
      const u = await prisma.uploadSession.findUnique({ where: { id }, select: { projectId: true, purpose: true } });
      return u && u.purpose !== "edu" ? u.projectId : null;
    }
    default:
      return null;
  }
}

/** Why this person may not do this request (null = allowed). */
export async function denyReason(user: { id: string; role: string }, path: string, method: string): Promise<string | null> {
  if (!isStudioUser(user.role)) return "Brak dostępu";
  if (user.role === "ADMIN") return null;
  if (ADMIN_ONLY.some((r) => r.test(path))) return "Tylko dla administratora";
  if (!canEdit(user.role)) {
    if (method !== "GET" && method !== "HEAD") return "Masz dostęp tylko do podglądu";
    if (EDITOR_ONLY.some((r) => r.test(path))) return "Brak dostępu";
  }
  const pid = await projectOfPath(path);
  if (pid && !(await canOpenProject(user, pid))) return "Nie masz dostępu do tego projektu";
  return null;
}

/** The request this server code runs for (path + method, passed on by the middleware). */
export async function requestInfo() {
  const h = await headers();
  return { path: h.get("x-askby-path") ?? "", method: (h.get("x-askby-method") ?? "GET").toUpperCase() };
}

/**
 * Every studio API: a signed-in person of the studio, allowed by their role for this request and with
 * access to the project the request is about (taken from its path).
 */
export async function requireAdmin() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Wymagane logowanie");
  const { path, method } = await requestInfo();
  const why = await denyReason(u, path, method);
  if (why) throw new HttpError(403, why);
  return u;
}

/** only an administrator (people and their access) */
export async function requireOwner() {
  const u = await requireAdmin();
  if (u.role !== "ADMIN") throw new HttpError(403, "Tylko dla administratora");
  return u;
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Wymagane logowanie");
  return u;
}
