"use client";
import * as React from "react";
import { Copy, Database, Trash2, UserPlus } from "lucide-react";
import { Button, Input, NativeSelect } from "@/components/ui";
import { api } from "@/lib/utils";
import { ORG_ROLES, ROLE_LABELS, type OrgRole } from "@/lib/social/rbac";
import { useSocial } from "./shell";
import { DemoBadge, ErrorBox, Field, Loading, PageHeader, Panel, Pill, useApi } from "./ui";

interface SettingsData {
  staff: boolean;
  uploadPost: { live: boolean; keySet: boolean; forcedDemo: boolean; baseUrl?: string };
  webhook?: { url: string; secretSet: boolean; tokenSet: boolean; signatureHeader: string; timestampHeader: string; deliveryHeader: string; sendExternalId: boolean };
  ai: { openai: boolean; model: string; rulesVersion: string };
  transcription: boolean;
  demoLoaded: boolean;
  email: { enabled: boolean };
}
interface OrgData {
  id: string;
  name: string;
  role: OrgRole;
  permissions: string[];
  members: Array<{ id: string; role: OrgRole; user: { id: string; email: string; name: string } }>;
  projects: Array<{ id: string; name: string }>;
  invites: Array<{ id: string; email: string; role: OrgRole; expiresAt: string }>;
}

