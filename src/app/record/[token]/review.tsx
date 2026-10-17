"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Loader2, Pencil, RotateCcw, SkipForward, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReviewItem {
  id: string;
  kind: "QUESTION" | "PROMPTER" | "QUESTION_PROMPTER";
  category: string;
  subcategory: string | null;
  text: string;
  spokenText: string | null;
  script: string | null;
  approved: boolean;
  recorded: boolean;
}

const KIND: Record<ReviewItem["kind"], string> = { QUESTION: "Pytanie", PROMPTER: "Prompter", QUESTION_PROMPTER: "Pytanie + prompter" };
const hasNarrator = (k: ReviewItem["kind"]) => k !== "PROMPTER";
const hasScript = (k: ReviewItem["kind"]) => k !== "QUESTION";

type Patch = Partial<Pick<ReviewItem, "text" | "spokenText" | "script">> & { approve?: boolean };

/**
 * "Przejrzyj treści": the expert reads the items before recording, fixes them and accepts them.
 * Phone: cards — swipe right to accept, left to edit, "Pomiń" moves on (the item stays in the pool).
 * Desktop: a table like the CSV, edited in place, with [Zatwierdź] on every row.
 */
export function ReviewScreen({ token, items: initial, onClose, onChange }: { token: string; items: ReviewItem[]; onClose: () => void; onChange: (items: ReviewItem[]) => void }) {
  const [items, setItems] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 900px)");
    const set = () => setWide(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);

  const save = async (id: string, patch: Patch) => {
    setErr(null);
    const res = await fetch(`/api/record/${token}/questions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error ?? `Nie zapisano (HTTP ${res.status})`);
      return false;
    }
    setItems((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, text: data.text, spokenText: data.spokenText, script: data.script, approved: data.approved } : x));
      onChange(next);
      return next;
    });
    return true;
  };

  const pending = items.filter((x) => !x.approved).length;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0c0d10] text-white safe-top safe-bottom" data-testid="review-screen">
      <div className={cn("mx-auto px-5 pb-10 pt-4", wide ? "max-w-6xl" : "max-w-md")}>
        <div className="mb-4 flex items-center gap-3">
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10" aria-label="Wróć">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold">Przejrzyj treści</h1>
            <p className="text-[13px] text-white/55" data-testid="review-progress">
              {pending ? `${pending} do akceptacji · ${items.length - pending} zatwierdzonych` : "Wszystko zatwierdzone 🎉"}
            </p>
          </div>
        </div>
        {err ? <p className="mb-3 rounded-xl bg-red-500/15 px-3 py-2 text-[13px] text-red-200">{err}</p> : null}
        {wide ? <ReviewTable items={items} save={save} /> : <ReviewCards items={items} save={save} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- phone: swipe cards */

function ReviewCards({ items, save }: { items: ReviewItem[]; save: (id: string, p: Patch) => Promise<boolean> }) {
  // the queue: not yet accepted, in order; "Pomiń" moves an item to the back (it stays in the pool)
  const [order, setOrder] = useState(() => items.filter((x) => !x.approved).map((x) => x.id));
  const queue = order.map((id) => items.find((x) => x.id === id)).filter((x): x is ReviewItem => !!x && !x.approved);
  const current = queue[0] ?? null;
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  // the gesture: locked to one axis after a few px — sideways swipes, vertical scrolls the content
  const start = useRef<{ x: number; y: number; axis: "x" | "y" | null } | null>(null);
  const dxRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const setDrag = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };
  const down = (x: number, y: number) => {
    start.current = { x, y, axis: null };
    dxRef.current = 0;
  };
  const move = (x: number, y: number) => {
    const g = start.current;
    if (!g) return;
    const ddx = x - g.x;
    const ddy = y - g.y;
    if (!g.axis && Math.hypot(ddx, ddy) > 8) {
      g.axis = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
      if (g.axis === "x") setDragging(true);
    }
    if (g.axis === "x") setDrag(ddx);
  };
  const cancel = () => {
    start.current = null;
    setDragging(false);
    setDrag(0);
  };
  const up = () => {
    const d = dxRef.current;
    start.current = null;
    setDragging(false);
    if (d > 90 && current) return void accept(current); // flies out from where it was dropped
    setDrag(0);
    if (d < -90 && current) setEditing(current);
  };

  const accept = async (it: ReviewItem) => {
    setLeaving("right");
    await new Promise((r) => setTimeout(r, 180));
    const ok = await save(it.id, { approve: true });
    setLeaving(null);
    setDx(0);
    if (ok) setOrder((o) => o.filter((id) => id !== it.id));
  };
  const skip = (it: ReviewItem) => setOrder((o) => [...o.filter((id) => id !== it.id), it.id]);

  if (!current)
    return (
      <div className="mt-16 text-center" data-testid="review-done">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400 text-black">
          <Check className="h-8 w-8" />
        </span>
        <p className="mt-4 text-lg font-semibold">Wszystkie treści zatwierdzone</p>
        <p className="mt-1 text-sm text-white/55">Możesz wrócić i nagrywać.</p>
      </div>
    );

  const rot = Math.max(-12, Math.min(12, dx / 14));
  const x = leaving === "right" ? 600 : leaving === "left" ? -600 : dx;
  return (
    <div>
      <p className="mb-2 text-center text-[12px] text-white/45">Przesuń w prawo — zatwierdź · w lewo — edytuj</p>
      <div className="relative h-[60dvh]">
        {queue[1] ? <div className="absolute inset-x-3 top-3 bottom-0 rounded-3xl bg-white/[.05]" aria-hidden /> : null}
        <div
          key={current.id}
          // pan-y: long content scrolls vertically inside the card, a sideways drag swipes it
          className={cn("absolute inset-0 flex select-none flex-col overflow-hidden rounded-3xl bg-[#191b21] p-5 shadow-2xl [touch-action:pan-y]", !dragging && "transition-transform duration-200")}
          style={{ transform: `translateX(${x}px) rotate(${rot}deg)` }}
          data-testid="review-card"
          // touch: touch events keep coming while the content scrolls (pointer events would be cancelled)
          onTouchStart={(e) => down(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={up}
          onTouchCancel={cancel}
          // mouse / pen
          onPointerDown={(e) => {
            if (e.pointerType === "touch") return;
            down(e.clientX, e.clientY);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => e.pointerType !== "touch" && move(e.clientX, e.clientY)}
          onPointerUp={(e) => e.pointerType !== "touch" && up()}
          onPointerCancel={(e) => e.pointerType !== "touch" && cancel()}
        >
          {dx > 40 ? <span className="absolute right-5 top-5 rounded-lg border-2 border-emerald-400 px-2 py-0.5 text-sm font-bold text-emerald-300">ZATWIERDŹ</span> : null}
          {dx < -40 ? <span className="absolute left-5 top-5 rounded-lg border-2 border-sky-400 px-2 py-0.5 text-sm font-bold text-sky-300">EDYTUJ</span> : null}
          <ItemBody it={current} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-4">
        <button onClick={() => setEditing(current)} className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10" aria-label="Edytuj" data-testid="review-edit">
          <Pencil className="h-5 w-5" />
        </button>
        <button onClick={() => skip(current)} className="flex h-12 items-center gap-1.5 rounded-full bg-white/10 px-5 text-sm font-medium" data-testid="review-skip">
          <SkipForward className="h-4 w-4" /> Pomiń
        </button>
        <button onClick={() => void accept(current)} className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400 text-black" aria-label="Zatwierdź" data-testid="review-accept">
          <Check className="h-6 w-6" />
        </button>
      </div>
      <p className="mt-3 text-center text-[12px] text-white/40">
        {queue.length} do akceptacji
      </p>
      {editing ? (
        <EditSheet
          it={editing}
          onClose={() => setEditing(null)}
          onSave={async (p, approve) => {
            const ok = await save(editing.id, { ...p, ...(approve ? { approve: true } : {}) });
            if (ok) {
              setEditing(null);
              if (approve) setOrder((o) => o.filter((id) => id !== editing.id));
            }
          }}
        />
      ) : null}
    </div>
  );
}

function ItemBody({ it }: { it: ReviewItem }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" data-testid="review-card-body">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
        {KIND[it.kind]} · {[it.category, it.subcategory].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.1em] text-white/40">{it.kind === "PROMPTER" ? "Hook — tytuł wideo" : "Tytuł wideo"}</p>
      <p className="font-display text-[22px] font-semibold leading-snug">{it.text}</p>
      {hasNarrator(it.kind) ? (
        <>
          <p className="mt-4 text-[11px] uppercase tracking-[0.1em] text-white/40">Lektor przeczyta</p>
          <p className="text-[15px] leading-snug text-white/80">{it.spokenText || it.text}</p>
        </>
      ) : null}
      {hasScript(it.kind) && it.script ? (
        <>
          <p className="mt-4 text-[11px] uppercase tracking-[0.1em] text-white/40">{it.kind === "QUESTION_PROMPTER" ? "Twoja odpowiedź (prompter)" : "Treść (prompter)"}</p>
          <div className="whitespace-pre-line pb-2 text-[15px] leading-relaxed text-white/85">{it.script}</div>
        </>
      ) : null}
    </div>
  );
}

function EditSheet({ it, onClose, onSave }: { it: ReviewItem; onClose: () => void; onSave: (p: Patch, approve: boolean) => Promise<void> }) {
  const [text, setText] = useState(it.text);
  const [spoken, setSpoken] = useState(it.spokenText ?? "");
  const [script, setScript] = useState(it.script ?? "");
  const [busy, setBusy] = useState(false);
  const patch = (): Patch => ({ text, ...(hasNarrator(it.kind) ? { spokenText: spoken.trim() || null } : {}), ...(hasScript(it.kind) ? { script: script.trim() || null } : {}) });
  const area = "w-full resize-y rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-[15px] leading-snug text-white outline-none focus:border-white/40";
  const go = async (approve: boolean) => {
    setBusy(true);
    await onSave(patch(), approve);
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0c0d10] safe-top safe-bottom" data-testid="review-edit-sheet">
      <div className="flex items-center gap-3 px-5 py-3">
        <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10" aria-label="Anuluj edycję">
          <X className="h-5 w-5" />
        </button>
        <p className="flex-1 font-semibold">Edytuj treść</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        <label className="block space-y-1.5">
          <span className="text-[12px] text-white/55">{it.kind === "PROMPTER" ? "Hook — tytuł wideo" : "Tytuł wideo"}</span>
          <textarea className={area} rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Tytuł wideo" />
        </label>
        {hasNarrator(it.kind) ? (
          <label className="block space-y-1.5">
            <span className="text-[12px] text-white/55">Pytanie czytane przez lektora (puste = tytuł)</span>
            <textarea className={area} rows={3} value={spoken} onChange={(e) => setSpoken(e.target.value)} aria-label="Pytanie czytane przez lektora" />
          </label>
        ) : null}
        {hasScript(it.kind) ? (
          <label className="block space-y-1.5">
            <span className="text-[12px] text-white/55">{it.kind === "QUESTION_PROMPTER" ? "Twoja odpowiedź (prompter)" : "Treść (prompter)"}</span>
            <textarea className={area} rows={10} value={script} onChange={(e) => setScript(e.target.value)} aria-label="Treść" />
          </label>
        ) : null}
      </div>
      <div className="flex gap-3 px-5 pb-4 pt-2">
        <button disabled={busy} onClick={() => void go(false)} className="h-14 flex-1 rounded-2xl bg-white/10 font-semibold disabled:opacity-50">
          Zapisz
        </button>
        <button disabled={busy} onClick={() => void go(true)} className="flex h-14 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-emerald-400 font-semibold text-black disabled:opacity-50" data-testid="review-save-accept">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" />} Zapisz i zatwierdź
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- desktop: table */

function ReviewTable({ items, save }: { items: ReviewItem[]; save: (id: string, p: Patch) => Promise<boolean> }) {
  const [filter, setFilter] = useState<"todo" | "done" | "all">("todo");
  // rows accepted in this session stay in place until the filter changes, so the list doesn't jump
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter((x) => filter === "all" || (filter === "done" ? x.approved : !x.approved || keep.has(x.id))), [items, filter, keep]);
  const showSpoken = items.some((x) => hasNarrator(x.kind));
  const showScript = items.some((x) => hasScript(x.kind));
  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(
          [
            ["todo", "Do akceptacji"],
            ["done", "Zatwierdzone"],
            ["all", "Wszystkie"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setFilter(k);
              setKeep(new Set());
            }}
            className={cn("rounded-full px-3 py-1.5 text-[13px]", filter === k ? "bg-white text-black" : "bg-white/10 text-white/70")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full table-fixed text-left text-[13.5px]" data-testid="review-table">
          <thead className="bg-white/[.04] text-[11px] uppercase tracking-[0.08em] text-white/45">
            <tr>
              <th className="w-[130px] px-3 py-2.5 font-medium">Typ · kategoria</th>
              <th className="px-3 py-2.5 font-medium">Tytuł wideo</th>
              {showSpoken ? <th className="px-3 py-2.5 font-medium">Pytanie (lektor)</th> : null}
              {showScript ? <th className="w-[38%] px-3 py-2.5 font-medium">Treść (prompter)</th> : null}
              <th className="w-[132px] px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => (
              <ReviewRow
                key={it.id}
                it={it}
                showSpoken={showSpoken}
                showScript={showScript}
                save={async (p) => {
                  if (p.approve) setKeep((k) => new Set(k).add(it.id));
                  return save(it.id, p);
                }}
              />
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-white/45">
                  {filter === "todo" ? "Nic nie czeka na akceptację." : "Brak pozycji."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRow({ it, showSpoken, showScript, save }: { it: ReviewItem; showSpoken: boolean; showScript: boolean; save: (p: Patch) => Promise<boolean> }) {
  const [text, setText] = useState(it.text);
  const [spoken, setSpoken] = useState(it.spokenText ?? "");
  const [script, setScript] = useState(it.script ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = text !== it.text || (spoken || null) !== (it.spokenText || null) || (script || null) !== (it.script || null);
  const cell = "w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1.5 leading-snug text-white outline-none hover:border-white/10 focus:border-white/30 focus:bg-white/[.05]";
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  const run = async (p: Patch) => {
    setBusy(true);
    await save(p);
    setBusy(false);
  };
  const edits = (): Patch => ({ text, ...(hasNarrator(it.kind) ? { spokenText: spoken.trim() || null } : {}), ...(hasScript(it.kind) ? { script: script.trim() || null } : {}) });
  return (
    <tr className={cn("border-t border-white/[.07] align-top", it.approved && "bg-emerald-400/[.06]")} data-testid="review-row" data-approved={it.approved}>
      <td className="px-3 py-2.5 text-[12px] text-white/55">
        <span className="block font-medium text-white/80">{KIND[it.kind]}</span>
        {[it.category, it.subcategory].filter(Boolean).join(" · ")}
        {it.recorded ? <span className="mt-1 block text-[11px] text-emerald-300/80">nagrane</span> : null}
      </td>
      <td className="px-1 py-1.5">
        <textarea ref={fit} rows={1} className={cn(cell, "font-semibold")} value={text} onChange={(e) => (setText(e.target.value), fit(e.target))} aria-label="Tytuł wideo" />
      </td>
      {showSpoken ? (
        <td className="px-1 py-1.5">
          {hasNarrator(it.kind) ? (
            <textarea ref={fit} rows={1} className={cn(cell, "text-white/80")} value={spoken} placeholder="= tytuł" onChange={(e) => (setSpoken(e.target.value), fit(e.target))} aria-label="Pytanie czytane przez lektora" />
          ) : (
            <span className="px-2 text-white/25">—</span>
          )}
        </td>
      ) : null}
      {showScript ? (
        <td className="px-1 py-1.5">
          {hasScript(it.kind) ? (
            <textarea ref={fit} rows={2} className={cn(cell, "text-white/85")} value={script} onChange={(e) => (setScript(e.target.value), fit(e.target))} aria-label="Treść" />
          ) : (
            <span className="px-2 text-white/25">—</span>
          )}
        </td>
      ) : null}
      <td className="px-3 py-2.5 text-right">
        {it.approved && !dirty ? (
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-1 text-[13px] font-medium text-emerald-300">
              <Check className="h-4 w-4" /> Zatwierdzone
            </span>
            <button disabled={busy} onClick={() => void run({ approve: false })} className="flex items-center gap-1 text-[12px] text-white/45 hover:text-white/80">
              <RotateCcw className="h-3 w-3" /> Cofnij
            </button>
          </div>
        ) : (
          <button
            disabled={busy || text.trim().length < 3}
            onClick={() => void run({ ...(dirty ? edits() : {}), approve: true })}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-400 px-3 text-[13px] font-semibold text-black disabled:opacity-50"
            data-testid="review-row-accept"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {dirty ? "Zapisz i zatwierdź" : "Zatwierdź"}
          </button>
        )}
      </td>
    </tr>
  );
}
