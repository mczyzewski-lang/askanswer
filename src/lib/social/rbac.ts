/**
 * Roles and permissions of Social Media Studio. A person's permissions in a project are the union of
 * their organization role and their project role (a client usually has only a project role, e.g.
 * APPROVER). Platform staff (UserRole ADMIN / EDITOR) act as OWNER everywhere.
 */
export type OrgRole = "OWNER" | "ADMIN" | "EDITOR" | "APPROVER" | "VIEWER";
export const ORG_ROLES: OrgRole[] = ["OWNER", "ADMIN", "EDITOR", "APPROVER", "VIEWER"];

export type Permission =
  | "project.view"
  | "content.edit"
  | "content.approve"
  | "content.schedule"
  | "accounts.manage"
  | "brand.edit"
  | "comments.view"
  | "comments.reply"
  | "analytics.view"
  | "members.manage"
  | "project.create"
  | "project.delete";

const MATRIX: Record<OrgRole, Permission[]> = {
  OWNER: ["project.view", "content.edit", "content.approve", "content.schedule", "accounts.manage", "brand.edit", "comments.view", "comments.reply", "analytics.view", "members.manage", "project.create", "project.delete"],
  ADMIN: ["project.view", "content.edit", "content.approve", "content.schedule", "accounts.manage", "brand.edit", "comments.view", "comments.reply", "analytics.view", "members.manage", "project.create"],
  EDITOR: ["project.view", "content.edit", "content.schedule", "comments.view", "comments.reply", "analytics.view"],
  APPROVER: ["project.view", "content.approve", "comments.view", "analytics.view"],
  VIEWER: ["project.view", "comments.view", "analytics.view"],
};

export const ROLE_LABELS: Record<OrgRole, { name: string; hint: string }> = {
  OWNER: { name: "Właściciel", hint: "Pełny dostęp, także usuwanie projektu i danych." },
  ADMIN: { name: "Administrator", hint: "Konta, ustawienia marki, zespół, treści i akceptacje." },
  EDITOR: { name: "Redaktor", hint: "Media, treści, wysyłka do akceptacji, harmonogram, odpowiedzi na komentarze." },
  APPROVER: { name: "Akceptujący", hint: "Przegląda i zatwierdza publikacje (np. klient)." },
  VIEWER: { name: "Podgląd", hint: "Tylko odczyt: kalendarz, publikacje, wyniki, komentarze." },
};

export function permissionsOf(roles: Array<OrgRole | null | undefined>): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) if (r) for (const p of MATRIX[r]) out.add(p);
  return out;
}

export function can(roles: Array<OrgRole | null | undefined>, p: Permission): boolean {
  return permissionsOf(roles).has(p);
}
