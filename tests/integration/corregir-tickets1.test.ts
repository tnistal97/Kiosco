/**
 * La correccion de Tickets 1, contra la base. Ver scripts/lib/corregir-tickets1.ts.
 *
 * Lo que importa:
 *
 *   1. se descuenta el exceso con un movimiento del libro, y lo que paso
 *      despues de la normalizacion (una venta) queda;
 *   2. el codigo y el nombre cambian con su entrada en la bitacora;
 *   3. si algo no esta como lo vio la auditoria, no se corrige NADA;
 *   4. se aplica una sola vez, y el ensayo no escribe nada.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { applyStockMovement, reconstruirStock } from '@/modules/inventory/service'
import { cantidad } from '@/server/cantidad'
import { corregirTickets1, ORIGEN, type Correcciones } from '../../scripts/lib/corregir-tickets1'
import { ORIGEN as NORMALIZACION } from '../../scripts/lib/normalizar-bultos'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Un producto como lo dejo la carga inicial, con su codigo si tiene. */
async function cargado(nombre: string, stock: number, codigo: string | null = null) {
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

/** Un ajuste con su entrada en la bitacora, como lo deja cada origen. */
async function ajuste(productId: number, delta: number, origen: string) {
  await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      branchId: fx.branchA.id,
      productId,
      type: 'MANUAL_ADJUSTMENT',
      quantity: cantidad(delta),
      saleUnit: 'UNIT',
      userId: fx.admin.id,
      reason: origen,
      referenceType: 'Product',
      referenceId: productId,
      audit: { origin: origen },
    }),
  )
}

async function stock(productId: number) {
  const s = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId: fx.branchA.id, productId } },
  })
  return Number(s?.quantity ?? 0)
}

const MARCA = 'correccion-de-prueba'

function correcciones(extra: Partial<Correcciones> = {}): Correcciones {
  return {
    marca: MARCA,
    stock: [
      {
        nombre: 'Encendedor Candela',
        ticket: '1(25) x 7724,94',
        unidadesTicket: 25,
        agregadoPorLaNormalizacion: 600,
        exceso: 600,
      },
    ],
    codigos: [
      {
        nombre: 'Monster Mango Loco lata 473cc',
        actual: '7798427620045',
        corregido: '7798422620045',
      },
    ],
    descripciones: [],
    nombres: [{ actual: 'Garbanzos Fainax 200 g', corregido: 'Harina de garbanzo Fainax 200 g' }],
    ...extra,
  }
}

function corregir(c = correcciones(), aplicar = true) {
  return corregirTickets1(prisma, {
    sucursal: fx.branchA.id,
    autor: fx.admin.id,
    correcciones: c,
    aplicar,
  })
}

/** Candela como quedo en produccion: 25, +600 de la normalizacion y una venta de 5 despues. */
async function escenario() {
  const candela = await cargado('Encendedor Candela', 25)
  await ajuste(candela.id, 600, NORMALIZACION)
  await ajuste(candela.id, -5, 'POST /api/sales')
  const monster = await cargado('Monster Mango Loco lata 473cc', 6, '7798427620045')
  const fainax = await cargado('Garbanzos Fainax 200 g', 3)
  return { candela, monster, fainax }
}

describe('corregirTickets1', () => {
  it('descuenta solo el exceso y conserva la venta posterior; corrige codigo y nombre', async () => {
    const { candela, monster, fainax } = await escenario()
    expect(await stock(candela.id)).toBe(620)

    const r = await corregir()

    expect(r.aplicado).toBe(true)
    expect(r.stock[0]?.cuenta).toEqual({
      base: 25,
      agregado: 600,
      posterior: -5,
      actual: 620,
      correcto: 20,
    })
    expect(await stock(candela.id)).toBe(20)
    expect(Number(await reconstruirStock(fx.branchA.id, candela.id))).toBe(20)
    const correccion = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: candela.id },
      orderBy: { id: 'desc' },
    })
    expect(Number(correccion.quantity)).toBe(-600)
    expect(correccion.reason).toContain('el ticket dice 1(25) x 7724,94 = 25 u.')
    expect(correccion.reason).toContain('Se conserva lo posterior (-5)')

    const codigos = await prisma.productBarcode.findMany({ where: { productId: monster.id } })
    expect(codigos.map((c) => [c.code, c.isPrimary])).toEqual([['7798422620045', true]])
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fainax.id } })).name).toBe(
      'Harina de garbanzo Fainax 200 g',
    )
    const entradas = await prisma.auditLog.findMany({
      where: { origin: ORIGEN, tableName: 'Product', recordId: { not: null } },
    })
    expect(entradas.map((e) => e.recordId).sort()).toEqual([monster.id, fainax.id].sort())
    expect(r.despues.unidades).toBe(r.antes.unidades - 600)
  })

  it('se aplica una sola vez por marca', async () => {
    const { candela } = await escenario()
    await corregir()
    const segunda = await corregir()
    expect(segunda.yaAplicada).not.toBeNull()
    expect(segunda.stock).toEqual([])
    expect(await stock(candela.id)).toBe(20)
  })

  it('el ensayo hace las cuentas y no escribe nada', async () => {
    const { candela, monster } = await escenario()
    const movimientos = await prisma.stockMovement.count()

    const r = await corregir(correcciones(), false)

    expect(r.aplicado).toBe(false)
    expect(r.stock[0]?.stockDespues).toBe(20)
    expect(await stock(candela.id)).toBe(620)
    expect(await prisma.stockMovement.count()).toBe(movimientos)
    expect(
      (await prisma.productBarcode.findFirstOrThrow({ where: { productId: monster.id } })).code,
    ).toBe('7798427620045')
    expect(await prisma.auditLog.count({ where: { origin: ORIGEN } })).toBe(0)
  })

  it('si la normalizacion no sumo lo que dice el manifiesto, no se corrige nada', async () => {
    const { candela, fainax } = await escenario()
    const c = correcciones()
    const [s] = c.stock
    if (s) s.agregadoPorLaNormalizacion = 575

    await expect(corregir(c)).rejects.toThrow('la normalización sumó 600')
    expect(await stock(candela.id)).toBe(620)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fainax.id } })).name).toBe(
      'Garbanzos Fainax 200 g',
    )
  })

  it('un codigo corregido que ya es de otro producto, aunque este de baja, frena todo', async () => {
    const { candela } = await escenario()
    const viejo = await cargado('Monster de baja', 0, '7798422620045')
    await prisma.product.update({ where: { id: viejo.id }, data: { isActive: false } })

    await expect(corregir()).rejects.toThrow('ya es de "Monster de baja"')
    expect(await stock(candela.id)).toBe(620)
  })

  it('un nombre corregido que ya usa otro producto activo frena todo', async () => {
    const { candela } = await escenario()
    await cargado('Harina de Garbanzo Fainax 200 g', 1)

    await expect(corregir()).rejects.toThrow('ya es el nombre de')
    expect(await stock(candela.id)).toBe(620)
  })
})
