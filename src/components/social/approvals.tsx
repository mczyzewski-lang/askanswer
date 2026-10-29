"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, CircleCheck, MessageSquareWarning, X } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PLATFORM_META } from "@/lib/social/platforms";
import { composeCaption } from "@/lib/social/rules";
import { useSocial } from "./shell";
import type { PostRow } from "./dashboard";
import { DemoBadge, Empty, ErrorBox, Loading, PageHeader, PlatformIcon, useApi, When } from "./ui";

type QueueRow = PostRow & { videoUrl: string; issues: string[]; canApprove: boolean };

const OPTION_LABELS: Record<string, (v: unknown) => string | null> = {
  youtubePrivacy: (v) => `Widoczność: ${v}`,
  youtubeTags: (v) => (Array.isArray(v) && v.length ? `Tagi YouTube: ${(v as string[]).join(", ")}` : null),
  tiktokPrivacy: (v) => `Prywatność TikTok: ${v}`,
  disableComments: (v) => (v ? "Komentarze wyłączone" : null),
  shareToFeed: (v) => (v === false ? "Bez pokazywania w siatce" : "Także w siatce profilu"),
  facebookMediaType: (v) => `Format: ${v === "VIDEO" ? "post wideo" : "Reels"}`,
  aiGenerated: (v) => (v ? "Oznaczone jako treść AI" : null),
};

export function Approvals() {
  const { projectId, toast } = useSocial();
  const search = useSearchParams();
  const focus = search.get("post");
  const { data, error, loading, reload } = useApi<{ posts: QueueRow[] }>(`/api/social/approvals${projectId ? `?project=${projectId}` : ""}`, [projectId]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [comment, setComment] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (focus) document.getElementById(`q-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, data]);
  const decide = async (rows: QueueRow[], decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED", note = "") => {
    setBusy(true);
    try {
      const r = await api<{ results: Array<{ id: string; ok: boolean; error?: string }> }>("/api/social/posts/decide", { method: "POST", json: { items: rows.map((p) => ({ postId: p.id, revision: p.revision })), decision, comment: note } });
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `Nie wszystko się udało: ${bad.map((b) => b.error).join(" · ")}` : decision === "APPROVED" ? `Zatwierdzono (${r.results.length}) — publikacje zostaną zaplanowane` : "Zapisano decyzję", bad.length ? "err" : "ok");
      setSelected(new Set());
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const rows = data?.posts ?? [];
  const approvable = rows.filter((p) => p.canApprove && !p.issues.length);
  return (
    <>
      <PageHeader
        title="Do akceptacji"
        subtitle="Nic nie zostanie zaplanowane ani opublikowane bez zatwierdzenia konkretnej wersji przez człowieka."
        actions={
          selected.size ? (
            <Button size="sm" disabled={busy} onClick={() => void decide(rows.filter((p) => selected.has(p.id)), "APPROVED")} data-testid="approve-selected">
              <Check /> Zatwierdź wybrane ({selected.size})
            </Button>
          ) : approvable.length > 1 ? (
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(approvable.map((p) => p.id)))}>
              Zaznacz wszystkie gotowe
            </Button>
          ) : undefined
        }
      />
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !rows.length ? <Empty icon={<CircleCheck className="h-6 w-6" />} title="Nic nie czeka na akceptację">Gdy redaktor wyśle publikacje do akceptacji, pojawią się tutaj.</Empty> : null}
      <div className="space-y-4">
        {rows.map((p) => {
          const caption = composeCaption({ description: p.description, cta: p.cta, hashtags: p.hashtags });
          const opts = Object.entries(p.options)
            .map(([k, v]) => OPTION_LABELS[k]?.(v))
            .filter(Boolean);
          return (
            <article key={p.id} id={`q-${p.id}`} className={cn("grid gap-4 rounded-2xl border bg-white p-4 md:grid-cols-[180px_1fr_260px]", focus === p.id ? "border-ink" : "border-line")} data-testid="approval-item" data-platform={p.platform}>
              <div className="aspect-[9/16] overflow-hidden rounded-xl bg-black">
                <video src={p.videoUrl} controls playsInline preload="metadata" poster={p.thumbUrl ?? undefined} className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <PlatformIcon platform={p.platform} size={22} />
                  <span className="font-medium">{PLATFORM_META[p.platform].name}</span>
                  <span className="text-[13px] text-muted">
                    → {p.account.name} {p.account.handle ? `@${p.account.handle}` : ""}
                  </span>
                  {p.isDemo ? <DemoBadge /> : null}
                </div>
                <p className="text-[12.5px] text-muted">
                  {p.project.name} · {p.title} ·{" "}
                  <Link className="underline" href={`/social/content/${p.contentItemId}?post=${p.id}`}>
                    edytor
                  </Link>
                </p>
                {p.postTitle ? <p className="font-semibold">{p.postTitle}</p> : null}
                <p className="whitespace-pre-line rounded-xl bg-ink/[.03] p-3 text-[13.5px] leading-relaxed" data-testid="final-caption">
                  {caption}
                </p>
                {p.firstComment ? <p className="text-[12.5px] text-muted">Pierwszy komentarz: „{p.firstComment}”</p> : null}
                {opts.length ? <p className="text-[12px] text-muted">{opts.join(" · ")}</p> : null}
                {p.issues.length ? <ErrorBox error={p.issues.join(" ")} /> : null}
              </div>
              <div className="space-y-2">
                <div className="rounded-xl border border-line p-3 text-[13px]">
                  <p className="text-[12px] text-muted">Termin publikacji ({p.project.timezone})</p>
                  <p className="font-medium" data-testid="approval-time">
                    <When at={p.scheduledAt} tz={p.project.timezone} opts={{ weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }} />
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted">Wersja {p.revision}</p>
                </div>
                {p.canApprove ? (
                  <>
                    <label className="flex items-center gap-2 text-[12.5px]">
                      <input type="checkbox" checked={selected.has(p.id)} disabled={!!p.issues.length} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /> Zaznacz do zbiorczej akceptacji
                    </label>
                    <Textarea rows={2} placeholder="Komentarz (opcjonalnie)" value={comment[p.id] ?? ""} onChange={(e) => setComment((c) => ({ ...c, [p.id]: e.target.value }))} aria-label="Komentarz do decyzji" />
                    <Button className="w-full" size="sm" disabled={busy || !!p.issues.length} onClick={() => void decide([p], "APPROVED", comment[p.id])} data-testid="approve">
                      <Check /> Akceptuj
                    </Button>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => void decide([p], "CHANGES_REQUESTED", comment[p.id])} data-testid="request-changes">
                        <MessageSquareWarning /> Poprawki
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-red-600" disabled={busy} onClick={() => void decide([p], "REJECTED", comment[p.id])} data-testid="reject">
                        <X /> Odrzuć
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-[12.5px] text-muted">Czeka na osobę z uprawnieniem do akceptacji.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
