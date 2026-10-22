/**
 * Una compra que entra al stock, contra la base. Ver scripts/lib/incorporar-compra.ts.
 *
 * Lo que importa ademas de la cuenta:
 *
 *   1. lo nuevo entra por el alta de siempre: precio 0, movimiento INITIAL;
 *   2. lo que suma es un movimiento del libro, y el libro reconstruye el saldo;
 *   3. si una linea queda para revisar, no entra ninguna;
 *   4. una compra se aplica una sola vez, y el ensayo no escribe nada.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { reconstruirStock } from '@/modules/inventory/service'
import { incorporarCompra, ORIGEN } from '../../scripts/lib/incorporar-compra'
import type { LineaDeCompra } from '../../scripts/lib/compra'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Un producto como lo dejo la carga inicial: con su stock en el libro. */
async function cargado(nombre: string, stock: number) {
  const p = await prisma.product.create({
    data: { name: nombre, price: 0, categoryId: fx.categoryId, branchId: fx.branchA.id },
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

const MARCA = 'compra-de-prueba'

function linea(
  nombre: string,
  cantidad: number,
  extra: Partial<LineaDeCompra> = {},
): LineaDeCompra {
  return { nombre, cantidad, codigo: null, accion: 'crear', origen: 'hoja 1 fila 1', ...extra }
}

function incorporar(lineas: LineaDeCompra[], aplicar = true) {
  return incorporarCompra(prisma, {
    sucursal: fx.branchA.id,
    autor: fx.admin.id,
    marca: MARCA,
    lineas,
    aplicar,
  })
}

async function stock(productId: number) {
  const s = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId: fx.branchA.id, productId } },
  })
  return Number(s?.quantity ?? 0)
}

describe('incorporarCompra', () => {
  it('crea los nuevos por el alta de siempre y suma a los existentes por el libro', async () => {
    const coca = await cargado('Coca Cola 600cc', 18)

    const r = await incorporar([
      linea('Coca Cola 600cc', 6, { accion: 'sumar', origen: 'hoja 1 fila 2' }),
      linea('Nueces', 5, { origen: 'hoja 2 fila 3' }),
    ])

    expect(r.aplicado).toBe(true)
    expect(r.sumados).toEqual([
      { id: coca.id, nombre: 'Coca Cola 600cc', cantidad: 6, stockAntes: 18, stockDespues: 24 },
    ])
    expect(await stock(coca.id)).toBe(24)
    expect(Number(await reconstruirStock(fx.branchA.id, coca.id))).toBe(24)
    const ajuste = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: coca.id, type: 'MANUAL_ADJUSTMENT' },
    })
    expect(Number(ajuste.quantity)).toBe(6)
    expect(ajuste.reason).toBe(`Compra ${MARCA} · hoja 1 fila 2`)

    const nueces = await prisma.product.findFirstOrThrow({
      where: { name: 'Nueces' },
      include: { movements: true, category: true, barcodes: true },
    })
    expect(Number(nueces.price)).toBe(0)
    expect(nueces.cost).toBeNull()
    expect(nueces.category.name).toBe('Sin categoría')
    expect(nueces.barcodes).toEqual([])
    expect(nueces.movements.map((m) => [m.type, Number(m.quantity), m.reason])).toEqual([
      ['INITIAL', 5, `Compra ${MARCA} · hoja 2 fila 3`],
    ])
    expect(r.despues.productos).toBe(r.antes.productos + 1)
    expect(r.despues.unidades).toBe(r.antes.unidades + 11)

    const resumen = await prisma.auditLog.findFirstOrThrow({
      where: { origin: ORIGEN, actionType: 'import' },
    })
    expect(resumen.changes).toMatchObject({
      after: { importacion: MARCA, creados: 1, sumados: 1, unidades: 11 },
    })
  })

  it('si una linea queda para revisar, no entra ninguna', async () => {
    await cargado('Cereal Nesquik bolitas chocolate 230 g', 2)
    const antes = await prisma.product.count()

    const r = await incorporar([
      linea('Nueces', 5),
      linea('cereal nesquik bolitas chocolate 230 g', 3),
    ])

    expect(r.aplicado).toBe(false)
    expect(r.pasos.map((p) => p.accion)).toEqual(['crear', 'revisar'])
    expect(await prisma.product.count()).toBe(antes)
    expect(await prisma.auditLog.count({ where: { origin: ORIGEN } })).toBe(0)
  })

  it('se aplica una sola vez por marca', async () => {
    const coca = await cargado('Coca Cola 600cc', 18)
    const lineas = [linea('Coca Cola 600cc', 6, { accion: 'sumar' })]

    await incorporar(lineas)
    const segunda = await incorporar(lineas)

    expect(segunda.yaAplicada).not.toBeNull()
    expect(segunda.pasos).toEqual([])
    expect(await stock(coca.id)).toBe(24)
  })

  it('el ensayo hace las cuentas y no escribe nada', async () => {
    const coca = await cargado('Coca Cola 600cc', 18)
    const antes = await prisma.stockMovement.count()

    const r = await incorporar(
      [linea('Coca Cola 600cc', 6, { accion: 'sumar' }), linea('Nueces', 5)],
      false,
    )

    expect(r.aplicado).toBe(false)
    expect(r.despues.unidades).toBe(r.antes.unidades + 11)
    expect(await stock(coca.id)).toBe(18)
    expect(await prisma.product.count({ where: { name: 'Nueces' } })).toBe(0)
    expect(await prisma.stockMovement.count()).toBe(antes)
    expect(await prisma.auditLog.count({ where: { origin: ORIGEN } })).toBe(0)
  })

  it('un codigo nuevo que ya es de otro producto, aunque este de baja, frena la compra', async () => {
    const viejo = await cargado('Gaseosa de baja', 0)
    await prisma.product.update({ where: { id: viejo.id }, data: { isActive: false } })
    await prisma.productBarcode.create({
      data: { productId: viejo.id, code: '7790895650833', isPrimary: true },
    })

    await expect(
      incorporar([linea('Coca Cola 600cc', 6, { codigo: '7790895650833' })]),
    ).rejects.toThrow('ya es de "Gaseosa de baja"')
    expect(await prisma.product.count({ where: { name: 'Coca Cola 600cc' } })).toBe(0)
  })
})
