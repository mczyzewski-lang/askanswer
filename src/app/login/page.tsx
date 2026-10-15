import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white font-display font-bold">A</div>
          <h1 className="font-display text-2xl font-semibold">AskBy Studio</h1>
          <p className="mt-1 text-sm text-muted">Zaloguj się do panelu administratora</p>
        </div>
        <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin"} />
      </div>
    </main>
  );
}
