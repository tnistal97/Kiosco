// src/app/api/reportes/vencimientos/route.ts
import { handler } from '@/server/http/handler'
import { resumenDeVencimientos } from '@/modules/lots/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El tablero de vencimientos de la sucursal.
 *
 * `lots.view` y no `reports.inventory.view`: son cuatro numeros operativos --que
 * hay que sacar de la gondola hoy-- y no un informe de gestion. Quien mira los
 * lotes tiene que poder verlos sin pedir el permiso de reportes.
 */
export const GET = handler(
  { auth: 'session', permission: 'lots.view', audit: 'GET /api/reportes/vencimientos' },
  ({ session }) => resumenDeVencimientos(session),
)
