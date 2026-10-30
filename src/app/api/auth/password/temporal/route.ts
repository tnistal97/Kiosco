import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import {
  signSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/server/auth/token'
import { elegirClaveSchema } from '@/modules/users/schemas'
import { elegirClaveDefinitiva } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Salir de una contrasena temporal: la primera pantalla de un empleado.
 *
 * Solo responde a una sesion con la contrasena marcada como temporal: cualquier
 * otra cambia la suya en `POST /api/auth/password`, sabiendo la actual. La
 * cookie se vuelve a firmar por lo mismo que en esa ruta: cambiar la clave no
 * debe echar a la persona del equipo en el que esta parada.
 */
export const POST = handler(
  {
    auth: 'session',
    body: elegirClaveSchema,
    audit: 'POST /api/auth/password/temporal',
    conClaveTemporal: true,
  },
  async ({ session, body }) => {
    const { sessionVersion } = await elegirClaveDefinitiva(session, body)

    const token = await signSessionToken({
      userId: session.userId,
      branchId: session.branchId,
      role: session.role,
      sv: sessionVersion,
    })

    const res = NextResponse.json({ success: true })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS))
    return res
  },
)
