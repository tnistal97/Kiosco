// /app/api/auth/logout/route.ts  (o en pages/api/auth/logout.js si usas páginas)
import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ success: true })
  // Para “borrar” la cookie, se envía con maxAge=0 o expires en pasado
  res.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0
  })
  return res
}
