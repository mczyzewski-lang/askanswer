"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Badge, Card, EmptyState, NativeSelect, useToast } from "@/components/ui";
import { api } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { POST_STATUS, type PostStatus } from "@/lib/social/status";

interface Data {
  linked: { id: string; name: string; organization: string; timezone: string } | null;
  options: Array<{ id: string; name: string; organization: string }>;
  posts: Array<{ id: string; platform: Platform; status: PostStatus; at: string | null; title: string; account: string }>;
}

const TONE = { gray: "gray", amber: "amber", blue: "blue", green: "green", red: "red", violet: "blue" } as const;

/** The project's publications in Social Media Studio: what is planned and what went out lately. */
export function ProjectSocial({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const load = useCallback(async () => setData(await api<Data>(`/api/admin/projects/${id}/social`)), [id]);
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);
  if (!data) return <p className={error ? "text-sm text-red-600" : "text-sm text-muted"}>{error ?? "Wczytuję…"}</p>;
  const tz = data.linked?.timezone ?? "Europe/Warsaw";
  const day = (iso: string) => new Intl.DateTimeFormat("pl-PL", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
  const hour = (iso: string) => new Intl.DateTimeFormat("pl-PL", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const now = Date.now();
  const upcoming = data.posts.filter((p) => p.at && new Date(p.at).getTime() >= now);
  const past = data.posts.filter((p) => p.at && new Date(p.at).getTime() < now).reverse();
  const groups = new Map<string, Data["posts"]>();
  for (const p of upcoming) groups.set(day(p.at!), [...(groups.get(day(p.at!)) ?? []), p]);

  const link = async (socialProjectId: string | null) => {
    try {
      await api(`/api/admin/projects/${id}/social`, { method: "PUT", json: { socialProjectId } });
      toast(socialProjectId ? "Połączono z projektem Social Media" : "Odłączono");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const Row = ({ p }: { p: Data["posts"][number] }) => {
    const st = POST_STATUS[p.status];
    return (
      <li className="flex items-center gap-3 py-2 text-sm" data-testid="social-post">
        <span className="w-12 shrink-0 tabular-nums text-muted">{p.at ? hour(p.at) : "—"}</span>
        <span className="w-8 shrink-0 rounded-md px-1 py-0.5 text-center text-[11px] font-semibold text-white" style={{ background: PLATFORM_META[p.platform]?.color ?? "#666" }}>
          {PLATFORM_META[p.platform]?.short ?? p.platform}
        </span>
        <span className="min-w-0 flex-1 truncate">{p.title || "(bez tytułu)"}</span>
        <span className="hidden shrink-0 text-xs text-muted sm:inline">{p.account}</span>
        <Badge tone={TONE[st.tone]}>{st.label}</Badge>
      </li>
    );
  };

  return (
    <div className="space-y-6" data-testid="project-social">
      {toastNode}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Harmonogram social media</h1>
          <p className="mt-1 text-sm text-muted">Publikacje tego projektu zaplanowane w Social Media Studio.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {data.linked ? (
            <Link href={`/social/calendar?project=${data.linked.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 font-medium text-white" data-testid="open-project-calendar">
              <CalendarDays className="h-4 w-4" /> Kalendarz projektu
            </Link>
          ) : null}
          <Link href="/social/calendar?project=all" className="inline-flex items-center gap-1 text-muted underline hover:text-ink">
            Wszystkie projekty <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">
          Projekt w Social Media Studio:{" "}
          {data.linked ? (
            <span className="font-medium">
              {data.linked.name} <span className="font-normal text-muted">· {data.linked.organization}</span>
            </span>
          ) : (
            <span className="text-muted">nie połączono</span>
          )}
        </p>
        {canEdit ? (
          <NativeSelect className="w-72" value={data.linked?.id ?? ""} onChange={(e) => void link(e.target.value || null)} aria-label="Projekt w Social Media Studio" data-testid="social-link">
            <option value="">— nie łącz —</option>
            {data.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.organization})
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </Card>

      {!data.linked ? (
        <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Brak połączenia">
          {data.options.length ? "Wybierz powyżej projekt Social Media Studio, z którego publikujesz filmy tego projektu." : "Najpierw utwórz projekt w Social Media Studio."}
        </EmptyState>
      ) : (
        <>
          <Card className="p-5">
            <p className="mb-2 font-medium">Zaplanowane ({upcoming.length})</p>
            {upcoming.length ? (
              [...groups.entries()].map(([d, ps]) => (
                <div key={d} className="mt-3 first:mt-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{d}</p>
                  <ul className="divide-y divide-line">
                    {ps.map((p) => (
                      <Row key={p.id} p={p} />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Nic nie jest zaplanowane na najbliższe 60 dni.</p>
            )}
          </Card>
          {past.length ? (
            <Card className="p-5">
              <p className="mb-2 font-medium">Ostatnie 7 dni</p>
              <ul className="divide-y divide-line">
                {past.map((p) => (
                  <Row key={p.id} p={p} />
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
