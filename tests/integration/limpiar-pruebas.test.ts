/**
 * `scripts/lib/limpiar-pruebas.ts`: saca ventas y cajas de prueba de un local
 * sin perderlas y sin tocar el stock. Lo que tiene que valer siempre:
 *
 *   - si hay algo que no es de la lista, no se toca nada;
 *   - todo queda copiado en el esquema de archivo;
 *   - el stock y el libro siguen iguales;
 *   - la otra sucursal no se entera;
 *   - el local queda con una caja abierta en $0, y se puede vender.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { ESQUEMA, limpiarPruebas } from '../../scripts/lib/limpiar-pruebas'

let fx: Fixture
let venta: number

const MARCA = 'limpieza-de-prueba'

async function ventaDe(productId: number, branchId: number, userId: number, shiftId: number) {
  const s = await prisma.sale.create({
    data: {
      userId,
      branchId,
      total: 100,
      items: { create: { productId, quantity: 1, price: 100 } },
    },
  })
  await prisma.salePayment.create({
    data: { saleId: s.id, method: 'CASH', amount: 100 },
  })
  await prisma.cashRegisterMovement.create({
    data: {
      branchId,
      userId,
      amount: 100,
      paymentMethod: 'CASH',
      type: 'sale',
      saleId: s.id,
      shiftId,
    },
  })
  return s.id
}

const opciones = () => ({
  sucursal: fx.branchA.id,
  autor: fx.admin.id,
  marca: MARCA,
  ventas: [venta],
  turnos: [fx.turnoA],
  responsable: 'CAJERO1',
  aplicar: true,
})

async function huellaDelStock() {
  return prisma.branchStock.findMany({ orderBy: [{ branchId: 'asc' }, { productId: 'asc' }] })
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`)
  fx = await seedFixture()
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { isActive: false } })
  venta = await ventaDe(fx.productoA.id, fx.branchA.id, fx.admin.id, fx.turnoA)
  await prisma.cashCount.create({
    data: { branchId: fx.branchA.id, userId: fx.admin.id, amount: 100, shiftId: fx.turnoA },
  })
  await prisma.branch.update({ where: { id: fx.branchA.id }, data: { currentCash: 1234 } })
})

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`)
  await prisma.$disconnect()
})

describe('Limpiar los datos de prueba', () => {
  it('saca ventas, pagos, movimientos, arqueos y turnos, y deja la caja en $0', async () => {
    const r = await limpiarPruebas(prisma, opciones())

    expect(r).toMatchObject({
      ventas: 1,
      lineas: 1,
      pagos: 1,
      movimientosDeCaja: 1,
      arqueos: 1,
      turnos: 1,
      aplicado: true,
    })
    expect(await prisma.sale.count({ where: { branchId: fx.branchA.id } })).toBe(0)
    expect(await prisma.cashRegisterMovement.count({ where: { branchId: fx.branchA.id } })).toBe(0)
    expect(await prisma.cashCount.count({ where: { branchId: fx.branchA.id } })).toBe(0)

    const turnos = await prisma.cashShift.findMany({ where: { branchId: fx.branchA.id } })
    expect(turnos).toHaveLength(1)
    expect(turnos[0]?.status).toBe('open')
    expect(Number(turnos[0]?.openingAmount)).toBe(0)
    expect(turnos[0]?.openedById).toBe(fx.cajero.id)

    const sucursal = await prisma.branch.findUniqueOrThrow({ where: { id: fx.branchA.id } })
    expect(Number(sucursal.currentCash)).toBe(0)
  })

  it('el stock, el libro y los productos no cambian', async () => {
    const stock = await huellaDelStock()
    const libro = await prisma.stockMovement.count()
    const productos = await prisma.product.findMany({ orderBy: { id: 'asc' } })

    await limpiarPruebas(prisma, opciones())

    expect(await huellaDelStock()).toEqual(stock)
    expect(await prisma.stockMovement.count()).toBe(libro)
    expect(await prisma.product.findMany({ orderBy: { id: 'asc' } })).toEqual(productos)
  })

  it('todo queda copiado en el archivo: no se pierde nada', async () => {
    await limpiarPruebas(prisma, opciones())

    for (const [tabla, n] of [
      ['Sale', 1],
      ['SaleItem', 1],
      ['SalePayment', 1],
      ['CashRegisterMovement', 1],
      ['CashCount', 1],
      ['CashShift', 1],
      ['Branch', 1],
    ] as const) {
      const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${ESQUEMA}."${tabla}"`,
      )
      expect(Number(filas[0]?.n), tabla).toBe(n)
    }
    const [sucursal] = await prisma.$queryRawUnsafe<Array<{ currentCash: unknown }>>(
      `SELECT "currentCash" FROM ${ESQUEMA}."Branch"`,
    )
    expect(Number(sucursal?.currentCash)).toBe(1234)
  })

  it('la otra sucursal no se entera', async () => {
    const otra = await ventaDe(fx.productoB.id, fx.branchB.id, fx.cajeroB.id, fx.turnoB)
    const caja = await prisma.branch.findUniqueOrThrow({ where: { id: fx.branchB.id } })

    await limpiarPruebas(prisma, opciones())

    expect(await prisma.sale.findUnique({ where: { id: otra } })).not.toBeNull()
    const turno = await prisma.cashShift.findUnique({ where: { id: fx.turnoB } })
    expect(turno?.status).toBe('open')
    const despues = await prisma.branch.findUniqueOrThrow({ where: { id: fx.branchB.id } })
    expect(despues.currentCash).toEqual(caja.currentCash)
  })

  it('el ensayo no deja nada: ni filas, ni archivo', async () => {
    const r = await limpiarPruebas(prisma, { ...opciones(), aplicar: false })

    expect(r.aplicado).toBe(false)
    expect(r.ventas).toBe(1)
    expect(await prisma.sale.count({ where: { id: venta } })).toBe(1)
    const [esquema] = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM information_schema.schemata WHERE schema_name = '${ESQUEMA}'`,
    )
    expect(Number(esquema?.n)).toBe(0)
  })

  it('la segunda vez no hace nada', async () => {
    await limpiarPruebas(prisma, opciones())
    const turnos = await prisma.cashShift.count()

    const r = await limpiarPruebas(prisma, opciones())

    expect(r.yaAplicada).not.toBeNull()
    expect(await prisma.cashShift.count()).toBe(turnos)
  })

  it('deja en la bitacora quien lo hizo', async () => {
    await limpiarPruebas(prisma, opciones())

    const e = await prisma.auditLog.findFirst({
      where: { tableName: 'Sale', actionType: 'delete' },
    })
    expect(e?.userId).toBe(fx.admin.id)
    expect(JSON.stringify(e?.changes)).toContain(MARCA)
  })
})

describe('Se niega si algo no es lo que dice la lista', () => {
  async function nadaCambio() {
    expect(await prisma.sale.count({ where: { id: venta } })).toBe(1)
    expect(await prisma.cashShift.count({ where: { id: fx.turnoA } })).toBe(1)
  }

  it('una venta que no esta en la lista: puede ser real', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { isActive: true } })
    await ventaDe(fx.productoA.id, fx.branchA.id, fx.cajero.id, fx.turnoA)

    await expect(limpiarPruebas(prisma, opciones())).rejects.toThrow(/no son las de la lista/)
    await nadaCambio()
  })

  it('un turno que no esta en la lista', async () => {
    await expect(limpiarPruebas(prisma, { ...opciones(), turnos: [] })).rejects.toThrow(
      /turnos de la sucursal no son/,
    )
    await nadaCambio()
  })

  it('una venta de un producto activo no es de prueba', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { isActive: true } })

    await expect(limpiarPruebas(prisma, opciones())).rejects.toThrow(/producto activo/)
    await nadaCambio()
  })

  it('un responsable de otra sucursal, o un autor que no administra', async () => {
    await expect(limpiarPruebas(prisma, { ...opciones(), responsable: 'cajero2' })).rejects.toThrow(
      /no es un usuario activo/,
    )
    await expect(limpiarPruebas(prisma, { ...opciones(), autor: fx.cajero.id })).rejects.toThrow(
      /no es un administrador/,
    )
    await nadaCambio()
  })
})
