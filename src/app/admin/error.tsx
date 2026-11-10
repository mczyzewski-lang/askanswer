"use client";
import { useEffect } from "react";

/** an error inside an admin page: show what broke (for a screenshot) instead of a blank page */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const chunk = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${error.name} ${error.message}`);
  return (
    <div className="mx-auto max-w-3xl p-6" data-testid="admin-error">
      <h1 className="text-lg font-semibold">Coś poszło nie tak na tej stronie</h1>
      {chunk ? (
        <p className="mt-2 text-sm">Aplikacja została właśnie zaktualizowana — odśwież stronę.</p>
      ) : (
        <p className="mt-2 text-sm text-neutral-600">Zrób zrzut ekranu tego komunikatu — pozwoli szybko znaleźć przyczynę.</p>
      )}
      <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-800">
        {`${error.name}: ${error.message}${error.digest ? `\ndigest: ${error.digest}` : ""}\n\n${(error.stack ?? "").split("\n").slice(0, 8).join("\n")}`}
      </pre>
      <div className="mt-4 flex gap-2">
        <button type="button" className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white" onClick={() => reset()}>
          Spróbuj ponownie
        </button>
        <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => location.reload()}>
          Odśwież stronę
        </button>
      </div>
    </div>
  );
}
