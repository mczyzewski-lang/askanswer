"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Mic, Palette, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, Input, NativeSelect, useToast } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { ThemesView } from "./themes-view";
import { SettingsPanel } from "./settings-panel";
import { ProjectExpertsCard } from "./project-experts-card";
import type { ProjectData } from "@/lib/server/project-data";

export type SettingsSection = "theme" | "people" | "voice" | "general";

const SECTIONS: Record<SettingsSection, { label: string; icon: typeof Palette }> = {
  theme: { label: "Motyw projektu", icon: Palette },
  people: { label: "Osoby i eksperci", icon: Users },
  voice: { label: "Głosy (lektor)", icon: Mic },
  general: { label: "Ogólne", icon: SlidersHorizontal },
};

const ROLE_NAME: Record<string, string> = { ADMIN: "Administrator", EDITOR: "Edytor", EXPERT: "Ekspert", VIEWER: "Przeglądający" };

export function ProjectSettings({
  projectId,
  back,
  sections,
  section,
  theme,
  experts,
  data,
  canEdit,
}: {
  projectId: string;
  back: string;
  sections: SettingsSection[];
  section: SettingsSection;
  theme: Parameters<typeof ThemesView>[0]["themes"][number] | null;
  experts: Array<{ id: string; name: string }>;
  data: ProjectData | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const refresh = () => router.refresh();
  return (
    <div className="space-y-6" data-testid="project-settings">
      {toastNode}
      <div>
        <Link href={back} className="text-sm text-muted hover:text-ink">
          ← Projekt
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold">Ustawienia projektu</h1>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-line" data-testid="settings-sections">
        {sections.map((k) => {
          const Icon = SECTIONS[k].icon;
          return (
            <Link
              key={k}
              href={`/admin/projects/${projectId}/settings?section=${k}`}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition", section === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} /> {SECTIONS[k].label}
            </Link>
          );
        })}
      </nav>
      {section === "theme" ? theme ? <ThemesView themes={[theme]} experts={experts} initialId={theme.id} embedded /> : <p className="text-sm text-muted">Projekt nie ma własnego motywu.</p> : null}
      {section === "people" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ProjectPeople projectId={projectId} toast={toast} />
          {data && data.project.format !== "ADS" ? <ProjectExpertsCard data={data} refresh={refresh} toast={toast} /> : null}
        </div>
      ) : null}
      {section === "voice" && data ? <SettingsPanel data={data} refresh={refresh} toast={toast} only="voice" /> : null}
      {section === "general" && data ? <SettingsPanel data={data} refresh={refresh} toast={toast} only="general" /> : null}
      {!canEdit ? <p className="text-xs text-muted">Masz dostęp tylko do podglądu — zmiany nie zostaną zapisane.</p> : null}
    </div>
  );
}

interface Person {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** The people who may open the project (administrators always can). */
function ProjectPeople({ projectId, toast }: { projectId: string; toast: (t: string, tone?: "ok" | "err") => void }) {
  const [d, setD] = useState<{ people: Person[]; admins: Person[]; others: Person[]; canManage: boolean } | null>(null);
  const [pick, setPick] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const load = useCallback(async () => setD(await api(`/api/admin/projects/${projectId}/people`)), [projectId]);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const add = async (body: Record<string, unknown>) => {
    try {
      await api(`/api/admin/projects/${projectId}/people`, { method: "POST", json: body });
      toast("Dodano dostęp do projektu");
      setPick("");
      setEmail("");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  if (!d) return <Card className="p-5 text-sm text-muted">Wczytuję…</Card>;
  return (
    <Card className="space-y-4 p-5" data-testid="project-people">
      <div>
        <p className="font-medium">Osoby z dostępem</p>
        <p className="text-sm text-muted">Tylko te osoby widzą projekt (administratorzy widzą wszystkie). Logują się przez Google tym adresem.</p>
      </div>
      <ul className="divide-y divide-line">
        {d.people.map((u) => (
          <li key={u.id} className="flex items-center gap-2 py-2 text-sm" data-testid="project-person">
            <span className="min-w-0 flex-1 truncate">
              {u.name} <span className="text-muted">· {u.email}</span>
            </span>
            <Badge>{ROLE_NAME[u.role] ?? u.role}</Badge>
            {d.canManage ? (
              <Button
                size="iconSm"
                variant="ghost"
                aria-label={`Odbierz dostęp: ${u.email}`}
                onClick={async () => {
                  await api(`/api/admin/projects/${projectId}/people?userId=${u.id}`, { method: "DELETE" }).catch((e: Error) => toast(e.message, "err"));
                  await load();
                }}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
        {d.admins.map((u) => (
          <li key={u.id} className="flex items-center gap-2 py-2 text-sm text-muted">
            <span className="min-w-0 flex-1 truncate">
              {u.name} · {u.email}
            </span>
            <Badge tone="blue">Administrator</Badge>
          </li>
        ))}
      </ul>
      {d.canManage ? (
        <div className="space-y-3 border-t border-line pt-4">
          {d.others.length ? (
            <div className="flex gap-2">
              <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Dodaj istniejącą osobę" className="flex-1">
                <option value="">Dodaj istniejącą osobę…</option>
                {d.others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email}) — {ROLE_NAME[u.role] ?? u.role}
                  </option>
                ))}
              </NativeSelect>
              <Button variant="outline" disabled={!pick} onClick={() => void add({ userId: pick })}>
                Dodaj
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nowa osoba: e-mail Google" className="min-w-0 flex-1" aria-label="E-mail nowej osoby" />
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rola nowej osoby" className="w-40">
              <option value="EDITOR">Edytor</option>
              <option value="EXPERT">Ekspert</option>
              <option value="VIEWER">Przeglądający</option>
            </NativeSelect>
            <Button disabled={!email.includes("@")} onClick={() => void add({ email, role })} data-testid="project-person-add">
              Zaproś
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
