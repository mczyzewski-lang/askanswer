"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, Input, Label, NativeSelect, useToast } from "@/components/ui";
import { api, cn, formatDate } from "@/lib/utils";

const ROLES = {
  ADMIN: { name: "Administrator", hint: "Wszystkie projekty, dodaje osoby i nadaje im dostęp." },
  EDITOR: { name: "Edytor", hint: "Edytuje przypisane projekty, korzysta z narzędzi globalnych." },
  EXPERT: { name: "Ekspert", hint: "Widzi swoje projekty i ich nagrania (bez edycji)." },
  VIEWER: { name: "Przeglądający", hint: "Tylko podgląd przypisanych projektów." },
} as const;
type Role = keyof typeof ROLES;

interface Person {
  id: string;
  email: string;
  name: string;
  role: string;
  google: boolean;
  password: boolean;
  lastLoginAt: string | null;
  projectIds: string[];
}
interface Proj {
  id: string;
  name: string;
  kind: string;
}

/** Administrators: the people of the studio, their role and the projects they may open. */
export function UsersView() {
  const [data, setData] = useState<{ users: Person[]; projects: Proj[] } | null>(null);
  const [form, setForm] = useState<{ email: string; name: string; role: Role; projectIds: string[] }>({ email: "", name: "", role: "EDITOR", projectIds: [] });
  const [open, setOpen] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const load = useCallback(async () => setData(await api<{ users: Person[]; projects: Proj[] }>("/api/admin/users")), []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);

  const patch = async (id: string, body: Record<string, unknown>, msg = "Zapisano") => {
    try {
      await api(`/api/admin/users/${id}`, { method: "PATCH", json: body });
      toast(msg);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  if (!data) return <p className={cn("text-sm", error ? "text-red-600" : "text-muted")}>{error ?? "Wczytuję…"}</p>;
  return (
    <div className="space-y-6" data-testid="users">
      {toastNode}
      <div>
        <h1 className="font-display text-[28px] font-semibold">Użytkownicy</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Dodaj osobę jej adresem e-mail — zaloguje się przez Google (to samo konto). Administratorzy widzą wszystkie projekty, pozostali tylko te, które im przypiszesz.</p>
      </div>

      <Card className="space-y-4 p-5">
        <p className="flex items-center gap-2 font-medium">
          <UserPlus className="h-4 w-4" /> Dodaj osobę
        </p>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/admin/users", { method: "POST", json: { ...form, name: form.name || undefined } });
              toast(`Dodano ${form.email}`);
              setForm({ email: "", name: "", role: "EDITOR", projectIds: [] });
              await load();
            } catch (err) {
              toast((err as Error).message, "err");
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="u-email">E-mail (konto Google)</Label>
              <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jan@firma.pl" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Imię i nazwisko</Label>
              <Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">Rola</Label>
              <NativeSelect id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {Object.entries(ROLES).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="text-xs text-muted">{ROLES[form.role].hint}</p>
          {form.role !== "ADMIN" ? <ProjectPicker projects={data.projects} value={form.projectIds} onChange={(projectIds) => setForm({ ...form, projectIds })} /> : null}
          <Button type="submit" disabled={!form.email.includes("@")} data-testid="user-add">
            Dodaj
          </Button>
        </form>
      </Card>

      <Card className="divide-y divide-line">
        {data.users.map((u) => {
          const role = u.role as Role;
          const known = role in ROLES;
          return (
            <div key={u.id} className="p-4" data-testid="user-row">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-sm text-muted">
                    {u.email}
                    {u.google ? " · Google" : u.password ? " · hasło" : " · jeszcze się nie logował(a)"}
                    {u.lastLoginAt ? ` · ostatnio ${formatDate(u.lastLoginAt)}` : ""}
                  </p>
                </div>
                {known ? (
                  <NativeSelect className="w-44" value={role} aria-label={`Rola: ${u.email}`} onChange={(e) => void patch(u.id, { role: e.target.value }, "Rola zmieniona")}>
                    {Object.entries(ROLES).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Badge>Social Media</Badge>
                )}
                {role === "ADMIN" ? (
                  <span className="w-36 text-right text-xs text-muted">wszystkie projekty</span>
                ) : known ? (
                  <button type="button" className="flex w-36 items-center justify-end gap-1 text-sm text-muted hover:text-ink" onClick={() => setOpen(open === u.id ? null : u.id)} data-testid="user-projects-toggle">
                    {u.projectIds.length} {u.projectIds.length === 1 ? "projekt" : "projektów"}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition", open === u.id && "rotate-180")} />
                  </button>
                ) : null}
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={`Usuń ${u.email}`}
                  onClick={async () => {
                    if (!confirm(`Usunąć konto ${u.email}?`)) return;
                    try {
                      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
                      await load();
                    } catch (e) {
                      toast((e as Error).message, "err");
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
              {open === u.id && role !== "ADMIN" ? (
                <div className="mt-3">
                  <ProjectPicker projects={data.projects} value={u.projectIds} onChange={(projectIds) => void patch(u.id, { projectIds }, "Dostęp do projektów zapisany")} />
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function ProjectPicker({ projects, value, onChange }: { projects: Proj[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const set = new Set(value);
  return (
    <div className="rounded-xl border border-line p-3" data-testid="project-picker">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Dostęp do projektów ({value.length})</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" className="h-8 w-48" aria-label="Szukaj projektu" />
      </div>
      <div className="grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
        {shown.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-black/[.03]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={set.has(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{p.kind}</span>
          </label>
        ))}
        {!shown.length ? <p className="px-2 text-sm text-muted">Brak projektów</p> : null}
      </div>
    </div>
  );
}
