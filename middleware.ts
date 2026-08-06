// middleware.ts
import { NextResponse, NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

const PUBLIC_PATHS = [
  '/', '/login',
  '/api/auth/login', '/api/auth/logout', '/api/auth/validate',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Permitir assets y rutas públicas
  if (/\.(.*)$/.test(pathname) || PUBLIC_PATHS.some(p => pathname === p)) {
    return NextResponse.next()
  }

  const token = req.cookies.get('token')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number }

    // Si va a /admin y no es admin, devolvemos a /caja
    if (pathname.startsWith('/admin')) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: { select: { name: true } } },
      })
      if (!user || user.role.name !== 'admin') {
        return NextResponse.redirect(new URL('/caja', req.url))
      }
    }

    return NextResponse.next()
  } catch {
    // token inválido → borrar cookie y al login
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.set('token', '', { httpOnly: true, maxAge: 0, path: '/' })
    return res
  }
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}
