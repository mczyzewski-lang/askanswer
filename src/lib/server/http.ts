import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./errors";

/** JSON response; BigInt values (file sizes over 2 GB) are sent as plain numbers. */
export function json(data: unknown, init?: number | ResponseInit) {
  const opts = typeof init === "number" ? { status: init } : init;
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  return new NextResponse(body, { ...opts, headers: { "content-type": "application/json", ...(opts?.headers as Record<string, string> | undefined) } });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) return json({ error: "Nieprawidłowe dane", issues: e.issues }, 400);
  console.error(e);
  return json({ error: "Wewnętrzny błąd serwera" }, 500);
}

/** Wrap a route handler with uniform error handling. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
