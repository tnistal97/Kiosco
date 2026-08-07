// src/app/api/products/barcode/[code]/route.ts
import { handler } from '@/server/http/handler'
import { notFound } from '@/server/http/errors'
import { buscarPorCodigoExacto } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Un producto por su codigo de barras EXACTO. La consulta del lector.
 *
 * Existe aparte de `GET /api/products?q=` por rendimiento. Aquella hace un
 * recorrido con `ILIKE '%...%'` sobre todos los codigos y devuelve hasta veinte
 * candidatos que el navegador despues descarta; esta es un acierto directo
 * sobre el indice unico de `ProductBarcode.code`: una fila leida, cualquiera
 * sea el tamano del catalogo.
 *
 * Encuentra por el codigo principal y por cualquier alternativo, con
 * comportamiento identico. Para quien pasa el lector no hay diferencia entre
 * los dos, y no deberia haberla.
 *
 * `?estado=todos` incluye los dados de baja. Por omision solo activos: un
 * producto fuera de venta no se vende, y confiar en el valor por omision del
 * servidor era lo que hacia que la caja pudiera venderlo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products/barcode/:code',
  },
  async ({ session, req, params }) => {
    const soloActivos = new URL(req.url).searchParams.get('estado') !== 'todos'
    const producto = await buscarPorCodigoExacto(session, params.code ?? '', { soloActivos })
    if (!producto) throw notFound('No hay ningun producto con ese codigo')
    return producto
  },
)
