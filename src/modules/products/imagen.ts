/**
 * Fotos de productos. Ver docs/PRODUCT_IMAGES.md.
 *
 * Toda foto entra por `prepararImagen`, venga de la ficha o del guion que las
 * busca en internet: se vuelve a codificar como una miniatura WebP de 480 px.
 * Lo que se guarda nunca es el archivo que llego --que puede pesar 5 MB, traer
 * la ubicacion del telefono en los metadatos o no ser una imagen--, sino lo
 * que salio de decodificarlo y dibujarlo de nuevo.
 *
 * `sharp` se carga recien cuando hace falta: este modulo lo importa el
 * servicio de productos, que usan la caja y el lector, y ninguno de los dos
 * tiene por que pagar la carga de una biblioteca nativa que no usa.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { audit, type DbClient } from '@/server/audit/audit'
import { invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'

/** Lado mayor de la miniatura. La ficha la muestra a 160 px; sobra para pantallas densas. */
export const LADO_MAXIMO = 480

/** Lo maximo que se acepta recibir. La pantalla achica la foto antes de mandarla. */
export const BYTES_MAXIMOS = 5 * 1024 * 1024

/** Una foto de 8000 x 6000 ya es mas de lo que trae cualquier telefono. */
const PIXELES_MAXIMOS = 50_000_000

/** Lo que `sharp` sabe leer y tiene sentido como foto de un producto. SVG no. */
const FORMATOS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif'])

export interface ImagenPreparada {
  data: Buffer
  width: number
  height: number
  sha256: string
}

/**
 * Decodifica, recorta el margen liso y achica.
 *
 * El recorte es para las fotos de catalogo, que suelen traer el producto
 * chiquito en el medio de un lienzo blanco de 1000 px: a 48 px de ancho, en el
 * listado, solo se veria el blanco. En una foto sacada con el telefono no hay
 * margen liso y no recorta nada.
 */
export async function prepararImagen(entrada: Uint8Array): Promise<ImagenPreparada> {
  if (entrada.byteLength === 0) throw invalid('Falta la foto.')
  if (entrada.byteLength > BYTES_MAXIMOS) {
    throw invalid('La foto pesa demasiado. Probá con una de menos de 5 MB.')
  }

  const { default: sharp } = await import('sharp')
  const abrir = () => sharp(entrada, { limitInputPixels: PIXELES_MAXIMOS, failOn: 'error' })

  let formato: string
  try {
    formato = (await abrir().metadata()).format
  } catch {
    throw invalid('El archivo no es una imagen que se pueda abrir.')
  }
  if (!FORMATOS.has(formato)) {
    throw invalid('La foto tiene que ser JPG, PNG o WebP.')
  }

  const codificar = (recortar: boolean) => {
    // `rotate()` sin argumentos endereza segun la orientacion EXIF: la foto
    // sacada con el telefono acostado no queda de costado.
    let tubo = abrir().rotate()
    if (recortar) tubo = tubo.trim({ threshold: 12 })
    return tubo
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
  }

  let salida: Awaited<ReturnType<typeof codificar>>
  try {
    salida = await codificar(true)
  } catch {
    // Una imagen toda del mismo color no tiene que recortar: `trim` falla, y
    // se guarda entera.
    try {
      salida = await codificar(false)
    } catch {
      throw invalid('El archivo no es una imagen que se pueda abrir.')
    }
  }

  return {
    data: salida.data,
    width: salida.info.width,
    height: salida.info.height,
    sha256: createHash('sha256').update(salida.data).digest('hex'),
  }
}

/**
 * Direccion de la foto, con su version.
 *
 * La version es el principio de la huella: otra foto es otra direccion, y el
 * navegador puede guardar cada una para siempre sin mostrar nunca una vieja.
 */
export function direccionDeImagen(productId: number, sha256: string): string {
  return `/api/products/${String(productId)}/imagen?v=${sha256.slice(0, 16)}`
}

