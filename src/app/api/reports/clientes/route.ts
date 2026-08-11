// src/app/api/reports/clientes/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeClientes } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cartera de clientes y movimiento de cuenta corriente del rango.
 *
 * Separa a proposito la FOTO de la PELICULA: los saldos son el estado de hoy
 * --un saldo es un acumulado y no tiene fecha-- y lo que se fio, se cobro y se
 * ajusto es lo que ocurrio dentro del rango. Mezclarlos haria pensar que toda
 * la deuda se genero en esos dias.
 *
 * Y no llama ganancia a lo que falta cobrar: la venta fiada ya figura en el
 * reporte de ventas como facturacion. Lo que este agrega es cuanto de eso
 * todavia no entro.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.clients.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/clientes',
  },
  ({ session, query }) => reporteDeClientes(session, query),
)
