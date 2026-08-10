/**
 * La reconciliacion: que CIERRE, y que sepa detectar cuando no.
 *
 * Dos mitades, y la segunda es la que importa:
 *
 *   1. Una base sana no reporta nada. Facil de conseguir y facil de creer.
 *   2. Una base rota reporta EXACTAMENTE lo que se rompio. Es lo que separa
 *      una comprobacion de un adorno: si no falla cuando tiene que fallar,
 *      que pase no significa nada.
 *
 * Cada inconsistencia se inyecta con SQL DIRECTO, saltando los servicios: es
 * la unica forma de producir el estado que las defensas de la aplicacion
 * impiden. Simula lo que si puede pasar de verdad --una restauracion parcial,
 * una edicion a mano, un error de una version anterior-- que es contra lo que
 * la reconciliacion existe.
 *
 * Ver docs/PHASE3_RECONCILIATION.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { comprobarIntegridad } from '@/modules/integrity/service'
import type { Informe } from '@/modules/integrity/tipos'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Las inconsistencias de una comprobacion concreta. */
function de(informe: Informe, nombre: string) {
  const c = informe.comprobaciones.find((x) => x.nombre === nombre)
  expect(c, `no existe la comprobacion "${nombre}"`).toBeDefined()
  return c?.inconsistencias ?? []
}

/** Una venta de 2 unidades del producto A, cobrada en efectivo. */
async function venderEfectivo() {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number; total: string }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: {
      items: [{ productId: fx.productoA.id, quantity: '2' }],
      payments: [{ method: 'CASH', amount: '25000.00' }],
    },
  })
}

// ---------------------------------------------------------------------------
// La base sana cierra
// ---------------------------------------------------------------------------

