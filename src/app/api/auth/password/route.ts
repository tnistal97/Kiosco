import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { origenDe } from '@/server/auth/loginAttempts'
import {
  signSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/server/auth/token'
import { cambiarMiClaveSchema } from '@/modules/users/schemas'
import { cambiarMiClave } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cambio de la contrasena propia.
 *
 * Cualquier usuario con sesion puede cambiar la SUYA: no hace falta ningun
 * permiso, pero si la clave actual. El cambio cierra todas las demas sesiones
 * de la persona (`sessionVersion`), y esta respuesta vuelve a firmar la cookie
 * de la sesion desde la que se cambio, para no echarla del equipo en el que
 * esta parada.
 *
 * La respuesta no lleva nada del usuario: ni la clave, ni el hash, ni el token
 * en el cuerpo.
 */
export const POST = handler(
  {
    auth: 'session',
    body: cambiarMiClaveSchema,
    audit: 'POST /api/auth/password',
    // Es justamente la ruta para dejar de tener una contrasena temporal.
    conClaveTemporal: true,
  },
  async ({ req, session, body }) => {
    const { sessionVersion } = await cambiarMiClave(session, body, origenDe(req))

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
