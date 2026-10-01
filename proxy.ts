import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

// Next 16: `middleware` is now `proxy`. Everything needs the owner's session except the sign-in
// page, the customer's invoice link (/i/…) and the reminder cron (which checks its own secret).
const PUBLIC = [/^\/login$/, /^\/api\/login$/, /^\/i\//, /^\/api\/cron\//];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();
  if (await validSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "signed_out" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
