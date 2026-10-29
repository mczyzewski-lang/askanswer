"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleCheck, Inbox, Send, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { useSocial } from "./shell";
import { Empty, ErrorBox, Loading, Metric, PageHeader, Panel, PlatformIcon, StatusPill, useApi, When } from "./ui";

export interface PostRow {
  id: string;
  contentItemId: string;
  project: { id: string; name: string; timezone: string };
  platform: Platform;
  status: string;
  title: string;
  description: string;
  hashtags: string[];
  cta: string;
  firstComment: string;
  options: Record<string, unknown>;
  postTitle: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  errorMessage: string | null;
  revision: number;
  isDemo: boolean;
  account: { id: string; name: string; handle: string | null };
  thumbUrl: string | null;
  durationSec: number | null;
}

interface Dash {
  counts: { pending: number; scheduled: number; published: number; failed: number; drafts: number; unreadComments: number; leads: number };
  upcoming: PostRow[];
  failed: PostRow[];
  reauth: Array<{ id: string; platform: Platform; displayName: string | null; accountHandle: string | null; connectionStatus: string; projectId: string; project: { name: string } }>;
  recent: Array<PostRow & { metrics: { views: number | null; likes: number | null; comments: number | null; capturedAt: string } | null }>;
}

export function PostLine({ p, right }: { p: PostRow; right?: React.ReactNode }) {
  return (
    <Link href={`/social/content/${p.contentItemId}?post=${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[.04]">
      <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-ink/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" /> : null}
        <span className="absolute -bottom-0.5 -right-0.5">
          <PlatformIcon platform={p.platform} size={16} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{p.title}</p>
        <p className="truncate text-[12px] text-muted">
          {p.project.name} · {PLATFORM_META[p.platform].name} · {p.account.name}
        </p>
      </div>
      {right}
    </Link>
  );
}

function Stat({ label, value, href, tone, icon }: { label: string; value: number; href: string; tone?: "warn" | "bad"; icon: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-2xl border border-line bg-white p-4 transition hover:border-ink/20">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[12.5px]">{label}</span>
        {icon}
      </div>
      <p className={`mt-2 font-display text-[26px] font-semibold tabular ${tone === "bad" && value ? "text-red-600" : tone === "warn" && value ? "text-amber-600" : ""}`}>{value}</p>
    </Link>
  );
}

export function Dashboard() {
  const { me, projectId, project, can } = useSocial();
  const { data, error, loading, reload } = useApi<Dash>(`/api/social/dashboard${projectId ? `?project=${projectId}` : ""}`, [projectId]);
  if (!me.projects.length)
    return (
      <>
        <PageHeader title="Dashboard" />
        <Empty icon={<Sparkles className="h-6 w-6" />} title="Nie masz jeszcze żadnego projektu" action={me.user.staff ? <Link href="/social/projects"><Button>Utwórz pierwszy projekt</Button></Link> : undefined}>
          {me.user.staff ? "Załóż organizację klienta i jego projekt albo wczytaj dane DEMO w Ustawieniach." : "Poproś osobę, która Cię zaprosiła, o dostęp do projektu."}
        </Empty>
      </>
    );
  return (
    <>
      <PageHeader
        title={project ? project.name : "Dashboard"}
        subtitle={project ? `${project.organizationName} · strefa czasowa ${project.timezone}` : "Wszystkie Twoje projekty"}
        actions={
          can("content.edit") ? (
            <Link href={`/social/library${projectId ? `?project=${projectId}` : ""}`}>
              <Button size="sm">
                <Upload /> Dodaj film
              </Button>
            </Link>
          ) : undefined
        }
      />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Do akceptacji" value={data.counts.pending} href="/social/approvals" tone="warn" icon={<CircleCheck className="h-4 w-4" />} />
            <Stat label="Zaplanowane" value={data.counts.scheduled} href="/social/calendar" icon={<Send className="h-4 w-4" />} />
            <Stat label="Nieprzeczytane komentarze" value={data.counts.unreadComments} href="/social/comments" icon={<Inbox className="h-4 w-4" />} />
            <Stat label="Błędy publikacji" value={data.counts.failed} href="/social/publications?status=SCHEDULING_FAILED,PUBLISH_FAILED,REAUTH_REQUIRED" tone="bad" icon={<AlertTriangle className="h-4 w-4" />} />
          </div>
          {data.reauth.length ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300" data-testid="reauth-alert">
              <p className="font-medium">Konta wymagają ponownego połączenia</p>
              <ul className="mt-1 space-y-0.5">
                {data.reauth.map((a) => (
                  <li key={a.id}>
                    <Link className="underline" href={`/social/projects/${a.projectId}?tab=accounts`}>
                      {a.project.name}: {PLATFORM_META[a.platform].name} {a.displayName ?? a.accountHandle ?? ""} — {a.connectionStatus === "DISCONNECTED" ? "rozłączone" : "połącz ponownie"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Najbliższe 7 dni" actions={<Link href="/social/calendar" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Kalendarz <ArrowRight className="h-3 w-3" /></Link>}>
              {data.upcoming.length ? (
                <div className="-mx-2">
                  {data.upcoming.map((p) => (
                    <PostLine key={p.id} p={p} right={<div className="text-right text-[12px]"><When at={p.scheduledAt} tz={p.project.timezone} /><div className="mt-0.5"><StatusPill status={p.status} /></div></div>} />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted">Nic nie jest zaplanowane na najbliższy tydzień.</p>
              )}
            </Panel>
            <Panel title="Ostatnio opublikowane" actions={<Link href="/social/analytics" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Analityka <ArrowRight className="h-3 w-3" /></Link>}>
              {data.recent.length ? (
                <div className="-mx-2">
                  {data.recent.map((p) => (
                    <PostLine key={p.id} p={p} right={<div className="text-right text-[12px] text-muted"><Metric value={p.metrics?.views ?? null} /> wyśw.<div className="text-[11px]">{p.metrics ? `stan: ${new Date(p.metrics.capturedAt).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "czeka na dane"}</div></div>} />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted">W ostatnim tygodniu nic się nie ukazało.</p>
              )}
            </Panel>
          </div>
          {data.failed.length ? (
            <Panel title="Wymaga uwagi">
              <div className="-mx-2">
                {data.failed.map((p) => (
                  <PostLine key={p.id} p={p} right={<div className="max-w-[45%] text-right text-[12px]"><StatusPill status={p.status} /><p className="mt-0.5 line-clamp-2 text-red-600">{p.errorMessage}</p></div>} />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
