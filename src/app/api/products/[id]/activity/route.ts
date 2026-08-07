// src/app/api/products/[id]/activity/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { actividadReciente } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ultimos cambios de precio, de costo y de stock de un producto.
 *
 * Es un resumen para la ficha, no una auditoria: devuelve una lista corta y no
 * pagina. La bitacora completa vive en `GET /api/audit`, con sus filtros y su
 * propio permiso.
 *
 * Los cambios de COSTO solo salen para quien tenga `products.cost.view`; de
 * eso se ocupa el servicio, no esta ruta.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products/:id/activity',
  },
  ({ session, params }) => actividadReciente(session, parseWith(idSchema, params.id)),
)
