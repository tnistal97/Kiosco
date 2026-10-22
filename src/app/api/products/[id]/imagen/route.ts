// src/app/api/products/[id]/imagen/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { invalid } from '@/server/http/errors'
import {
  BYTES_MAXIMOS,
  esVersionVigente,
  guardarImagen,
  leerImagen,
  quitarImagen,
} from '@/modules/products/imagen'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * La foto del producto, tal cual se guardo: WebP.
 *
 * Con la version vigente en la direccion (`?v=`, que es lo que pone el
 * listado) se puede guardar para siempre: otra foto tendria otra direccion.
 * Sin version, o con una vieja, se guarda pero se revalida cada vez.
 *
 * `private`: la sirve la sesion, y un cache compartido no tiene por que
 * guardarla.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products/:id/imagen',
  },
  async ({ req, session, params }) => {
    const foto = await leerImagen(session, parseWith(idSchema, params.id))
    const etag = `"${foto.sha256}"`
    const headers = {
      'Content-Type': foto.mimeType,
      'Cache-Control': esVersionVigente(foto.sha256, req.nextUrl.searchParams.get('v'))
        ? 'private, max-age=31536000, immutable'
        : 'private, no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(Buffer.from(foto.data), { headers })
  },
)

/**
 * Pone o cambia la foto. El cuerpo es la imagen, sin envoltorio: JPG, PNG o
 * WebP de hasta 5 MB. La pantalla la achica antes de mandarla.
 */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'products.update',
    audit: 'PUT /api/products/:id/imagen',
  },
  async ({ req, session, params, origin }) =>
    guardarImagen(session, parseWith(idSchema, params.id), await leerCuerpo(req), origin),
)

export const DELETE = handler(
  {
    auth: 'session',
    permission: 'products.update',
    audit: 'DELETE /api/products/:id/imagen',
  },
  ({ session, params, origin }) => quitarImagen(session, parseWith(idSchema, params.id), origin),
)

/**
 * El cuerpo entero, cortando apenas pasa del maximo.
 *
 * Leido de a pedazos y no con `arrayBuffer()`: un cuerpo sin
 * `Content-Length` --o con uno que miente-- se cargaria entero en memoria
 * antes de poder mirar cuanto pesa.
 */
async function leerCuerpo(req: Request): Promise<Uint8Array> {
  const declarado = Number(req.headers.get('content-length') ?? '0')
  if (declarado > BYTES_MAXIMOS) throw demasiadoGrande()

  const lector = req.body?.getReader()
  if (!lector) return new Uint8Array()

  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > BYTES_MAXIMOS) {
      await lector.cancel()
      throw demasiadoGrande()
    }
    partes.push(value)
  }
  return Buffer.concat(partes)
}

function demasiadoGrande() {
  return invalid('La foto pesa demasiado. Probá con una de menos de 5 MB.')
}
