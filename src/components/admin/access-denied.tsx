import Link from "next/link";

export function AccessDenied({ reason }: { reason: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center" data-testid="access-denied">
      <p className="font-display text-xl font-semibold">Brak dostępu</p>
      <p className="mt-2 text-sm text-muted">{reason}. Jeśli potrzebujesz dostępu, poproś administratora.</p>
      <Link href="/admin" className="mt-4 inline-block text-sm underline">
        Wróć do projektów
      </Link>
    </div>
  );
}
