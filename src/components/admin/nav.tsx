"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Projekty", match: (p: string) => p === "/admin" || p.startsWith("/admin/projects") },
  { href: "/admin/auto-reels", label: "Auto Reels", match: (p: string) => p.startsWith("/admin/auto-reels") },
  { href: "/admin/reklamy", label: "Reklamy", match: (p: string) => p.startsWith("/admin/reklamy") },
  { href: "/admin/ads", label: "Ads Studio", match: (p: string) => p.startsWith("/admin/ads") },
  { href: "/admin/edu", label: "EduStudio", match: (p: string) => p.startsWith("/admin/edu") },
  { href: "/admin/experts", label: "Eksperci", match: (p: string) => p.startsWith("/admin/experts") },
  { href: "/admin/voices", label: "Głosy", match: (p: string) => p.startsWith("/admin/voices") },
  { href: "/admin/themes", label: "Motywy", match: (p: string) => p.startsWith("/admin/themes") },
  { href: "/social", label: "Social Media", match: () => false },
];

/** The admin menu: a column in the desktop sidebar, a scrolling row in the mobile top bar. */
export function AdminNav({ vertical = false }: { vertical?: boolean }) {
  const path = usePathname();
  return (
    <nav className={cn("text-sm", vertical ? "flex flex-col gap-0.5" : "flex items-center gap-0.5 overflow-x-auto")} data-testid={vertical ? "admin-nav-side" : "admin-nav-top"}>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn(
            "whitespace-nowrap rounded-lg transition",
            vertical ? "px-3 py-2" : "px-2.5 py-1.5",
            i.match(path) ? "bg-black/[.06] font-medium text-ink" : "text-muted hover:bg-black/[.03] hover:text-ink",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