describe('Una base sana no reporta nada', () => {
  it('la fixture recien creada cierra en las nueve comprobaciones', async () => {
    const informe = await comprobarIntegridad()
    expect(
      informe.comprobaciones.filter((c) => c.inconsistencias.length > 0).map((c) => c.nombre),
      'la fixture no deberia tener inconsistencias',
    ).toEqual([])
    expect(informe.total).toBe(0)
  })

  it('despues de vender, cobrar y ajustar stock sigue cerrando', async () => {
    const venta = await venderEfectivo()
    expect(venta.status).toBe(201)

    const { PATCH } = await import('@/app/api/stock/[id]/route')
    const ajuste = await call(PATCH, `/api/stock/${String(fx.productoA.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { delta: '-1', type: 'BREAKAGE', reason: 'Se cayo una' },
    })
    expect(ajuste.status).toBe(200)

    const informe = await comprobarIntegridad()
    expect(informe.total, 'una operacion normal descuadro el sistema').toBe(0)
  })

  it('una venta con pago combinado deja el cajon con SOLO el efectivo', async () => {
    // $30.000 = $10.000 efectivo + $20.000 transferencia. La caja sube 10.000.
    const { POST } = await import('@/app/api/sales/route')
    const venta = await call<{ id: number }>(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        // $25.000 = $10.000 en efectivo + $15.000 por transferencia.
        items: [{ productId: fx.productoA.id, quantity: '2' }],
        payments: [
          { method: 'CASH', amount: '10000.00' },
          { method: 'TRANSFER', amount: '15000.00' },
        ],
      },
    })
    expect(venta.status, JSON.stringify(venta.body)).toBe(201)

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId: venta.body.id },
      select: { amount: true, paymentMethod: true },
      orderBy: { id: 'asc' },
    })
    const efectivo = movimientos.filter((m) => m.paymentMethod === 'CASH')
    expect(efectivo).toHaveLength(1)
    expect(efectivo[0]?.amount.toFixed(2), 'la transferencia entro al cajon').toBe('10000.00')

    const informe = await comprobarIntegridad()
    expect(informe.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// La base rota se detecta
// ---------------------------------------------------------------------------

describe('Detecta lo que se rompe, y solo eso', () => {
  it('un total de venta que no coincide con sus lineas', async () => {
    const venta = await venderEfectivo()
    await prisma.$executeRaw`
      UPDATE "Sale" SET "total" = "total" + 1000 WHERE "id" = ${venta.body.id}
    `

    const informe = await comprobarIntegridad()
    const ventas = de(informe, 'Ventas')

    expect(ventas).toHaveLength(1)
    expect(ventas[0]?.entidad).toBe(`Venta #${String(venta.body.id)}`)
    expect(ventas[0]?.regla).toBe('total = suma de las lineas')
    expect(ventas[0]?.diferencia).toBe('1000')
  })

  it('un pago que no suma el total', async () => {
    const venta = await venderEfectivo()
    await prisma.$executeRaw`
      UPDATE "SalePayment" SET "amount" = "amount" - 500 WHERE "saleId" = ${venta.body.id}
    `

    const pagos = de(await comprobarIntegridad(), 'Pagos')
    expect(pagos).toHaveLength(1)
    expect(pagos[0]?.regla).toBe('total = suma de los pagos')
    expect(pagos[0]?.diferencia).toBe('-500')
  })

  it('una venta sin ningun pago registrado, informada aparte', async () => {
    const venta = await venderEfectivo()
    await prisma.$executeRaw`DELETE FROM "SalePayment" WHERE "saleId" = ${venta.body.id}`

    const pagos = de(await comprobarIntegridad(), 'Pagos')
    expect(pagos).toHaveLength(1)
    // Regla DISTINTA de "los importes no suman": una base anterior a la Fase
    // 3.4 tiene ventas asi, y mezclarlas haria que un dato viejo conocido se
    // lea como un descuadre nuevo.
    expect(pagos[0]?.regla).toBe('toda venta tiene sus pagos registrados')
  })

  it('UNA TRANSFERENCIA QUE AUMENTA EL EFECTIVO', async () => {
    // Es LA invariante del objetivo. Se fuerza el caso cambiandole el medio a
    // un movimiento de caja: la venta dice que se cobro por transferencia y la
    // caja dice que entro efectivo.
    const { POST } = await import('@/app/api/sales/route')
    const venta = await call<{ id: number }>(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        items: [{ productId: fx.productoA.id, quantity: '2' }],
        payments: [{ method: 'TRANSFER', amount: '25000.00' }],
      },
    })

    await prisma.$executeRaw`
      UPDATE "CashRegisterMovement" SET "paymentMethod" = 'CASH'
       WHERE "saleId" = ${venta.body.id} AND "type" = 'sale'
    `

    const caja = de(await comprobarIntegridad(), 'Venta y caja')
    // Dos filas: falta el movimiento de TRANSFER y sobra el de CASH.
    expect(caja).toHaveLength(2)
    expect(caja.map((i) => i.entidad).sort()).toEqual([
      `Venta #${String(venta.body.id)} (CASH)`,
      `Venta #${String(venta.body.id)} (TRANSFER)`,
    ])
  })

  it('una anulacion cuya reversion no cierra', async () => {
    const venta = await venderEfectivo()

    const { POST } = await import('@/app/api/sales/[id]/cancel/route')
    await call(POST, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(venta.body.id) },
      body: { reason: 'Se arrepintio' },
    })

    // Sana antes de tocarla.
    expect(de(await comprobarIntegridad(), 'Anulaciones')).toHaveLength(0)

    await prisma.$executeRaw`
      UPDATE "CashRegisterMovement" SET "amount" = "amount" + 100
       WHERE "saleId" = ${venta.body.id} AND "type" = 'sale_cancel'
    `

    const anulaciones = de(await comprobarIntegridad(), 'Anulaciones')
    expect(anulaciones).toHaveLength(1)
    expect(anulaciones[0]?.regla).toBe('venta + reversion = 0')
    expect(anulaciones[0]?.encontrado).toBe('100.00')
  })

  it('un turno cerrado cuyo esperado no se deriva de sus movimientos', async () => {
    await venderEfectivo()

    const { POST } = await import('@/app/api/cash/shift/[id]/close/route')
    const cierre = await call<{ turno: { esperado: string } }>(
      POST,
      `/api/cash/shift/${String(fx.turnoA)}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.turnoA) },
        body: { countedAmount: '30000.00', notes: 'Cierre de prueba' },
      },
    )
    expect(cierre.status).toBe(200)
    expect(de(await comprobarIntegridad(), 'Turnos de caja')).toHaveLength(0)

    await prisma.$executeRaw`
      UPDATE "CashShift" SET "expectedAmount" = "expectedAmount" + 250 WHERE "id" = ${fx.turnoA}
    `

    const turnos = de(await comprobarIntegridad(), 'Turnos de caja')
    // Dos: el esperado dejo de derivarse Y la diferencia dejo de ser
    // contado - esperado. Las dos son ciertas y las dos se informan.
    expect(turnos).toHaveLength(2)
    expect(turnos.map((t) => t.regla).sort()).toEqual([
      'diferencia = contado - esperado',
      'esperado = inicial + efectivo del turno',
    ])
  })

  it('el stock que no coincide con el libro', async () => {
    await prisma.$executeRaw`
      UPDATE "BranchStock" SET "quantity" = "quantity" + 0.250
       WHERE "productId" = ${fx.productoPeso.id} AND "branchId" = ${fx.branchA.id}
    `

    const inv = de(await comprobarIntegridad(), 'Inventario')
    expect(inv).toHaveLength(1)
    expect(inv[0]?.entidad).toBe(fx.productoPeso.name)
    expect(inv[0]?.regla).toBe('stock = suma del libro')
    expect(inv[0]?.diferencia).toBe('0.25')
  })

  it('un movimiento BORRADO DEL MEDIO, con el saldo ajustado a mano', async () => {
    // ES EL CASO QUE LAS OTRAS DOS REGLAS NO VEN.
    //
    // Se borra el movimiento del medio y se ajusta `BranchStock` para que la
    // suma vuelva a cerrar. Con eso, la regla del saldo queda satisfecha y
    // cada fila sobreviviente sigue siendo coherente consigo misma: previo +
    // delta = resultante. Solo la CADENA --cada fila empieza donde termino la
    // anterior-- ve el hueco.
    const primera = await venderEfectivo()
    await venderEfectivo()

    const delMedio = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceType: 'Sale', referenceId: primera.body.id },
      select: { id: true, quantity: true, productId: true, branchId: true },
    })

    // Se salta el disparador de inmutabilidad, que es justo el que impide
    // llegar a este estado desde la aplicacion. Simula una restauracion
    // parcial o una edicion directa sobre la base.
    await prisma.$executeRaw`ALTER TABLE "StockMovement" DISABLE TRIGGER USER`
    try {
      await prisma.$executeRaw`DELETE FROM "StockMovement" WHERE "id" = ${delMedio.id}`
    } finally {
      await prisma.$executeRaw`ALTER TABLE "StockMovement" ENABLE TRIGGER USER`
    }
    await prisma.$executeRaw`
      UPDATE "BranchStock" SET "quantity" = "quantity" - ${delMedio.quantity}
       WHERE "productId" = ${delMedio.productId} AND "branchId" = ${delMedio.branchId}
    `

    const inv = de(await comprobarIntegridad(), 'Inventario')
    const cadena = inv.filter((i) => i.regla === 'empieza donde termino el anterior')
    const saldos = inv.filter((i) => i.regla === 'stock = suma del libro')

    expect(saldos, 'el saldo cuadraba: por eso hace falta la cadena').toHaveLength(0)
    expect(cadena, 'la cadena no detecto el movimiento borrado').toHaveLength(1)
    expect(cadena[0]?.detalle).toBe('falta un movimiento entre este y el anterior')
  })

  it('borrar el ULTIMO movimiento y ajustar el saldo NO se detecta, y hay que saberlo', async () => {
    // El limite honesto de estas tres reglas.
    //
    // Si se borra el ultimo movimiento de un producto y se ajusta
    // `BranchStock` a mano, no queda hueco en la cadena --no hay fila
    // posterior que lo delate-- ni descuadre en el saldo. La reconciliacion
    // no puede verlo, y decirlo aca vale mas que fingir que si.
    //
    // Contra ESE caso protege otra cosa: el disparador que impide UPDATE y
    // DELETE sobre el libro, que hay que desactivar a proposito --como hace
    // esta prueba-- para llegar a ese estado.
    const venta = await venderEfectivo()

    const ultimo = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceType: 'Sale', referenceId: venta.body.id },
      select: { id: true, quantity: true, productId: true, branchId: true },
    })

    await prisma.$executeRaw`ALTER TABLE "StockMovement" DISABLE TRIGGER USER`
    try {
      await prisma.$executeRaw`DELETE FROM "StockMovement" WHERE "id" = ${ultimo.id}`
    } finally {
      await prisma.$executeRaw`ALTER TABLE "StockMovement" ENABLE TRIGGER USER`
    }
    await prisma.$executeRaw`
      UPDATE "BranchStock" SET "quantity" = "quantity" - ${ultimo.quantity}
       WHERE "productId" = ${ultimo.productId} AND "branchId" = ${ultimo.branchId}
    `

    expect(de(await comprobarIntegridad(), 'Inventario')).toHaveLength(0)
  })

  it('una orden cuyo recibido no coincide con sus recepciones', async () => {
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number; items: Array<{ id: number }> }>(
      crear,
      '/api/purchases',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: {
          supplierId: fx.proveedor.id,
          items: [{ productId: fx.productoCaja.id, quantity: '5', unitCost: '8800' }],
        },
      },
    )
    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    await call(confirmar, `/api/purchases/${String(orden.body.id)}/confirm`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.body.id) },
    })

    const { POST: recibir } = await import('@/app/api/purchases/[id]/receive/route')
    await call(recibir, `/api/purchases/${String(orden.body.id)}/receive`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.body.id) },
      body: { items: [{ orderItemId: orden.body.items[0]?.id, quantity: '3' }] },
    })

    expect(de(await comprobarIntegridad(), 'Compras')).toHaveLength(0)

    // Se sube el recibido de la linea sin tocar las recepciones. Es lo que
    // pasaria si alguien "corrigiera" la orden a mano.
    await prisma.$executeRaw`
      UPDATE "PurchaseOrderItem" SET "receivedQuantity" = 4
       WHERE "purchaseOrderId" = ${orden.body.id}
    `

    const compras = de(await comprobarIntegridad(), 'Compras')
    const lineas = compras.filter((c) => c.regla.startsWith('recibido ='))
    expect(lineas).toHaveLength(1)
    expect(lineas[0]?.esperado).toBe('3.000')
    expect(lineas[0]?.encontrado).toBe('4.000')
  })

  it('un costo actual que no es el del ultimo evento del historial', async () => {
    const { PUT } = await import('@/app/api/products/[id]/cost/route')
    await call(PUT, `/api/products/${String(fx.productoA.id)}/cost`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { cost: '8000.00', reason: 'Lista de mayo' },
    })

    expect(de(await comprobarIntegridad(), 'Costos')).toHaveLength(0)

    // Alguien cambia el costo sin dejar rastro, que es exactamente lo que la
    // invariante existe para hacer imposible de esconder.
    await prisma.$executeRaw`
      UPDATE "Product" SET "cost" = 9999 WHERE "id" = ${fx.productoA.id}
    `

    const costos = de(await comprobarIntegridad(), 'Costos')
    expect(costos).toHaveLength(1)
    expect(costos[0]?.regla).toBe('costo actual = ultimo evento del historial')
    expect(costos[0]?.esperado).toBe('8000.0000')
    expect(costos[0]?.encontrado).toBe('9999.0000')
  })
})

// ---------------------------------------------------------------------------
// La regla del ultimo evento de costo
// ---------------------------------------------------------------------------

describe('El ultimo evento de costo manda, venga de donde venga', () => {
  async function cambiarCosto(valor: string, motivo: string) {
    const { PUT } = await import('@/app/api/products/[id]/cost/route')
    return call(PUT, `/api/products/${String(fx.productoCaja.id)}/cost`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoCaja.id) },
      body: { cost: valor, reason: motivo },
    })
  }

  async function recibirUnaCaja(costoPorCaja: string) {
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number; items: Array<{ id: number }> }>(
      crear,
      '/api/purchases',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: {
          supplierId: fx.proveedor.id,
          items: [{ productId: fx.productoCaja.id, quantity: '1', unitCost: costoPorCaja }],
        },
      },
    )
    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    await call(confirmar, `/api/purchases/${String(orden.body.id)}/confirm`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.body.id) },
    })
    const { POST: recibir } = await import('@/app/api/purchases/[id]/receive/route')
    return call(recibir, `/api/purchases/${String(orden.body.id)}/receive`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.body.id) },
      body: { items: [{ orderItemId: orden.body.items[0]?.id, quantity: '1' }] },
    })
  }

  async function costoActual(): Promise<string | null> {
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoCaja.id },
      select: { cost: true },
    })
    return p.cost === null ? null : p.cost.toFixed(4)
  }

  it('una correccion manual POSTERIOR le gana a la recepcion', async () => {
    await recibirUnaCaja('8800') // 8800 / 8 = 1100
    expect(await costoActual()).toBe('1100.0000')

    const res = await cambiarCosto('1050.00', 'Nos hicieron una bonificacion')
    expect(res.status).toBe(200)

    expect(await costoActual(), 'la recepcion no puede ganarle a lo que vino despues').toBe(
      '1050.0000',
    )
    expect(await comprobarIntegridad().then((i) => i.total)).toBe(0)
  })

  it('y una recepcion POSTERIOR le gana a la correccion manual', async () => {
    await cambiarCosto('1050.00', 'Bonificacion')
    await recibirUnaCaja('9600') // 9600 / 8 = 1200

    expect(await costoActual(), 'el camion nuevo manda').toBe('1200.0000')
    expect(await comprobarIntegridad().then((i) => i.total)).toBe(0)
  })

  it('el historial encadena aunque se mezclen los dos origenes', async () => {
    await recibirUnaCaja('8800')
    await cambiarCosto('1050.00', 'Bonificacion')
    await recibirUnaCaja('9600')

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoCaja.id },
      orderBy: { id: 'asc' },
      select: { previousCost: true, newCost: true, receiptId: true },
    })

    expect(historial).toHaveLength(3)
    expect(historial.map((h) => h.newCost?.toFixed(4))).toEqual([
      '1100.0000',
      '1050.0000',
      '1200.0000',
    ])
    // Cada fila parte de donde dejo la anterior.
    expect(historial[1]?.previousCost?.toFixed(4)).toBe('1100.0000')
    expect(historial[2]?.previousCost?.toFixed(4)).toBe('1050.0000')
    // Y se distingue el origen: el del medio no vino de ninguna recepcion.
    expect(historial.map((h) => h.receiptId !== null)).toEqual([true, false, true])

    expect(await comprobarIntegridad().then((i) => i.total)).toBe(0)
  })

  it('borrar el costo guarda NULL, no cero', async () => {
    await cambiarCosto('1050.00', 'Lista de mayo')

    const { PUT } = await import('@/app/api/products/[id]/cost/route')
    const res = await call(PUT, `/api/products/${String(fx.productoCaja.id)}/cost`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoCaja.id) },
      body: { cost: null, reason: 'No sabemos a cuanto lo compramos' },
    })
    expect(res.status).toBe(200)

    const ultimo = await prisma.productCostHistory.findFirstOrThrow({
      where: { productId: fx.productoCaja.id },
      orderBy: { id: 'desc' },
      select: { newCost: true },
    })

    // Cero seria "no me costo nada" --margen del 100%--; nulo es "no sabemos".
    expect(ultimo.newCost, 'borrar el costo guardaba 0, que es otra cosa').toBeNull()
    expect(await costoActual()).toBeNull()
    expect(await comprobarIntegridad().then((i) => i.total)).toBe(0)
  })
})
