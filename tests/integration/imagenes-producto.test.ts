/**
 * Fotos de productos contra la base. Ver docs/PRODUCT_IMAGES.md.
 *
 * Cuatro reglas:
 *
 *   1. lo que se guarda es SIEMPRE una miniatura WebP que hizo el servidor, no
 *      el archivo que llego;
 *   2. el listado dice donde esta la foto, con su version, y la foto se puede
 *      guardar para siempre solo con la version vigente;
 *   3. una sucursal no ve ni toca las fotos de otra, y cambiarlas es de quien
 *      puede editar productos;
 *   4. cada cambio deja su entrada en la bitacora, y repetir el mismo no deja
 *      ninguna.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import sharp from 'sharp'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { buildRequest, call, errorDe, sessionCookie, type InvocacionReal } from '../helpers/http'
import { guardarImagenEn, prepararImagen } from '@/modules/products/imagen'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * Una "foto de catalogo": un producto rojo de 200 x 300 en el medio de un
 * lienzo blanco de 1200 x 1200. Es el caso que el recorte existe para resolver.
 */
async function fotoDeCatalogo(color = '#d02020'): Promise<Buffer> {
  const producto = await sharp({
    create: { width: 200, height: 300, channels: 3, background: color },
  })
    .png()
    .toBuffer()
  return sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#ffffff' } })
    .composite([{ input: producto, left: 500, top: 450 }])
    .jpeg()
    .toBuffer()
}

async function rutas() {
  return import('@/app/api/products/[id]/imagen/route')
}

async function subir(productId: number, data: Uint8Array, usuario = fx.admin, type = 'image/jpeg') {
  const { PUT } = await rutas()
  return call<{ imageUrl: string }>(PUT, `/api/products/${String(productId)}/imagen`, {
    method: 'PUT',
    cookie: await sessionCookie(usuario),
    params: { id: String(productId) },
    bytes: { data, type },
  })
}

/** El GET devuelve bytes: se lee el cuerpo tal cual, sin pasar por texto. */
async function pedirFoto(path: string, usuario = fx.admin, headers: Record<string, string> = {}) {
  const { GET } = await rutas()
  const id = /\/api\/products\/(\d+)\//.exec(path)?.[1] ?? ''
  const res = await (GET as InvocacionReal)(
    buildRequest(path, { cookie: await sessionCookie(usuario), headers }),
    { params: Promise.resolve({ id }) },
  )
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) }
}

async function listado(usuario = fx.admin) {
  const { GET } = await import('@/app/api/products/route')
  const res = await call<{ data: Array<{ id: number; imageUrl: string | null }> }>(
    GET,
    '/api/products?pageSize=100',
    { cookie: await sessionCookie(usuario) },
  )
  return res.body.data
}

// ---------------------------------------------------------------------------
// 1. Lo que se guarda
// ---------------------------------------------------------------------------

