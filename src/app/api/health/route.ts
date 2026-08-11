// src/app/api/health/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildInfo } from '@/server/build-info'
import { problemasDeEntorno } from '@/server/env'
import { REQUEST_ID_HEADER, requestIdDe } from '@/server/http/requestId'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Estado del servicio.
 *
 * NO usa el envoltorio `handler`. Tres razones concretas:
 *
 *   1. `handler` resuelve la sesion incluso en las rutas publicas, y eso
 *      consulta la base. El endpoint que sirve para saber si la base responde
 *      no puede depender de que la base responda para llegar a contestar.
 *   2. Necesita elegir el estado HTTP --200 o 503-- y `handler` devuelve 200
 *      salvo que se lance un error.
 *   3. Un monitor lo pega cada treinta segundos. Nada de esto debe escribir.
 *
 * QUE DEVUELVE Y QUE NO
 *
 * Devuelve identidad del binario y salud de la base. NO devuelve la
 * `DATABASE_URL`, ni el host, ni el usuario de la base, ni el secreto, ni
 * rutas del sistema de archivos, ni el texto del error de PostgreSQL. Un
 * endpoint de salud es publico por definicion --lo consulta el monitor, sin
 * credenciales-- y todo lo que conteste hay que darlo por publicado.
 *
 * Por eso `database.error` no existe: si la base no responde, dice `ok:
 * false` y punto. El motivo esta en el log del servidor, junto al mismo
 * `requestId` que viaja en la cabecera de esta respuesta.
 *
 *   200  la aplicacion responde y la base contesta.
 *   503  una dependencia critica esta caida: la base no contesta, o falta una
 *        variable de entorno sin la cual el servicio no puede operar.
 *
 * Que 503 tambien cubra el entorno es deliberado: una aplicacion con
 * `JWT_SECRET` invalido levanta, sirve la pantalla de login, y falla recien
 * al firmar el token. Para el balanceador esta sana; para quien tiene que
 * cobrar, no existe.
 */

/** Tope de espera de la sonda. Mas alla de esto la base esta caida a efectos practicos. */
const TIMEOUT_MS = 2000

export interface HealthBody {
  status: 'ok' | 'degraded'
  version: string
  commit: string
  buildTime: string
  environment: string
  database: {
    ok: boolean
    /** Milisegundos que tardo el SELECT 1. Ausente si no respondio. */
    latencyMs?: number
  }
  /** Nombres --nunca valores-- de las variables mal configuradas. */
  configuracion?: { faltantes: string[] }
}

async function sondearBase(): Promise<{ ok: boolean; latencyMs?: number }> {
  const empezo = performance.now()
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rechazar) =>
        setTimeout(() => {
          rechazar(new Error('timeout'))
        }, TIMEOUT_MS),
      ),
    ])
    return { ok: true, latencyMs: Math.round(performance.now() - empezo) }
  } catch (error) {
    // El detalle va al log del servidor, no a la respuesta: el mensaje de
    // Prisma incluye el host y el usuario de la base.
    console.error('[health] la base no respondio:', error)
    return { ok: false }
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdDe(req)
  const info = buildInfo()
  const database = await sondearBase()
  const faltantes = problemasDeEntorno().map((p) => p.variable)

  const sano = database.ok && faltantes.length === 0

  const cuerpo: HealthBody = {
    status: sano ? 'ok' : 'degraded',
    version: info.version,
    commit: info.commit,
    buildTime: info.buildTime,
    environment: info.environment,
    database,
    ...(faltantes.length > 0 ? { configuracion: { faltantes } } : {}),
  }

  const res = NextResponse.json(cuerpo, { status: sano ? 200 : 503 })
  res.headers.set(REQUEST_ID_HEADER, requestId)
  // Nunca se guarda: una respuesta de salud cacheada miente por definicion.
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  return res
}
