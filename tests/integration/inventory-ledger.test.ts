/**
 * Libro de inventario.
 *
 * LA propiedad que se prueba una y otra vez, con distintas palabras:
 *
 *   para todo producto:  suma(StockMovement.quantity) == BranchStock.quantity
 *
 * Si esa igualdad se rompe, el sistema esta mintiendo: o el saldo se movio sin
 * dejar rastro, o el rastro dice una cosa y el saldo otra. Por eso casi todos
 * los casos de aca terminan comprobandola, y no solo el que la nombra.
 *
 * Ver docs/INVENTORY_LEDGER.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  seedFixture,
  prisma,
  stockOf,
  ponerStock,
  descuadresDelLibro,
  movimientosDe,
  type Fixture,
  num,
} from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'
import { PATCH as AJUSTAR, PUT as RECUENTO } from '@/app/api/stock/[id]/route'
import { GET as MOVIMIENTOS } from '@/app/api/inventory/movements/route'
import { GET as REPOSICION } from '@/app/api/inventory/replenishment/route'
import { POST as CREAR_PRODUCTO } from '@/app/api/products/route'
import { DELETE as BORRAR_PRODUCTO } from '@/app/api/products/[id]/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

interface VentaCreada {
  id: number
}

async function vender(cantidad: number, usuario = fx.cajero) {
  return call<VentaCreada>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: {
      items: [{ productId: fx.productoA.id, quantity: cantidad }],
      paymentMethod: 'efectivo',
    },
  })
}

async function anular(saleId: number, motivo = 'Prueba del libro') {
  return call(ANULAR, `/api/sales/${String(saleId)}/cancel`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(saleId) },
    body: { reason: motivo },
  })
}

async function ajustar(body: unknown, usuario = fx.admin) {
  return call(AJUSTAR, `/api/stock/${String(fx.productoA.id)}`, {
    method: 'PATCH',
    cookie: await sessionCookie(usuario),
    params: { id: String(fx.productoA.id) },
    body,
  })
}

interface PaginaMovimientos {
  data: Array<{
    id: number
    type: string
    typeLabel: string
    quantity: number
    previousQuantity: number
    resultingQuantity: number
    referenceType: string | null
    referenceId: number | null
    reason: string | null
    product: { id: number; name: string }
    user: { id: number; name: string }
  }>
  pagination: { total: number; totalPages: number; page: number }
}

async function historial(query = '', usuario = fx.admin) {
  return call<PaginaMovimientos>(MOVIMIENTOS, `/api/inventory/movements${query}`, {
    cookie: await sessionCookie(usuario),
  })
}

/** El libro cuadra para todos los productos. Se llama al final de casi todo. */
async function exigirLibroCuadrado() {
  const descuadres = await descuadresDelLibro()
  expect(
    descuadres,
    `El libro no cuadra: ${JSON.stringify(descuadres)}. ` +
      'O el saldo se movio sin dejar movimiento, o el movimiento miente.',
  ).toEqual([])
}

// ---------------------------------------------------------------------------

describe('INITIAL — el saldo de partida', () => {
  it('un producto nuevo con unidades nace con su movimiento inicial', async () => {
    const res = await call<{ id: number }>(CREAR_PRODUCTO, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Arroz Gallo 1kg',
        price: 2500,
        categoryId: fx.categoryId,
        totalStock: 20,
      },
    })
    expect(res.status).toBeLessThan(300)

    const movimientos = await movimientosDe(fx.branchA.id, res.body.id)
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.type).toBe('INITIAL')
    expect(num(movimientos[0]?.quantity)).toBe(20)
    expect(num(movimientos[0]?.previousQuantity)).toBe(0)
    expect(num(movimientos[0]?.resultingQuantity)).toBe(20)

    await exigirLibroCuadrado()
  })

  it('un producto nuevo SIN unidades no genera movimiento', async () => {
    // Un movimiento de cero no dice nada, y la invariante se cumple sola con
    // la suma vacia. Ademas es lo que permite borrar un producto cargado por
    // error: en cuanto tiene historial, deja de poder borrarse.
    const res = await call<{ id: number }>(CREAR_PRODUCTO, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Producto vacio', price: 100, categoryId: fx.categoryId, totalStock: 0 },
    })
    expect(res.status).toBeLessThan(300)

    expect(await movimientosDe(fx.branchA.id, res.body.id)).toHaveLength(0)
    await exigirLibroCuadrado()
  })

  it('un producto sin historial se puede borrar; uno con historial, no', async () => {
    const vacio = await call<{ id: number }>(CREAR_PRODUCTO, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Cargado por error', price: 100, categoryId: fx.categoryId, totalStock: 0 },
    })

    const borrado = await call(BORRAR_PRODUCTO, `/api/products/${String(vacio.body.id)}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(vacio.body.id) },
    })
    expect(borrado.status, 'un producto sin ninguna operacion tiene que poder borrarse').toBeLessThan(300) // prettier-ignore

    // El de la fixture tiene su INITIAL: ya no se borra, se da de baja.
    const negado = await call(BORRAR_PRODUCTO, `/api/products/${String(fx.productoA.id)}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
    })
    expect(negado.status).toBe(409)
    expect(errorDe(negado).code).toBe('PRODUCT_HAS_MOVEMENTS')
    expect(await prisma.product.count({ where: { id: fx.productoA.id } })).toBe(1)
  })
})

