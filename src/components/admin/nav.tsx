"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Clapperboard, FolderOpen, GraduationCap, Megaphone, Mic, Palette, Settings2, Share2, Sparkles, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const starts = (prefix: string) => (p: string) => p.startsWith(prefix);

/** Where the work happens (videos, reels, courses, social). */
const main: Item[] = [
  { href: "/admin", label: "Projekty", icon: FolderOpen, match: (p) => p === "/admin" || p.startsWith("/admin/projects") },
  { href: "/admin/reklamy", label: "Reklamy", icon: Megaphone, match: starts("/admin/reklamy") },
  { href: "/admin/auto-reels", label: "Auto Reels", icon: Sparkles, match: starts("/admin/auto-reels") },
  { href: "/admin/ads", label: "Ads Studio", icon: Clapperboard, match: starts("/admin/ads") },
  { href: "/admin/edu", label: "EduStudio", icon: GraduationCap, match: starts("/admin/edu") },
  { href: "/social", label: "Social Media", icon: Share2, match: () => false },
];

/** Shared setup used by every project. */
const settings: Item[] = [
  { href: "/admin/experts", label: "Eksperci", icon: Users, match: starts("/admin/experts") },
  { href: "/admin/voices", label: "Głosy", icon: Mic, match: starts("/admin/voices") },
  { href: "/admin/themes", label: "Motywy", icon: Palette, match: starts("/admin/themes") },
];

function NavLink({ i, path, vertical, sub }: { i: Item; path: string; vertical: boolean; sub?: boolean }) {
  const active = i.match(path);
  const Icon = i.icon;
  return (
    <Link
      href={i.href}
      className={cn(
        "flex items-center gap-2.5 whitespace-nowrap rounded-lg transition",
        vertical ? (sub ? "py-1.5 pl-9 pr-3" : "px-3 py-2") : "px-2.5 py-1.5",
        active ? "bg-black/[.06] font-medium text-ink" : "text-muted hover:bg-black/[.03] hover:text-ink",
      )}
      aria-current={active ? "page" : undefined}
    >
      {sub && vertical ? null : <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
      {i.label}
    </Link>
  );
}

/** The admin menu: a column in the desktop sidebar (settings folded under „Ustawienia”), a scrolling row on a phone. */
export function AdminNav({ vertical = false }: { vertical?: boolean }) {
  const path = usePathname();
  const inSettings = settings.some((i) => i.match(path));
  const [open, setOpen] = useState(inSettings);
  if (!vertical)
    return (
      <nav className="flex items-center gap-0.5 overflow-x-auto text-sm" data-testid="admin-nav-top">
        {main.map((i) => (
          <NavLink key={i.href} i={i} path={path} vertical={false} />
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        {settings.map((i) => (
          <NavLink key={i.href} i={i} path={path} vertical={false} />
        ))}
      </nav>
    );
  return (
    <nav className="flex flex-col gap-0.5 text-sm" data-testid="admin-nav-side">
      {main.map((i) => (
        <NavLink key={i.href} i={i} path={path} vertical />
      ))}
      <div className="my-2 border-t border-line" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-black/[.03] hover:text-ink", inSettings ? "text-ink" : "text-muted")}
        aria-expanded={open || inSettings}
        data-testid="admin-nav-settings"
      >
        <Settings2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">Ustawienia</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition", open || inSettings ? "rotate-180" : "")} />
      </button>
      {open || inSettings ? settings.map((i) => <NavLink key={i.href} i={i} path={path} vertical sub />) : null}
    </nav>
  );
}
