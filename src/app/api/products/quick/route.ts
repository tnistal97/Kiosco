// src/app/api/products/quick/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearProductoRapidoSchema } from '@/modules/products/schemas'
import { crearProductoRapido } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Alta RAPIDA de un producto, desde la caja. Fase 5A.1.
 *
 * Existe aparte de `POST /api/products` por dos motivos, y ninguno es estetico:
 *
 *   1. **Permiso propio.** `products.quickCreate` es mas chico que
 *      `products.create` --seis campos, sin costo ni proveedor ni codigos
 *      alternativos-- y por eso se le puede dar al supervisor de turno sin
 *      darle el catalogo entero. Si esto colgara del mismo permiso, el permiso
 *      nuevo no significaria nada.
 *
 *   2. **Contrato mas chico.** El mostrador no tiene por que conocer la forma
 *      completa de un producto --once campos, cuatro de ellos con su propio
 *      permiso-- para dar de alta lo que acaba de pasar por el lector.
 *
 * Lo que NO se duplica son las reglas: el servicio traduce la entrada minima a
 * un alta normal y entra por el mismo cuerpo que el formulario largo, con la
 * misma transaccion, el mismo movimiento `INITIAL` y la misma bitacora. Lo unico
 * que cambia es el `origin`, que es como despues se cuenta cuantos productos
 * hubo que crear en el mostrador.
 *
 * Ver docs/POS_QUICK_PRODUCT_CREATE.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'products.quickCreate',
    body: crearProductoRapidoSchema,
    audit: 'POST /api/products/quick',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearProductoRapido(session, body), { status: 201 }),
)
