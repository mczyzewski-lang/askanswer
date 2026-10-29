"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { api } from "@/lib/utils";

/** accept an invitation to Social Media Studio: set name + password, then go in */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = React.useState<{ email: string; name: string; role: string; where: string; kind: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    api<typeof info>(`/api/invite/${token}`)
      .then((r) => {
        setInfo(r);
        setName(r?.name ?? "");
      })
      .catch((e) => setError((e as Error).message));
  }, [token]);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink font-display font-bold text-white">S</div>
          <h1 className="font-display text-2xl font-semibold">Social Media Studio</h1>
        </div>
        <Card className="p-6">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!info && !error ? <p className="text-sm text-muted">Wczytuję…</p> : null}
          {info ? (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await api(`/api/invite/${token}`, { method: "POST", json: { name, password } });
                  window.location.href = "/social";
                } catch (err) {
                  setError((err as Error).message);
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm">
                Zaproszenie do {info.kind === "project" ? "projektu" : "organizacji"} <b>{info.where}</b> dla <b>{info.email}</b>.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="name">Imię i nazwisko</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Hasło (min. 10 znaków)</Label>
                <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Zakładam konto…" : "Załóż konto i wejdź"}
              </Button>
            </form>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