describe('SALE — la venta deja su rastro por producto', () => {
  it('vender dos unidades escribe un movimiento de -2 atado a la venta', async () => {
    const venta = await vender(2)
    expect(venta.status).toBeLessThan(300)

    const movimientos = await movimientosDe(fx.branchA.id, fx.productoA.id)
    expect(movimientos).toHaveLength(2) // INITIAL de la fixture + la venta

    const mov = movimientos[1]
    expect(mov?.type).toBe('SALE')
    expect(num(mov?.quantity)).toBe(-2)
    expect(num(mov?.previousQuantity)).toBe(10)
    expect(num(mov?.resultingQuantity)).toBe(8)
    expect(mov?.referenceType).toBe('Sale')
    expect(mov?.referenceId).toBe(venta.body.id)
    expect(mov?.userId, 'el movimiento lleva a quien vendio, no al dueño').toBe(fx.cajero.id)

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(8)
    await exigirLibroCuadrado()
  })

  it('una venta con dos productos deja un movimiento por producto', async () => {
    const otro = await prisma.product.create({
      data: {
        name: 'Fideos Matarazzo',
        price: 1800,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
      },
    })
    await ponerStock(fx.branchA.id, otro.id, 30, fx.admin.id)

    const res = await call<VentaCreada>(CREAR_VENTA, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: {
        items: [
          { productId: fx.productoA.id, quantity: 1 },
          { productId: otro.id, quantity: 4 },
        ],
        paymentMethod: 'efectivo',
      },
    })
    expect(res.status).toBeLessThan(300)

    const deLaVenta = await prisma.stockMovement.findMany({
      where: { referenceType: 'Sale', referenceId: res.body.id },
      orderBy: { productId: 'asc' },
    })
    expect(deLaVenta).toHaveLength(2)
    expect(
      deLaVenta.map((m) => m.quantity.toFixed(3)).sort(),
      'la venta descuenta la cantidad exacta de cada linea',
    ).toEqual(['-1.000', '-4.000'])

    await exigirLibroCuadrado()
  })

  it('una venta que no alcanza no deja NI venta NI movimiento', async () => {
    // Atomicidad: si el stock no da, no puede quedar la venta escrita y el
    // stock sin descontar, ni al reves.
    const res = await vender(999)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_STOCK')

    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.saleItem.count()).toBe(0)
    expect(await prisma.salePayment.count()).toBe(0)
    expect(await prisma.cashRegisterMovement.count()).toBe(0)
    expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(0)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)

    await exigirLibroCuadrado()
  })
})

describe('SALE_CANCEL — la anulacion agrega, no borra', () => {
  it('deja el movimiento original y le suma el inverso', async () => {
    const venta = await vender(2)
    await anular(venta.body.id, 'Se arrepintio')

    const movimientos = await movimientosDe(fx.branchA.id, fx.productoA.id)
    expect(movimientos).toHaveLength(3) // INITIAL + SALE + SALE_CANCEL

    const original = movimientos[1]
    const inverso = movimientos[2]

    expect(original?.type, 'el SALE original NO se toca').toBe('SALE')
    expect(num(original?.quantity)).toBe(-2)

    expect(inverso?.type).toBe('SALE_CANCEL')
    expect(num(inverso?.quantity)).toBe(2)
    expect(num(inverso?.previousQuantity)).toBe(8)
    expect(num(inverso?.resultingQuantity)).toBe(10)
    expect(inverso?.referenceType).toBe('Sale')
    expect(inverso?.referenceId, 'queda atada a la misma venta').toBe(venta.body.id)
    expect(inverso?.reason).toBe('Se arrepintio')
    expect(inverso?.userId, 'lleva a quien anulo, no a quien vendio').toBe(fx.admin.id)

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    await exigirLibroCuadrado()
  })

  it('los dos movimientos de la venta suman cero', async () => {
    const venta = await vender(3)
    await anular(venta.body.id)

    const suma = await prisma.stockMovement.aggregate({
      where: { referenceType: 'Sale', referenceId: venta.body.id },
      _sum: { quantity: true },
    })
    expect(num(suma._sum.quantity), 'una venta anulada no movio stock, netamente').toBe(0)
  })

  it('una segunda anulacion no devuelve el stock dos veces', async () => {
    const venta = await vender(2)
    await anular(venta.body.id)
    const segunda = await anular(venta.body.id)

    expect(segunda.status).toBe(409)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await prisma.stockMovement.count({ where: { type: 'SALE_CANCEL' } })).toBe(1)
    await exigirLibroCuadrado()
  })
})

