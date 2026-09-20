import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const APP_PATHS = ["/companies", "/c", "/holdings", "/portfolio", "/rules", "/fees", "/about", "/setup"];

export function proxy(request: NextRequest) {
  const hosts = (process.env.APP_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (hosts.length === 0) return NextResponse.next();

  const host = request.headers.get("host")?.split(":")[0] ?? "";
  const { pathname, search } = request.nextUrl;

  if (hosts.includes(host)) {
    if (pathname === "/") return NextResponse.rewrite(new URL("/companies", request.url));
    return NextResponse.next();
  }

  if (APP_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.redirect(new URL(pathname + search, `https://${hosts[0]}`), 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
