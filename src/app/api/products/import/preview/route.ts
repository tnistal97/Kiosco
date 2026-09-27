// src/app/api/products/import/preview/route.ts
import { handler } from '@/server/http/handler'
import { vistaPreviaSchema } from '@/modules/importacion/schemas'
import { previsualizarImportacion } from '@/modules/importacion/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Vista previa de una importacion de productos. No escribe nada. Fase P0-B.
 *
 * Recibe las celdas de las columnas elegidas --nunca el archivo, que se lee en
 * el navegador-- y devuelve fila por fila que pasaria: alta, cambio, nada u
 * omitida, con sus errores y avisos. Los permisos finos (precio, costo, stock,
 * categorias) no se exigen aca sino en el plan: quien no puede cambiar precios
 * igual puede ver la vista previa, y el plan le dice que columna sacar.
 *
 * Cualquiera de los dos permisos alcanza para entrar: `products.create` para
 * dar de alta, `products.update` para actualizar lo que ya existe.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: ['products.create', 'products.update'],
    body: vistaPreviaSchema,
    audit: 'POST /api/products/import/preview',
  },
  ({ session, body }) => previsualizarImportacion(session, body),
)
