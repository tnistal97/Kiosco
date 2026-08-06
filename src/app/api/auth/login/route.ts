// src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server'
import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { rateLimited, unauthenticated } from '@/server/http/errors'
import {
  signSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from '@/server/auth/token'
import {
  estaBloqueado,
  origenDe,
  registrarExito,
  registrarFallo,
} from '@/server/auth/loginAttempts'
import { loginSchema } from '@/modules/auth/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mensaje unico para todos los fallos de autenticacion.
 *
 * No distingue entre "el usuario no existe", "la contrasena es incorrecta" y
 * "el usuario esta dado de baja". Si distinguiera, cualquiera podria averiguar
 * que nombres de usuario son validos probandolos uno por uno.
 */
const ERROR_GENERICO = 'Usuario o contrasena incorrectos'

export const POST = handler(
  {
    auth: 'public',
    body: loginSchema,
    audit: 'POST /api/auth/login',
  },
  async ({ req, body }) => {
    const origen = origenDe(req)

    if (estaBloqueado(body.username, origen)) {
      throw rateLimited('Demasiados intentos fallidos. Espere 15 minutos.')
    }

    const user = await prisma.user.findUnique({
      where: { username: body.username },
      select: {
        id: true,
        password: true,
        branchId: true,
        isActive: true,
        sessionVersion: true,
        role: { select: { name: true } },
      },
    })

    // Se compara siempre contra un hash, exista o no el usuario, para que el
    // tiempo de respuesta no delate cuales existen.
    const hashDeReferencia = '$2b$12$0000000000000000000000000000000000000000000000000000'
    const claveOk = await bcrypt.compare(body.password, user?.password ?? hashDeReferencia)

    if (!user || !claveOk || !user.isActive) {
      registrarFallo(body.username, origen)

      // El intento fallido se registra solo si el usuario existe: para uno
      // inexistente no hay a quien asociarlo, y AuditLog.userId es obligatorio.
      if (user) {
        await audit(prisma, {
          userId: user.id,
          table: 'User',
          recordId: user.id,
          action: 'login_failed',
          after: { origen, motivo: !claveOk ? 'contrasena' : 'usuario inactivo' },
          origin: 'POST /api/auth/login',
        })
      }

      throw unauthenticated(ERROR_GENERICO)
    }

    registrarExito(body.username, origen)

    const token = await signSessionToken({
      userId: user.id,
      branchId: user.branchId,
      role: user.role.name,
      sv: user.sessionVersion,
    })

    await audit(prisma, {
      userId: user.id,
      table: 'User',
      recordId: user.id,
      action: 'login',
      after: { origen },
      origin: 'POST /api/auth/login',
    })

    // El cuerpo no lleva datos del usuario: la aplicacion los pide a
    // /api/auth/validate, que si verifica la sesion.
    const res = NextResponse.json({ success: true })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS))
    return res
  },
)
