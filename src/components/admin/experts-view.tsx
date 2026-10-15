"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button, Card, Dialog, DialogContent, EmptyState, Input, Label, Progress, useToast } from "@/components/ui";
import { api, formatDate } from "@/lib/utils";

interface ExpertRow {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  projects: Array<{ id: string; name: string; total: number; recorded: number }>;
  links: Array<{ id: string; project: string; url: string | null; expiresAt: string }>;
}

export function ExpertsView({ experts }: { experts: ExpertRow[] }) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [edit, setEdit] = useState<ExpertRow | "new" | null>(null);
  const [form, setForm] = useState({ name: "", email: "", title: "" });
  const openEdit = (e: ExpertRow | "new") => {
    setEdit(e);
    setForm(e === "new" ? { name: "", email: "", title: "" } : { name: e.name, email: e.email ?? "", title: e.title ?? "" });
  };
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold">Eksperci</h1>
          <p className="mt-1 text-sm text-muted">Eksperci nagrywają odpowiedzi przez bezpieczny link — bez zakładania konta.</p>
        </div>
        <Button onClick={() => openEdit("new")}>
          <UserPlus /> Dodaj eksperta
        </Button>
      </div>
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        {experts.length === 0 ? <EmptyState title="Brak ekspertów" /> : null}
        {experts.map((e) => {
          const total = e.projects.reduce((n, p) => n + p.total, 0);
          const rec = e.projects.reduce((n, p) => n + p.recorded, 0);
          return (
            <Card key={e.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold">{e.name}</p>
                  <p className="text-sm text-muted">{[e.title, e.email].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="iconSm" variant="ghost" aria-label="Edytuj" onClick={() => openEdit(e)}>
                    <Pencil />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label="Usuń"
                    onClick={async () => {
                      if (!confirm(`Usunąć eksperta ${e.name}? Jego nagrania również zostaną usunięte.`)) return;
                      await api(`/api/admin/experts/${e.id}`, { method: "DELETE" });
                      router.refresh();
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-muted">
                  <span>Postęp nagrywania</span>
                  <span className="tabular">
                    {rec}/{total}
                  </span>
                </div>
                <Progress value={total ? rec / total : 0} />
              </div>
              <div className="mt-4 space-y-1 text-sm">
                {e.projects.map((p) => (
                  <Link key={p.id} href={`/admin/projects/${p.id}`} className="flex justify-between rounded-lg px-2 py-1 hover:bg-black/[.03]">
                    <span className="truncate">{p.name}</span>
                    <span className="tabular text-muted">
                      {p.recorded}/{p.total}
                    </span>
                  </Link>
                ))}
              </div>
              {e.links.length ? (
                <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                  {e.links.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {l.project} · do {formatDate(l.expiresAt)}
                      </span>
                      {l.url ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(l.url!).catch(() => {});
                            toast("Skopiowano link");
                          }}
                        >
                          <Copy /> Kopiuj link
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit === "new" ? "Nowy ekspert" : "Edytuj eksperta"}>
          <form
            className="space-y-4"
            onSubmit={async (ev) => {
              ev.preventDefault();
              try {
                const body = { name: form.name, email: form.email || null, title: form.title || null };
                if (edit === "new") await api("/api/admin/experts", { method: "POST", json: body });
                else if (edit) await api(`/api/admin/experts/${edit.id}`, { method: "PATCH", json: body });
                setEdit(null);
                router.refresh();
              } catch (err) {
                toast((err as Error).message, "err");
              }
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="e-name">Imię i nazwisko</Label>
              <Input id="e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-title">Tytuł / specjalizacja (opcjonalnie)</Label>
              <Input id="e-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-mail">E-mail (opcjonalnie)</Label>
              <Input id="e-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <Button type="submit" className="w-full">
              Zapisz
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {toastNode}
    </div>
  );
}