describe('Ajustes: el tipo es el dato', () => {
  const casos = [
    { tipo: 'MANUAL_ADJUSTMENT', delta: 5, motivo: 'Entrada de mercaderia', queda: 15 },
    { tipo: 'LOSS', delta: -3, motivo: 'Vencido', queda: 7 },
    { tipo: 'BREAKAGE', delta: -2, motivo: 'Se cayo un cajon', queda: 8 },
    { tipo: 'INTERNAL_USE', delta: -1, motivo: 'Degustacion', queda: 9 },
  ] as const

  for (const caso of casos) {
    it(`${caso.tipo} queda registrado con su tipo, su motivo y sus saldos`, async () => {
      const res = await ajustar({ delta: caso.delta, type: caso.tipo, reason: caso.motivo })
      expect(res.status).toBeLessThan(300)

      const movimientos = await movimientosDe(fx.branchA.id, fx.productoA.id)
      const mov = movimientos[1]

      expect(mov?.type).toBe(caso.tipo)
      expect(num(mov?.quantity)).toBe(caso.delta)
      expect(num(mov?.previousQuantity)).toBe(10)
      expect(num(mov?.resultingQuantity)).toBe(caso.queda)
      expect(mov?.reason).toBe(caso.motivo)

      expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(caso.queda)
      await exigirLibroCuadrado()
    })
  }

  it('sin tipo declarado es un ajuste generico, no una perdida', async () => {
    // Obligar a clasificar cada correccion de carga como perdida seria mentir.
    await ajustar({ delta: 2, reason: 'Correccion de carga' })
    const mov = (await movimientosDe(fx.branchA.id, fx.productoA.id))[1]
    expect(mov?.type).toBe('MANUAL_ADJUSTMENT')
  })

  it('una perdida no puede sumar unidades', async () => {
    const res = await ajustar({ delta: 3, type: 'LOSS', reason: 'Intento invalido' })
    expect(res.status).toBe(400)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
  })

  it('un ajuste no puede declarar una venta', async () => {
    // La pantalla de ajustes no puede escribir un SALE: eso fabricaria una
    // salida de mercaderia sin venta que la respalde.
    const res = await ajustar({ delta: -1, type: 'SALE', reason: 'Intento invalido' })
    expect(res.status).toBe(400)
    expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(0)
  })

  it('el motivo sigue siendo obligatorio', async () => {
    const res = await ajustar({ delta: -1, type: 'BREAKAGE' })
    expect(res.status).toBe(400)
    await exigirLibroCuadrado()
  })

  it('un ajuste queda ademas en la bitacora de seguridad', async () => {
    await ajustar({ delta: -2, type: 'BREAKAGE', reason: 'Se rompio' })

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'StockMovement' },
      orderBy: { id: 'desc' },
    })
    expect(log?.reason).toBe('Se rompio')
    expect(log?.branchId).toBe(fx.branchA.id)
    expect(log?.userId).toBe(fx.admin.id)
  })

  it('una venta NO duplica entrada de bitacora por producto', async () => {
    // La venta ya se audita entera. Una entrada por linea convertiria una
    // venta de quince productos en dieciseis filas que dicen lo mismo.
    await vender(1)
    expect(await prisma.auditLog.count({ where: { tableName: 'StockMovement' } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { tableName: 'Sale' } })).toBe(1)
  })
})

