import { NextResponse, type NextRequest } from "next/server";
import { looksLikeToken, SESSION_COOKIE } from "@/lib/auth";

// Next 16: `middleware` is now `proxy`. This only sends people without a session cookie to the
// sign-in page early; every page and route checks the session in the database itself (lib/session).
const PUBLIC = [
  /^\/(login|signup|claim|reset|forgot)$/,
  /^\/api\/(login|signup|claim|reset)$/,
  /^\/i\//,
  /^\/api\/cron\//,
  /^\/brand\//,
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();
  if (looksLikeToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)"],
};
