"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Projekty", match: (p: string) => p === "/admin" || p.startsWith("/admin/projects") },
  { href: "/admin/ads", label: "Ads Studio", match: (p: string) => p.startsWith("/admin/ads") },
  { href: "/admin/experts", label: "Eksperci", match: (p: string) => p.startsWith("/admin/experts") },
  { href: "/admin/voices", label: "Głosy", match: (p: string) => p.startsWith("/admin/voices") },
  { href: "/admin/themes", label: "Motywy", match: (p: string) => p.startsWith("/admin/themes") },
  { href: "/social", label: "Social Media", match: () => false },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={cn("rounded-lg px-3 py-1.5 transition", i.match(path) ? "bg-black/[.06] font-medium text-ink" : "text-muted hover:text-ink")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
