import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const AGENT_SECRET = process.env.NEXTAUTH_SECRET ?? 'vochus-easy-save-secret-dev-2026'
const ADMIN_SECRET = process.env.NEXTAUTH_SECRET ?? 'vochus-easy-save-secret-dev-2026'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/api/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/superadmin/') ||
    pathname === '/api/superadmin'
  ) {
    const token = await getToken({
      req: request,
      secret: ADMIN_SECRET,
      cookieName: 'next-admin-auth.session-token',
    })
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((token as any).role !== 'superadmin')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.next()
  }

  if (pathname.startsWith('/superadmin')) {
    if (pathname.startsWith('/superadmin/login')) {
      return NextResponse.next()
    }

    const token = await getToken({
      req: request,
      secret: ADMIN_SECRET,
      cookieName: 'next-admin-auth.session-token',
    })

    if (!token || (token as any).role !== 'superadmin') {
      return NextResponse.redirect(new URL('/superadmin/login', request.url))
    }

    return NextResponse.next()
  }

  if (pathname.startsWith('/dashboard')) {
    const token = await getToken({
      req: request,
      secret: AGENT_SECRET,
    })

    if (!token) {
      return NextResponse.redirect(new URL('/', request.url))
    }

    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/superadmin/:path*', '/api/admin/:path*', '/api/superadmin/:path*'],
}
