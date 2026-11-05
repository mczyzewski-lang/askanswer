import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { elevenLabsConfigured } from "@/lib/server/env";
import { AdminNav } from "@/components/admin/nav";
import { ActivityNotifier } from "@/components/admin/activity-notifier";
import { diskUsage } from "@/lib/server/storage";
import { env } from "@/lib/server/env";
import { appCommit } from "@/lib/server/version";

export const dynamic = "force-dynamic";

function Logo() {
  return (
    <Link href="/admin" className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-display text-sm font-bold text-white">A</span>
      <span className="font-display text-[15px] font-semibold">AskBy Studio</span>
    </Link>
  );
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // local media storage: warn before the volume is full (uploads and processing would fail)
  const disk = env.storageDriver === "local" ? await diskUsage() : null;
  const lowDisk = disk && disk.total > 0 && (disk.free < 400e6 || disk.free / disk.total < 0.15) ? disk : null;
  const diskBadge = lowDisk ? (
    <span
      className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
      title="Wolumen z nagraniami jest prawie pełny — nowe nagrania mogą się nie przetworzyć. Zwiększ wolumen w Railway lub podłącz S3/R2."
      data-testid="disk-warning"
    >
      Dysk: wolne {(lowDisk.free / 1e9).toFixed(lowDisk.free < 1e9 ? 2 : 1)} z {(lowDisk.total / 1e9).toFixed(1)} GB
    </span>
  ) : null;
  const logout = (
    <form action="/api/auth/logout" method="post">
      <button className="rounded-lg px-2 py-1 text-muted hover:bg-black/5 hover:text-ink">Wyloguj</button>
    </form>
  );
  return (
    <div className="min-h-screen lg:flex">
      {/* desktop: menu on the left */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-paper/85 px-3 py-4 backdrop-blur lg:flex" data-testid="admin-sidebar">
        <div className="px-2 pb-5">
          <Logo />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNav vertical />
        </div>
        <div className="space-y-2 border-t border-line px-2 pt-3 text-sm">
          {diskBadge}
          {!elevenLabsConfigured() ? (
            <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700" title="Ustaw ELEVENLABS_API_KEY w .env">
              ElevenLabs: brak konfiguracji
            </span>
          ) : null}
          <div className="truncate text-xs text-muted" title={user.email}>{user.email}</div>
          <div className="flex items-center justify-between">
            {logout}
            {appCommit() ? (
              <span className="font-mono text-[11px] text-muted" title="Wdrożona wersja (commit) — porównaj z ostatnim commitem na GitHubie" data-testid="app-version">
                v {appCommit()}
              </span>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {/* mobile / tablet: top bar */}
        <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center justify-between gap-4 px-4 sm:px-6">
            <Logo />
            <div className="flex items-center gap-2 text-sm">
              {diskBadge}
              {logout}
            </div>
          </div>
          <div className="px-2 pb-2 sm:px-4">
            <AdminNav />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </div>
      <ActivityNotifier />
    </div>
  );
}
