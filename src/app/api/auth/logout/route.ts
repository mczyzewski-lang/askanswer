import { SESSION_COOKIE } from "@/lib/server/session-token";

export async function POST() {
  // relative redirect: behind a reverse proxy req.url contains the internal host
  return new Response(null, {
    status: 303,
    headers: { location: "/login", "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  });
}
