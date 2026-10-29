"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, FolderPlus, Plus } from "lucide-react";
import { Button, Dialog, DialogContent, Input } from "@/components/ui";
import { api } from "@/lib/utils";
import { useSocial } from "./shell";
import { DemoBadge, Empty, Field, PageHeader, Panel } from "./ui";

export function ProjectsList() {
  const { me, reloadMe, toast } = useSocial();
  const router = useRouter();
  const [newOrg, setNewOrg] = React.useState(false);
  const [newProject, setNewProject] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async (kind: "org" | "project") => {
    setBusy(true);
    try {
      if (kind === "org") {
        await api("/api/social/orgs", { method: "POST", json: { name } });
        toast("Utworzono organizację");
        setNewOrg(false);
      } else {
        const p = await api<{ id: string }>(`/api/social/orgs/${newProject}/projects`, { method: "POST", json: { name } });
        await reloadMe();
        router.push(`/social/projects/${p.id}?tab=accounts`);
        return;
      }
      setName("");
      await reloadMe();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const orgIds = new Set(me.organizations.map((o) => o.id));
  const loose = me.projects.filter((p) => !orgIds.has(p.organizationId));
  return (
    <>
      <PageHeader
        title="Projekty"
        subtitle="Organizacja → projekty → konta społecznościowe. Dane każdego projektu są od siebie oddzielone."
        actions={
          me.user.staff ? (
            <Button size="sm" variant="outline" onClick={() => setNewOrg(true)} data-testid="new-org">
              <Building2 /> Nowa organizacja
            </Button>
          ) : undefined
        }
      />
      {!me.organizations.length && !loose.length ? <Empty icon={<Building2 className="h-6 w-6" />} title="Brak organizacji">{me.user.staff ? "Utwórz organizację klienta, a w niej projekty (marki)." : "Nie masz jeszcze dostępu do żadnego projektu."}</Empty> : null}
      <div className="space-y-6">
        {me.organizations.map((o) => {
          const projects = me.projects.filter((p) => p.organizationId === o.id);
          const canCreate = o.role === "OWNER" || o.role === "ADMIN";
          return (
            <Panel
              key={o.id}
              data-testid="org-panel"
              title={
                <span className="flex items-center gap-2">
                  {o.name} {o.isDemo ? <DemoBadge /> : null}
                </span>
              }
              actions={
                canCreate ? (
                  <Button size="sm" variant="ghost" onClick={() => setNewProject(o.id)} data-testid="new-project">
                    <FolderPlus /> Nowy projekt
                  </Button>
                ) : undefined
              }
            >
              {projects.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {projects.map((p) => (
                    <Link key={p.id} href={`/social/projects/${p.id}`} className="rounded-xl border border-line p-3 transition hover:border-ink/25" data-testid="project-card">
                      <p className="flex items-center gap-2 font-medium">
                        {p.name} {p.isDemo ? <DemoBadge /> : null}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {p.timezone} · Twoja rola: {p.roles.join(", ")}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">Brak projektów w tej organizacji.</p>
              )}
            </Panel>
          );
        })}
        {loose.length ? (
          <Panel title="Projekty, do których masz dostęp">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {loose.map((p) => (
                <Link key={p.id} href={`/social/projects/${p.id}`} className="rounded-xl border border-line p-3 hover:border-ink/25" data-testid="project-card">
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {p.organizationName} · {p.roles.join(", ")}
                  </p>
                </Link>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
      <Dialog open={newOrg || !!newProject} onOpenChange={(o) => !o && (setNewOrg(false), setNewProject(null))}>
        <DialogContent title={newOrg ? "Nowa organizacja" : "Nowy projekt"} description={newOrg ? "Np. klient agencji. W organizacji zakładasz projekty (marki)." : "Projekt to marka z własnymi kontami, treściami, komentarzami i analityką."}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(newOrg ? "org" : "project");
            }}
          >
            <Field label="Nazwa">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required minLength={2} placeholder={newOrg ? "AV Holding" : "Nowy Etap"} aria-label="Nazwa" />
            </Field>
            {me.demoMode && !newOrg ? <p className="text-[12.5px] text-muted">Studio działa w trybie DEMO (brak klucza Upload-Post) — nowy projekt będzie projektem DEMO.</p> : null}
            <Button type="submit" disabled={busy || name.trim().length < 2} className="w-full">
              <Plus /> Utwórz
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
