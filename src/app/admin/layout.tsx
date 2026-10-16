import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { elevenLabsConfigured } from "@/lib/server/env";
import { AdminNav } from "@/components/admin/nav";
import { ActivityNotifier } from "@/components/admin/activity-notifier";
import { diskUsage } from "@/lib/server/storage";
import { env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // local media storage: warn before the volume is full (uploads and processing would fail)
  const disk = env.storageDriver === "local" ? await diskUsage() : null;
  const lowDisk = disk && disk.total > 0 && (disk.free < 400e6 || disk.free / disk.total < 0.15) ? disk : null;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-display text-sm font-bold text-white">A</span>
            <span className="font-display text-[15px] font-semibold">AskBy Studio</span>
          </Link>
          <AdminNav />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {lowDisk ? (
              <span
                className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                title="Wolumen z nagraniami jest prawie pełny — nowe nagrania mogą się nie przetworzyć. Zwiększ wolumen w Railway lub podłącz S3/R2."
                data-testid="disk-warning"
              >
                Dysk: wolne {(lowDisk.free / 1e9).toFixed(lowDisk.free < 1e9 ? 2 : 1)} z {(lowDisk.total / 1e9).toFixed(1)} GB
              </span>
            ) : null}
            {!elevenLabsConfigured() ? (
              <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 md:inline" title="Ustaw ELEVENLABS_API_KEY w .env">
                ElevenLabs: brak konfiguracji
              </span>
            ) : null}
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <form action="/api/auth/logout" method="post">
              <button className="rounded-lg px-2 py-1 text-muted hover:bg-black/5 hover:text-ink">Wyloguj</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <ActivityNotifier />
    </div>
  );
}
