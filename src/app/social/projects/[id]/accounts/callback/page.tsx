"use client";
import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/utils";
import { Loading, ErrorBox } from "@/components/social/ui";

/** back from the provider's connect page: read the accounts and go to the project's accounts tab */
export default function Callback() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const once = React.useRef(false);
  React.useEffect(() => {
    if (once.current) return;
    once.current = true;
    api(`/api/social/projects/${id}/accounts/sync`, { method: "POST", json: { profileId: search.get("profile") } })
      .then(() => router.replace(`/social/projects/${id}?tab=accounts`))
      .catch((e) => setError((e as Error).message));
  }, [id, search, router]);
  return error ? <ErrorBox error={`Nie udało się odczytać połączonych kont: ${error}`} /> : <Loading label="Synchronizuję połączone konta…" />;
}
