/**
 * `scripts/lib/cargar-precios.ts`: carga precios revisados por nombre exacto,
 * sin pisar uno fijado a mano y sin tocar nada mas.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { cargarPrecios, type PrecioDeLista } from '../../scripts/lib/cargar-precios'

let fx: Fixture

const opciones = (precios: PrecioDeLista[]) => ({
  sucursal: fx.branchA.id,
  autor: fx.admin.id,
  marca: 'precios-de-prueba',
  origen: 'lista.xlsx',
  precios,
  aplicar: true,
})

const A = () => ({ nombre: fx.productoA.name, precio: '2400.00', fila: 7 })

beforeEach(async () => {
  fx = await seedFixture()
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: 0 } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function precioDe(id: number) {
  const p = await prisma.product.findUniqueOrThrow({ where: { id } })
  return Number(p.price)
}

describe('Cargar precios', () => {
  it('pone el precio y solo el precio', async () => {
    const antes = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    const stock = await prisma.branchStock.findMany({ orderBy: { id: 'asc' } })

    const r = await cargarPrecios(prisma, opciones([A()]))

    expect(r).toMatchObject({ cargados: 1, conPrecio: [], aplicado: true })
    const despues = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    expect(Number(despues.price)).toBe(2400)
    expect({ ...despues, price: 0, updatedAt: 0 }).toEqual({ ...antes, price: 0, updatedAt: 0 })
    expect(await prisma.branchStock.findMany({ orderBy: { id: 'asc' } })).toEqual(stock)
  })

  it('no pisa un precio que ya no esta en $0', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: 999 } })

    const r = await cargarPrecios(prisma, opciones([A()]))

    expect(r.cargados).toBe(0)
    expect(r.conPrecio).toEqual([fx.productoA.name])
    expect(await precioDe(fx.productoA.id)).toBe(999)
  })

  it('los productos que no estan en la lista no cambian', async () => {
    const otro = await precioDe(fx.productoPeso.id)

    await cargarPrecios(prisma, opciones([A()]))

    expect(await precioDe(fx.productoPeso.id)).toBe(otro)
  })

  it('deja en la bitacora el antes, el despues y la fila', async () => {
    await cargarPrecios(prisma, opciones([A()]))

    const e = await prisma.auditLog.findFirst({
      where: { tableName: 'Product', recordId: fx.productoA.id, actionType: 'update' },
    })
    expect(e?.userId).toBe(fx.admin.id)
    expect(e?.reason).toContain('fila 7')
    expect(JSON.stringify(e?.changes)).toContain('2400.00')
  })

  it('la segunda vez no hace nada', async () => {
    await cargarPrecios(prisma, opciones([A()]))
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: 0 } })

    const r = await cargarPrecios(prisma, opciones([A()]))

    expect(r.yaAplicada).not.toBeNull()
    expect(await precioDe(fx.productoA.id)).toBe(0)
  })

  it('el ensayo no escribe nada', async () => {
    const r = await cargarPrecios(prisma, { ...opciones([A()]), aplicar: false })

    expect(r).toMatchObject({ cargados: 1, aplicado: false })
    expect(await precioDe(fx.productoA.id)).toBe(0)
    expect(await prisma.auditLog.count({ where: { actionType: 'import' } })).toBe(0)
  })
})

describe('Se niega si la lista no cierra, y entonces no carga nada', () => {
  it('un nombre que no es exacto', async () => {
    await expect(
      cargarPrecios(prisma, opciones([A(), { nombre: 'Fernet', precio: '10.00', fila: 8 }])),
    ).rejects.toThrow(/hay 0 productos/)
    expect(await precioDe(fx.productoA.id)).toBe(0)
  })

  it('un producto repetido', async () => {
    await expect(cargarPrecios(prisma, opciones([A(), A()]))).rejects.toThrow(/dos veces/)
  })

  it('un precio que no es positivo', async () => {
    await expect(cargarPrecios(prisma, opciones([{ ...A(), precio: '0.00' }]))).rejects.toThrow(
      /precio válido/,
    )
  })

  it('un autor que no administra', async () => {
    await expect(
      cargarPrecios(prisma, { ...opciones([A()]), autor: fx.cajero.id }),
    ).rejects.toThrow(/no es un administrador/)
  })
})
