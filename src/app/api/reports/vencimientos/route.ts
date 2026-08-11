// src/app/api/reports/vencimientos/route.ts
import { handler } from '@/server/http/handler'
import { reporteDeVencimientos } from '@/modules/reports/service.lots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El reporte de vencimientos: los tramos, su valor y el detalle.
 *
 * DISTINTO de `/api/reportes/vencimientos`, que son los cuatro numeros del
 * tablero. Este trae el desglose por partida y la valorizacion, que es lo que
 * se mira sentado y no de paso.
 *
 * `lots.view` por lo mismo que el tablero: quien mira los lotes tiene que poder
 * ver que se le vence. El VALOR, en cambio, solo con `reports.costs.view`, y va
 * etiquetado como "a costo actual": lo que vence la semana que viene todavia se
 * puede vender, y presentarlo como perdida realizada seria mentir.
 */
export const GET = handler(
  { auth: 'session', permission: 'lots.view', audit: 'GET /api/reports/vencimientos' },
  ({ session }) => reporteDeVencimientos(session),
)
