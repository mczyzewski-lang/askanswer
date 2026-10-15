"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FileText,
  FileUp,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Star,
  Trash2,
  Volume2,
  Wand2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@/components/ui";
import { api, cn, formatDate, formatDuration, plural } from "@/lib/utils";
import { themeFromRow, DEFAULT_THEME } from "@/lib/themes";
import type { PanelProps } from "./project-view";
import { QuestionPreview } from "./question-preview";
import { parseBulk } from "@/lib/bulk-questions";

type Q = PanelProps["data"]["questions"][number];
type Take = Q["takes"][number];

export const STATUS: Record<string, { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" | "violet" }> = {
  TO_RECORD: { label: "Do nagrania", tone: "gray" },
  IN_PROGRESS: { label: "W trakcie", tone: "blue" },
  RECORDED: { label: "Nagrane", tone: "violet" },
  NEEDS_FIX: { label: "Do poprawy", tone: "amber" },
  APPROVED: { label: "Zatwierdzone", tone: "green" },
};

export function QuestionsPanel({ data, refresh, toast }: PanelProps) {
  const [items, setItems] = useState(data.questions);
  const [prevData, setPrevData] = useState(data.questions);
  if (prevData !== data.questions) {
    setPrevData(data.questions);
    setItems(data.questions);
  }
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Q | "new" | null>(null);
  const [bulk, setBulk] = useState(false);
  const [preview, setPreview] = useState<Q | null>(null);
  const [newCat, setNewCat] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const theme = data.project.theme ? themeFromRow(data.project.theme) : DEFAULT_THEME;

  const visible = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter((q) => (filter === "none" ? !q.categoryId : filter.startsWith("sub:") ? q.subcategoryId === filter.slice(4) : q.categoryId === filter)),
    [items, filter],
  );
  const [catsOpen, setCatsOpen] = useState(false);

  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldI = items.findIndex((q) => q.id === e.active.id);
    const newI = items.findIndex((q) => q.id === e.over!.id);
    const next = arrayMove(items, oldI, newI);
    setItems(next);
    try {
      await api(`/api/admin/projects/${data.project.id}/questions/reorder`, { method: "POST", json: { ids: next.map((q) => q.id) } });
      refresh();
    } catch (err) {
      toast((err as Error).message, "err");
      setItems(items);
    }
  };

  const importCsv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const rows = res.data
          .map((r) => {
            const get = (...keys: string[]) => {
              for (const k of Object.keys(r)) if (keys.includes(k.trim().toLowerCase())) return (r[k] ?? "").trim();
              return "";
            };
            const max = Number(get("czas", "maks", "max", "maxdurationsec", "duration"));
            return {
              text: get("pytanie", "question", "text", "treść", "tresc"),
              categoryName: get("kategoria", "category") || undefined,
              subcategoryName: get("podkategoria", "temat", "subcategory") || undefined,
              instructions: get("instrukcje", "instructions", "wskazówki") || null,
              maxDurationSec: Number.isFinite(max) && max > 0 ? Math.round(max) : null,
            };
          })
          .filter((r) => r.text.length >= 3);
        if (!rows.length) {
          toast("Nie znaleziono pytań. Plik CSV powinien mieć kolumny: pytanie, kategoria, instrukcje, czas", "err");
          return;
        }
        try {
          const r = await api<{ created: number }>(`/api/admin/projects/${data.project.id}/questions`, { method: "POST", json: { items: rows } });
          toast(`Zaimportowano ${r.created} ${plural(r.created, "pytanie", "pytania", "pytań")}`);
          refresh();
        } catch (err) {
          toast((err as Error).message, "err");
        }
      },
      error: (err) => toast(`Błąd CSV: ${err.message}`, "err"),
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Dodaj pytanie
        </Button>
        <Button variant="outline" onClick={() => setBulk(true)}>
          <ClipboardPaste /> Wklej wiele
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp /> Import CSV
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importCsv(f);
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <NativeSelect className="h-9 w-48" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtr kategorii">
            <option value="all">Wszystkie kategorie</option>
            {data.categories.map((c) => [
              <option key={c.id} value={c.id}>
                {c.name}
              </option>,
              ...c.subcategories.map((sc) => (
                <option key={sc.id} value={`sub:${sc.id}`}>
                  {"\u00a0\u00a0\u00a0"}› {sc.name}
                </option>
              )),
            ])}
            <option value="none">Bez kategorii</option>
          </NativeSelect>
          <Button size="sm" variant="outline" onClick={() => setCatsOpen(true)}>
            Kategorie i tematy
          </Button>
          <form
            className="flex items-center gap-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newCat.trim()) return;
              try {
                await api(`/api/admin/projects/${data.project.id}/categories`, { method: "POST", json: { name: newCat.trim() } });
                setNewCat("");
                toast("Dodano kategorię");
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            <Input className="h-9 w-40" placeholder="Nowa kategoria" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Nowa kategoria" />
            <Button type="submit" size="sm" variant="subtle" disabled={!newCat.trim()}>
              Dodaj
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-5">
        {visible.length === 0 ? (
          <EmptyState title="Brak pytań">Dodaj pytania ręcznie, wklej listę lub zaimportuj plik CSV.</EmptyState>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {visible.map((q) => (
                  <QuestionRow key={q.id} q={q} index={items.indexOf(q)} data={data} refresh={refresh} toast={toast} onEdit={() => setEditing(q)} onPreview={() => setPreview(q)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <QuestionDialog open={editing !== null} question={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} refresh={refresh} toast={toast} />
      <BulkDialog open={bulk} onClose={() => setBulk(false)} data={data} refresh={refresh} toast={toast} />
      <CategoriesDialog open={catsOpen} onClose={() => setCatsOpen(false)} data={data} refresh={refresh} toast={toast} />
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent title="Podgląd pytania na wideo" description="Tak pytanie pojawi się w górnej części filmu (motyw projektu).">
          {preview ? (
            <div className="flex justify-center">
              <QuestionPreview text={preview.text} theme={theme} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuestionRow({ q, index, data, refresh, toast, onEdit, onPreview }: { q: Q; index: number; onEdit: () => void; onPreview: () => void } & PanelProps) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id });
  const [open, setOpen] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    try {
      await api(`/api/admin/questions/${q.id}`, { method: "PATCH", json: body });
      if (msg) toast(msg);
      refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };

  const playNarration = async () => {
    setNarrating(true);
    try {
      const r = await api<{ url: string }>(`/api/admin/questions/${q.id}/narration`, { method: "POST" });
      if (audioRef.current) {
        audioRef.current.src = r.url;
        await audioRef.current.play();
      }
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setNarrating(false);
    }
  };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10 opacity-80")}>
      <Card className={cn("overflow-hidden", isDragging && "shadow-xl")}>
        <div className="flex items-start gap-2 p-3 sm:p-4">
          <button {...attributes} {...listeners} className="mt-0.5 cursor-grab touch-none rounded-md p-1 text-muted hover:bg-black/5 active:cursor-grabbing" aria-label="Przeciągnij, aby zmienić kolejność">
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="tabular mt-0.5 w-6 shrink-0 text-sm text-muted">{index + 1}.</span>
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{q.text}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {q.categoryName ? (
                <Badge>
                  {q.categoryName}
                  {q.subcategoryName ? <span className="text-ink/50">› {q.subcategoryName}</span> : null}
                </Badge>
              ) : null}
              <span>{q.expertName ?? "Brak eksperta"}</span>
              {q.maxDurationSec ? <span>· do {formatDuration(q.maxDurationSec)}</span> : null}
              {q.instructions ? <span className="truncate">· {q.instructions}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <NativeSelect
              aria-label="Status"
              className="h-8 w-[136px] rounded-lg text-xs"
              value={q.status}
              onChange={(e) => patch({ status: e.target.value }, "Zmieniono status")}
            >
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant={open ? "subtle" : "ghost"}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              data-testid="takes-toggle"
              className={cn(q.takes.length > 0 && "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100")}
            >
              <Badge tone={q.takes.length ? "green" : "gray"}>{q.takes.length}</Badge>
              <span className="hidden sm:inline">{q.takes.length === 1 ? "nagranie" : "nagrania"}</span>
              <ChevronDown className={cn("transition", open && "rotate-180")} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="iconSm" variant="ghost" aria-label="Więcej">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edytuj
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onPreview}>
                  <Eye /> Podgląd na wideo
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={playNarration} disabled={narrating}>
                  <Volume2 /> Odsłuchaj lektora
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    try {
                      await api(`/api/admin/questions/${q.id}/duplicate`, { method: "POST" });
                      toast("Zduplikowano pytanie");
                      refresh();
                    } catch (err) {
                      toast((err as Error).message, "err");
                    }
                  }}
                >
                  <Copy /> Duplikuj
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => patch({ status: "NEEDS_FIX" }, "Poproszono eksperta o ponowne nagranie")}>
                  <RotateCcw /> Poproś o ponowne nagranie
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  onSelect={async () => {
                    if (!confirm(`Usunąć pytanie „${q.text}”${q.takes.length ? " wraz z nagraniami" : ""}?`)) return;
                    try {
                      await api(`/api/admin/questions/${q.id}`, { method: "DELETE" });
                      toast("Usunięto pytanie");
                      refresh();
                    } catch (err) {
                      toast((err as Error).message, "err");
                    }
                  }}
                >
                  <Trash2 /> Usuń
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {open ? (
          <div className="border-t border-line bg-black/[.015] p-3 sm:p-4">
            {q.takes.length === 0 ? (
              <p className="text-sm text-muted">Brak nagrań. Wyślij ekspertowi link z zakładki „Eksperci i linki”.</p>
            ) : (
              <div className="space-y-2">
                {q.takes.map((t) => (
                  <TakeRow key={t.id} t={t} q={q} data={data} refresh={refresh} toast={toast} onOpenStudio={(id) => router.push(`/studio/${id}`)} />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Card>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}

function TakeRow({ t, q, refresh, toast, onOpenStudio }: { t: Take; q: Q; onOpenStudio: (id: string) => void } & PanelProps) {
  const [watch, setWatch] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = q.selectedTakeId === t.id;
  const processing = t.status === "UPLOADED" || t.status === "PROCESSING";
  const call = async (url: string, method = "POST", msg?: string) => {
    setBusy(true);
    try {
      const r = await api<{ id?: string }>(url, { method });
      if (msg) toast(msg);
      refresh();
      return r;
    } catch (err) {
      toast((err as Error).message, "err");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-2.5 ring-1 ring-line">
      <button
        className="relative flex h-16 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black text-white disabled:opacity-40"
        disabled={!t.previewUrl}
        onClick={() => setWatch(true)}
        aria-label="Obejrzyj nagranie"
      >
        <Play className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Ujęcie {t.takeNumber}</span>
          {selected ? (
            <Badge tone="violet">
              <Star className="h-3 w-3" /> wybrane
            </Badge>
          ) : null}
          <TakeStatus t={t} />
          {t.compositionStatus === "EDITED" ? <Badge tone="blue">zmontowane</Badge> : t.compositionStatus === "EXPORTED" ? <Badge tone="green">wyeksportowane</Badge> : null}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {formatDuration(t.durationSec)} · {t.mode === "CONTINUOUS" ? "tryb ciągły" : "tylko odpowiedź"} · {formatDate(t.createdAt)}
          {t.transcriptionError ? <span className="text-amber-700"> · {t.transcriptionError}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="brand" disabled={t.status !== "READY" || busy} onClick={async () => {
          if (t.compositionId) return onOpenStudio(t.compositionId);
          const r = await call(`/api/admin/takes/${t.id}/composition`);
          if (r?.id) onOpenStudio(r.id);
        }}>
          <Wand2 /> Otwórz w Studio
        </Button>
        {t.editedDownload ? (
          <a href={t.editedDownload} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-medium hover:bg-black/[.03]">
            <Download className="h-4 w-4" /> Wersja zmontowana
          </a>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="iconSm" variant="ghost" aria-label="Więcej opcji ujęcia">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setWatch(true)} disabled={!t.previewUrl}>
              <Play /> Obejrzyj nagranie
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.open(`/api/admin/takes/${t.id}/download`, "_self")} disabled={t.status === "UPLOADING"}>
              <Download /> Pobierz oryginał
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTranscript(true)} disabled={!t.hasTranscript}>
              <FileText /> Zobacz transkrypcję
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => call(`/api/admin/takes/${t.id}/select`, "POST", "Wybrano ujęcie")} disabled={selected}>
              <Star /> Ustaw jako wybrane
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => call(`/api/admin/takes/${t.id}/transcribe${t.hasTranscript ? "?force=1" : ""}`, "POST", "Zlecono transkrypcję")}>
              <RefreshCw /> {t.hasTranscript ? "Transkrybuj ponownie" : "Ponów transkrypcję"}
            </DropdownMenuItem>
            {t.status === "FAILED" ? (
              <DropdownMenuItem onSelect={() => call(`/api/admin/takes/${t.id}/reprocess`, "POST", "Ponowiono przetwarzanie")}>
                <RotateCcw /> Ponów przetwarzanie
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              onSelect={() => {
                if (confirm("Trwale usunąć to ujęcie, jego pliki i montaż? Tej operacji nie można cofnąć.")) void call(`/api/admin/takes/${t.id}`, "DELETE", "Usunięto ujęcie");
              }}
            >
              <Trash2 /> Usuń nagranie
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {processing ? <p className="w-full text-xs text-blue-700">{t.processingStep ?? "Przetwarzanie…"}</p> : null}
      {t.status === "FAILED" ? (
        <div className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <p className="font-medium">
            Błąd przetwarzania{t.processingStep ? ` na etapie „${t.processingStep}”` : ""}. Oryginalne nagranie jest bezpieczne — możesz je pobrać lub kliknąć „Ponów przetwarzanie” w menu ⋯.
          </p>
          {t.processingError ? (
            <p className="mt-1 break-words font-mono text-[11px] text-red-700/90">
              {t.processingError.length > 520 ? `${t.processingError.slice(0, 220)} … ${t.processingError.slice(-280)}` : t.processingError}
            </p>
          ) : null}
        </div>
      ) : null}
      <Dialog open={watch} onOpenChange={setWatch}>
        <DialogContent title={`Ujęcie ${t.takeNumber}`} description={q.text}>
          {t.previewUrl ? (
            <video controls playsInline autoPlay className="mx-auto max-h-[70vh] rounded-xl bg-black">
              <source src={t.previewUrl} type="video/mp4" />
              {t.proxyUrl ? <source src={t.proxyUrl} type="video/webm" /> : null}
            </video>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={transcript} onOpenChange={setTranscript}>
        <DialogContent title="Transkrypcja (oryginał)" description="Wynik ElevenLabs Scribe — edycja napisów w Studio nie zmienia tego tekstu.">
          <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{t.transcriptText}</p>
          <a className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand" href={`/api/admin/takes/${t.id}/transcript`}>
            <Download className="h-4 w-4" /> Pobierz TXT
          </a>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TakeStatus({ t }: { t: Take }) {
  switch (t.status) {
    case "UPLOADING":
      return (
        <Badge tone="blue">
          <Loader2 className="h-3 w-3 animate-spin" /> wysyłanie
        </Badge>
      );
    case "UPLOADED":
    case "PROCESSING":
      return (
        <Badge tone="blue">
          <Loader2 className="h-3 w-3 animate-spin" /> przetwarzanie
        </Badge>
      );
    case "READY":
      return (
        <Badge tone="green">
          <CheckCircle2 className="h-3 w-3" /> gotowe do edycji
        </Badge>
      );
    case "FAILED":
      return (
        <Badge tone="red" title={t.processingError ?? undefined}>
          <AlertCircle className="h-3 w-3" /> błąd przetwarzania
        </Badge>
      );
    default:
      return null;
  }
}

function QuestionDialog({ open, question, data, onClose, refresh, toast }: { open: boolean; question: Q | null; onClose: () => void } & PanelProps) {
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [newSub, setNewSub] = useState("");
  const [expertId, setExpertId] = useState<string>("");
  const [instructions, setInstructions] = useState("");
  const [max, setMax] = useState<string>("");
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? (question?.id ?? "new") : null;
  if (key !== lastKey) {
    setLastKey(key);
    setText(question?.text ?? "");
    setCategoryId(question?.categoryId ?? data.categories[0]?.id ?? "");
    setSubcategoryId(question?.subcategoryId ?? "");
    setNewSub("");
    setExpertId(question?.expertId ?? data.experts[0]?.id ?? "");
    setInstructions(question?.instructions ?? "");
    setMax(question?.maxDurationSec ? String(question.maxDurationSec) : "");
  }
  const theme = data.project.theme ? themeFromRow(data.project.theme) : DEFAULT_THEME;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={question ? "Edytuj pytanie" : "Nowe pytanie"} className="max-w-3xl">
        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <form
            id="qform"
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = {
                text,
                categoryId: categoryId || null,
                subcategoryId: subcategoryId && subcategoryId !== "__new" ? subcategoryId : null,
                ...(subcategoryId === "__new" && newSub.trim() ? { subcategoryName: newSub.trim() } : {}),
                expertId: expertId || null, instructions: instructions || null, maxDurationSec: max ? Number(max) : null };
              try {
                if (question) await api(`/api/admin/questions/${question.id}`, { method: "PATCH", json: body });
                else await api(`/api/admin/projects/${data.project.id}/questions`, { method: "POST", json: body });
                toast(question ? "Zapisano pytanie" : "Dodano pytanie");
                onClose();
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="qtext">Treść pytania</Label>
              <Textarea id="qtext" value={text} onChange={(e) => setText(e.target.value)} required minLength={3} rows={3} placeholder="np. Dlaczego warto zastrzec znak towarowy?" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qcat">Kategoria</Label>
                <NativeSelect
                  id="qcat"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setSubcategoryId("");
                  }}
                >
                  <option value="">— brak —</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qexp">Ekspert</Label>
                <NativeSelect id="qexp" value={expertId} onChange={(e) => setExpertId(e.target.value)}>
                  <option value="">— nieprzypisane —</option>
                  {data.experts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {categoryId ? (
              <div className="space-y-1.5">
                <Label htmlFor="qsub">Podkategoria / temat (opcjonalnie)</Label>
                <div className="flex gap-2">
                  <NativeSelect id="qsub" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
                    <option value="">— brak —</option>
                    {(data.categories.find((c) => c.id === categoryId)?.subcategories ?? []).map((sc) => (
                      <option key={sc.id} value={sc.id}>
                        {sc.name}
                      </option>
                    ))}
                    <option value="__new">+ Nowa podkategoria…</option>
                  </NativeSelect>
                  {subcategoryId === "__new" ? <Input placeholder="np. dzieci" value={newSub} onChange={(e) => setNewSub(e.target.value)} aria-label="Nazwa nowej podkategorii" /> : null}
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="qinst">Wskazówki do nagrania (opcjonalnie)</Label>
              <Input id="qinst" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="np. Odpowiedz w 3–4 zdaniach" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qmax">Zalecany maksymalny czas odpowiedzi (sekundy)</Label>
              <Input id="qmax" type="number" min={5} max={1800} value={max} onChange={(e) => setMax(e.target.value)} placeholder="np. 60" />
            </div>
            <Button type="submit" className="w-full" disabled={text.trim().length < 3}>
              {question ? "Zapisz" : "Dodaj pytanie"}
            </Button>
          </form>
          <div className="hidden md:block">
            <p className="mb-2 text-xs font-medium text-muted">Podgląd na wideo</p>
            <QuestionPreview text={text || "Treść pytania"} theme={theme} width={200} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkDialog({ open, onClose, data, refresh, toast }: { open: boolean; onClose: () => void } & PanelProps) {
  const [text, setText] = useState("");
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [expertId, setExpertId] = useState(data.experts[0]?.id ?? "");
  const lines = parseBulk(text);
  const catName = data.categories.find((c) => c.id === categoryId)?.name ?? null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Wklej wiele pytań"
        description="Jedno pytanie w każdej linii. Temat (podkategorię) podaj w nawiasie na początku: [dzieci] Kto decyduje o opiece? — wiersz bez nawiasu nie ma podkategorii. Numeracja i punktory są usuwane automatycznie."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"[dzieci] Kto decyduje o opiece nad dzieckiem?\n[dzieci] Jak ustala się wysokość alimentów?\n[majątek] Jak dzieli się majątek po rozwodzie?\nIle trwa sprawa rozwodowa?"} aria-label="Pytania" />
          {lines.length ? (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-paper text-muted">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Kategoria</th>
                    <th className="px-3 py-1.5 font-medium">Podkategoria</th>
                    <th className="px-3 py-1.5 font-medium">Pytanie</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const cat = l.category ?? catName ?? (l.subcategory ? l.subcategory : null);
                    const sub = l.category || catName ? l.subcategory : undefined;
                    return (
                      <tr key={i} className="border-t border-line">
                        <td className="px-3 py-1.5 text-muted">{cat ?? "—"}</td>
                        <td className="px-3 py-1.5">{sub ? <Badge tone="violet">{sub}</Badge> : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-1.5">{l.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Kategoria">
              <option value="">— bez kategorii —</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={expertId} onChange={(e) => setExpertId(e.target.value)} aria-label="Ekspert">
              <option value="">— nieprzypisane —</option>
              {data.experts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            className="w-full"
            disabled={!lines.length}
            onClick={async () => {
              try {
                const r = await api<{ created: number }>(`/api/admin/projects/${data.project.id}/questions`, {
                  method: "POST",
                  json: {
                    items: lines.map((l) => {
                      // [Kategoria/temat] wins; [temat] goes under the chosen category; with no category chosen [temat] becomes the category
                      if (l.category) return { text: l.text, categoryName: l.category, subcategoryName: l.subcategory, expertId: expertId || null };
                      if (categoryId) return { text: l.text, categoryId, subcategoryName: l.subcategory, expertId: expertId || null };
                      return { text: l.text, categoryName: l.subcategory, expertId: expertId || null };
                    }),
                  },
                });
                toast(`Dodano ${r.created} ${plural(r.created, "pytanie", "pytania", "pytań")}`);
                setText("");
                onClose();
                refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            Dodaj {lines.length || ""} {plural(lines.length, "pytanie", "pytania", "pytań")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ open, onClose, data, refresh, toast }: { open: boolean; onClose: () => void } & PanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const counts = (catId: string, subId?: string) => data.questions.filter((q) => q.categoryId === catId && (subId === undefined || q.subcategoryId === subId)).length;
  const call = async (url: string, method: string, json?: unknown, ok?: string) => {
    try {
      await api(url, { method, json });
      if (ok) toast(ok);
      refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Kategorie i tematy" description="Podkategorie (tematy) porządkują pytania w kategorii, np. Rozwody › dzieci, Rozwody › majątek." className="max-w-xl">
        <div className="space-y-3">
          {data.categories.map((c) => (
            <div key={c.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {c.name} <span className="text-xs font-normal text-muted">({counts(c.id)})</span>
                </p>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={`Usuń kategorię ${c.name}`}
                  onClick={() => {
                    if (confirm(`Usunąć kategorię „${c.name}” razem z jej tematami? Pytania zostaną, ale bez kategorii.`)) void call(`/api/admin/categories/${c.id}`, "DELETE", undefined, "Usunięto kategorię");
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.subcategories.map((sc) => (
                  <span key={sc.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand">
                    {sc.name} <span className="opacity-60">({counts(c.id, sc.id)})</span>
                    <button aria-label={`Usuń temat ${sc.name}`} className="ml-0.5 opacity-60 hover:opacity-100" onClick={() => call(`/api/admin/subcategories/${sc.id}`, "DELETE", undefined, "Usunięto temat")}>
                      ×
                    </button>
                  </span>
                ))}
                {c.subcategories.length === 0 ? <span className="text-xs text-muted">Brak tematów</span> : null}
              </div>
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = (drafts[c.id] ?? "").trim();
                  if (!name) return;
                  await call(`/api/admin/categories/${c.id}/subcategories`, "POST", { name }, "Dodano temat");
                  setDrafts((d) => ({ ...d, [c.id]: "" }));
                }}
              >
                <Input className="h-9" placeholder="Nowy temat, np. dzieci" value={drafts[c.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} aria-label={`Nowy temat w kategorii ${c.name}`} />
                <Button type="submit" size="sm" variant="subtle" disabled={!(drafts[c.id] ?? "").trim()}>
                  Dodaj
                </Button>
              </form>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
