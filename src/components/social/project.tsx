"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Link2, Plus, RefreshCw, Trash2, Unplug, UserPlus } from "lucide-react";
import { Button, Dialog, DialogContent, Input, NativeSelect, Switch, Textarea } from "@/components/ui";
import { api, cn } from "@/lib/utils";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social/platforms";
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from "@/lib/social/rbac";
import { useSocial } from "./shell";
import { DemoBadge, ErrorBox, Field, Loading, Metric, PageHeader, Panel, Pill, PlatformIcon, Tabs, useApi } from "./ui";

export interface AccountView {
  id: string;
  platform: Platform;
  handle: string | null;
  displayName: string | null;
  image: string | null;
  status: string;
  reauthRequired: boolean;
  capabilities: string[];
  commentsAvailable: boolean;
  needsPage: boolean;
  pageId: string | null;
  pageName: string | null;
  isDemo: boolean;
  lastSyncAt: string | null;
  profileId: string;
}

interface ProjectData {
  project: { id: string; name: string; timezone: string; language: string; isDemo: boolean; organization: { id: string; name: string } };
  permissions: string[];
  roles: OrgRole[];
  counts: { accounts: number; scheduled: number; published: number; pendingApproval: number; failed: number; unreadComments: number };
  results: { d7: Result; d30: Result };
  accounts: AccountView[];
  members: Array<{ id: string; role: OrgRole; user: { id: string; email: string; name: string } }>;
}
interface Result {
  published: number;
  views: number | null;
  interactions: number | null;
  lastUpdated: string | null;
}

type Tab = "overview" | "accounts" | "brand" | "team" | "danger";

export function ProjectView({ id }: { id: string }) {
  const search = useSearchParams();
  const [tab, setTab] = React.useState<Tab>((search.get("tab") as Tab) || "overview");
  const { data, error, loading, reload } = useApi<ProjectData>(`/api/social/projects/${id}`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const perms = new Set(data.permissions);
  return (
    <>
      <PageHeader
        title={data.project.name}
        subtitle={
          <span className="flex items-center gap-2">
            {data.project.organization.name} · {data.project.timezone} · Twoja rola: {data.roles.map((r) => ROLE_LABELS[r].name).join(", ")} {data.project.isDemo ? <DemoBadge /> : null}
          </span>
        }
        actions={
          <Link href={`/social/library?project=${id}`}>
            <Button size="sm">Dodaj film</Button>
          </Link>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-6"
        items={[
          ["overview", "Przegląd"],
          ["accounts", `Konta (${data.accounts.filter((a) => a.status !== "DISCONNECTED").length})`],
          ["brand", "Ustawienia marki"],
          ...(perms.has("members.manage") ? ([["team", "Zespół"]] as Array<[Tab, string]>) : []),
          ...(perms.has("project.delete") ? ([["danger", "Usuń projekt"]] as Array<[Tab, string]>) : []),
        ]}
      />
      {tab === "overview" ? <Overview data={data} /> : null}
      {tab === "accounts" ? <Accounts data={data} reload={reload} /> : null}
      {tab === "brand" ? <Brand projectId={id} /> : null}
      {tab === "team" ? <Team data={data} reload={reload} /> : null}
      {tab === "danger" ? <Danger data={data} /> : null}
    </>
  );
}

function Overview({ data }: { data: ProjectData }) {
  const c = data.counts;
  const cards: Array<[string, number, string]> = [
    ["Połączone konta", c.accounts, "?tab=accounts"],
    ["Zaplanowane", c.scheduled, "/social/calendar"],
    ["Opublikowane", c.published, "/social/publications"],
    ["Do akceptacji", c.pendingApproval, "/social/approvals"],
    ["Nieprzeczytane komentarze", c.unreadComments, "/social/comments"],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([label, n, href]) => (
          <Link key={label} href={href.startsWith("?") ? href : `${href}?project=${data.project.id}`} className="rounded-2xl border border-line bg-white p-4 hover:border-ink/20">
            <p className="text-[12.5px] text-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular">{n}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["d7", "d30"] as const).map((k) => (
          <Panel key={k} title={k === "d7" ? "Ostatnie 7 dni" : "Ostatnie 30 dni"}>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-[12px] text-muted">Opublikowane</dt>
                <dd className="text-lg font-semibold tabular">{data.results[k].published}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Wyświetlenia</dt>
                <dd className="text-lg font-semibold">
                  <Metric value={data.results[k].views} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Interakcje</dt>
                <dd className="text-lg font-semibold">
                  <Metric value={data.results[k].interactions} />
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11.5px] text-muted">{data.results[k].lastUpdated ? `Dane z ${new Date(data.results[k].lastUpdated!).toLocaleString("pl-PL")}` : "Brak danych z tego okresu."}</p>
          </Panel>
        ))}
      </div>
      {data.accounts.some((a) => a.status !== "CONNECTED") ? (
        <ErrorBox error={`Część kont wymaga uwagi: ${data.accounts.filter((a) => a.status !== "CONNECTED").map((a) => `${PLATFORM_META[a.platform].name} (${a.status === "DISCONNECTED" ? "rozłączone" : "połącz ponownie"})`).join(", ")}.`} />
      ) : null}
    </div>
  );
}

