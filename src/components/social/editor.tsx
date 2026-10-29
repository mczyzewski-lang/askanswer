"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, Check, Clock, ExternalLink, History, Loader2, MessageSquareWarning, Plus, RefreshCw, RotateCcw, Save, Send, Smartphone, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Button, Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api, cn, formatDuration } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { composeCaption } from "@/lib/social/rules";
import { canCancel, canDecide, canSubmit } from "@/lib/social/status";
import { utcToZonedInput, formatInTz } from "@/lib/social/tz";
import { useSocial } from "./shell";
import type { AccountView } from "./project";
import type { MediaItem } from "./library";
import { chars, DemoBadge, ErrorBox, Field, Loading, Metric, Pill, PlatformIcon, StatusPill, Tabs, useApi, waitForJob } from "./ui";

interface Issue {
  level: "error" | "warning";
  field: string;
  message: string;
}
export interface EditorPost {
  id: string;
  platform: Platform;
  status: string;
  title: string;
  description: string;
  hashtags: string[];
  cta: string;
  firstComment: string;
  coverTimestamp: number | null;
  options: Record<string, unknown>;
  altOpenings: string[];
  coverReason: string;
  mediaVariantId: string | null;
  scheduledAt: string | null;
  revision: number;
  approvedRevision: number | null;
  approvedAt: string | null;
  approvedBy: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  warnings: string[];
  isDemo: boolean;
  account: AccountView;
  issues: Issue[];
  limits: { title?: number; text: number; hashtagsMax: number; hashtagsRecommended: [number, number]; firstComment?: number; tagsTotal?: number };
  fields: { title: boolean; firstComment: boolean; tags: boolean };
  provider: { status: string; jobId: string | null; requestId: string | null; externalId: string; scheduledAt: string; error: string | null } | null;
  publications: Array<{ id: string; generation: number; status: string; jobId: string | null; requestId: string | null; externalId: string; scheduledAt: string; error: string | null; url: string | null; attempts: Array<{ kind: string; ok: boolean; httpStatus: number | null; error: string | null; at: string }> }>;
  approvals: Array<{ id: string; decision: string; revision: number; comment: string; by: string; at: string; invalidatedAt: string | null; invalidatedReason: string | null }>;
  revisions: Array<{ revision: number; reason: string; by: string; at: string; snapshot: unknown }>;
  generations: Array<{ id: string; kind: string; at: string; model: string; rulesVersion: string; output: unknown; error: string | null }>;
}
interface ContentData {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  isDemo: boolean;
  media: MediaItem;
  posts: EditorPost[];
  project: { id: string; name: string; timezone: string };
  permissions: string[];
  accounts: AccountView[];
}

type Draft = Pick<EditorPost, "title" | "description" | "hashtags" | "cta" | "firstComment" | "coverTimestamp" | "options" | "mediaVariantId"> & { scheduledLocal: string };
const toDraft = (p: EditorPost, tz: string): Draft => ({ title: p.title, description: p.description, hashtags: p.hashtags, cta: p.cta, firstComment: p.firstComment, coverTimestamp: p.coverTimestamp, options: p.options, mediaVariantId: p.mediaVariantId, scheduledLocal: p.scheduledAt ? utcToZonedInput(p.scheduledAt, tz) : "" });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

const REGEN: Array<[string, string]> = [
  ["shorter", "Krócej"],
  ["sales", "Bardziej sprzedażowo"],
  ["educational", "Bardziej edukacyjnie"],
  ["natural", "Bardziej naturalnie"],
  ["concrete", "Więcej konkretów"],
  ["other_cta", "Inne CTA"],
  ["hashtags", "Wygeneruj ponownie tylko hashtagi"],
];

