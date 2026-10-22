/**
 * La normalizacion por unidad contra la base. Ver scripts/lib/normalizar-bultos.ts.
 *
 * Lo que importa ademas de la cuenta:
 *
 *   1. el stock cambia por movimientos del libro, y el libro sigue
 *      reconstruyendo el saldo;
 *   2. el bulto consolidado queda de baja, no borrado;
 *   3. el codigo de la caja no queda como codigo de la unidad;
 *   4. la foto termina en la unidad, una sola vez;
 *   5. repetirlo no vuelve a multiplicar, y el ensayo no escribe nada.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import sharp from 'sharp'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { guardarImagenEn, prepararImagen } from '@/modules/products/imagen'
import { reconstruirStock } from '@/modules/inventory/service'
import { normalizarBultos, ORIGEN } from '../../scripts/lib/normalizar-bultos'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Un producto como lo dejo la carga inicial: con su stock en el libro. */
async function cargado(nombre: string, stock: number, codigo?: string) {
  const p = await prisma.product.create({
    data: {
      name: nombre,
      price: 0,
      categoryId: fx.categoryId,
      branchId: fx.branchA.id,
      ...(codigo ? { barcodes: { create: { code: codigo, isPrimary: true } } } : {}),
    },
  })
  await prisma.branchStock.create({
    data: { branchId: fx.branchA.id, productId: p.id, quantity: stock },
  })
  await prisma.stockMovement.create({
    data: {
      branchId: fx.branchA.id,
      productId: p.id,
      type: 'INITIAL',
      quantity: stock,
      previousQuantity: 0,
      resultingQuantity: stock,
      userId: fx.admin.id,
      reason: 'Carga inicial',
    },
  })
  return p
}

async function ponerFoto(productId: number, color: string) {
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: color } })
    .png()
    .toBuffer()
  const imagen = await prepararImagen(png)
  await guardarImagenEn(prisma, {
    productId,
    branchId: fx.branchA.id,
    userId: fx.admin.id,
    imagen,
    sourceUrl: null,
    origin: 'prueba',
  })
  return imagen.sha256
}

function normalizar(aplicar = true, codigosVerificados?: Map<string, string>) {
  return normalizarBultos(prisma, {
    sucursal: fx.branchA.id,
    autor: fx.admin.id,
    aplicar,
    codigosVerificados,
  })
}

async function estado(id: number) {
  const p = await prisma.product.findUniqueOrThrow({
    where: { id },
    include: {
      stocks: true,
      barcodes: { orderBy: { id: 'asc' } },
      image: { select: { sha256: true } },
    },
  })
  return {
    nombre: p.name,
    activo: p.isActive,
    stock: Number(p.stocks[0]?.quantity ?? 0),
    libro: Number(await reconstruirStock(fx.branchA.id, id)),
    precio: Number(p.price),
    codigos: p.barcodes.map((c) => `${c.code}${c.isPrimary ? '*' : ''}`),
    descripcion: p.description,
    compra: `${p.purchaseUnit} x${p.unitsPerPurchaseUnit.toString()}`,
    foto: p.image?.sha256 ?? null,
    version: p.imageSha256,
  }
}

