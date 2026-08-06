// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cierre de sesion.
 *
 * Borrar la cookie no alcanza: el JWT es autocontenido y, si alguien lo copio
 * antes, sigue siendo valido hasta que venza. Por eso ademas se incrementa
 * `sessionVersion` del usuario, lo que invalida en el acto cualquier token
 * emitido antes.
 *
 * Efecto lateral aceptado: cerrar sesion en un equipo la cierra en todos. En
 * un almacen es lo esperable, y ademas es justamente lo que se quiere cuando
 * el motivo del logout es "me parece que alguien uso mi usuario".
 */
export const POST = handler(
  {
    auth: 'public',
    audit: 'POST /api/auth/logout',
  },
  async ({ session }) => {
    if (session) {
      await prisma.user.update({
        where: { id: session.userId },
        data: { sessionVersion: { increment: 1 } },
      })

      await audit(prisma, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'User',
        recordId: session.userId,
        action: 'logout',
        origin: 'POST /api/auth/logout',
      })
    }

    const res = NextResponse.json({ success: true })
    res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0))
    return res
  },
)