export function ContentEditor({ id }: { id: string }) {
  const { toast } = useSocial();
  const search = useSearchParams();
  const { data, error, loading, reload } = useApi<ContentData>(`/api/social/content/${id}`);
  const [active, setActive] = React.useState<string>(search.get("post") ?? "");
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const [openings, setOpenings] = React.useState<Array<{ mechanism: string; text: string }> | null>(null);
  const [addTarget, setAddTarget] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const tz = data?.project.timezone ?? "Europe/Warsaw";

  React.useEffect(() => {
    if (!data) return;
    setDrafts(Object.fromEntries(data.posts.map((p) => [p.id, toDraft(p, tz)])));
    if (!data.posts.some((p) => p.id === active) && data.posts[0]) setActive(data.posts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  // statuses move by themselves while the provider works
  const moving = data?.posts.some((p) => ["SCHEDULING", "PUBLISHING", "APPROVED"].includes(p.status) || (p.provider && ["CANCELLING", "UNKNOWN"].includes(p.provider.status)));
  React.useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [moving, reload]);
  const dirtyIds = data ? data.posts.filter((p) => drafts[p.id] && !same(drafts[p.id], toDraft(p, tz))).map((p) => p.id) : [];
  React.useEffect(() => {
    if (!dirtyIds.length) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyIds.length]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const perms = new Set(data.permissions);
  const post = data.posts.find((p) => p.id === active) ?? data.posts[0];
  const draft = post ? drafts[post.id] : undefined;
  const setDraft = (patch: Partial<Draft>) => post && setDrafts((d) => ({ ...d, [post.id]: { ...d[post.id], ...patch } }));
  const media = data.media;
  const variant = draft?.mediaVariantId ? media.variants.find((v) => v.id === draft.mediaVariantId) : null;

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      if (ok) toast(ok);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  const save = async (ids: string[]) => {
    for (const pid of ids) {
      const d = drafts[pid];
      const p = data.posts.find((x) => x.id === pid)!;
      if (p.approvedRevision === p.revision && !confirm(`${PLATFORM_META[p.platform].name}: ta publikacja jest zatwierdzona. Zmiana wycofa akceptację${p.provider ? " i wstrzyma zlecenie u dostawcy" : ""} — będzie wymagać ponownego zatwierdzenia. Kontynuować?`)) return;
      await api(`/api/social/posts/${pid}`, { method: "PATCH", json: { title: d.title, description: d.description, hashtags: d.hashtags, cta: d.cta, firstComment: d.firstComment, coverTimestamp: d.coverTimestamp, options: d.options, mediaVariantId: d.mediaVariantId, scheduledAt: d.scheduledLocal || null } });
    }
  };
  const editable = perms.has("content.edit") && post && !["PUBLISHED", "PUBLISHING", "SCHEDULING"].includes(post.status);
  const caption = draft ? composeCaption({ description: draft.description, cta: draft.cta, hashtags: draft.hashtags }) : "";

  return (
    <div className="space-y-5" data-testid="content-editor">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/social/library?project=${data.projectId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Biblioteka
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold">{data.title || media.title}</h1>
        {data.isDemo ? <DemoBadge /> : null}
        {perms.has("content.edit") ? (
          <>
            <Button size="sm" variant="outline" onClick={() => void run("gen", async () => { const r = await api<{ jobId: string }>(`/api/social/content/${id}/generate`, { method: "POST", json: {} }); await waitForJob(r.jobId); }, "AI przygotowało nowe wersje (szkice)")} disabled={!!busy} data-testid="generate-all">
              {busy === "gen" ? <Loader2 className="animate-spin" /> : <Sparkles />} AI: wszystkie platformy
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddTarget(true)}>
              <Plus /> Konto
            </Button>
            <Button size="sm" variant="outline" disabled={!dirtyIds.length || !!busy} onClick={() => void run("save", () => save(dirtyIds), "Zapisano")} data-testid="save-all">
              <Save /> Zapisz {dirtyIds.length ? `(${dirtyIds.length})` : ""}
            </Button>
            <Button
              size="sm"
              disabled={!!busy || !data.posts.some((p) => canSubmit(p.status as never))}
              onClick={() =>
                void run("submit", async () => {
                  if (dirtyIds.length) await save(dirtyIds);
                  const r = await api<{ results: Array<{ id: string; ok: boolean; errors: string[] }> }>("/api/social/posts/submit", { method: "POST", json: { postIds: data.posts.filter((p) => canSubmit(p.status as never)).map((p) => p.id) } });
                  const bad = r.results.filter((x) => !x.ok);
                  if (bad.length) throw new Error(bad.map((b) => `${PLATFORM_META[data.posts.find((p) => p.id === b.id)!.platform].name}: ${b.errors.join(" ")}`).join(" · "));
                }, "Wysłano do akceptacji")
              }
              data-testid="submit-all"
            >
              <Send /> Wyślij wszystko do akceptacji
            </Button>
          </>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* LEFT: film */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <div className="aspect-[9/16] overflow-hidden rounded-2xl bg-black">{(variant?.url ?? media.videoUrl) ? <video ref={videoRef} key={variant?.url ?? media.videoUrl!} src={variant?.url ?? media.videoUrl!} poster={media.thumbUrl ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-contain" /> : null}</div>
          <div className="rounded-2xl border border-line bg-white p-3 text-[12.5px]">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Długość</dt>
              <dd>{formatDuration(media.durationSec)}</dd>
              <dt className="text-muted">Format</dt>
              <dd>
                {media.width}×{media.height} · {media.videoCodec}
              </dd>
            </dl>
            {post && draft ? (
              <>
                {media.variants.some((v) => v.status === "READY") ? (
                  <Field label="Plik do publikacji">
                    <NativeSelect value={draft.mediaVariantId ?? ""} onChange={(e) => setDraft({ mediaVariantId: e.target.value || null })} disabled={!editable} className="h-8 text-xs">
                      <option value="">Oryginał</option>
                      {media.variants
                        .filter((v) => v.status === "READY")
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            Pionowy {v.width}×{v.height}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                <div className="mt-2">
                  <Field label={`Okładka: ${draft.coverTimestamp !== null ? `${draft.coverTimestamp.toFixed(1)} s` : "automatyczna"}`} hint={post.coverReason ? `AI: ${post.coverReason}` : "Klatka filmu na miniaturę."}>
                    <input
                      type="range"
                      className="range range-light"
                      min={0}
                      max={Math.max(0.1, (media.durationSec ?? 1) - 0.1)}
                      step={0.1}
                      value={draft.coverTimestamp ?? 0}
                      disabled={!editable}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setDraft({ coverTimestamp: v });
                        if (videoRef.current) videoRef.current.currentTime = v;
                      }}
                      aria-label="Okładka"
                    />
                  </Field>
                </div>
                {media.checks?.[post.platform] && (media.checks[post.platform].errors.length || media.checks[post.platform].warnings.length) && !draft.mediaVariantId ? (
                  <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
                    {PLATFORM_META[post.platform].name}: {[...media.checks[post.platform].errors, ...media.checks[post.platform].warnings].join(" ")}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </aside>

        {/* RIGHT: one tab per target */}
        <section className="min-w-0">
          <Tabs
            value={post?.id ?? ""}
            onChange={setActive}
            items={data.posts.map((p) => [
              p.id,
              <span key={p.id} className="flex items-center gap-1.5" data-testid="platform-tab" data-platform={p.platform}>
                <PlatformIcon platform={p.platform} size={16} />
                {PLATFORM_META[p.platform].name}
                {dirtyIds.includes(p.id) ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="niezapisane" /> : null}
              </span>,
            ])}
          />
          {!post || !draft ? (
            <p className="py-10 text-center text-sm text-muted">Brak kont docelowych — dodaj konto.</p>
          ) : (
            <div className="mt-4 space-y-4" data-testid="post-editor" data-post={post.id}>
              {/* where it goes */}
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3">
                <PlatformIcon platform={post.platform} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-muted">Zostanie opublikowane na koncie</p>
                  <p className="truncate font-medium" data-testid="target-account-name">
                    {post.account.displayName ?? post.account.handle} {post.account.handle ? <span className="text-muted">@{post.account.handle}</span> : null} {post.account.pageName ? <span className="text-muted">· {post.account.pageName}</span> : null}
                  </p>
                </div>
                <StatusPill status={post.status} />
                {post.account.status !== "CONNECTED" ? <Pill tone="red">konto wymaga połączenia</Pill> : null}
              </div>
              {post.errorMessage && !["PUBLISHED"].includes(post.status) ? <ErrorBox error={post.errorMessage} /> : null}
              {post.provider?.status === "CANCELLING" ? <p className="rounded-xl bg-amber-50 p-2.5 text-[12.5px] text-amber-900 dark:bg-amber-400/10 dark:text-amber-300">Wstrzymuję zlecenie u dostawcy…</p> : null}
              {post.publishedUrl ? (
                <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                  Zobacz publikację <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
                <div className="space-y-4 rounded-2xl border border-line bg-white p-4">
                  {post.fields.title ? (
                    <Field label="Tytuł" counter={{ n: chars(draft.title), max: post.limits.title }}>
                      <Input value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} disabled={!editable} aria-label="Tytuł" />
                    </Field>
                  ) : null}
                  <Field label="Opis" counter={{ n: chars(caption), max: post.limits.text }} hint="Licznik obejmuje opis + CTA + hashtagi (tak jak trafi na platformę).">
                    <Textarea rows={8} value={draft.description} onChange={(e) => setDraft({ description: e.target.value })} disabled={!editable} aria-label="Opis" data-testid="description" />
                  </Field>
                  <HashtagInput value={draft.hashtags} onChange={(v) => setDraft({ hashtags: v })} disabled={!editable} limits={post.limits} />
                  <Field label="CTA">
                    <Input value={draft.cta} onChange={(e) => setDraft({ cta: e.target.value })} disabled={!editable} aria-label="CTA" />
                  </Field>
                  {post.fields.firstComment ? (
                    <Field label="Pierwszy komentarz (opcjonalnie)" counter={{ n: chars(draft.firstComment), max: post.limits.firstComment }}>
                      <Textarea rows={2} value={draft.firstComment} onChange={(e) => setDraft({ firstComment: e.target.value })} disabled={!editable} aria-label="Pierwszy komentarz" />
                    </Field>
                  ) : null}
                  <PlatformOptions platform={post.platform} options={draft.options} onChange={(o) => setDraft({ options: o })} disabled={!editable} limits={post.limits} />
                  {post.issues.length ? (
                    <ul className="space-y-1 text-[12.5px]" data-testid="issues">
                      {post.issues.map((i, n) => (
                        <li key={n} className={i.level === "error" ? "text-red-600" : "text-amber-700 dark:text-amber-300"}>
                          {i.level === "error" ? "✕" : "!"} {i.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {editable ? (
                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" disabled={!!busy} data-testid="regenerate">
                            {busy === "regen" ? <Loader2 className="animate-spin" /> : <Wand2 />} Regeneruj
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {REGEN.map(([mode, label]) => (
                            <DropdownMenuItem key={mode} onSelect={() => void run("regen", () => api(`/api/social/posts/${post.id}/regenerate`, { method: "POST", json: { mode } }), "Nowa wersja zapisana (poprzednia jest w historii)")}>
                              {label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("open", async () => setOpenings((await api<{ openings: Array<{ mechanism: string; text: string }> }>(`/api/social/posts/${post.id}/openings`, { method: "POST" })).openings))}>
                        {busy === "open" ? <Loader2 className="animate-spin" /> : <Sparkles />} 3 otwarcia
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPhone(true)}>
                        <Smartphone /> Podgląd
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
                        <History /> Historia
                      </Button>
                      <Button size="sm" className="ml-auto" disabled={!dirtyIds.includes(post.id) || !!busy} onClick={() => void run("save", () => save([post.id]), "Zapisano szkic")} data-testid="save">
                        <Save /> Zapisz
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2 border-t border-line pt-3">
                      <Button size="sm" variant="outline" onClick={() => setPhone(true)}>
                        <Smartphone /> Podgląd
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
                        <History /> Historia
                      </Button>
                    </div>
                  )}
                  {post.altOpenings.length && editable ? (
                    <div className="rounded-xl bg-ink/[.03] p-3 text-[12.5px]">
                      <p className="mb-1 font-medium">Alternatywne otwarcia od AI</p>
                      {post.altOpenings.map((o, i) => (
                        <button key={i} className="block w-full rounded-lg px-2 py-1 text-left hover:bg-ink/5" onClick={() => setDraft({ description: replaceOpening(draft.description, o) })}>
                          „{o}”
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* schedule + approval */}
                <div className="space-y-4">
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <Field label={`Termin (${tz})`} hint={post.scheduledAt ? `= ${new Date(post.scheduledAt).toISOString().replace("T", " ").slice(0, 16)} UTC` : "Domyślnie decydujesz Ty."}>
                      <Input type="datetime-local" value={draft.scheduledLocal} onChange={(e) => setDraft({ scheduledLocal: e.target.value })} disabled={!editable} aria-label="Data publikacji" data-testid="schedule-input" />
                    </Field>
                    <SuggestTimes accountId={post.account.id} tz={tz} onPick={(local) => editable && setDraft({ scheduledLocal: local })} />
                  </div>
                  <div className="space-y-2 rounded-2xl border border-line bg-white p-4 text-[13px]">
                    <p className="font-medium">Akceptacja</p>
                    {post.approvedRevision === post.revision && post.approvedAt ? (
                      <p className="text-emerald-700 dark:text-emerald-300">
                        <Check className="mr-1 inline h-3.5 w-3.5" />
                        Zatwierdzona wersja {post.revision} — {post.approvedBy}, {formatInTz(post.approvedAt, tz)}
                      </p>
                    ) : (
                      <p className="text-muted">Wersja {post.revision} nie jest zatwierdzona.</p>
                    )}
                    {perms.has("content.edit") && canSubmit(post.status as never) ? (
                      <Button size="sm" className="w-full" disabled={!!busy} onClick={() => void run("submit1", async () => { if (dirtyIds.includes(post.id)) await save([post.id]); const r = await api<{ results: Array<{ ok: boolean; errors: string[] }> }>("/api/social/posts/submit", { method: "POST", json: { postIds: [post.id] } }); if (!r.results[0].ok) throw new Error(r.results[0].errors.join(" ")); }, "Wysłano do akceptacji")} data-testid="submit">
                        <Send /> Wyślij do akceptacji
                      </Button>
                    ) : null}
                    {perms.has("content.approve") && canDecide(post.status as never) ? <DecisionButtons post={post} dirty={dirtyIds.includes(post.id)} onDone={reload} /> : null}
                    {perms.has("content.schedule") && ["SCHEDULING_FAILED", "PUBLISH_FAILED"].includes(post.status) ? (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => void run("retry", () => api(`/api/social/posts/${post.id}/retry`, { method: "POST" }), "Ponawiam")}>
                        <RefreshCw /> Ponów
                      </Button>
                    ) : null}
                    {perms.has("content.schedule") && canCancel(post.status as never) && post.status !== "DRAFT" ? (
                      <Button size="sm" variant="ghost" className="w-full text-red-600" onClick={() => confirm("Anulować tę publikację?") && void run("cancel", () => api(`/api/social/posts/${post.id}/cancel`, { method: "POST" }), "Anulowano")} data-testid="cancel">
                        <Ban /> Anuluj publikację
                      </Button>
                    ) : null}
                    {perms.has("content.edit") && !["PUBLISHED", "PUBLISHING"].includes(post.status) ? (
                      <Button size="sm" variant="ghost" className="w-full text-muted" onClick={() => confirm(`Usunąć konto ${post.account.displayName ?? ""} z tej publikacji?`) && void run("rm", () => api(`/api/social/posts/${post.id}`, { method: "DELETE" }), "Usunięto konto docelowe")}>
                        <Trash2 /> Usuń to konto z publikacji
                      </Button>
                    ) : null}
                    {post.provider ? (
                      <p className="pt-1 text-[11.5px] text-muted">
                        Zlecenie: {post.provider.status}
                        {post.provider.jobId ? ` · job ${post.provider.jobId}` : ""} · {post.provider.externalId}
                      </p>
                    ) : null}
                  </div>
                  {post.status === "PUBLISHED" ? <PostResults postId={post.id} /> : null}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {phone && post && draft ? <PhonePreview post={post} draft={draft} caption={caption} thumb={media.thumbUrl} onClose={() => setPhone(false)} /> : null}
      {history && post ? <HistoryDialog post={post} tz={tz} onClose={() => setHistory(false)} onRestore={(rev) => void run("restore", () => api(`/api/social/posts/${post.id}/restore`, { method: "POST", json: { revision: rev } }), "Przywrócono").then(() => setHistory(false))} canEdit={!!editable} /> : null}
      {openings && post && draft ? (
        <Dialog open onOpenChange={(o) => !o && setOpenings(null)}>
          <DialogContent title="3 alternatywne otwarcia" description="Kliknij, aby podmienić pierwsze zdanie opisu (zapisz potem zmiany).">
            <div className="space-y-2">
              {openings.map((o, i) => (
                <button key={i} className="block w-full rounded-xl border border-line p-3 text-left text-sm hover:bg-ink/[.03]" onClick={() => (setDraft({ description: replaceOpening(draft.description, o.text) }), setOpenings(null))}>
                  <span className="mr-2 rounded bg-ink/[.06] px-1.5 py-0.5 text-[11px]">{o.mechanism}</span>
                  {o.text}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {addTarget ? (
        <Dialog open onOpenChange={(o) => !o && setAddTarget(false)}>
          <DialogContent title="Dodaj konto docelowe">
            <div className="space-y-2">
              {data.accounts
                .filter((a) => !data.posts.some((p) => p.account.id === a.id))
                .map((a) => (
                  <button key={a.id} className="flex w-full items-center gap-2 rounded-xl border border-line p-3 text-left text-sm hover:bg-ink/[.03]" onClick={() => void run("add", () => api(`/api/social/content/${id}/targets`, { method: "POST", json: { accountId: a.id } }), "Dodano").then(() => setAddTarget(false))}>
                    <PlatformIcon platform={a.platform} /> {a.displayName ?? a.handle}
                  </button>
                ))}
              {!data.accounts.some((a) => !data.posts.some((p) => p.account.id === a.id)) ? <p className="text-sm text-muted">Wszystkie połączone konta są już w tej publikacji.</p> : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function replaceOpening(text: string, opening: string) {
  const m = /^(.+?[.!?…])(\s|$)/s.exec(text);
  if (!m || m[1].includes("\n")) {
    const [first, ...rest] = text.split("\n");
    return [opening, ...(first ? rest : rest)].join("\n");
  }
  return opening + text.slice(m[1].length);
}

function HashtagInput({ value, onChange, disabled, limits }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; limits: EditorPost["limits"] }) {
  const [text, setText] = React.useState("");
  const add = (raw: string) => {
    const tags = raw.split(/[\s,]+/).map((t) => t.trim().replace(/^#*/, "#")).filter((t) => t.length > 1 && !value.includes(t));
    if (tags.length) onChange([...value, ...tags]);
    setText("");
  };
  const [lo, hi] = limits.hashtagsRecommended;
  return (
    <Field label="Hashtagi" counter={{ n: value.length, max: limits.hashtagsMax }} hint={`Zalecane ${lo}–${hi}. Bez #viral, #fyp, #reels.`}>
      <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1.5", disabled && "opacity-60")}>
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-ink/[.06] px-2 py-0.5 text-[12.5px]">
            {t}
            {!disabled ? (
              <button onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Usuń ${t}`}>
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault();
                add(text);
              } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => text && add(text)}
            className="min-w-24 flex-1 bg-transparent text-sm outline-none"
            placeholder="#temat"
            aria-label="Dodaj hashtag"
          />
        ) : null}
      </div>
    </Field>
  );
}

function PlatformOptions({ platform, options, onChange, disabled, limits }: { platform: Platform; options: Record<string, unknown>; onChange: (o: Record<string, unknown>) => void; disabled?: boolean; limits: EditorPost["limits"] }) {
  const set = (k: string, v: unknown) => onChange({ ...options, [k]: v });
  const bool = (k: string, label: string) => (
    <label className="flex items-center justify-between gap-2 text-[13px]">
      {label}
      <Switch checked={Boolean(options[k])} onCheckedChange={(v) => !disabled && set(k, v)} />
    </label>
  );
  if (platform === "YOUTUBE") {
    const tags = (options.youtubeTags as string[] | undefined) ?? [];
    return (
      <div className="grid gap-3 rounded-xl bg-ink/[.03] p-3 sm:grid-cols-2">
        <Field label="Tagi YouTube" counter={{ n: tags.join(",").length, max: limits.tagsTotal }} hint="Oddzielone przecinkami (to nie hashtagi).">
          <Input value={tags.join(", ")} onChange={(e) => set("youtubeTags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} disabled={disabled} aria-label="Tagi YouTube" />
        </Field>
        <Field label="Widoczność">
          <NativeSelect value={String(options.youtubePrivacy ?? "public")} onChange={(e) => set("youtubePrivacy", e.target.value)} disabled={disabled}>
            <option value="public">Publiczny</option>
            <option value="unlisted">Niepubliczny</option>
            <option value="private">Prywatny</option>
          </NativeSelect>
        </Field>
        {bool("madeForKids", "Przeznaczony dla dzieci")}
        {bool("aiGenerated", "Zawiera treści syntetyczne (AI)")}
      </div>
    );
  }
  if (platform === "TIKTOK")
    return (
      <div className="grid gap-3 rounded-xl bg-ink/[.03] p-3 sm:grid-cols-2">
        <Field label="Kto może oglądać" hint="Dostępne opcje zależą od konta TikTok.">
          <NativeSelect value={String(options.tiktokPrivacy ?? "PUBLIC_TO_EVERYONE")} onChange={(e) => set("tiktokPrivacy", e.target.value)} disabled={disabled}>
            <option value="PUBLIC_TO_EVERYONE">Wszyscy</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">Znajomi</option>
            <option value="FOLLOWER_OF_CREATOR">Obserwujący</option>
            <option value="SELF_ONLY">Tylko ja</option>
          </NativeSelect>
        </Field>
        <div className="space-y-2">
          {bool("disableComments", "Wyłącz komentarze")}
          {bool("disableDuet", "Wyłącz duety")}
          {bool("disableStitch", "Wyłącz stitch")}
          {bool("aiGenerated", "Oznacz jako treść AI")}
        </div>
      </div>
    );
  if (platform === "INSTAGRAM") return <div className="rounded-xl bg-ink/[.03] p-3">{bool("shareToFeed", "Pokaż także w siatce profilu (feed)")}</div>;
  if (platform === "FACEBOOK")
    return (
      <div className="rounded-xl bg-ink/[.03] p-3">
        <Field label="Format na Facebooku">
          <NativeSelect value={String(options.facebookMediaType ?? "REELS")} onChange={(e) => set("facebookMediaType", e.target.value)} disabled={disabled}>
            <option value="REELS">Reels (pionowy, 3–90 s)</option>
            <option value="VIDEO">Post wideo</option>
          </NativeSelect>
        </Field>
      </div>
    );
  return null;
}

function SuggestTimes({ accountId, tz, onPick }: { accountId: string; tz: string; onPick: (local: string) => void }) {
  const [data, setData] = React.useState<{ source: string; note: string; slots: Array<{ weekday: number; hour: number; score: number | null; samples: number }> } | null>(null);
  const days = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."];
  const pick = (weekday: number, hour: number) => {
    // the next such weekday + hour in the project's time zone
    const now = new Date();
    for (let d = 0; d < 14; d++) {
      const day = new Date(now.getTime() + d * 86400e3);
      const local = utcToZonedInput(day, tz).slice(0, 10);
      const wd = (new Date(`${local}T12:00:00Z`).getUTCDay() + 6) % 7;
      const cand = `${local}T${String(hour).padStart(2, "0")}:00`;
      if (wd === weekday && cand > utcToZonedInput(now, tz)) return onPick(cand);
    }
  };
  return (
    <div className="mt-2">
      {!data ? (
        <button className="inline-flex items-center gap-1 text-[12px] text-muted underline" onClick={async () => setData(await api(`/api/social/accounts/${accountId}/suggest-times`))}>
          <Clock className="h-3 w-3" /> Zasugeruj godzinę
        </button>
      ) : (
        <div className="space-y-1.5 text-[12px]">
          <p className="text-muted">{data.note}</p>
          <div className="flex flex-wrap gap-1">
            {data.slots.map((s, i) => (
              <button key={i} className="rounded-full border border-line px-2 py-0.5 hover:bg-ink/5" onClick={() => pick(s.weekday, s.hour)}>
                {days[s.weekday]} {s.hour}:00
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionButtons({ post, dirty, onDone }: { post: EditorPost; dirty: boolean; onDone: () => Promise<void> }) {
  const { toast } = useSocial();
  const [comment, setComment] = React.useState("");
  const decide = async (decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED") => {
    if (dirty) return toast("Najpierw zapisz zmiany — akceptujesz zapisaną wersję.", "err");
    try {
      const r = await api<{ results: Array<{ ok: boolean; error?: string }> }>("/api/social/posts/decide", { method: "POST", json: { items: [{ postId: post.id, revision: post.revision }], decision, comment } });
      if (!r.results[0].ok) throw new Error(r.results[0].error);
      toast(decision === "APPROVED" ? "Zatwierdzono — publikacja zostanie zaplanowana" : "Zapisano decyzję");
      await onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="space-y-2 border-t border-line pt-2" data-testid="decision">
      <Textarea rows={2} placeholder="Komentarz do decyzji (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Komentarz do decyzji" />
      <Button size="sm" className="w-full" onClick={() => void decide("APPROVED")} data-testid="approve">
        <Check /> Akceptuj wersję {post.revision}
      </Button>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={() => void decide("CHANGES_REQUESTED")} data-testid="request-changes">
          <MessageSquareWarning /> Poprawki
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-red-600" onClick={() => void decide("REJECTED")} data-testid="reject">
          <X /> Odrzuć
        </Button>
      </div>
    </div>
  );
}

interface Latest {
  capturedAt: string;
  checkpoint: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  avgViewDurationSec: number | null;
  engagementRate: number | null;
  unsupported: string[];
}

function PostResults({ postId }: { postId: string }) {
  const { toast } = useSocial();
  const { data, reload } = useApi<{ latest: Latest | null; curve: Array<{ at: string; views: number | null; checkpoint: string }> }>(`/api/social/posts/${postId}/results`);
  const l = data?.latest ?? null;
  const rows: Array<[string, number | null, "int" | "pct" | "sec", string]> = l
    ? [
        ["Wyświetlenia", l.views, "int", "views"],
        ["Zasięg", l.reach, "int", "reach"],
        ["Polubienia", l.likes, "int", "likes"],
        ["Komentarze", l.comments, "int", "comments"],
        ["Udostępnienia", l.shares, "int", "shares"],
        ["Zapisania", l.saves, "int", "saves"],
        ["Śr. czas oglądania", l.avgViewDurationSec, "sec", "avgViewDurationSec"],
        ["Zaangażowanie", l.engagementRate, "pct", "engagementRate"],
      ]
    : [];
  return (
    <div className="rounded-2xl border border-line bg-white p-4 text-[13px]" data-testid="post-results">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">Wyniki</p>
        <button
          className="text-[12px] text-muted underline"
          onClick={async () => {
            try {
              await api(`/api/social/posts/${postId}/metrics`, { method: "POST" });
              await reload();
            } catch (e) {
              toast((e as Error).message, "err");
            }
          }}
        >
          Odśwież
        </button>
      </div>
      {!l ? (
        <p className="text-muted">Pierwsze dane pojawią się ok. godzinę po publikacji.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-y-1">
            {rows.map(([label, v, f, key]) => (
              <React.Fragment key={label}>
                <dt className="text-muted">{label}</dt>
                <dd className="text-right">
                  <Metric value={v} format={f} unsupported={l.unsupported.includes(key)} />
                </dd>
              </React.Fragment>
            ))}
          </dl>
          {data && data.curve.length > 1 ? (
            <p className="mt-2 text-[11.5px] text-muted">
              Dynamika: {data.curve.map((c) => `${c.checkpoint} ${c.views ?? "—"}`).join(" → ")}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-muted">Stan na {new Date(l.capturedAt).toLocaleString("pl-PL")} ({l.checkpoint}). „—” = platforma nie podaje tej metryki.</p>
        </>
      )}
    </div>
  );
}

function PhonePreview({ post, draft, caption, thumb, onClose }: { post: EditorPost; draft: Draft; caption: string; thumb: string | null; onClose: () => void }) {
  const name = post.account.handle ?? post.account.displayName ?? "konto";
  const short = caption.length > 125 ? `${caption.slice(0, 125)}… więcej` : caption;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Podgląd: ${PLATFORM_META[post.platform].name}`} description="Przybliżony wygląd na telefonie (interfejs platformy jest uproszczony).">
        <div className="mx-auto w-[300px] overflow-hidden rounded-[2.2rem] border-[10px] border-neutral-900 bg-black shadow-xl" data-testid="phone-preview">
          {post.platform === "LINKEDIN" || (post.platform === "FACEBOOK" && draft.options.facebookMediaType === "VIDEO") ? (
            <div className="bg-white p-3 text-[12px] text-black">
              <p className="font-semibold">{post.account.displayName ?? name}</p>
              <p className="mt-2 whitespace-pre-line">{caption.length > 210 ? `${caption.slice(0, 210)}… więcej` : caption}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumb ? <img src={thumb} alt="" className="mt-2 aspect-[4/5] w-full rounded object-cover" /> : null}
            </div>
          ) : (
            <div className="relative aspect-[9/16]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumb ? <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-16 text-[11.5px] text-white">
                <p className="font-semibold">@{name}</p>
                {post.platform === "YOUTUBE" ? <p className="mt-1 font-semibold">{draft.title}</p> : null}
                <p className="mt-1 whitespace-pre-line">{post.platform === "YOUTUBE" ? "" : short}</p>
              </div>
            </div>
          )}
        </div>
        {draft.firstComment ? <p className="mt-3 text-center text-[12px] text-muted">Pierwszy komentarz: „{draft.firstComment}”</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ post, tz, onClose, onRestore, canEdit }: { post: EditorPost; tz: string; onClose: () => void; onRestore: (rev: number) => void; canEdit: boolean }) {
  const DEC: Record<string, string> = { APPROVED: "zatwierdził(a)", REJECTED: "odrzucił(a)", CHANGES_REQUESTED: "poprosił(a) o poprawki" };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Historia publikacji" description={`${PLATFORM_META[post.platform].name} · ${post.account.displayName ?? ""}`} className="max-w-2xl">
        <div className="max-h-[65vh] space-y-5 overflow-y-auto text-[13px]">
          <section>
            <p className="mb-1 font-semibold">Decyzje</p>
            {post.approvals.length ? (
              <ul className="space-y-1">
                {post.approvals.map((a) => (
                  <li key={a.id} className={cn(a.invalidatedAt && "text-muted line-through")}>
                    {formatInTz(a.at, tz)} — {a.by} {DEC[a.decision]} wersję {a.revision}
                    {a.comment ? `: „${a.comment}”` : ""}
                    {a.invalidatedReason ? <span className="ml-1 text-[11.5px] no-underline">({a.invalidatedReason})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Brak decyzji.</p>
            )}
          </section>
          <section>
            <p className="mb-1 font-semibold">Wersje</p>
            <ul className="space-y-1">
              {post.revisions.map((r) => (
                <li key={r.revision} className="flex items-center gap-2">
                  <span className="tabular w-8 text-muted">v{r.revision}</span>
                  <span className="flex-1">
                    {r.reason} · {r.by} · {formatInTz(r.at, tz)}
                  </span>
                  {canEdit && r.revision !== post.revision && (r.snapshot as { description?: string })?.description !== undefined ? (
                    <button className="inline-flex items-center gap-1 text-[12px] underline" onClick={() => onRestore(r.revision)}>
                      <RotateCcw className="h-3 w-3" /> Przywróć teksty
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="mb-1 font-semibold">Generacje AI</p>
            {post.generations.length ? (
              <ul className="space-y-1">
                {post.generations.map((g) => (
                  <li key={g.id} className="text-muted">
                    {formatInTz(g.at, tz)} — {g.kind} · {g.model} · reguły {g.rulesVersion}
                    {g.error ? ` · błąd: ${g.error}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Brak.</p>
            )}
          </section>
          {post.publications.length ? (
            <section>
              <p className="mb-1 font-semibold">Zlecenia u dostawcy</p>
              {post.publications.map((p) => (
                <div key={p.id} className="mb-2 rounded-lg border border-line p-2 text-[12px]">
                  <p>
                    #{p.generation} · {p.status} · {p.externalId} {p.jobId ? `· job ${p.jobId}` : ""} · na {formatInTz(p.scheduledAt, tz)}
                  </p>
                  {p.error ? <p className="text-red-600">{p.error}</p> : null}
                  {p.attempts.map((a, i) => (
                    <p key={i} className="text-muted">
                      {formatInTz(a.at, tz)} {a.kind} {a.ok ? "OK" : "błąd"} {a.httpStatus ?? ""} {a.error ?? ""}
                    </p>
                  ))}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