describe('La cuenta, en la base', () => {
  it('1. Producto = 2 y Producto (bulto x 4) = 3: queda Producto = 14 y el bulto de baja', async () => {
    const unidad = await cargado('Leche Serenísima entera 1 L', 2)
    const bulto = await cargado('Leche Serenísima entera 1 L (bulto x4)', 3)

    const r = await normalizar()

    expect(r.pasos).toMatchObject([{ accion: 'consolidar', stockFinal: 14 }])
    expect(await estado(unidad.id)).toMatchObject({
      nombre: 'Leche Serenísima entera 1 L',
      activo: true,
      stock: 14,
      libro: 14,
      precio: 0,
      compra: 'BOX x4',
    })
    expect(await estado(bulto.id)).toMatchObject({ activo: false, stock: 0, libro: 0 })

    const movimientos = await prisma.stockMovement.findMany({
      where: { productId: { in: [unidad.id, bulto.id] }, type: 'MANUAL_ADJUSTMENT' },
      orderBy: { id: 'asc' },
    })
    expect(movimientos.map((m) => [m.productId, Number(m.quantity), m.reason])).toEqual([
      [
        bulto.id,
        -3,
        `Por unidad: pasa a "Leche Serenísima entera 1 L" (#${String(unidad.id)}) como 3 bultos x 4 = 12 u.`,
      ],
      [
        unidad.id,
        12,
        `Por unidad: 3 bultos x 4 = 12 u. de "Leche Serenísima entera 1 L (bulto x4)" (#${String(bulto.id)})`,
      ],
    ])
  })

  it('2. Solo Producto (bulto x 6) = 2: queda una fila, Producto = 12', async () => {
    const bulto = await cargado('Agua Villavicencio 500 ml (bulto x6)', 2)
    await normalizar()
    expect(await estado(bulto.id)).toMatchObject({
      nombre: 'Agua Villavicencio 500 ml',
      activo: true,
      stock: 12,
      libro: 12,
      precio: 0,
      compra: 'BOX x6',
    })
    const activos = await prisma.product.count({
      where: { branchId: fx.branchA.id, name: { contains: 'bulto' } },
    })
    expect(activos).toBe(0)
  })

  it('3. dos productos parecidos pero distintos no se juntan', async () => {
    const porron = await cargado('Cerveza Corona porrón 330/355cc bulto x6', 2)
    const lata = await cargado('Cerveza Corona lata 473cc', 6)
    await normalizar()
    expect(await estado(porron.id)).toMatchObject({
      nombre: 'Cerveza Corona porrón 330/355cc',
      stock: 12,
    })
    expect(await estado(lata.id)).toMatchObject({
      nombre: 'Cerveza Corona lata 473cc',
      activo: true,
      stock: 6,
      libro: 6,
    })
  })

  it('lo ambiguo no se toca', async () => {
    const bulto = await cargado('Red Bull 250ml bulto x4', 4)
    const parecido = await cargado('Red Bull lata 250 ml', 3)
    const r = await normalizar()
    expect(r.pasos).toMatchObject([{ accion: 'revisar' }])
    expect(await estado(bulto.id)).toMatchObject({ nombre: 'Red Bull 250ml bulto x4', stock: 4 })
    expect(await estado(parecido.id)).toMatchObject({ stock: 3 })
  })

  it('un bulto que ya tuvo un ajuste queda para revisar', async () => {
    const bulto = await cargado('Clight naranja 8g bulto x20', 20)
    await prisma.$transaction(async (tx) => {
      const { applyStockMovement } = await import('@/modules/inventory/service')
      const { cantidad } = await import('@/server/cantidad')
      await applyStockMovement(tx, {
        branchId: fx.branchA.id,
        productId: bulto.id,
        type: 'MANUAL_ADJUSTMENT',
        quantity: cantidad(-1),
        saleUnit: 'UNIT',
        userId: fx.admin.id,
        reason: 'se vendio uno',
      })
    })
    const r = await normalizar()
    expect(r.pasos).toMatchObject([{ accion: 'revisar' }])
    expect(await estado(bulto.id)).toMatchObject({
      nombre: 'Clight naranja 8g bulto x20',
      stock: 19,
    })
  })
})

describe('4. Codigos de barras', () => {
  it('el codigo del bulto no reemplaza al de la unidad ni queda en ella como codigo', async () => {
    const unidad = await cargado('Galletitas Express 100 g', 5, '7790000000010')
    const bulto = await cargado('Galletitas Express 100 g (bulto x24)', 1, '17790000000031')
    await normalizar()
    expect(await estado(unidad.id)).toMatchObject({
      stock: 29,
      codigos: ['7790000000010*'],
      descripcion: 'Código del bulto x24: 17790000000031 (no es el de la unidad).',
    })
    expect(await estado(bulto.id)).toMatchObject({ activo: false, codigos: [] })
    // Escanear la caja ya no vende una unidad suelta.
    expect(await prisma.productBarcode.count({ where: { code: '17790000000031' } })).toBe(0)
  })

  it('sin unidad: se saca el codigo de la caja, y entra el de la unidad solo si esta verificado', async () => {
    const sinVerificar = await cargado('Red Bull 250ml bulto x4', 4, '9002490203306')
    const verificado = await cargado('Baño Pronto naranja 1L bulto x8', 8, '37790036000320')
    await normalizar(true, new Map([['37790036000320', '7790036000329']]))
    expect(await estado(sinVerificar.id)).toMatchObject({
      nombre: 'Red Bull 250ml',
      stock: 16,
      codigos: [],
      descripcion: 'Código del bulto x4: 9002490203306 (no es el de la unidad).',
    })
    expect(await estado(verificado.id)).toMatchObject({
      nombre: 'Baño Pronto naranja 1L',
      stock: 64,
      codigos: ['7790036000329*'],
      descripcion: 'Código del bulto x8: 37790036000320 (no es el de la unidad).',
    })
  })
})