const CAP_LABEL: Record<Platform, string> = {
  INSTAGRAM: "Reels, okładka, pierwszy komentarz, komentarze (publiczne odpowiedzi i DM)",
  TIKTOK: "Filmy, prywatność, okładka; komentarze tylko z uprawnieniem „comments”",
  YOUTUBE: "Shorts, tytuł, tagi, prywatność, komentarze",
  FACEBOOK: "Reels i posty wideo na stronie firmowej, komentarze",
  LINKEDIN: "Filmy na profilu lub stronie firmy, komentarze (strony firmowe)",
};

function Accounts({ data, reload }: { data: ProjectData; reload: () => Promise<void> }) {
  const { toast } = useSocial();
  const canManage = data.permissions.includes("accounts.manage");
  const [connect, setConnect] = React.useState(false);
  const [chosen, setChosen] = React.useState<Platform[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pagesFor, setPagesFor] = React.useState<AccountView | null>(null);
  const go = async (platforms: Platform[], accountId?: string) => {
    setBusy(accountId ?? "connect");
    try {
      const r = accountId ? await api<{ url: string }>(`/api/social/accounts/${accountId}/reconnect`, { method: "POST" }) : await api<{ url: string }>(`/api/social/projects/${data.project.id}/accounts`, { method: "POST", json: { platforms } });
      window.location.href = r.url;
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(null);
    }
  };
  const sync = async () => {
    setBusy("sync");
    try {
      const r = await api<{ changes: string[] }>(`/api/social/projects/${data.project.id}/accounts/sync`, { method: "POST", json: {} });
      toast(r.changes.length ? r.changes.join(" · ") : "Konta są aktualne");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (a: AccountView) => {
    if (!confirm(`Rozłączyć ${PLATFORM_META[a.platform].name} ${a.displayName ?? ""}? Zaplanowane publikacje na to konto zostaną anulowane.`)) return;
    try {
      await api(`/api/social/accounts/${a.id}`, { method: "DELETE" });
      toast("Konto rozłączone");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const active = data.accounts.filter((a) => a.status !== "DISCONNECTED");
  return (
    <div className="space-y-4" data-testid="accounts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">Klient loguje się na swoje konta na bezpiecznej stronie dostawcy (Upload-Post). Hasła nie trafiają do Social Media Studio. Kilka kont tej samej platformy w projekcie jest możliwych — każde trafia do osobnego profilu dostawcy.</p>
        {canManage ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void sync()} disabled={busy === "sync"}>
              <RefreshCw className={cn(busy === "sync" && "animate-spin")} /> Synchronizuj
            </Button>
            <Button size="sm" onClick={() => setConnect(true)} data-testid="connect-account">
              <Plus /> Połącz konto
            </Button>
          </div>
        ) : null}
      </div>
      {active.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((a) => (
            <div key={a.id} className="rounded-2xl border border-line bg-white p-4" data-testid="account-card" data-platform={a.platform} data-status={a.status}>
              <div className="flex items-start gap-3">
                <PlatformIcon platform={a.platform} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {a.displayName ?? a.handle ?? PLATFORM_META[a.platform].name} {a.isDemo ? <DemoBadge /> : null}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {a.handle ? `@${a.handle}` : ""} · {PLATFORM_META[a.platform].name} {PLATFORM_META[a.platform].format}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.status === "CONNECTED" ? <Pill tone="green">Połączone</Pill> : <Pill tone="red">Wymaga ponownej autoryzacji</Pill>}
                    {a.platform === "TIKTOK" && !a.commentsAvailable ? <Pill tone="amber">Komentarze: połącz ponownie z uprawnieniem</Pill> : null}
                    {a.needsPage ? <Pill tone="amber">Wybierz stronę</Pill> : null}
                    {a.pageName ? <Pill>Strona: {a.pageName}</Pill> : null}
                  </div>
                  <p className="mt-2 text-[12px] text-muted">{CAP_LABEL[a.platform]}</p>
                </div>
              </div>
              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  {a.status !== "CONNECTED" || (a.platform === "TIKTOK" && !a.commentsAvailable) ? (
                    <Button size="sm" onClick={() => void go([a.platform], a.id)} disabled={busy === a.id} data-testid="reconnect">
                      <Link2 /> Połącz ponownie
                    </Button>
                  ) : null}
                  {a.platform === "FACEBOOK" || a.platform === "LINKEDIN" ? (
                    <Button size="sm" variant="outline" onClick={() => setPagesFor(a)} data-testid="choose-page">
                      {a.platform === "FACEBOOK" ? "Strona Facebook" : "Profil / strona LinkedIn"}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="ml-auto text-red-600" onClick={() => void disconnect(a)}>
                    <Unplug /> Rozłącz
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Brak połączonych kont. {canManage ? "Kliknij „Połącz konto”." : ""}</div>
      )}
      <Dialog open={connect} onOpenChange={setConnect}>
        <DialogContent title="Połącz konta" description="Wybierz platformy — przejdziesz na stronę autoryzacji i wrócisz tutaj.">
          <div className="space-y-2">
            {PLATFORMS.map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 hover:bg-ink/[.03]">
                <input type="checkbox" checked={chosen.includes(p)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p] : c.filter((x) => x !== p)))} />
                <PlatformIcon platform={p} />
                <span className="text-sm font-medium">{PLATFORM_META[p].name}</span>
                <span className="text-[12px] text-muted">{PLATFORM_META[p].format}</span>
                {active.some((a) => a.platform === p) ? <span className="ml-auto text-[11.5px] text-muted">kolejne konto → nowy profil</span> : null}
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" disabled={!chosen.length || busy === "connect"} onClick={() => void go(chosen)} data-testid="connect-go">
            Przejdź do autoryzacji
          </Button>
        </DialogContent>
      </Dialog>
      {pagesFor ? <PagePicker account={pagesFor} onClose={() => setPagesFor(null)} onDone={reload} /> : null}
    </div>
  );
}

function PagePicker({ account, onClose, onDone }: { account: AccountView; onClose: () => void; onDone: () => Promise<void> }) {
  const { toast } = useSocial();
  const { data, error } = useApi<{ pages: Array<{ id: string; name: string }> }>(`/api/social/accounts/${account.id}/pages`);
  const choose = async (page: { id: string; name: string } | null) => {
    try {
      await api(`/api/social/accounts/${account.id}`, { method: "PATCH", json: { page } });
      toast("Zapisano. Publikacje na to konto wymagają ponownej akceptacji.");
      await onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={account.platform === "FACEBOOK" ? "Strona Facebook" : "Gdzie publikować na LinkedIn"} description="Publikacje tego konta trafią na wybraną stronę.">
        {error ? <ErrorBox error={error} /> : null}
        {!data && !error ? <Loading /> : null}
        <div className="space-y-2">
          {data?.pages.map((p) => (
            <button key={p.id} onClick={() => void choose(p)} className={cn("flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm hover:bg-ink/[.03]", account.pageId === p.id ? "border-ink" : "border-line")} data-testid="page-option">
              {p.name}
              {account.pageId === p.id ? <Pill tone="green">wybrana</Pill> : null}
            </button>
          ))}
          {data && !data.pages.length ? <p className="text-sm text-muted">Dostawca nie zwrócił żadnych stron — sprawdź uprawnienia konta.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface BrandData {
  brand: {
    description: string;
    audience: string;
    goal: string;
    tone: string;
    website: string;
    products: string;
    usp: string;
    preferredCta: string;
    forbiddenPhrases: string[];
    keywords: string[];
    knowledgeBase: string;
    moderationRules: string;
    autoReplyEnabled: boolean;
    autoReplyCategories: string[];
    autoReplyMaxPerHour: number;
    commentRetentionDays: number;
  };
  docs: Array<{ id: string; name: string; updatedAt: string; size: number }>;
  canEdit: boolean;
}

function Brand({ projectId }: { projectId: string }) {
  const { toast } = useSocial();
  const { data, reload } = useApi<BrandData>(`/api/social/projects/${projectId}/brand`);
  const [form, setForm] = React.useState<BrandData["brand"] | null>(null);
  React.useEffect(() => {
    if (data) setForm(data.brand);
  }, [data]);
  if (!data || !form) return <Loading />;
  const set = <K extends keyof BrandData["brand"]>(k: K, v: BrandData["brand"][K]) => setForm({ ...form, [k]: v });
  const save = async () => {
    try {
      await api(`/api/social/projects/${projectId}/brand`, { method: "PUT", json: form });
      toast("Zapisano ustawienia marki");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const ro = !data.canEdit;
  const text = (k: keyof BrandData["brand"], label: string, hint?: string, rows = 3) => (
    <Field label={label} hint={hint}>
      <Textarea rows={rows} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} disabled={ro} aria-label={label} />
    </Field>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]" data-testid="brand-settings">
      <div className="space-y-4">
        <Panel title="Marka i oferta">
          <div className="grid gap-4 md:grid-cols-2">
            {text("description", "Opis działalności")}
            {text("audience", "Grupa docelowa")}
            {text("goal", "Główny cel komunikacji", "Np. zgłoszenia na konsultację, zapisy do newslettera.")}
            {text("tone", "Ton marki", "Np. spokojny, rzeczowy, bez żargonu.")}
            <Field label="Strona internetowa">
              <Input value={form.website} onChange={(e) => set("website", e.target.value)} disabled={ro} />
            </Field>
            <Field label="Preferowane CTA">
              <Input value={form.preferredCta} onChange={(e) => set("preferredCta", e.target.value)} disabled={ro} />
            </Field>
            {text("products", "Produkty / usługi")}
            {text("usp", "Główne USP")}
            <Field label="Zakazane sformułowania" hint="Jedno w linii — AI nigdy ich nie użyje, a publikacji z nimi nie da się zatwierdzić.">
              <Textarea rows={3} value={form.forbiddenPhrases.join("\n")} onChange={(e) => set("forbiddenPhrases", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} disabled={ro} aria-label="Zakazane sformułowania" />
            </Field>
            <Field label="Słowa kluczowe" hint="Oddzielone przecinkami.">
              <Textarea rows={3} value={form.keywords.join(", ")} onChange={(e) => set("keywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} disabled={ro} aria-label="Słowa kluczowe" />
            </Field>
          </div>
        </Panel>
        <Panel title="Baza wiedzy">
          {text("knowledgeBase", "Fakty o ofercie, które AI może wykorzystać", "Ceny, warunki, odpowiedzi na częste pytania. Jedyne źródło faktów dla AI — czego tu nie ma, tego AI nie napisze.", 8)}
          <KnowledgeDocs projectId={projectId} docs={data.docs} canEdit={data.canEdit} onChange={reload} />
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Moderacja komentarzy">
          {text("moderationRules", "Zasady moderacji", "Np. „na pytania o cenę zawsze zaproś do wiadomości prywatnej”.", 5)}
          <div className="mt-4 space-y-3 rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">Automatyczne odpowiedzi</span>
              <Switch checked={form.autoReplyEnabled} onCheckedChange={(v) => set("autoReplyEnabled", v)} />
            </div>
            <p className="text-[12px] text-muted">Domyślnie wyłączone. Nigdy dla skarg, spraw prawnych i medycznych, danych osobowych, konfliktów ani pytań wymagających weryfikacji — te zawsze trafiają do człowieka.</p>
            {form.autoReplyEnabled ? (
              <>
                {(["positive", "question"] as const).map((c) => (
                  <label key={c} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={form.autoReplyCategories.includes(c)} onChange={(e) => set("autoReplyCategories", e.target.checked ? [...form.autoReplyCategories, c] : form.autoReplyCategories.filter((x) => x !== c))} />
                    {c === "positive" ? "Pozytywne komentarze (podziękowanie)" : "Proste pytania (tylko z bazy wiedzy)"}
                  </label>
                ))}
                <Field label="Limit na godzinę">
                  <Input type="number" min={1} max={30} value={form.autoReplyMaxPerHour} onChange={(e) => set("autoReplyMaxPerHour", Number(e.target.value))} />
                </Field>
              </>
            ) : null}
          </div>
        </Panel>
        <Panel title="Dane">
          <Field label="Przechowywanie komentarzy (dni)" hint="Starsze komentarze są usuwane (RODO).">
            <Input type="number" min={30} max={3650} value={form.commentRetentionDays} onChange={(e) => set("commentRetentionDays", Number(e.target.value))} disabled={ro} />
          </Field>
        </Panel>
        {!ro ? (
          <Button className="w-full" onClick={() => void save()} data-testid="brand-save">
            Zapisz ustawienia marki
          </Button>
        ) : (
          <p className="text-sm text-muted">Tylko do odczytu (Twoja rola nie pozwala na zmiany).</p>
        )}
      </div>
    </div>
  );
}

function KnowledgeDocs({ projectId, docs, canEdit, onChange }: { projectId: string; docs: BrandData["docs"]; canEdit: boolean; onChange: () => Promise<void> }) {
  const { toast } = useSocial();
  const ref = React.useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    if (f.size > 2_000_000) return toast("Plik jest za duży (maks. 2 MB tekstu)", "err");
    try {
      await api(`/api/social/projects/${projectId}/knowledge`, { method: "POST", json: { name: f.name, content: await f.text() } });
      await onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="mt-4">
      <p className="mb-2 text-[12.5px] font-medium text-ink/80">Dokumenty (TXT / MD / CSV)</p>
      <ul className="space-y-1">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-[13px]">
            {d.name} <span className="text-[11.5px] text-muted">{Math.round(d.size / 1000)} tys. znaków</span>
            {canEdit ? (
              <button className="text-muted hover:text-red-600" aria-label="Usuń" onClick={async () => (await api(`/api/social/projects/${projectId}/knowledge?doc=${d.id}`, { method: "DELETE" }), await onChange())}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <>
          <input ref={ref} type="file" accept=".txt,.md,.csv,text/plain,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button size="sm" variant="outline" className="mt-2" onClick={() => ref.current?.click()}>
            <Plus /> Dodaj dokument
          </Button>
        </>
      ) : null}
    </div>
  );
}

function Team({ data, reload }: { data: ProjectData; reload: () => Promise<void> }) {
  const { toast } = useSocial();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrgRole>("APPROVER");
  const [link, setLink] = React.useState<string | null>(null);
  const inviteNow = async () => {
    try {
      const r = await api<{ added: boolean; url: string | null }>(`/api/social/projects/${data.project.id}/members`, { method: "POST", json: { email, role } });
      if (r.added) toast("Dodano osobę do projektu");
      setLink(r.url);
      setEmail("");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Panel title="Osoby z dostępem do tego projektu">
        <p className="mb-3 text-[12.5px] text-muted">Członkowie organizacji widzą wszystkie jej projekty — zarządzasz nimi w Ustawieniach. Tutaj osoby z dostępem tylko do tego projektu (np. klient akceptujący materiały).</p>
        {data.members.length ? (
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 text-sm" data-testid="member-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{m.user.name || m.user.email}</p>
                  <p className="text-[12px] text-muted">{m.user.email}</p>
                </div>
                <NativeSelect className="h-8 w-40 text-xs" value={m.role} onChange={async (e) => (await api(`/api/social/members/${m.id}?scope=project`, { method: "PATCH", json: { role: e.target.value } }), await reload())}>
                  {ORG_ROLES.filter((r) => r !== "OWNER").map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r].name}
                    </option>
                  ))}
                </NativeSelect>
                <button className="text-muted hover:text-red-600" aria-label="Usuń dostęp" onClick={async () => confirm("Odebrać dostęp?") && (await api(`/api/social/members/${m.id}?scope=project`, { method: "DELETE" }), await reload())}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nikt spoza organizacji nie ma dostępu.</p>
        )}
      </Panel>
      <Panel title="Zaproś osobę">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void inviteNow();
          }}
        >
          <Field label="E-mail">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail zapraszanej osoby" />
          </Field>
          <Field label="Rola" hint={ROLE_LABELS[role].hint}>
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OrgRole)} aria-label="Rola">
              {ORG_ROLES.filter((r) => r !== "OWNER").map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r].name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" className="w-full">
            <UserPlus /> Zaproś
          </Button>
        </form>
        {link ? (
          <div className="mt-3 rounded-xl border border-line bg-brand-soft/40 p-3 text-[12.5px]" data-testid="invite-link">
            <p className="font-medium">Link zaproszenia (ważny 14 dni)</p>
            <p className="mt-1 break-all text-muted">{link}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void navigator.clipboard.writeText(link).then(() => toast("Skopiowano"))}>
              <Copy /> Kopiuj
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function Danger({ data }: { data: ProjectData }) {
  const { toast, reloadMe } = useSocial();
  const router = useRouter();
  const [name, setName] = React.useState("");
  return (
    <Panel title="Usuń projekt i wszystkie jego dane">
      <p className="text-sm text-muted">Zaplanowane publikacje zostaną anulowane u dostawcy, profile dostawcy (i autoryzacje kont) usunięte, a pliki, publikacje, komentarze i wyniki — skasowane. Tego nie można cofnąć. Opublikowane posty pozostaną na platformach.</p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label={`Wpisz nazwę projektu: ${data.project.name}`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-72" aria-label="Potwierdź nazwą projektu" />
        </Field>
        <Button
          variant="danger"
          disabled={name !== data.project.name}
          onClick={async () => {
            try {
              await api(`/api/social/projects/${data.project.id}`, { method: "DELETE", json: { confirm: name } });
              await reloadMe();
              router.push("/social/projects");
            } catch (e) {
              toast((e as Error).message, "err");
            }
          }}
        >
          <Trash2 /> Usuń projekt
        </Button>
      </div>
    </Panel>
  );
}
