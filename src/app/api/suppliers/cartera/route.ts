// src/app/api/suppliers/cartera/route.ts
import { handler } from '@/server/http/handler'
import { carteraDeProveedores } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cuentas por pagar del negocio: total, vencido y lo que vence esta semana.
 *
 * Es el tablero del objetivo 31. NO lo ve el cajero: exige
 * `supplierAccounts.view`, que el perfil de caja no tiene.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    audit: 'GET /api/suppliers/cartera',
  },
  ({ session }) => carteraDeProveedores(session),
)