describe('El recuento se convierte en delta', () => {
  it('"quedan 30" sobre 10 se registra como +20, con los dos saldos', async () => {
    const res = await call(RECUENTO, `/api/stock/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { quantity: 30, reason: 'Recuento fisico de fin de mes' },
    })
    expect(res.status).toBeLessThan(300)

    const mov = (await movimientosDe(fx.branchA.id, fx.productoA.id))[1]
    expect(mov?.type).toBe('MANUAL_ADJUSTMENT')
    expect(num(mov?.quantity), 'se guarda COMO se llego, no solo a donde').toBe(20)
    expect(num(mov?.previousQuantity)).toBe(10)
    expect(num(mov?.resultingQuantity)).toBe(30)

    await exigirLibroCuadrado()
  })

  it('un recuento que coincide con el stock actual se rechaza', async () => {
    const res = await call(RECUENTO, `/api/stock/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { quantity: 10, reason: 'Recuento sin cambios' },
    })
    expect(res.status).toBe(400)
    expect(await prisma.stockMovement.count({ where: { type: 'MANUAL_ADJUSTMENT' } })).toBe(0)
  })
})

describe('El stock no queda negativo, nunca', () => {
  it('un ajuste que se pasa se rechaza y no escribe nada', async () => {
    const res = await ajustar({ delta: -11, type: 'LOSS', reason: 'Mas de lo que hay' })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_STOCK')

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await prisma.stockMovement.count({ where: { type: 'LOSS' } })).toBe(0)
    await exigirLibroCuadrado()
  })

  it('vender exactamente lo que hay lo deja en cero, y una unidad mas falla', async () => {
    expect((await vender(10)).status).toBeLessThan(300)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(0)

    const otra = await vender(1)
    expect(otra.status).toBe(409)

    await exigirLibroCuadrado()
  })

  it('ningun saldo del libro es negativo', async () => {
    await vender(4)
    await ajustar({ delta: -3, type: 'BREAKAGE', reason: 'Rotura' })

    const negativos = await prisma.stockMovement.count({ where: { resultingQuantity: { lt: 0 } } })
    expect(negativos).toBe(0)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(3)
  })
})

describe('Un movimiento no se edita y no se borra', () => {
  it('la base rechaza el UPDATE y el DELETE, no solo el codigo', async () => {
    await vender(1)
    const mov = (await movimientosDe(fx.branchA.id, fx.productoA.id))[1]
    expect(mov).toBeDefined()
    const id = mov?.id ?? 0

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "StockMovement" SET "quantity" = 99 WHERE "id" = ${id}`),
      'un UPDATE directo sobre el libro tiene que fallar en la base',
    ).rejects.toThrow(/inmutables/i)

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "StockMovement" WHERE "id" = ${id}`),
      'un DELETE directo sobre el libro tiene que fallar en la base',
    ).rejects.toThrow(/inmutables/i)

    const sigue = await prisma.stockMovement.findUnique({ where: { id } })
    expect(num(sigue?.quantity)).toBe(-1)
  })

  it('la base rechaza una fila cuyos tres numeros no concuerdan', async () => {
    await expect(
      prisma.stockMovement.create({
        data: {
          branchId: fx.branchA.id,
          productId: fx.productoA.id,
          type: 'MANUAL_ADJUSTMENT',
          quantity: 5,
          previousQuantity: 10,
          resultingQuantity: 99, // 10 + 5 no es 99
          userId: fx.admin.id,
        },
      }),
      'que 10 mas 5 den 99 tiene que ser imposible, no improbable',
    ).rejects.toThrow()
  })

  it('la base rechaza una venta que aumente el stock', async () => {
    await expect(
      prisma.stockMovement.create({
        data: {
          branchId: fx.branchA.id,
          productId: fx.productoA.id,
          type: 'SALE',
          quantity: 5,
          previousQuantity: 10,
          resultingQuantity: 15,
          userId: fx.admin.id,
        },
      }),
    ).rejects.toThrow()
  })

  it('la base rechaza un tipo inventado', async () => {
    await expect(
      prisma.stockMovement.create({
        data: {
          branchId: fx.branchA.id,
          productId: fx.productoA.id,
          type: 'REGALO',
          quantity: -1,
          previousQuantity: 10,
          resultingQuantity: 9,
          userId: fx.admin.id,
        },
      }),
    ).rejects.toThrow()
  })
})

