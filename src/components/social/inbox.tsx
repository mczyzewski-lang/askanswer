"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Inbox as InboxIcon, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { Button, NativeSelect, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { useSocial } from "./shell";
import { DemoBadge, Empty, ErrorBox, Loading, PageHeader, Pill, PlatformIcon, Seg, useApi } from "./ui";

interface Comment {
  id: string;
  projectId: string;
  project: string;
  canReply: boolean;
  platform: Platform;
  account: string | null;
  author: string;
  text: string;
  postedAt: string;
  status: "NEW" | "NEEDS_REPLY" | "REPLIED" | "IGNORED" | "ESCALATED";
  category: string | null;
  sentiment: string | null;
  isQuestion: boolean;
  isLead: boolean;
  needsHuman: boolean;
  aiReason: string | null;
  readAt: string | null;
  isDemo: boolean;
  post: { id: string; contentItemId: string; url: string | null; title: string; thumbUrl: string | null } | null;
  thread: Array<{ text: string; isOwn: boolean; author: string; at: string }>;
  replies: Array<{ id: string; text: string; source: string; status: string; visibility: string; error: string | null; sentAt: string | null; createdAt: string }>;
}

const FILTERS: Array<[string, string]> = [
  ["all", "Wszystkie"],
  ["unanswered", "Bez odpowiedzi"],
  ["attention", "Wymagające reakcji"],
  ["questions", "Pytania"],
  ["leads", "Potencjalne leady"],
  ["negative", "Negatywne"],
];
const STATUS: Record<Comment["status"], string> = { NEW: "Nowy", NEEDS_REPLY: "Wymaga odpowiedzi", REPLIED: "Odpowiedziano", IGNORED: "Zignorowany", ESCALATED: "Do człowieka" };
const CATEGORY: Record<string, string> = { question: "pytanie", positive: "pozytywny", negative: "negatywny", spam: "spam", purchase_intent: "intencja zakupowa", contact_request: "prośba o kontakt", needs_human: "wymaga człowieka" };

