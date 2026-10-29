import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session-token";

// Admin area + admin APIs require a staff session; Social Media Studio (/social, /api/social) any
// session — its endpoints check the person's role in the organization / project themselves.
// Expert recording routes (/record, /api/record) are authorised by invitation token, the provider
// webhook (/api/hooks) by its signature, and media by signed URLs.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const staffArea = pathname.startsWith("/admin") || pathname.startsWith("/studio") || pathname.startsWith("/api/admin");
  if (session) {
    if (staffArea && session.role === "MEMBER") {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Brak dostępu" }, { status: 403 });
      const url = req.nextUrl.clone();
      url.pathname = "/social";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Wymagane logowanie" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/studio/:path*", "/api/admin/:path*", "/social/:path*", "/api/social/:path*"],
};