describe('Reconstruccion del stock', () => {
  it('despues de vender, anular y ajustar, el libro reconstruye el saldo', async () => {
    const v1 = await vender(3)
    await vender(2)
    await anular(v1.body.id)
    await ajustar({ delta: 6, reason: 'Entrada de mercaderia' })
    await ajustar({ delta: -1, type: 'BREAKAGE', reason: 'Rotura' })

    // 10 - 3 - 2 + 3 + 6 - 1 = 13
    const suma = await prisma.stockMovement.aggregate({
      where: { branchId: fx.branchA.id, productId: fx.productoA.id },
      _sum: { quantity: true },
    })
    expect(num(suma._sum.quantity)).toBe(13)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(13)

    await exigirLibroCuadrado()
  })

  it('cada movimiento arranca donde termino el anterior', async () => {
    // La cadena tiene que ser continua: si un saldo anterior no coincide con
    // el resultante del movimiento previo, hubo un cambio sin registrar.
    await vender(1)
    await ajustar({ delta: 5, reason: 'Entrada' })
    await ajustar({ delta: -2, type: 'LOSS', reason: 'Faltante' })

    const movimientos = await movimientosDe(fx.branchA.id, fx.productoA.id)
    for (let i = 1; i < movimientos.length; i++) {
      expect(
        num(movimientos[i]?.previousQuantity),
        `El movimiento ${String(movimientos[i]?.id)} arranca en un saldo que nadie dejo`,
      ).toBe(num(movimientos[i - 1]?.resultingQuantity))
    }
  })
})

describe('Historial: filtros, paginacion y permisos', () => {
  it('el cajero no puede ver el libro aunque vea el stock', async () => {
    const res = await historial('', fx.cajero)
    expect(res.status).toBe(403)
    expect(errorDe(res).code).toBe('FORBIDDEN')
  })

  it('el repositor si puede', async () => {
    const repositor = fx.porRol.repositor
    expect(repositor).toBeDefined()
    if (!repositor) return
    const res = await historial('', repositor)
    expect(res.status).toBeLessThan(300)
  })

  it('solo muestra los movimientos de la sucursal propia', async () => {
    await vender(1)
    await ponerStock(fx.branchB.id, fx.productoB.id, 25, fx.cajeroB.id)

    const res = await historial()
    const sucursales = new Set(res.body.data.map((m) => m.product.id))
    expect(sucursales.has(fx.productoB.id), 'se filtro un movimiento de otra sucursal').toBe(false)
  })

  it('el mas reciente va primero', async () => {
    await vender(1)
    await ajustar({ delta: 4, reason: 'Entrada posterior' })

    const res = await historial()
    expect(res.body.data[0]?.type).toBe('MANUAL_ADJUSTMENT')
    expect(res.body.data[0]?.reason).toBe('Entrada posterior')
  })

  it('filtra por tipo', async () => {
    await vender(1)
    await ajustar({ delta: -2, type: 'BREAKAGE', reason: 'Rotura' })
    await ajustar({ delta: 3, reason: 'Entrada' })

    const res = await historial('?tipo=BREAKAGE')
    expect(res.body.pagination.total).toBe(1)
    expect(res.body.data[0]?.type).toBe('BREAKAGE')
    expect(res.body.data[0]?.typeLabel, 'la pantalla no muestra el codigo crudo').toBe('Rotura')
  })

  it('filtra por producto y por usuario', async () => {
    await vender(1) // cajero
    await ajustar({ delta: 2, reason: 'Entrada' }) // admin

    const porUsuario = await historial(`?usuarioId=${String(fx.cajero.id)}`)
    expect(porUsuario.body.pagination.total).toBe(1)
    expect(porUsuario.body.data[0]?.type).toBe('SALE')

    const porProducto = await historial(`?productId=${String(fx.productoA.id)}`)
    expect(porProducto.body.pagination.total).toBe(3) // INITIAL + venta + ajuste
  })

  it('filtra por la venta que lo origino', async () => {
    const venta = await vender(2)
    await ajustar({ delta: 1, reason: 'Ruido' })

    const res = await historial(`?referenceType=Sale&referenceId=${String(venta.body.id)}`)
    expect(res.body.pagination.total).toBe(1)
    // La API devuelve las cantidades como cadena decimal, igual que el dinero.
    expect(res.body.data[0]?.quantity).toBe('-2.000')
  })

  it('busca por nombre de producto', async () => {
    await vender(1)
    const res = await historial('?q=Fernet')
    expect(res.body.pagination.total).toBeGreaterThan(0)

    const vacio = await historial('?q=NoExisteEsteProducto')
    expect(vacio.body.pagination.total).toBe(0)
  })

  it('pagina, y no devuelve el libro entero', async () => {
    for (let i = 0; i < 8; i++) {
      await ajustar({ delta: 1, reason: `Entrada ${String(i)}` })
    }

    const res = await historial('?pageSize=3')
    expect(res.body.data).toHaveLength(3)
    // 8 ajustes + los dos INITIAL de la sucursal A (el fernet y el queso).
    expect(res.body.pagination.total).toBe(10)
    expect(res.body.pagination.totalPages).toBe(4)

    const segunda = await historial('?pageSize=3&page=2')
    expect(segunda.body.data).toHaveLength(3)
    const idsPrimera = res.body.data.map((m) => m.id)
    const idsSegunda = segunda.body.data.map((m) => m.id)
    expect(idsPrimera.some((id) => idsSegunda.includes(id)), 'las paginas se solapan').toBe(false) // prettier-ignore
  })

  it('no existe forma de escribir el libro por la API', async () => {
    const mod: Record<string, unknown> = await import('@/app/api/inventory/movements/route')
    expect('POST' in mod).toBe(false)
    expect('PUT' in mod).toBe(false)
    expect('PATCH' in mod).toBe(false)
    expect('DELETE' in mod).toBe(false)
  })
})

