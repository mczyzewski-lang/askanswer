"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Ban, ExternalLink, RefreshCw, Search } from "lucide-react";
import { Button, Input, NativeSelect } from "@/components/ui";
import { api } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META } from "@/lib/social/platforms";
import { canCancel } from "@/lib/social/status";
import { useSocial } from "./shell";
import type { PostRow } from "./dashboard";
import { DemoBadge, Empty, ErrorBox, Loading, PageHeader, PlatformIcon, Seg, StatusPill, useApi, When } from "./ui";

type Row = PostRow & { provider: { status: string; providerJobId: string | null; providerRequestId: string | null; externalId: string; errorMessage: string | null } | null };

const GROUPS: Array<[string, string, string]> = [
  ["active", "W toku", "PENDING_APPROVAL,APPROVED,SCHEDULING,SCHEDULED,PUBLISHING"],
  ["published", "Opublikowane", "PUBLISHED"],
  ["failed", "Błędy", "SCHEDULING_FAILED,PUBLISH_FAILED,REAUTH_REQUIRED"],
  ["other", "Odrzucone / anulowane", "REJECTED,CHANGES_REQUESTED,CANCELLED"],
  ["all", "Wszystkie", ""],
];

export function Publications() {
  const { projectId, can, toast } = useSocial();
  const search = useSearchParams();
  const initial = search.get("status");
  const [group, setGroup] = React.useState(initial ? (GROUPS.find((g) => g[2] === initial)?.[0] ?? "all") : "all");
  const [platform, setPlatform] = React.useState("");
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const status = GROUPS.find((g) => g[0] === group)?.[2] ?? "";
  const qs = new URLSearchParams({ ...(projectId ? { project: projectId } : {}), ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(query ? { q: query } : {}) });
  const { data, error, loading, reload } = useApi<{ posts: Row[] }>(`/api/social/publications?${qs}`, [qs.toString()]);
  const act = async (url: string, msg: string) => {
    try {
      await api(url, { method: "POST" });
      toast(msg);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <>
      <PageHeader title="Publikacje" subtitle="Każde konto docelowe ma osobny status i osobne zlecenie u dostawcy." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Seg value={group} onChange={setGroup} items={GROUPS.map(([k, l]) => [k, l] as [string, string])} />
        <NativeSelect className="h-8 w-40 text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platforma">
          <option value="">Wszystkie platformy</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_META[p].name}
            </option>
          ))}
        </NativeSelect>
        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <Input className="h-8 w-56 text-xs" placeholder="Szukaj w opisach i tytułach" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj" />
          <Button size="iconSm" variant="outline" type="submit" aria-label="Szukaj">
            <Search />
          </Button>
        </form>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.posts.length ? <Empty title="Brak publikacji">Zmień filtry albo przygotuj publikacje w Bibliotece treści.</Empty> : null}
      {data?.posts.length ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[900px] text-[13px]" data-testid="publications">
            <thead className="border-b border-line text-left text-[12px] text-muted">
              <tr>
                <th className="px-3 py-2">Film</th>
                <th className="px-3 py-2">Konto</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Termin</th>
                <th className="px-3 py-2">Dostawca</th>
                <th className="px-3 py-2 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((p) => (
                <tr key={p.id} className="border-b border-line align-top last:border-0" data-testid="publication-row" data-status={p.status}>
                  <td className="px-3 py-2">
                    <Link href={`/social/content/${p.contentItemId}?post=${p.id}`} className="flex items-center gap-2 hover:underline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumbUrl ? <img src={p.thumbUrl} alt="" className="h-10 w-7 rounded object-cover" /> : null}
                      <span className="line-clamp-2">{p.title}</span>
                    </Link>
                    <span className="text-[11.5px] text-muted">
                      {p.project.name} {p.isDemo ? <DemoBadge className="ml-1" /> : null}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <PlatformIcon platform={p.platform} size={16} /> {p.account.name}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={p.status} />
                    {p.errorMessage && p.status !== "PUBLISHED" ? <p className="mt-1 max-w-[260px] text-[11.5px] text-red-600">{p.errorMessage}</p> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <When at={p.publishedAt ?? p.scheduledAt} tz={p.project.timezone} />
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-muted">{p.provider ? <>{p.provider.status}<br />{p.provider.providerJobId ?? p.provider.providerRequestId ?? "—"}<br />{p.provider.externalId}</> : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      {p.publishedUrl ? (
                        <a href={p.publishedUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[12px] hover:bg-ink/[.03]">
                          <ExternalLink className="h-3.5 w-3.5" /> Otwórz
                        </a>
                      ) : null}
                      {can("content.schedule", p.project.id) && ["SCHEDULING_FAILED", "PUBLISH_FAILED"].includes(p.status) ? (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => void act(`/api/social/posts/${p.id}/retry`, "Ponawiam")}>
                          <RefreshCw /> Ponów
                        </Button>
                      ) : null}
                      {can("content.schedule", p.project.id) && canCancel(p.status as never) && p.status !== "DRAFT" ? (
                        <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => confirm("Anulować?") && void act(`/api/social/posts/${p.id}/cancel`, "Anulowano")} data-testid="row-cancel">
                          <Ban /> Anuluj
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