export function Inbox() {
  const { projectId, toast } = useSocial();
  const search = useSearchParams();
  const [filter, setFilter] = React.useState("all");
  const [platform, setPlatform] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(search.get("comment"));
  const qs = new URLSearchParams({ filter, ...(projectId ? { project: projectId } : {}), ...(platform ? { platform } : {}) });
  const { data, error, loading, reload } = useApi<{ comments: Comment[]; unavailable: Array<{ id: string; platform: Platform; name: string | null; projectId: string }> }>(`/api/social/comments?${qs}`, [qs.toString()]);
  const [refreshing, setRefreshing] = React.useState(false);
  const current = data?.comments.find((c) => c.id === selected) ?? null;
  React.useEffect(() => {
    if (current && !current.readAt && current.canReply) void api(`/api/social/comments/${current.id}`, { method: "PATCH", json: { read: true } }).catch(() => {});
  }, [current]);
  const refresh = async () => {
    if (!projectId) return toast("Wybierz projekt w przełączniku, aby pobrać komentarze.", "err");
    setRefreshing(true);
    try {
      await api(`/api/social/projects/${projectId}/comments/refresh`, { method: "POST" });
      toast("Pobieram nowe komentarze…");
      setTimeout(() => void reload(), 4000);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Komentarze"
        subtitle="Jedna skrzynka dla wszystkich projektów i platform. AI proponuje odpowiedzi — wysyła zawsze człowiek (chyba że właściciel włączył bezpieczne auto-odpowiedzi)."
        actions={
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} /> Pobierz teraz
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Seg value={filter} onChange={setFilter} items={FILTERS} />
        <NativeSelect className="h-8 w-40 text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platforma">
          <option value="">Wszystkie platformy</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_META[p].name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {data?.unavailable.length ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
          Komentarze niedostępne dla: {data.unavailable.map((a) => `${PLATFORM_META[a.platform].name} ${a.name ?? ""}`).join(", ")} — wymaga ponownego połączenia konta z uprawnieniem do komentarzy.{" "}
          <Link className="underline" href={`/social/projects/${data.unavailable[0].projectId}?tab=accounts`}>
            Konta
          </Link>
        </div>
      ) : null}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && !data.comments.length ? <Empty icon={<InboxIcon className="h-6 w-6" />} title="Brak komentarzy">Komentarze pojawią się, gdy publikacje zaczną je zbierać (najczęściej sprawdzamy nowe publikacje).</Empty> : null}
      {data?.comments.length ? (
        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <ul className="max-h-[75vh] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-white" data-testid="comment-list">
            {data.comments.map((c) => (
              <li key={c.id}>
                <button onClick={() => setSelected(c.id)} className={cn("block w-full px-3 py-2.5 text-left hover:bg-ink/[.03]", selected === c.id && "bg-ink/[.05]")} data-testid="comment-row" data-category={c.category ?? ""}>
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={c.platform} size={16} />
                    <span className="truncate text-[13px] font-medium">{c.author}</span>
                    {!c.readAt ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                    <span className="ml-auto whitespace-nowrap text-[11px] text-muted">{new Date(c.postedAt).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink/80">{c.text}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill tone={c.status === "REPLIED" ? "green" : c.status === "ESCALATED" ? "red" : c.status === "NEEDS_REPLY" ? "amber" : "gray"}>{STATUS[c.status]}</Pill>
                    {c.isLead ? <Pill tone="violet">lead</Pill> : null}
                    {c.category && c.category !== "positive" ? <Pill>{CATEGORY[c.category] ?? c.category}</Pill> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {current ? <CommentDetail key={current.id} c={current} onChange={reload} /> : <div className="hidden items-center justify-center rounded-2xl border border-dashed border-line text-sm text-muted lg:flex">Wybierz komentarz</div>}
        </div>
      ) : null}
    </>
  );
}

function CommentDetail({ c, onChange }: { c: Comment; onChange: () => Promise<void> }) {
  const { toast } = useSocial();
  const draft = c.replies.find((r) => r.status === "DRAFT" || r.status === "FAILED");
  const [text, setText] = React.useState(draft?.text ?? "");
  const [visibility, setVisibility] = React.useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      if (ok) toast(ok);
      await onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-white p-4" data-testid="comment-detail">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <PlatformIcon platform={c.platform} size={22} />
        <span className="font-medium">{c.author}</span>
        <span className="text-muted">
          · {c.project} · {c.account}
        </span>
        {c.isDemo ? <DemoBadge /> : null}
        <span className="ml-auto text-[12px] text-muted">{new Date(c.postedAt).toLocaleString("pl-PL")}</span>
      </div>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{c.text}</p>
      {c.aiReason || c.category ? (
        <p className="text-[12px] text-muted">
          AI: {CATEGORY[c.category ?? ""] ?? "—"}
          {c.sentiment ? ` · ${c.sentiment}` : ""}
          {c.aiReason ? ` · ${c.aiReason}` : ""}
        </p>
      ) : null}
      {c.needsHuman ? <p className="rounded-xl bg-red-50 p-2.5 text-[12.5px] text-red-800 dark:bg-red-400/10 dark:text-red-300">Wymaga człowieka — nie odpowiadaj automatycznie, nie podawaj porad w konkretnej sprawie ani danych w komentarzu.</p> : null}
      {c.post ? (
        <Link href={`/social/content/${c.post.contentItemId}?post=${c.post.id}`} className="flex items-center gap-2 rounded-xl border border-line p-2 text-[12.5px] hover:bg-ink/[.03]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.post.thumbUrl ? <img src={c.post.thumbUrl} alt="" className="h-10 w-7 rounded object-cover" /> : null}
          Pod filmem: <span className="font-medium">{c.post.title}</span>
        </Link>
      ) : null}
      {c.thread.length ? (
        <div className="space-y-1.5 border-l-2 border-line pl-3 text-[13px]">
          {c.thread.map((t, i) => (
            <p key={i} className={t.isOwn ? "text-brand" : ""}>
              <span className="font-medium">{t.isOwn ? "Twoje konto" : t.author}:</span> {t.text}
            </p>
          ))}
        </div>
      ) : null}
      {c.replies.filter((r) => r.status !== "DRAFT").length ? (
        <ul className="space-y-1 text-[12.5px]">
          {c.replies
            .filter((r) => r.status !== "DRAFT")
            .map((r) => (
              <li key={r.id} className="text-muted">
                {r.status === "SENT" ? "✓ Wysłano" : r.status === "FAILED" ? "✕ Błąd" : r.status === "REJECTED" ? "Odrzucony projekt" : r.status} ({r.source === "AUTO" ? "auto" : r.source === "AI" || r.source === "AI_EDITED" ? "AI" : "człowiek"}, {r.visibility === "PRIVATE" ? "DM" : "publicznie"}): „{r.text}” {r.error ? <span className="text-red-600">{r.error}</span> : null}
              </li>
            ))}
        </ul>
      ) : null}
      {c.canReply ? (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run("draft", async () => { const r = await api<{ reply: { text: string }; needsHuman: boolean; reason: string }>(`/api/social/comments/${c.id}/draft`, { method: "POST" }); setText(r.reply.text); setNote(r.needsHuman ? `AI: wymaga człowieka — ${r.reason}` : null); })} data-testid="ai-draft">
              {busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />} Wygeneruj odpowiedź AI
            </Button>
            {c.platform === "INSTAGRAM" ? (
              <Seg<"PUBLIC" | "PRIVATE">
                value={visibility}
                onChange={setVisibility}
                items={[
                  ["PUBLIC", "Publicznie"],
                  ["PRIVATE", "Prywatnie (DM)"],
                ]}
              />
            ) : null}
            <NativeSelect className="ml-auto h-8 w-44 text-xs" value={c.status} onChange={(e) => void run("st", () => api(`/api/social/comments/${c.id}`, { method: "PATCH", json: { status: e.target.value } }))} aria-label="Status obsługi">
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
          {note ? <p className="text-[12px] text-amber-700 dark:text-amber-300">{note}</p> : null}
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Napisz odpowiedź albo wygeneruj projekt AI i go popraw" aria-label="Odpowiedź" data-testid="reply-text" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy || text.trim().length < 2} onClick={() => void run("send", () => api(`/api/social/comments/${c.id}/reply`, { method: "POST", json: { text, replyId: draft?.id ?? null, visibility } }), "Odpowiedź zatwierdzona — wysyłam")} data-testid="send-reply">
              <Send /> Zatwierdź i wyślij
            </Button>
            {draft ? (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("rej", async () => { await api(`/api/social/replies/${draft.id}/reject`, { method: "POST" }); setText(""); }, "Odrzucono projekt")}>
                <X /> Odrzuć projekt
              </Button>
            ) : null}
          </div>
          <p className="text-[11.5px] text-muted">AI nie zna cen ani warunków spoza bazy wiedzy marki. Dane osobowe z komentarzy są usuwane przed wysłaniem do AI.</p>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">Twoja rola pozwala tylko na podgląd.</p>
      )}
    </div>
  );
}