export function Settings() {
  const { me, toast, reloadMe } = useSocial();
  const { data, error } = useApi<SettingsData>("/api/social/settings");
  const [orgId, setOrgId] = React.useState(me.organizations[0]?.id ?? "");
  const [seeding, setSeeding] = React.useState(false);
  return (
    <>
      <PageHeader title="Ustawienia" subtitle="Zespół i role, integracje, tryb DEMO." />
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {me.organizations.length ? (
            <Panel
              title="Zespół organizacji"
              actions={
                me.organizations.length > 1 ? (
                  <NativeSelect className="h-8 w-56 text-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organizacja">
                    {me.organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : undefined
              }
            >
              {orgId ? <OrgTeam orgId={orgId} /> : null}
            </Panel>
          ) : (
            <Panel title="Zespół">
              <p className="text-sm text-muted">Masz dostęp do pojedynczych projektów — zespołem zarządza właściciel organizacji.</p>
            </Panel>
          )}
          <Panel title="Role">
            <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
              {ORG_ROLES.map((r) => (
                <div key={r} className="rounded-xl border border-line p-3">
                  <dt className="font-medium">{ROLE_LABELS[r].name}</dt>
                  <dd className="text-muted">{ROLE_LABELS[r].hint}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
        <div className="space-y-6">
          {!data ? (
            <Loading />
          ) : (
            <>
              <Panel title="Integracje">
                <ul className="space-y-2 text-[13px]" data-testid="integrations">
                  <li className="flex items-center justify-between gap-2">
                    Upload-Post {data.uploadPost.live ? <Pill tone="green">połączone (na żywo)</Pill> : <span className="flex items-center gap-1"><DemoBadge /> {data.uploadPost.forcedDemo ? "wymuszony" : "brak klucza"}</span>}
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    AI (OpenAI) {data.ai.openai ? <Pill tone="green">{data.ai.model}</Pill> : <Pill tone="red">brak klucza</Pill>}
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    Transkrypcja (ElevenLabs) {data.transcription ? <Pill tone="green">tak</Pill> : <Pill>brak klucza</Pill>}
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    Powiadomienia e-mail <Pill>wkrótce (teraz w aplikacji)</Pill>
                  </li>
                  <li className="text-[12px] text-muted">Reguły platform: wersja {data.ai.rulesVersion}. Klucze API są tylko po stronie serwera (Railway → Variables).</li>
                </ul>
              </Panel>
              {data.webhook ? (
                <Panel title="Webhook Upload-Post">
                  <div className="space-y-2 text-[12.5px]">
                    <p>Adres do wpisania w panelu Upload-Post (Notifications → Webhook):</p>
                    <p className="break-all rounded-lg bg-ink/[.04] p-2 font-mono text-[12px]">{data.webhook.url}</p>
                    <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(data.webhook!.url).then(() => toast("Skopiowano"))}>
                      <Copy /> Kopiuj
                    </Button>
                    <p>
                      Podpis HMAC: {data.webhook.secretSet ? <Pill tone="green">sekret ustawiony</Pill> : <Pill tone="amber">brak UPLOAD_POST_WEBHOOK_SECRET</Pill>} Token w adresie: {data.webhook.tokenSet ? <Pill tone="green">ustawiony</Pill> : <Pill>brak</Pill>}
                    </p>
                    <p className="text-muted">
                      Nagłówki: podpis <code>{data.webhook.signatureHeader}</code>, czas <code>{data.webhook.timestampHeader}</code>, id dostarczenia <code>{data.webhook.deliveryHeader}</code>. Zdarzenia: upload_completed, social_account_connected, social_account_disconnected, social_account_reauth_required, comment_received.
                    </p>
                    {!data.webhook.secretSet && !data.webhook.tokenSet ? <ErrorBox error="Webhook jest wyłączony, dopóki nie ustawisz sekretu albo tokenu. Bez niego stan publikacji i tak uzgadnia co kilka minut zadanie rekonsyliacji." /> : null}
                  </div>
                </Panel>
              ) : null}
              {data.staff ? (
                <Panel title="Dane DEMO">
                  <p className="text-[12.5px] text-muted">Organizacja „AV Holding (DEMO)” z projektami Nowy Etap, Risify i Pravna: konta, filmy, publikacje, wyniki i komentarze — wszystko oznaczone DEMO, nic nie trafia do prawdziwych kont.</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={data.demoLoaded || seeding}
                    onClick={async () => {
                      setSeeding(true);
                      try {
                        await api("/api/social/demo", { method: "POST" });
                        toast("Wczytano dane DEMO");
                        await reloadMe();
                      } catch (e) {
                        toast((e as Error).message, "err");
                      } finally {
                        setSeeding(false);
                      }
                    }}
                    data-testid="load-demo"
                  >
                    <Database /> {data.demoLoaded ? "Dane DEMO są wczytane" : seeding ? "Wczytuję…" : "Wczytaj dane DEMO"}
                  </Button>
                </Panel>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function OrgTeam({ orgId }: { orgId: string }) {
  const { toast } = useSocial();
  const { data, error, reload } = useApi<OrgData>(`/api/social/orgs/${orgId}`, [orgId]);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<OrgRole>("EDITOR");
  const [link, setLink] = React.useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const canManage = data.permissions.includes("members.manage");
  return (
    <div className="space-y-4" data-testid="org-team">
      <ul className="divide-y divide-line">
        {data.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.user.name || m.user.email}</p>
              <p className="text-[12px] text-muted">{m.user.email}</p>
            </div>
            {canManage ? (
              <>
                <NativeSelect className="h-8 w-40 text-xs" value={m.role} onChange={async (e) => { try { await api(`/api/social/members/${m.id}?scope=org`, { method: "PATCH", json: { role: e.target.value } }); await reload(); } catch (err) { toast((err as Error).message, "err"); } }} aria-label="Rola">
                  {ORG_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r].name}
                    </option>
                  ))}
                </NativeSelect>
                <button className="text-muted hover:text-red-600" aria-label="Usuń z organizacji" onClick={async () => { if (!confirm("Usunąć z organizacji?")) return; try { await api(`/api/social/members/${m.id}?scope=org`, { method: "DELETE" }); await reload(); } catch (err) { toast((err as Error).message, "err"); } }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Pill>{ROLE_LABELS[m.role].name}</Pill>
            )}
          </li>
        ))}
      </ul>
      {data.invites.length ? (
        <div className="text-[12.5px] text-muted">
          Oczekujące zaproszenia:{" "}
          {data.invites.map((i) => `${i.email} (${ROLE_LABELS[i.role].name})`).join(", ")}
        </div>
      ) : null}
      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api<{ added: boolean; url: string | null }>(`/api/social/orgs/${orgId}/members`, { method: "POST", json: { email, role } });
              setLink(r.url);
              if (r.added) toast("Dodano do organizacji");
              setEmail("");
              await reload();
            } catch (err) {
              toast((err as Error).message, "err");
            }
          }}
        >
          <Field label="E-mail">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-64" aria-label="E-mail" />
          </Field>
          <Field label="Rola">
            <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className="w-44" aria-label="Rola zapraszanej osoby">
              {ORG_ROLES.filter((r) => r !== "OWNER" || data.role === "OWNER").map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r].name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit">
            <UserPlus /> Zaproś do organizacji
          </Button>
        </form>
      ) : null}
      {link ? (
        <div className="rounded-xl border border-line bg-brand-soft/40 p-3 text-[12.5px]" data-testid="invite-link">
          <p className="font-medium">Link zaproszenia (ważny 14 dni) — wyślij go tej osobie</p>
          <p className="mt-1 break-all text-muted">{link}</p>
        </div>
      ) : null}
    </div>
  );
}
