import { NextResponse, type NextRequest } from 'next/server'

// ── Maintenance mode ─────────────────────────────────────────────
// Shows a minimal "something's brewing" splash on the PUBLIC site while
// the rebuild ships. /admin, /api, and /auth stay open so we can keep
// operating. Toggle:
//   MAINTENANCE_MODE=true  → on  (any environment)
//   MAINTENANCE_MODE=false → off (kill switch, even in prod — no revert)
//   unset                  → on in production, off in local dev
const MAINTENANCE_MODE =
  process.env.MAINTENANCE_MODE === 'true' ||
  (process.env.MAINTENANCE_MODE !== 'false' && process.env.NODE_ENV === 'production')

// Paths that bypass the splash (still reachable during maintenance).
function isOpenDuringMaintenance(pathname: string): boolean {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/auth')
  )
}

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Something's brewing — nomi</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #09090b;
    color: #fafafa;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
  }
  .wrap { max-width: 30rem; }
  .dot {
    width: 10px; height: 10px; border-radius: 9999px;
    background: #f97316; display: inline-block; margin-bottom: 28px;
    box-shadow: 0 0 0 0 rgba(249,115,22,0.6);
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(249,115,22,0.5); }
    70%  { box-shadow: 0 0 0 16px rgba(249,115,22,0); }
    100% { box-shadow: 0 0 0 0 rgba(249,115,22,0); }
  }
  h1 { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 14px; }
  p { color: #a1a1aa; font-size: 1.05rem; line-height: 1.6; }
  .mark { margin-top: 36px; font-size: 0.8rem; letter-spacing: 0.18em; text-transform: uppercase; color: #52525b; }
</style>
</head>
<body>
  <div class="wrap">
    <span class="dot"></span>
    <h1>Something's brewing.</h1>
    <p>We're building something new. Check back soon.</p>
    <div class="mark">nomi market</div>
  </div>
</body>
</html>`

export function middleware(request: NextRequest) {
  if (MAINTENANCE_MODE && !isOpenDuringMaintenance(request.nextUrl.pathname)) {
    return new NextResponse(MAINTENANCE_HTML, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '3600',
      },
    })
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
