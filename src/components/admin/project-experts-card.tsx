"use client";
import { useState } from "react";
import { UserMinus, UserPlus, Users } from "lucide-react";
import { Button, Card, Input, NativeSelect } from "@/components/ui";
import { api, plural } from "@/lib/utils";
import type { PanelProps } from "./project-view";

/** Settings → experts taking part in this project: add from "Eksperci" or create, assign questions, remove. */
export function ProjectExpertsCard({ data, refresh, toast }: PanelProps) {
  const members = data.experts.filter((e) => data.projectExpertIds.includes(e.id));
  const others = data.experts.filter((e) => !data.projectExpertIds.includes(e.id));
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const unassigned = data.questions.filter((q) => !q.expertId).length;
  const base = `/api/admin/projects/${data.project.id}/experts`;
  const call = async (url: string, method: string, json: unknown, ok: (r: { assigned?: number }) => string) => {
    try {
      const r = await api<{ assigned?: number }>(url, { method, json });
      toast(ok(r));
      refresh();
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };
  return (
    <Card className="space-y-4 p-5" data-testid="project-experts">
      <div>
        <p className="flex items-center gap-2 font-medium">
          <Users className="h-4 w-4" /> Eksperci projektu
        </p>
        <p className="mt-1 text-xs text-muted">Eksperci z zakładki „Eksperci”, którzy nagrywają w tym projekcie. Dla każdego wygenerujesz link w „Eksperci i linki”.</p>
      </div>
      {members.length === 0 ? <p className="text-sm text-muted">Nikt nie jest jeszcze przypisany.</p> : null}
      <div className="space-y-2">
        {members.map((e) => {
          const count = data.questions.filter((q) => q.expertId === e.id).length;
          return (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5" data-testid="project-expert">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{e.name}</p>
                <p className="text-xs text-muted">
                  {count} {plural(count, "pozycja", "pozycje", "pozycji")}
                  {e.title ? ` · ${e.title}` : ""}
                </p>
              </div>
              {unassigned > 0 ? (
                <Button size="sm" variant="subtle" onClick={() => call(`${base}/${e.id}`, "POST", { scope: "unassigned" }, (r) => `Przypisano ${r.assigned ?? 0} bez eksperta do: ${e.name}`)}>
                  Przypisz {unassigned} bez eksperta
                </Button>
              ) : null}
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Usuń ${e.name} z projektu`}
                onClick={() => {
                  if (confirm(`Usunąć ${e.name} z projektu? Jego pozycje zostaną bez eksperta (nagrania zostają).`)) void call(`${base}/${e.id}`, "DELETE", undefined, () => "Usunięto eksperta z projektu");
                }}
              >
                <UserMinus />
              </Button>
            </div>
          );
        })}
      </div>
      {others.length ? (
        <div className="flex gap-2">
          <NativeSelect aria-label="Ekspert do dodania" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Wybierz eksperta z listy…</option>
            {others.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.title ? ` — ${e.title}` : ""}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={!pick}
            onClick={async () => {
              await call(base, "POST", { expertId: pick }, () => "Dodano eksperta do projektu");
              setPick("");
            }}
          >
            <UserPlus /> Dodaj
          </Button>
        </div>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          await call(base, "POST", { name }, () => "Utworzono eksperta i dodano do projektu");
          setName("");
        }}
      >
        <Input placeholder="Nowy ekspert: imię i nazwisko" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nowy ekspert" />
        <Button type="submit" variant="subtle" disabled={name.trim().length < 2}>
          Utwórz
        </Button>
      </form>
    </Card>
  );
}
