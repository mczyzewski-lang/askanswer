import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  no_account: "To konto Google nie ma dostępu do AskBy Studio. Poproś administratora o dodanie Twojego adresu e-mail.",
  google_config: "Logowanie przez Google nie jest jeszcze skonfigurowane (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  google_failed: "Google nie potwierdził logowania — spróbuj ponownie.",
  google_state: "Sesja logowania wygasła — spróbuj ponownie.",
  google_cancelled: "Logowanie przez Google zostało przerwane.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white font-display font-bold">A</div>
          <h1 className="font-display text-2xl font-semibold">AskBy Studio</h1>
          <p className="mt-1 text-sm text-muted">Zaloguj się do AskBy Studio i Social Media Studio</p>
        </div>
        <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin"} googleError={error ? (ERRORS[error] ?? "Nie udało się zalogować.") : null} />
      </div>
    </main>
  );
}