describe('Stock minimo y alertas', () => {
  async function reposicion(usuario = fx.admin) {
    return call<{ agotados: number; bajoMinimo: number; sinMinimo: number }>(
      REPOSICION,
      '/api/inventory/replenishment',
      { cookie: await sessionCookie(usuario) },
    )
  }

  it('sin minimo configurado nadie esta bajo minimo', async () => {
    // El catalogo migrado arranca con minimo cero, y con cero la condicion
    // `cantidad > 0 && cantidad <= 0` no se cumple nunca. Es intencional.
    const res = await reposicion()
    expect(res.body.bajoMinimo).toBe(0)
    expect(res.body.agotados).toBe(0)
    // Dos: el fernet y el queso por peso. Ninguno tiene minimo configurado.
    expect(res.body.sinMinimo, 'hay que poder decir que nadie configuro minimos').toBe(2)
  })

  it('con minimo 6 y diez unidades sigue estando bien', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 6 } })
    const res = await reposicion()
    expect(res.body.bajoMinimo).toBe(0)
    // El queso sigue sin minimo: se le puso solo al fernet.
    expect(res.body.sinMinimo).toBe(1)
  })

  it('con minimo 6, vender cinco lo pone bajo minimo', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 6 } })
    await vender(5)

    const res = await reposicion()
    expect(res.body.bajoMinimo).toBe(1)
    expect(res.body.agotados).toBe(0)
  })

  it('vender todo lo pone agotado, no bajo minimo', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 6 } })
    await vender(10)

    const res = await reposicion()
    expect(res.body.agotados).toBe(1)
    expect(res.body.bajoMinimo, 'agotado y bajo minimo son estados distintos').toBe(0)
  })

  it('un producto dado de baja no cuenta como faltante', async () => {
    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { minimumStock: 6, isActive: false },
    })
    await vender(10)

    const res = await reposicion()
    expect(res.body.agotados).toBe(0)
    expect(res.body.sinMinimo, 'el queso sigue activo y sin minimo').toBe(1)
  })

  it('el filtro de bajo minimo del catalogo usa el minimo del producto', async () => {
    const { GET } = await import('@/app/api/products/route')
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 6 } })

    const antes = await call<{ pagination: { total: number } }>(
      GET,
      '/api/products?lowStock=true&estado=activos',
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(antes.body.pagination.total).toBe(0)

    await vender(5)

    const despues = await call<{ pagination: { total: number } }>(
      GET,
      '/api/products?lowStock=true&estado=activos',
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(despues.body.pagination.total).toBe(1)
  })

  it('el catalogo devuelve el estado calculado, no guardado', async () => {
    const { GET } = await import('@/app/api/products/route')
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 6 } })
    await vender(5)

    const res = await call<{ data: Array<{ estado: string; minimumStock: string }> }>(
      GET,
      `/api/products?ids=${String(fx.productoA.id)}`,
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(res.body.data[0]?.estado).toBe('LOW')
    expect(res.body.data[0]?.minimumStock).toBe('6.000')

    // Y sin tocar nada mas, subir el minimo cambia el estado: si estuviera
    // guardado en la base, seguiria diciendo lo de antes.
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { minimumStock: 0 } })
    const otra = await call<{ data: Array<{ estado: string }> }>(
      GET,
      `/api/products?ids=${String(fx.productoA.id)}`,
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(otra.body.data[0]?.estado).toBe('OK')
  })
})
