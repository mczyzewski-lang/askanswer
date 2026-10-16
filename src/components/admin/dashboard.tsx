"use client";
import Link from "next/link";
import { FORMAT_LABELS, type ProjectFormat } from "@/lib/project-terms";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, FolderPlus, Users } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogContent, DialogTrigger, EmptyState, Input, Label, NativeSelect, Progress, Textarea, useToast } from "@/components/ui";
import { api, formatDate } from "@/lib/utils";
import { THEME_PRESETS } from "@/lib/themes";
import type { DashboardProject } from "@/lib/server/project-data";

export function Dashboard({ projects }: { projects: DashboardProject[] }) {
  const totals = projects.reduce(
    (t, p) => ({ q: t.q + p.questionCount, r: t.r + p.recorded, e: t.e + p.edited, x: t.x + p.exported }),
    { q: 0, r: 0, e: 0, x: 0 },
  );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Projekty</h1>
          <p className="mt-1 text-sm text-muted">Od pytania do zmontowanego wideo eksperta w kilka minut.</p>
        </div>
        <NewProjectDialog />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Pytania" value={totals.q} />
        <Kpi label="Nagrane odpowiedzi" value={totals.r} sub={totals.q ? `${Math.round((totals.r / totals.q) * 100)}% ukończone` : undefined} />
        <Kpi label="Zmontowane filmy" value={totals.e} />
        <Kpi label="Wyeksportowane" value={totals.x} />
      </div>
      <div className="mt-8 space-y-3">
        {projects.length === 0 ? (
          <EmptyState icon={<FolderPlus className="h-8 w-8" />} title="Brak projektów">
            Utwórz pierwszy projekt, dodaj pytania i wyślij ekspertowi link do nagrania.
          </EmptyState>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/admin/projects/${p.id}`} className="group block">
              <Card className="p-5 transition group-hover:border-black/15 group-hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-display text-lg font-semibold">{p.name}</h2>
                      <ArrowUpRight className="h-4 w-4 text-muted opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                      <Users className="h-3.5 w-3.5" />
                      {p.experts.length ? p.experts.join(", ") : "Brak przypisanego eksperta"}
                    </p>
                  </div>
                  <span className="text-xs text-muted">Aktualizacja: {formatDate(p.updatedAt)}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                  <Metric label="Pytania" value={p.questionCount} />
                  <Metric label="Nagrane" value={p.recorded} />
                  <Metric label="Bez odpowiedzi" value={p.unanswered} tone={p.unanswered ? "amber" : undefined} />
                  <Metric label="Zmontowane" value={p.edited} />
                  <Metric label="Wyeksportowane" value={p.exported} />
                </div>
                <Progress className="mt-4" value={p.questionCount ? p.recorded / p.questionCount : 0} />
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular font-medium">{tone && value ? <Badge tone="amber">{value}</Badge> : value}</div>
    </div>
  );
}

function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("pravna");
  const [format, setFormat] = useState<ProjectFormat>("ANSWERS");
  const [busy, setBusy] = useState(false);
  const { toast, toastNode } = useToast();
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <FolderPlus /> Nowy projekt
          </Button>
        </DialogTrigger>
        <DialogContent title="Nowy projekt" description="Projekt grupuje pytania, ekspertów i gotowe filmy.">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const p = await api<{ id: string }>("/api/admin/projects", { method: "POST", json: { name, description: description || null, preset, format } });
                router.push(`/admin/projects/${p.id}`);
              } catch (err) {
                toast((err as Error).message, "err");
                setBusy(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pname">Nazwa</Label>
              <Input id="pname" placeholder="np. Pravna — Ekspert odpowiada na pytania o znaki towarowe" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdesc">Opis (opcjonalnie)</Label>
              <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pformat">Format</Label>
              <NativeSelect id="pformat" value={format} onChange={(e) => setFormat(e.target.value as ProjectFormat)}>
                {(Object.keys(FORMAT_LABELS) as ProjectFormat[]).map((k) => (
                  <option key={k} value={k}>
                    {FORMAT_LABELS[k].name} — {FORMAT_LABELS[k].description}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ptheme">Motyw startowy</Label>
              <NativeSelect id="ptheme" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {THEME_PRESETS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} — {t.description}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" className="w-full" disabled={busy || name.trim().length < 2}>
              Utwórz projekt
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {toastNode}
    </>
  );
}