/** Si `v` es la version vigente de esta huella. Solo entonces se puede guardar para siempre. */
export function esVersionVigente(sha256: string, v: string | null): boolean {
  return v !== null && v.length === 16 && sha256.startsWith(v)
}

export interface CambioDeImagen {
  productId: number
  branchId: number
  userId: number
  imagen: ImagenPreparada
  /** Pagina de donde salio, si salio de internet. */
  sourceUrl: string | null
  origin: string
}

/**
 * Guarda la foto de un producto, reemplazando la que tuviera.
 *
 * No escribe nada --ni la bitacora-- si es la misma foto con el mismo origen:
 * es lo que permite volver a correr el guion de carga sin llenar la bitacora
 * de cambios que no cambiaron nada.
 */
export async function guardarImagenEn(db: DbClient, cambio: CambioDeImagen): Promise<boolean> {
  const { productId, imagen } = cambio
  const antes = await db.productImage.findUnique({
    where: { productId },
    select: { sha256: true, sourceUrl: true },
  })
  if (antes?.sha256 === imagen.sha256 && antes.sourceUrl === cambio.sourceUrl) return false

  const datos = {
    mimeType: 'image/webp',
    data: new Uint8Array(imagen.data),
    width: imagen.width,
    height: imagen.height,
    sha256: imagen.sha256,
    sourceUrl: cambio.sourceUrl,
  }
  await db.productImage.upsert({
    where: { productId },
    create: { productId, ...datos },
    update: datos,
  })

  // En la bitacora, la huella y el origen: los bytes no dicen nada a quien la
  // lee, y la huella alcanza para saber si dos fotos son la misma.
  await audit(db, {
    userId: cambio.userId,
    branchId: cambio.branchId,
    table: 'ProductImage',
    recordId: productId,
    action: antes ? 'update' : 'create',
    before: antes ?? undefined,
    after: {
      sha256: imagen.sha256,
      sourceUrl: cambio.sourceUrl,
      width: imagen.width,
      height: imagen.height,
    },
    origin: cambio.origin,
  })
  return true
}

/** El producto, si es de la sucursal de la sesion. 404 si no: no se confirma que exista en otra. */
async function exigirProductoDeLaSucursal(session: Session, productId: number): Promise<void> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: { id: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
}

/** La foto que sube alguien desde la ficha del producto. */
export async function guardarImagen(
  session: Session,
  productId: number,
  entrada: Uint8Array,
  origin: string,
): Promise<{ imageUrl: string }> {
  await exigirProductoDeLaSucursal(session, productId)
  const imagen = await prepararImagen(entrada)

  await prisma.$transaction((tx) =>
    guardarImagenEn(tx, {
      productId,
      branchId: session.branchId,
      userId: session.userId,
      imagen,
      sourceUrl: null,
      origin,
    }),
  )
  return { imageUrl: direccionDeImagen(productId, imagen.sha256) }
}

export async function quitarImagen(
  session: Session,
  productId: number,
  origin: string,
): Promise<{ ok: true }> {
  await exigirProductoDeLaSucursal(session, productId)

  await prisma.$transaction(async (tx) => {
    const antes = await tx.productImage.findUnique({
      where: { productId },
      select: { sha256: true, sourceUrl: true },
    })
    // Quitar una foto que no hay no es un error: el resultado es el pedido.
    if (!antes) return
    await tx.productImage.delete({ where: { productId } })
    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'ProductImage',
      recordId: productId,
      action: 'delete',
      before: antes,
      origin,
    })
  })
  return { ok: true }
}

export async function leerImagen(
  session: Session,
  productId: number,
): Promise<{ data: Uint8Array; mimeType: string; sha256: string }> {
  const foto = await prisma.productImage.findFirst({
    where: { productId, product: { branchId: session.branchId } },
    select: { data: true, mimeType: true, sha256: true },
  })
  if (!foto) throw notFound('El producto no tiene foto')
  return foto
}
