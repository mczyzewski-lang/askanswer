"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Bell, CalendarDays, CheckCheck, CircleCheck, FolderKanban, Inbox, LayoutDashboard, LibraryBig, LogOut, Menu, Moon, Send, Settings, Sun, X } from "lucide-react";
import { useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import type { OrgRole, Permission } from "@/lib/social/rbac";
import { DemoBadge, useApi } from "./ui";

export interface MeProject {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  timezone: string;
  isDemo: boolean;
  roles: OrgRole[];
  permissions: Permission[];
}
export interface Me {
  user: { id: string; email: string; name: string; staff: boolean };
  organizations: Array<{ id: string; name: string; isDemo: boolean; role: OrgRole }>;
  projects: MeProject[];
  unread: number;
  demoMode: boolean;
}

interface Ctx {
  me: Me;
  reloadMe: () => Promise<void>;
  /** the project picked in the switcher ("" = all projects) */
  projectId: string;
  setProjectId: (id: string) => void;
  project: MeProject | null;
  can: (p: Permission, projectId?: string) => boolean;
  tzOf: (projectId?: string | null) => string;
  toast: (text: string, tone?: "ok" | "err") => void;
}

const SocialCtx = React.createContext<Ctx | null>(null);
export function useSocial() {
  const c = React.useContext(SocialCtx);
  if (!c) throw new Error("useSocial outside the shell");
  return c;
}

const NAV: Array<{ href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }> = [
  { href: "/social", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/social/projects", label: "Projekty", icon: FolderKanban },
  { href: "/social/library", label: "Biblioteka treści", icon: LibraryBig },
  { href: "/social/calendar", label: "Kalendarz", icon: CalendarDays },
  { href: "/social/approvals", label: "Do akceptacji", icon: CircleCheck },
  { href: "/social/publications", label: "Publikacje", icon: Send },
  { href: "/social/comments", label: "Komentarze", icon: Inbox },
  { href: "/social/analytics", label: "Analityka", icon: BarChart3 },
  { href: "/social/settings", label: "Ustawienia", icon: Settings },
];

type Theme = "light" | "dark" | "system";
function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function SocialShell({ children }: { children: React.ReactNode }) {
  const { data: me, error, reload } = useApi<Me>("/api/social/me");
  const path = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const [projectId, setProjectIdState] = React.useState("");
  const [theme, setTheme] = React.useState<Theme>("system");
  const [open, setOpen] = React.useState(false);
  const [bell, setBell] = React.useState(false);
  const { toast, toastNode } = useToast();

  React.useEffect(() => {
    let t: Theme = "system";
    try {
      t = (localStorage.getItem("social-theme") as Theme) || "system";
    } catch {}
    setTheme(t);
    applyTheme(t);
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, []);
  React.useEffect(() => {
    const q = search.get("project");
    if (q) setProjectIdState(q);
    else {
      try {
        setProjectIdState(localStorage.getItem("social-project") ?? "");
      } catch {}
    }
  }, [search]);
  React.useEffect(() => setOpen(false), [path]);

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    try {
      localStorage.setItem("social-project", id);
    } catch {}
    if (search.get("project")) {
      const u = new URL(window.location.href);
      if (id) u.searchParams.set("project", id);
      else u.searchParams.delete("project");
      router.replace(u.pathname + u.search);
    }
  };

  if (error)
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm">
        <p>
          Nie udało się wczytać danych: {error}.{" "}
          <button className="underline" onClick={() => void reload()}>
            Spróbuj ponownie
          </button>
        </p>
      </div>
    );
  if (!me) return <div className="min-h-screen" />;
  const project = me.projects.find((p) => p.id === projectId) ?? null;
  const ctx: Ctx = {
    me,
    reloadMe: reload,
    projectId: project ? projectId : "",
    setProjectId,
    project,
    can: (perm, pid) => (pid ? me.projects.find((p) => p.id === pid)?.permissions.includes(perm) : project ? project.permissions.includes(perm) : me.projects.some((p) => p.permissions.includes(perm))) ?? false,
    tzOf: (pid) => me.projects.find((p) => p.id === pid)?.timezone ?? project?.timezone ?? "Europe/Warsaw",
    toast,
  };
  const cycle = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    try {
      localStorage.setItem("social-theme", next);
    } catch {}
    applyTheme(next);
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Social Media Studio">
      <Link href="/social" className="mb-3 flex items-center gap-2 px-2 py-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-display text-sm font-bold text-white">S</span>
        <span className="font-display text-[15px] font-semibold">Social Media Studio</span>
      </Link>
      <label className="mb-2 block px-1">
        <span className="sr-only">Projekt</span>
        <select value={ctx.projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-white px-2 text-[13px]" data-testid="project-switcher">
          <option value="">Wszystkie projekty</option>
          {me.organizations.map((o) => (
            <optgroup key={o.id} label={o.name}>
              {me.projects
                .filter((p) => p.organizationId === o.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDemo ? " · DEMO" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
          {me.projects
            .filter((p) => !me.organizations.some((o) => o.id === p.organizationId))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      {NAV.map((n) => {
        const active = n.exact ? path === n.href : path.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link key={n.href} href={n.href} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition", active ? "bg-ink/[.07] font-medium text-ink" : "text-muted hover:bg-ink/[.04] hover:text-ink")} aria-current={active ? "page" : undefined}>
            <Icon className="h-4 w-4" />
            {n.label}
          </Link>
        );
      })}
      <div className="mt-auto space-y-1 border-t border-line pt-3 text-[13px]">
        {me.user.staff ? (
          <Link href="/admin" className="block rounded-lg px-2.5 py-1.5 text-muted hover:bg-ink/[.04] hover:text-ink">
            ← AskBy Studio
          </Link>
        ) : null}
        <div className="truncate px-2.5 text-[12px] text-muted" title={me.user.email}>
          {me.user.name || me.user.email}
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted hover:bg-ink/[.04] hover:text-ink">
            <LogOut className="h-4 w-4" /> Wyloguj
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <SocialCtx.Provider value={ctx}>
      <div className="min-h-screen bg-paper text-ink">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-white lg:block">{sidebar}</aside>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-white">{sidebar}</aside>
          </div>
        ) : null}
        <div className="lg:pl-60">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper/85 px-4 backdrop-blur sm:px-6">
            <button className="rounded-lg p-1.5 hover:bg-ink/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="truncate text-sm text-muted">{project ? `${project.organizationName} / ${project.name}` : "Wszystkie projekty"}</div>
            {me.demoMode || project?.isDemo ? <DemoBadge /> : null}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={cycle} className="rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Motyw" title={theme === "system" ? "Motyw: systemowy" : theme === "dark" ? "Motyw: ciemny" : "Motyw: jasny"}>
                {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button onClick={() => setBell((v) => !v)} className="relative rounded-lg p-2 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Powiadomienia" data-testid="notifications-bell">
                <Bell className="h-4 w-4" />
                {me.unread ? <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white" data-testid="notifications-count">{me.unread > 99 ? "99+" : me.unread}</span> : null}
              </button>
            </div>
          </header>
          {bell ? <Notifications onClose={() => setBell(false)} onChange={() => void reload()} /> : null}
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
          {toastNode}
        </div>
      </div>
    </SocialCtx.Provider>
  );
}

interface Note {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function Notifications({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const { data, reload } = useApi<{ items: Note[]; unread: number }>("/api/social/notifications");
  const router = useRouter();
  const read = async (ids?: string[]) => {
    await api("/api/social/notifications", { method: "POST", json: ids ? { ids } : { all: true } });
    await reload();
    onChange();
  };
  return (
    <div className="fixed right-3 top-14 z-40 w-[min(420px,calc(100vw-24px))] rounded-2xl border border-line bg-white shadow-2xl" data-testid="notifications">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold">Powiadomienia</p>
        <div className="flex items-center gap-1">
          <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-ink/5" onClick={() => void read()}>
            <CheckCheck className="h-3.5 w-3.5" /> Oznacz wszystkie
          </button>
          <button className="rounded-md p-1 text-muted hover:bg-ink/5" onClick={onClose} aria-label="Zamknij">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto">
        {!data ? <li className="p-4 text-sm text-muted">Wczytuję…</li> : null}
        {data && !data.items.length ? <li className="p-6 text-center text-sm text-muted">Nic nowego.</li> : null}
        {data?.items.map((n) => (
          <li key={n.id} className={cn("border-b border-line last:border-0", !n.readAt && "bg-brand-soft/40")}>
            <button
              className="block w-full px-4 py-3 text-left hover:bg-ink/[.03]"
              onClick={async () => {
                if (!n.readAt) await read([n.id]);
                if (n.link) {
                  onClose();
                  router.push(n.link);
                }
              }}
            >
              <p className="text-[13px] font-medium">{n.title}</p>
              {n.body ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{n.body}</p> : null}
              <p className="mt-1 text-[11px] text-muted">{new Date(n.createdAt).toLocaleString("pl-PL")}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