describe('5. La foto', () => {
  it('la del bulto pasa a la unidad confirmada, sin copia', async () => {
    const unidad = await cargado('Té Taragüi x25', 2)
    const bulto = await cargado('Té Taragüi x25 (bulto x12)', 1)
    const sha = await ponerFoto(bulto.id, '#c0392b')

    await normalizar()

    expect(await estado(unidad.id)).toMatchObject({ foto: sha, version: sha, stock: 14 })
    expect(await estado(bulto.id)).toMatchObject({ foto: null, version: null })
    expect(await prisma.productImage.count()).toBe(1)
    const bitacora = await prisma.auditLog.findMany({
      where: { tableName: 'ProductImage', origin: ORIGEN },
      orderBy: { id: 'asc' },
      select: { recordId: true, actionType: true },
    })
    expect(bitacora).toEqual([
      { recordId: unidad.id, actionType: 'create' },
      { recordId: bulto.id, actionType: 'delete' },
    ])
  })

  it('si la unidad ya tiene foto, la del bulto se quita y la de la unidad queda', async () => {
    const unidad = await cargado('Té Taragüi x25', 2)
    const bulto = await cargado('Té Taragüi x25 (bulto x12)', 1)
    const deLaUnidad = await ponerFoto(unidad.id, '#27ae60')
    await ponerFoto(bulto.id, '#c0392b')

    await normalizar()

    expect(await estado(unidad.id)).toMatchObject({ foto: deLaUnidad, version: deLaUnidad })
    expect(await estado(bulto.id)).toMatchObject({ foto: null })
    expect(await prisma.productImage.count()).toBe(1)
  })

  it('al renombrar, la foto sigue en el mismo producto', async () => {
    const bulto = await cargado('Puré de tomate Noel brick 520 g (bulto x12)', 2)
    const sha = await ponerFoto(bulto.id, '#c0392b')
    await normalizar()
    expect(await estado(bulto.id)).toMatchObject({
      nombre: 'Puré de tomate Noel brick 520 g',
      foto: sha,
      stock: 24,
    })
  })
})

describe('6. Repetirlo no vuelve a multiplicar', () => {
  it('la segunda vez no hay nada que hacer y nada cambia', async () => {
    const unidad = await cargado('Leche Serenísima entera 1 L', 2)
    await cargado('Leche Serenísima entera 1 L (bulto x4)', 3)
    const solo = await cargado('Agua Villavicencio 500 ml (bulto x6)', 2)

    const primera = await normalizar()
    const movimientos = await prisma.stockMovement.count()
    const entradas = await prisma.auditLog.count()
    const segunda = await normalizar()

    expect(primera.despues).toMatchObject({ unidades: primera.antes.unidades - 5 + 12 + 12 })
    expect(segunda.pasos).toEqual([])
    expect(segunda.antes).toEqual(primera.despues)
    expect(segunda.despues).toEqual(primera.despues)
    expect(await prisma.stockMovement.count()).toBe(movimientos)
    expect(await prisma.auditLog.count()).toBe(entradas)
    expect((await estado(unidad.id)).stock).toBe(14)
    expect((await estado(solo.id)).stock).toBe(12)
  })

  it('el ensayo hace las cuentas y no escribe nada', async () => {
    const bulto = await cargado('Agua Villavicencio 500 ml (bulto x6)', 2)
    const movimientos = await prisma.stockMovement.count()

    const r = await normalizar(false)

    expect(r.aplicado).toBe(false)
    expect(r.despues.unidades).toBe(r.antes.unidades + 10)
    expect(r.despues.conBulto).toBe(0)
    expect(await estado(bulto.id)).toMatchObject({
      nombre: 'Agua Villavicencio 500 ml (bulto x6)',
      stock: 2,
    })
    expect(await prisma.stockMovement.count()).toBe(movimientos)
  })

  it('no toca otra sucursal', async () => {
    const otra = await prisma.product.create({
      data: {
        name: 'Agua 500 ml (bulto x6)',
        price: 0,
        categoryId: fx.categoryId,
        branchId: fx.branchB.id,
      },
    })
    await cargado('Agua Villavicencio 500 ml (bulto x6)', 2)
    await normalizar()
    expect((await prisma.product.findUniqueOrThrow({ where: { id: otra.id } })).name).toBe(
      'Agua 500 ml (bulto x6)',
    )
  })
})
