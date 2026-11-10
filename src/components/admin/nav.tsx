"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  Clapperboard,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Mic,
  Palette,
  Settings2,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavProject {
  id: string;
  name: string;
  kind: "Projekt" | "Reklamy" | "Ads Studio" | "Auto Reels";
  href: string;
  themeId: string | null;
}

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);

/** All projects; each project's modules (Reklamy, Ads Studio, Auto Reels, Google Adwords…) are reached through the project itself. */
const lists: Item[] = [{ href: "/admin", label: "Wszystkie projekty", icon: FolderOpen, match: (p) => p === "/admin" }];
/** where a new project of each kind is created (from the project switcher) */
const NEW_KINDS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/admin", label: "Projekt (pytania)", icon: FolderOpen },
  { href: "/admin/reklamy", label: "Reklamy", icon: Megaphone },
  { href: "/admin/ads", label: "Ads Studio", icon: Clapperboard },
  { href: "/admin/auto-reels", label: "Auto Reels", icon: Sparkles },
];

const KIND_ICON: Record<NavProject["kind"], LucideIcon> = { Projekt: FolderOpen, Reklamy: Megaphone, "Ads Studio": Clapperboard, "Auto Reels": Sparkles };

function NavLink({ i, path, compact }: { i: Item; path: string; compact?: boolean }) {
  const active = i.match(path);
  const Icon = i.icon;
  return (
    <Link
      href={i.href}
      className={cn(
        "flex items-center gap-2.5 whitespace-nowrap rounded-lg transition",
        compact ? "px-2.5 py-1.5" : "px-3 py-[7px]",
        active ? "bg-black/[.06] font-medium text-ink" : "text-muted hover:bg-black/[.03] hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      {i.label}
    </Link>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <p className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted/80">{children}</p>;

/** The project being worked on: chosen at the top, remembered between pages. */
function ProjectSwitcher({ projects, current }: { projects: NavProject[]; current: NavProject | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q]);
  const groups = (["Projekt", "Reklamy", "Auto Reels", "Ads Studio"] as const).map((k) => [k, shown.filter((p) => p.kind === k)] as const).filter(([, ps]) => ps.length);
  const Icon = current ? KIND_ICON[current.kind] : FolderOpen;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:bg-black/[.02]" data-testid="project-switcher">
          <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{current?.name ?? "Wybierz projekt"}</span>
            <span className="block text-[11px] text-muted">{current?.kind ?? `${projects.length} projektów`}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-72 rounded-xl border border-line bg-white p-1.5 shadow-lg" data-testid="project-switcher-menu">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Szukaj projektu…"
            className="mb-1 h-8 w-full rounded-lg border border-line px-2.5 text-sm outline-none focus:border-ink/30"
            aria-label="Szukaj projektu"
          />
          <div className="max-h-80 overflow-y-auto">
            {groups.length === 0 ? <p className="px-2.5 py-3 text-sm text-muted">{projects.length ? "Nic nie pasuje" : "Nie masz jeszcze dostępu do żadnego projektu."}</p> : null}
            {groups.map(([kind, ps]) => (
              <div key={kind}>
                <p className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted/80">{kind}</p>
                {ps.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-black/[.04]"
                    onClick={() => {
                      setOpen(false);
                      setQ("");
                      router.push(p.href);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.id === current?.id ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1" data-testid="project-switcher-new">
            <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted/80">Nowy / lista projektów</p>
            <div className="grid grid-cols-2 gap-0.5">
              {NEW_KINDS.map((k) => (
                <Link key={k.href} href={k.href} onClick={() => setOpen(false)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-black/[.04] hover:text-ink">
                  <k.icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {k.label}
                </Link>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The admin menu. Top: the project being worked on and its parts (overview, look, settings); then the
 * lists of projects; at the bottom the global tools that belong to no project and the settings.
 */
export function AdminNav({ vertical = false, projects, current: remembered, role }: { vertical?: boolean; projects: NavProject[]; current: NavProject | null; role: string }) {
  const path = usePathname();
  const search = useSearchParams();
  // the project of this page (the layout is not rendered again on client navigation), else the remembered one
  const m = /^\/admin\/(projects|ads|auto-reels|adwords)\/([^/?#]+)/.exec(path);
  const [last, setLast] = useState<NavProject | null>(remembered);
  const fromPath = m ? (projects.find((p) => p.id === m[2]) ?? null) : undefined;
  const current = fromPath === undefined ? last : fromPath;
  useEffect(() => {
    if (fromPath) setLast(fromPath);
  }, [fromPath]);
  const editor = role === "ADMIN" || role === "EDITOR";
  // remember the project for the pages that are not about one (lists, global tools)
  useEffect(() => {
    if (!current) return;
    try {
      document.cookie = `askby_project=${current.id}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`;
    } catch {
      /* ignore */
    }
  }, [current]);

  const ads = current?.kind === "Ads Studio" || current?.kind === "Auto Reels";
  const settingsBase = current ? `/admin/projects/${current.id}/settings` : "";
  const onSettings = (sec: string) => () => path === settingsBase && (search.get("section") ?? "theme") === sec;
  const projectItems: Item[] = current
    ? [
        // a module project (Ads Studio, Auto Reels, Reklamy): its studio by name, so it is easy to find
        current.kind === "Projekt"
          ? { href: current.href, label: "Przegląd", icon: LayoutDashboard, match: (p: string) => p === current.href }
          : { href: current.href, label: current.kind, icon: KIND_ICON[current.kind], match: (p: string) => p === current.href || p.startsWith(`${current.href}/`) },
        ...(ads ? [{ href: `/admin/projects/${current.id}`, label: "Montaże i eksport", icon: Clapperboard, match: (p: string) => p === `/admin/projects/${current.id}` }] : []),
        { href: `/admin/projects/${current.id}/social`, label: "Harmonogram social", icon: CalendarDays, match: (p: string) => p === `/admin/projects/${current.id}/social` },
        { href: `/admin/adwords/${current.id}`, label: "Google Adwords", icon: Target, match: (p: string) => p === `/admin/adwords/${current.id}` },
      ]
    : [];
  // Projekt → Ustawienia: its theme, people (with experts), narrator voices, general
  const projectSettings: Item[] = current
    ? [
        { href: `${settingsBase}?section=theme`, label: "Motyw projektu", icon: Palette, match: onSettings("theme") },
        { href: `${settingsBase}?section=people`, label: "Osoby i eksperci", icon: Users, match: onSettings("people") },
        ...(ads ? [] : [{ href: `${settingsBase}?section=voice`, label: "Głosy (lektor)", icon: Mic, match: onSettings("voice") }]),
        { href: `${settingsBase}?section=general`, label: "Ogólne", icon: SlidersHorizontal, match: onSettings("general") },
      ]
    : [];
  const tools: Item[] = [...(editor ? [{ href: "/admin/edu", label: "EduStudio", icon: GraduationCap, match: starts("/admin/edu") }] : []), { href: "/social/calendar?project=all", label: "Harmonogram social", icon: CalendarDays, match: () => false }, { href: "/social", label: "Social Media", icon: Share2, match: () => false }];
  const settings: Item[] = editor
    ? [
        { href: "/admin/experts", label: "Eksperci", icon: Users, match: starts("/admin/experts") },
        { href: "/admin/voices", label: "Głosy", icon: Mic, match: starts("/admin/voices") },
        { href: "/admin/themes", label: "Motywy", icon: Palette, match: (p) => p === "/admin/themes" },
        ...(role === "ADMIN" ? [{ href: "/admin/users", label: "Użytkownicy", icon: UserCog, match: starts("/admin/users") }] : []),
      ]
    : [];

  if (!vertical)
    return (
      <div className="space-y-2" data-testid="admin-nav-top">
        <ProjectSwitcher projects={projects} current={current} />
        <nav className="flex items-center gap-0.5 overflow-x-auto text-sm">
          {[...projectItems, ...projectSettings, ...lists].map((i) => (
            <NavLink key={i.href + i.label} i={i} path={path} compact />
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          {[...tools, ...settings].map((i) => (
            <NavLink key={i.href} i={i} path={path} compact />
          ))}
        </nav>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="admin-nav-side">
      <ProjectSwitcher projects={projects} current={current} />
      <nav className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
        {projectItems.length ? (
          <div className="flex flex-col gap-0.5" data-testid="nav-project">
            {projectItems.map((i) => (
              <NavLink key={i.href + i.label} i={i} path={path} />
            ))}
            <p className="px-3 pb-0.5 pt-2 text-[11px] font-medium text-muted/80">Ustawienia projektu</p>
            <div className="ml-3 flex flex-col gap-0.5 border-l border-line pl-1.5" data-testid="nav-project-settings">
              {projectSettings.map((i) => (
                <NavLink key={i.href} i={i} path={path} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
          {lists.map((i) => (
            <NavLink key={i.href} i={i} path={path} />
          ))}
        </div>
        <div className="flex-1" />
        <Heading>Narzędzia globalne</Heading>
        <div className="flex flex-col gap-0.5" data-testid="nav-tools">
          {tools.map((i) => (
            <NavLink key={i.href} i={i} path={path} />
          ))}
        </div>
        {settings.length ? (
          <>
            <Heading>
              <span className="inline-flex items-center gap-1">
                <Settings2 className="h-3 w-3" /> Ustawienia globalne
              </span>
            </Heading>
            <div className="flex flex-col gap-0.5" data-testid="nav-settings">
              {settings.map((i) => (
                <NavLink key={i.href} i={i} path={path} />
              ))}
            </div>
          </>
        ) : null}
      </nav>
    </div>
  );
}