describe('Lo que se guarda es una miniatura que hizo el servidor', () => {
  it('recorta el margen blanco, achica y guarda WebP', async () => {
    const res = await subir(fx.productoA.id, await fotoDeCatalogo())
    expect(res.status).toBe(200)

    const fila = await prisma.productImage.findUniqueOrThrow({
      where: { productId: fx.productoA.id },
    })
    expect(fila.mimeType).toBe('image/webp')

    const meta = await sharp(fila.data).metadata()
    expect(meta.format).toBe('webp')
    // Recortado al producto (200 x 300) y no el lienzo entero achicado a
    // 480 x 480: de eso se trata el recorte. Unos pixeles de mas por los
    // bordes que deja el JPEG alrededor del rojo, como en una foto real.
    expect(meta.width).toBeGreaterThanOrEqual(200)
    expect(meta.width).toBeLessThan(215)
    expect(meta.height).toBeGreaterThanOrEqual(300)
    expect(meta.height).toBeLessThan(315)
    expect([fila.width, fila.height]).toEqual([meta.width, meta.height])
  })

  it('una foto grande queda en 480 px de lado mayor', async () => {
    const grande = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#3060c0' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 2800, height: 1800, channels: 3, background: '#20a040' },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 100,
        },
      ])
      .jpeg()
      .toBuffer()

    expect((await subir(fx.productoA.id, grande)).status).toBe(200)
    const fila = await prisma.productImage.findUniqueOrThrow({
      where: { productId: fx.productoA.id },
    })
    expect(Math.max(fila.width, fila.height)).toBe(480)
  })

  it('una imagen de un solo color se guarda entera, sin fallar por el recorte', async () => {
    const lisa = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer()
    expect((await subir(fx.productoA.id, lisa, fx.admin, 'image/png')).status).toBe(200)
  })

  it('rechaza lo que no es una imagen, y no guarda nada', async () => {
    const res = await subir(fx.productoA.id, new TextEncoder().encode('no soy una foto'))
    expect(res.status).toBe(400)
    expect(errorDe(res).message).toMatch(/no es una imagen/)
    expect(await prisma.productImage.count()).toBe(0)
  })

  it('rechaza un SVG: no es una foto, y es un documento con codigo adentro', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    )
    const res = await subir(fx.productoA.id, svg, fx.admin, 'image/svg+xml')
    expect(res.status).toBe(400)
    expect(await prisma.productImage.count()).toBe(0)
  })

  it('rechaza un cuerpo de mas de 5 MB sin intentar abrirlo', async () => {
    const res = await subir(fx.productoA.id, new Uint8Array(5 * 1024 * 1024 + 1))
    expect(res.status).toBe(400)
    expect(errorDe(res).message).toMatch(/pesa demasiado/)
  })

  it('la base rechaza una fila que no escribio el servidor', async () => {
    await expect(
      prisma.productImage.create({
        data: {
          productId: fx.productoA.id,
          mimeType: 'image/svg+xml',
          data: new Uint8Array([1, 2, 3]),
          width: 10,
          height: 10,
          sha256: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2. Listado, version y cache
// ---------------------------------------------------------------------------

describe('El listado dice donde esta la foto, con su version', () => {
  it('sin foto, null; con foto, la direccion con la version vigente', async () => {
    expect((await listado()).find((p) => p.id === fx.productoA.id)?.imageUrl).toBeNull()

    const { body } = await subir(fx.productoA.id, await fotoDeCatalogo())
    const fila = await prisma.productImage.findUniqueOrThrow({
      where: { productId: fx.productoA.id },
    })
    const esperada = `/api/products/${String(fx.productoA.id)}/imagen?v=${fila.sha256.slice(0, 16)}`

    expect(body.imageUrl).toBe(esperada)
    expect((await listado()).find((p) => p.id === fx.productoA.id)?.imageUrl).toBe(esperada)
  })

  it('el lector de codigos tambien la trae', async () => {
    await subir(fx.productoA.id, await fotoDeCatalogo())
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const res = await call<{ imageUrl: string | null }>(
      GET,
      `/api/products/barcode/${fx.productoA.barcode}`,
      { cookie: await sessionCookie(fx.cajero), params: { code: fx.productoA.barcode } },
    )
    expect(res.body.imageUrl).toMatch(/\/imagen\?v=[0-9a-f]{16}$/)
  })

  it('la ficha dice de donde salio la foto', async () => {
    const imagen = await prepararImagen(await fotoDeCatalogo())
    await guardarImagenEn(prisma, {
      productId: fx.productoA.id,
      branchId: fx.branchA.id,
      userId: fx.admin.id,
      imagen,
      sourceUrl: 'https://www.ejemplo.com.ar/producto/p',
      origin: 'prueba',
    })
    const { GET } = await import('@/app/api/products/[id]/route')
    const res = await call<{ imageSourceUrl: string | null }>(
      GET,
      `/api/products/${String(fx.productoA.id)}`,
      { cookie: await sessionCookie(fx.admin), params: { id: String(fx.productoA.id) } },
    )
    expect(res.body.imageSourceUrl).toBe('https://www.ejemplo.com.ar/producto/p')
  })

  it('con la version vigente se guarda para siempre; sin version, se revalida', async () => {
    const { body } = await subir(fx.productoA.id, await fotoDeCatalogo())

    const vigente = await pedirFoto(body.imageUrl, fx.cajero)
    expect(vigente.res.status).toBe(200)
    expect(vigente.res.headers.get('content-type')).toBe('image/webp')
    expect(vigente.res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(vigente.res.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await sharp(vigente.bytes).metadata()).format).toBe('webp')

    const sinVersion = await pedirFoto(`/api/products/${String(fx.productoA.id)}/imagen`)
    expect(sinVersion.res.headers.get('cache-control')).toBe('private, no-cache')

    const vieja = await pedirFoto(
      `/api/products/${String(fx.productoA.id)}/imagen?v=0000000000000000`,
    )
    expect(vieja.res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('con la misma huella responde 304 sin mandar la foto de nuevo', async () => {
    const { body } = await subir(fx.productoA.id, await fotoDeCatalogo())
    const primera = await pedirFoto(body.imageUrl)
    const etag = primera.res.headers.get('etag') ?? ''

    const segunda = await pedirFoto(body.imageUrl, fx.admin, { 'if-none-match': etag })
    expect(segunda.res.status).toBe(304)
    expect(segunda.bytes.byteLength).toBe(0)
  })

  it('otra foto es otra direccion', async () => {
    const primera = await subir(fx.productoA.id, await fotoDeCatalogo('#d02020'))
    const segunda = await subir(fx.productoA.id, await fotoDeCatalogo('#2040d0'))
    expect(segunda.body.imageUrl).not.toBe(primera.body.imageUrl)
    expect(await prisma.productImage.count()).toBe(1)
  })

  it('la version que lee el listado la mantiene la base, aunque la foto se toque a mano', async () => {
    await subir(fx.productoA.id, await fotoDeCatalogo())
    const foto = await prisma.productImage.findUniqueOrThrow({
      where: { productId: fx.productoA.id },
    })
    const conFoto = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    expect(conFoto.imageSha256).toBe(foto.sha256)

    // Un borrado que no pasa por la aplicacion --un psql a mano-- tambien la
    // deja al dia: la escribe el disparador, no el servicio.
    await prisma.$executeRaw`DELETE FROM "ProductImage" WHERE "productId" = ${fx.productoA.id}`
    const sinFoto = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    expect(sinFoto.imageSha256).toBeNull()
    expect((await listado()).find((p) => p.id === fx.productoA.id)?.imageUrl).toBeNull()
  })

  it('un producto sin foto responde 404', async () => {
    const { res } = await pedirFoto(`/api/products/${String(fx.productoA.id)}/imagen`)
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 3. Sucursal y permisos
// ---------------------------------------------------------------------------

describe('Cada sucursal con sus fotos, y cambiarlas es de quien edita productos', () => {
  it('no se ve ni se cambia la foto de un producto de otra sucursal', async () => {
    const imagen = await prepararImagen(await fotoDeCatalogo())
    await guardarImagenEn(prisma, {
      productId: fx.productoB.id,
      branchId: fx.branchB.id,
      userId: fx.admin.id,
      imagen,
      sourceUrl: null,
      origin: 'prueba',
    })

    const { res } = await pedirFoto(`/api/products/${String(fx.productoB.id)}/imagen`, fx.cajero)
    expect(res.status).toBe(404)

    const cambio = await subir(fx.productoB.id, await fotoDeCatalogo('#2040d0'))
    expect(cambio.status).toBe(404)

    const { DELETE } = await rutas()
    const borrado = await call(DELETE, `/api/products/${String(fx.productoB.id)}/imagen`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoB.id) },
    })
    expect(borrado.status).toBe(404)

    const sigue = await prisma.productImage.findUniqueOrThrow({
      where: { productId: fx.productoB.id },
    })
    expect(sigue.sha256).toBe(imagen.sha256)
  })

  it('el cajero ve la foto pero no la puede cambiar ni quitar', async () => {
    const { body } = await subir(fx.productoA.id, await fotoDeCatalogo())
    expect((await pedirFoto(body.imageUrl, fx.cajero)).res.status).toBe(200)

    const cambio = await subir(fx.productoA.id, await fotoDeCatalogo('#2040d0'), fx.cajero)
    expect(cambio.status).toBe(403)

    const { DELETE } = await rutas()
    const borrado = await call(DELETE, `/api/products/${String(fx.productoA.id)}/imagen`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.productoA.id) },
    })
    expect(borrado.status).toBe(403)
    expect(await prisma.productImage.count()).toBe(1)
  })

  it('sin sesion no hay foto', async () => {
    const { GET } = await rutas()
    const res = await call(GET, `/api/products/${String(fx.productoA.id)}/imagen`, {
      params: { id: String(fx.productoA.id) },
    })
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// 4. Bitacora y ciclo de vida
// ---------------------------------------------------------------------------

describe('Cada cambio de foto queda en la bitacora', () => {
  it('poner, cambiar y quitar dejan create, update y delete con la huella', async () => {
    await subir(fx.productoA.id, await fotoDeCatalogo('#d02020'))
    await subir(fx.productoA.id, await fotoDeCatalogo('#2040d0'))
    const { DELETE } = await rutas()
    const borrado = await call(DELETE, `/api/products/${String(fx.productoA.id)}/imagen`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
    })
    expect(borrado.status).toBe(200)
    expect(await prisma.productImage.count()).toBe(0)

    const entradas = await prisma.auditLog.findMany({
      where: { tableName: 'ProductImage', recordId: fx.productoA.id },
      orderBy: { id: 'asc' },
    })
    expect(entradas.map((e) => e.actionType)).toEqual(['create', 'update', 'delete'])
    expect(entradas.every((e) => e.userId === fx.admin.id && e.branchId === fx.branchA.id)).toBe(
      true,
    )
    // La huella, no los bytes.
    expect(JSON.stringify(entradas[0]?.changes)).toMatch(/"sha256":"[0-9a-f]{64}"/)
    expect(JSON.stringify(entradas)).not.toMatch(/"data"/)
  })

  it('la misma foto con el mismo origen no escribe nada', async () => {
    const imagen = await prepararImagen(await fotoDeCatalogo())
    const cambio = {
      productId: fx.productoA.id,
      branchId: fx.branchA.id,
      userId: fx.admin.id,
      imagen,
      sourceUrl: 'https://www.ejemplo.com.ar/producto/p',
      origin: 'prueba',
    }
    expect(await guardarImagenEn(prisma, cambio)).toBe(true)
    expect(await guardarImagenEn(prisma, cambio)).toBe(false)
    expect(await prisma.auditLog.count({ where: { tableName: 'ProductImage' } })).toBe(1)
  })

  it('quitar una foto que no hay no es un error ni deja entrada', async () => {
    const { DELETE } = await rutas()
    const res = await call(DELETE, `/api/products/${String(fx.productoA.id)}/imagen`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
    })
    expect(res.status).toBe(200)
    expect(await prisma.auditLog.count({ where: { tableName: 'ProductImage' } })).toBe(0)
  })

  it('editar el producto no mete la foto en su entrada de la bitacora', async () => {
    await subir(fx.productoA.id, await fotoDeCatalogo())
    const { PUT } = await import('@/app/api/products/[id]/route')
    const res = await call(PUT, `/api/products/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { description: 'Con foto' },
    })
    expect(res.status).toBe(200)

    const entrada = await prisma.auditLog.findFirstOrThrow({
      where: { tableName: 'Product', recordId: fx.productoA.id, actionType: 'update' },
      orderBy: { id: 'desc' },
    })
    expect(JSON.stringify(entrada.changes)).not.toMatch(/image|sha256/)
  })

  it('borrar un producto sin historial se lleva su foto', async () => {
    const { POST } = await import('@/app/api/products/route')
    const alta = await call<{ id: number }>(POST, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Producto cargado por error',
        price: '100.00',
        categoryId: fx.categoryId,
        totalStock: '0.000',
      },
    })
    expect(alta.status).toBe(201)
    await subir(alta.body.id, await fotoDeCatalogo())

    const { DELETE } = await import('@/app/api/products/[id]/route')
    const borrado = await call(DELETE, `/api/products/${String(alta.body.id)}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(alta.body.id) },
    })
    expect(borrado.status).toBe(200)
    expect(await prisma.productImage.count({ where: { productId: alta.body.id } })).toBe(0)
  })
})
