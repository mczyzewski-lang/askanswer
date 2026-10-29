"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Dialog, DialogContent, NativeSelect } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META } from "@/lib/social/platforms";
import { POST_STATUS, type PostStatus } from "@/lib/social/status";
import { dayKey, formatInTz, utcToZonedInput, zonedToUtc } from "@/lib/social/tz";
import { useSocial } from "./shell";
import type { PostRow } from "./dashboard";
import { ErrorBox, Loading, PageHeader, PlatformIcon, Seg, StatusPill, useApi } from "./ui";

type View = "month" | "week" | "day" | "list";
const WD = ["pon.", "wt.", "śr.", "czw.", "pt.", "sob.", "niedz."];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);

const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (key: string) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
const startOfWeek = (key: string) => addDays(key, -weekdayOf(key));
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;

const TONE_BAR: Record<string, string> = { gray: "border-l-neutral-400", amber: "border-l-amber-500", blue: "border-l-sky-500", green: "border-l-emerald-500", red: "border-l-red-500", violet: "border-l-violet-500" };

export function Calendar() {
  const { projectId, project, toast, can } = useSocial();
  const router = useRouter();
  const tz = project?.timezone ?? "Europe/Warsaw";
  const [view, setView] = React.useState<View>("month");
  const [cursor, setCursor] = React.useState(() => dayKey(new Date(), tz));
  const [platform, setPlatform] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [move, setMove] = React.useState<{ post: PostRow; local: string } | null>(null);

  const range = React.useMemo(() => {
    if (view === "day") return { from: cursor, to: addDays(cursor, 1) };
    if (view === "week") return { from: startOfWeek(cursor), to: addDays(startOfWeek(cursor), 7) };
    if (view === "list") return { from: cursor, to: addDays(cursor, 60) };
    const first = monthStart(cursor);
    const gridStart = startOfWeek(first);
    return { from: gridStart, to: addDays(gridStart, 42) };
  }, [view, cursor]);
  const qs = new URLSearchParams({ from: zonedToUtc(`${range.from}T00:00`, tz).toISOString(), to: zonedToUtc(`${range.to}T00:00`, tz).toISOString(), ...(projectId ? { project: projectId } : {}), ...(platform ? { platform } : {}), ...(account ? { account } : {}), ...(status ? { status } : {}) });
  const { data, error, loading, reload } = useApi<{ posts: PostRow[]; accounts: Array<{ id: string; platform: string; displayName: string | null; accountHandle: string | null }> }>(`/api/social/calendar?${qs}`, [qs.toString()]);
  const posts = data?.posts ?? [];
  const at = (p: PostRow) => p.publishedAt ?? p.scheduledAt;
  const byDay = React.useMemo(() => {
    const m = new Map<string, PostRow[]>();
    for (const p of posts) {
      const a = at(p);
      if (!a) continue;
      const k = dayKey(a, tz);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    for (const list of m.values()) list.sort((a, b) => (at(a) ?? "").localeCompare(at(b) ?? ""));
    return m;
  }, [posts, tz]);

  const step = (dir: number) => setCursor((c) => (view === "month" ? monthStart(addDays(monthStart(c), dir > 0 ? 32 : -1)) : view === "week" ? addDays(c, dir * 7) : view === "list" ? addDays(c, dir * 30) : addDays(c, dir)));
  const draggable = (p: PostRow) => !["PUBLISHED", "PUBLISHING", "SCHEDULING", "CANCELLED"].includes(p.status) && can("content.edit", p.project.id);
  const onDrop = (e: React.DragEvent, targetDay: string, hour?: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/post");
    const p = posts.find((x) => x.id === id);
    if (!p || !p.scheduledAt) return;
    const time = utcToZonedInput(p.scheduledAt, tz).slice(11);
    const local = `${targetDay}T${hour !== undefined ? `${String(hour).padStart(2, "0")}:${time.slice(3)}` : time}`;
    if (local === utcToZonedInput(p.scheduledAt, tz)) return;
    setMove({ post: p, local });
  };
  const doMove = async (approve: boolean) => {
    if (!move) return;
    try {
      await api(`/api/social/posts/${move.post.id}/reschedule`, { method: "POST", json: { scheduledAt: move.local, approve } });
      toast(approve ? "Przesunięto i zatwierdzono nowy termin" : "Przesunięto — nowy termin wymaga akceptacji");
      setMove(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const chip = (p: PostRow, compact = false) => {
    const tone = POST_STATUS[p.status as PostStatus]?.tone ?? "gray";
    return (
      <div
        key={p.id}
        draggable={draggable(p)}
        onDragStart={(e) => e.dataTransfer.setData("text/post", p.id)}
        onClick={() => router.push(`/social/content/${p.contentItemId}?post=${p.id}`)}
        className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border border-l-[3px] border-line bg-white px-1.5 py-1 text-[11.5px] hover:border-ink/30", TONE_BAR[tone], draggable(p) && "cursor-grab active:cursor-grabbing")}
        title={`${p.title} — ${POST_STATUS[p.status as PostStatus]?.label ?? p.status} · ${p.account.name}`}
        data-testid="calendar-post"
        data-status={p.status}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!compact && p.thumbUrl ? <img src={p.thumbUrl} alt="" className="h-7 w-5 shrink-0 rounded object-cover" /> : null}
        <PlatformIcon platform={p.platform} size={14} />
        <span className="tabular text-muted">{formatInTz(at(p)!, tz, { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="min-w-0 flex-1 truncate">{p.title}</span>
      </div>
    );
  };
  const today = dayKey(new Date(), tz);
  const title = view === "month" ? new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart(cursor)}T12:00:00Z`)) : view === "week" ? `${formatInTz(`${startOfWeek(cursor)}T12:00:00Z`, "UTC", { day: "numeric", month: "short" })} – ${formatInTz(`${addDays(startOfWeek(cursor), 6)}T12:00:00Z`, "UTC", { day: "numeric", month: "short", year: "numeric" })}` : formatInTz(`${cursor}T12:00:00Z`, "UTC", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader
        title="Kalendarz"
        subtitle={`Godziny w strefie ${tz}. Przeciągnij publikację na inny dzień lub godzinę — zmiana terminu wymaga akceptacji.`}
        actions={
          <Seg<View>
            value={view}
            onChange={setView}
            items={[
              ["month", "Miesiąc"],
              ["week", "Tydzień"],
              ["day", "Dzień"],
              ["list", "Lista"],
            ]}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="iconSm" variant="outline" onClick={() => step(-1)} aria-label="Wstecz">
          <ChevronLeft />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCursor(today)}>
          Dziś
        </Button>
        <Button size="iconSm" variant="outline" onClick={() => step(1)} aria-label="Dalej">
          <ChevronRight />
        </Button>
        <p className="ml-1 font-medium capitalize">{title}</p>
        <div className="ml-auto flex flex-wrap gap-2">
          <NativeSelect className="h-8 w-36 text-xs" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platforma">
            <option value="">Wszystkie platformy</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_META[p].name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="h-8 w-40 text-xs" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Konto">
            <option value="">Wszystkie konta</option>
            {data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {PLATFORM_META[a.platform as keyof typeof PLATFORM_META]?.short} {a.displayName ?? a.accountHandle}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="h-8 w-40 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Wszystkie statusy</option>
            {Object.entries(POST_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}

      {view === "month" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white" data-testid="calendar-month">
          <div className="grid grid-cols-7 border-b border-line text-[12px] text-muted">
            {WD.map((d) => (
              <div key={d} className="px-2 py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => addDays(range.from, i)).map((d) => (
              <div key={d} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, d)} className={cn("min-h-28 space-y-1 border-b border-r border-line p-1.5", d.slice(0, 7) !== cursor.slice(0, 7) && "bg-ink/[.02] text-muted")} data-day={d}>
                <p className={cn("text-[11.5px]", d === today && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink font-semibold text-white")}>{Number(d.slice(8))}</p>
                {(byDay.get(d) ?? []).slice(0, 4).map((p) => chip(p, true))}
                {(byDay.get(d)?.length ?? 0) > 4 ? (
                  <button className="text-[11px] text-muted underline" onClick={() => (setCursor(d), setView("day"))}>
                    +{byDay.get(d)!.length - 4} więcej
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "week" || view === "day" ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white" data-testid={`calendar-${view}`}>
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `56px repeat(${view === "week" ? 7 : 1}, minmax(0,1fr))` }}>
            <div />
            {(view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [cursor]).map((d) => (
              <div key={d} className={cn("border-b border-l border-line px-2 py-1.5 text-[12px]", d === today && "font-semibold")}>
                {WD[weekdayOf(d)]} {Number(d.slice(8))}.{d.slice(5, 7)}
              </div>
            ))}
            {HOURS.map((h) => (
              <React.Fragment key={h}>
                <div className="border-b border-line px-2 py-1 text-right text-[11px] text-muted">{h}:00</div>
                {(view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [cursor]).map((d) => (
                  <div key={d + h} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, d, h)} className="min-h-12 space-y-1 border-b border-l border-line p-1">
                    {(byDay.get(d) ?? []).filter((p) => Number(formatInTz(at(p)!, tz, { hour: "2-digit", hourCycle: "h23" })) === h).map((p) => chip(p))}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
          {(byDay.get(cursor) ?? []).some((p) => Number(formatInTz(at(p)!, tz, { hour: "2-digit", hourCycle: "h23" })) < 6) ? <p className="p-2 text-[12px] text-muted">Publikacje przed 6:00 widać w widoku listy.</p> : null}
        </div>
      ) : null}

      {view === "list" ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-white" data-testid="calendar-list">
          {posts.length ? (
            <table className="w-full text-[13px]">
              <thead className="border-b border-line text-left text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2">Termin</th>
                  <th className="px-3 py-2">Film</th>
                  <th className="px-3 py-2">Konto</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-ink/[.02]">
                    <td className="whitespace-nowrap px-3 py-2 tabular">{formatInTz(at(p)!, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2">
                      <Link className="hover:underline" href={`/social/content/${p.contentItemId}?post=${p.id}`}>
                        {p.title}
                      </Link>
                      <span className="ml-2 text-[11.5px] text-muted">{p.project.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <PlatformIcon platform={p.platform} size={16} /> {p.account.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-8 text-center text-sm text-muted">Brak publikacji w najbliższych 60 dniach.</p>
          )}
        </div>
      ) : null}

      {move ? (
        <Dialog open onOpenChange={(o) => !o && setMove(null)}>
          <DialogContent title="Zmienić termin?" description={`${move.post.title} · ${PLATFORM_META[move.post.platform].name} → ${formatInTz(zonedToUtc(move.local, tz), tz)}`}>
            <p className="text-sm text-muted">Termin jest częścią zatwierdzonej wersji. {move.post.status === "SCHEDULED" ? "Zlecenie u dostawcy zostanie wstrzymane do ponownej akceptacji — albo, jeśli zatwierdzasz od razu, zmienione w miejscu." : ""}</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setMove(null)}>
                Anuluj
              </Button>
              <Button variant="outline" onClick={() => void doMove(false)} data-testid="move-needs-approval">
                Przesuń (do akceptacji)
              </Button>
              {can("content.approve", move.post.project.id) && ["SCHEDULED", "APPROVED"].includes(move.post.status) ? (
                <Button onClick={() => void doMove(true)} data-testid="move-and-approve">
                  Przesuń i zatwierdź
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
