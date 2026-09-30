import { z } from 'zod'
import { handler } from '@/server/http/handler'
import { cierreDelDia } from '@/modules/cash/service.cierre'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  /** `AAAA-MM-DD` en la zona de la sucursal. Sin ella, hoy. */
  fecha: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
    .optional(),
})

/**
 * El cierre del dia: ventas, como se cobraron y la cuenta del cajon, en una
 * sola respuesta y con los numeros del servidor. V1 comercial.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.cash.view',
    query: querySchema,
    audit: 'GET /api/cash/cierre',
  },
  ({ session, query }) => cierreDelDia(session, query),
)
