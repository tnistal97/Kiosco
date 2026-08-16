/**
 * Linea base de rendimiento y el lector con un catalogo de verdad. Fase 5A.2.
 *
 * Dos cosas, y las dos con la misma disciplina:
 *
 *   1. El BUSCADOR por codigo, que es el camino mas caliente del sistema:
 *      ocurre una vez por producto de cada ticket, con el cliente esperando.
 *      Se comprueba con 10.000 y con 100.000 codigos que su costo no dependa
 *      del tamano del catalogo, y las seis propiedades que lo hacen correcto.
 *
 *   2. Una MEDIDA de referencia de los diez caminos que importan, para poder
 *      comparar despues. Los tiempos se informan; se afirma un techo generoso
 *      que no mide la maquina sino que atrapa una regresion catastrofica.
 *
 * Los numeros medidos quedan en docs/PERFORMANCE_BASELINE.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, diaLocal, restaurarEstadisticas, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  // Este archivo carga cien mil productos. Sin esto, el planificador sigue
  // creyendo que la tabla es grande y las pruebas que corran despues --en
  // cualquier archivo-- eligen planes para un volumen que ya no existe.
  await restaurarEstadisticas()
  await prisma.$disconnect()
})

/** Tope generoso: no mide la maquina, atrapa una regresion catastrofica. */
const TECHO_MS = 400

async function cuantoTarda(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}

/**
 * `n` productos con dos codigos cada uno, en cuatro sentencias.
 *
 * Uno por uno con `prisma.product.create` serian doscientos mil viajes de ida y
 * vuelta. `generate_series` los arma dentro de PostgreSQL.
 *
 * Los codigos principales llevan CEROS INICIALES a proposito: es lo que
 * comprueba que en ningun punto del camino se conviertan a numero.
 */
async function catalogoGrande(n: number): Promise<void> {
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Product" ("name", "price", "categoryId", "branchId", "saleUnit",
                           "purchaseUnit", "unitsPerPurchaseUnit", "minimumStock", "isActive")
    SELECT 'Producto ' || i, 100 + i, ${String(fx.categoryId)}, ${String(fx.branchA.id)},
           'UNIT', 'UNIT', 1, 0, true
      FROM generate_series(1, ${String(n)}) AS i
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ProductBarcode" ("productId", "code", "isPrimary")
    SELECT p."id", '00' || lpad(p."id"::text, 11, '0'), true
      FROM "Product" p WHERE p."name" LIKE 'Producto %'
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ProductBarcode" ("productId", "code", "isPrimary")
    SELECT p."id", 'ALT' || lpad(p."id"::text, 10, '0'), false
      FROM "Product" p WHERE p."name" LIKE 'Producto %'
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "BranchStock" ("branchId", "productId", "quantity")
    SELECT ${String(fx.branchA.id)}, p."id", 50
      FROM "Product" p WHERE p."name" LIKE 'Producto %'
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "StockMovement" ("branchId", "productId", "type", "quantity",
                                 "previousQuantity", "resultingQuantity", "userId", "reason")
    SELECT ${String(fx.branchA.id)}, p."id", 'INITIAL', 50, 0, 50, ${String(fx.admin.id)},
           'Carga masiva de la medicion'
      FROM "Product" p WHERE p."name" LIKE 'Producto %'
  `)
  // Sin esto el planificador trabaja con estadisticas de una tabla vacia.
  await prisma.$executeRawUnsafe(`ANALYZE "Product", "ProductBarcode", "BranchStock"`)
}

/** El codigo principal del producto `id`, tal como lo genera `catalogoGrande`. */
function codigoDe(id: number): string {
  return `00${String(id).padStart(11, '0')}`
}

// ---------------------------------------------------------------------------
// El lector, con 10.000 y con 100.000
// ---------------------------------------------------------------------------

describe.each([10_000, 100_000])('El lector con %i productos', (cantidad) => {
  it('las seis propiedades del camino caliente', async () => {
    await catalogoGrande(cantidad)

    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const cookie = await sessionCookie(fx.cajero)
    const leer = (code: string, estado?: string) =>
      call<{ id: number; name: string; barcode: string }>(
        GET,
        `/api/products/barcode/${code}${estado === undefined ? '' : `?estado=${estado}`}`,
        { cookie, params: { code } },
      )

    // Uno del medio del catalogo, no el primero ni el ultimo.
    const alMedio = await prisma.product.findFirstOrThrow({
      where: { name: { startsWith: 'Producto ' } },
      select: { id: true },
      orderBy: { id: 'asc' },
      skip: Math.floor(cantidad / 2),
    })
    const codigo = codigoDe(alMedio.id)

    // 1 · USA EL INDICE. Sin `enable_seqscan = off`: con estadisticas frescas
    // el planificador tiene que elegirlo por su cuenta.
    const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN SELECT * FROM "ProductBarcode" WHERE "code" = '${codigo}'`,
    )
    const texto = plan.map((f) => Object.values(f).join(' ')).join(' | ')
    expect(texto, `el plan fue: ${texto}`).toMatch(/Index (Only )?Scan/)
    expect(texto).not.toMatch(/Seq Scan/)

    // 2 · PRESERVA LOS CEROS. El codigo empieza con dos ceros y el producto
    // aparece con ese codigo exacto: en ningun punto se convirtio a numero.
    expect(codigo.startsWith('00')).toBe(true)
    const conCeros = await leer(codigo)
    expect(conCeros.status, `no encontro ${codigo}`).toBe(200)
    expect(conCeros.body.barcode).toBe(codigo)
    // Y el mismo codigo sin los ceros NO encuentra nada: son codigos distintos.
    const sinCeros = await leer(codigo.replace(/^0+/, ''))
    expect(sinCeros.status, 'quitar los ceros encontro el mismo producto').toBe(404)

    // 3 · ENCUENTRA POR ALTERNATIVO, con el mismo resultado.
    const porAlternativo = await leer(`ALT${String(alMedio.id).padStart(10, '0')}`)
    expect(porAlternativo.status).toBe(200)
    expect(porAlternativo.body.id).toBe(conCeros.body.id)

    // 4 · DISTINGUE INACTIVO DE INEXISTENTE.
    await prisma.product.update({ where: { id: alMedio.id }, data: { isActive: false } })
    expect((await leer(codigo)).status, 'un producto de baja no se vende').toBe(404)
    const todos = await leer(codigo, 'todos')
    expect(todos.status, 'con ?estado=todos si aparece, y eso es lo que deja ofrecer reactivarlo').toBe(200) // prettier-ignore
    const inexistente = await leer('99999999999999')
    expect(inexistente.status).toBe(404)
    await prisma.product.update({ where: { id: alMedio.id }, data: { isActive: true } })

    // 5 · UN CODIGO DESCONOCIDO NO ESCRIBE NADA.
    const antes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT (SELECT count(*) FROM "Product") + (SELECT count(*) FROM "ProductBarcode")
            + (SELECT count(*) FROM "StockMovement") + (SELECT count(*) FROM "AuditLog") AS n`,
    )
    for (let i = 0; i < 20; i++) await leer(`8888888888${String(i).padStart(3, '0')}`)
    const despues = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT (SELECT count(*) FROM "Product") + (SELECT count(*) FROM "ProductBarcode")
            + (SELECT count(*) FROM "StockMovement") + (SELECT count(*) FROM "AuditLog") AS n`,
    )
    expect(String(despues[0]?.n), 'veinte lecturas fallidas escribieron filas').toBe(
      String(antes[0]?.n),
    )

    // 6 · NO RECORRE LA TABLA. `EXPLAIN (ANALYZE)` dice cuantas filas leyo de
    // verdad: contar sentencias no distingue una consulta que lee una fila de
    // una que recorre doscientas mil, porque las dos cuentan uno.
    const analize = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM "ProductBarcode" WHERE "code" = '99999999999999'`,
    )
    const leidas = /"Actual Rows":\s*(\d+)/.exec(JSON.stringify(analize))
    expect(Number(leidas?.[1] ?? -1), `leyo ${String(leidas?.[1])} filas`).toBe(0)

    // Y los tiempos, informados.
    const conocido = await cuantoTarda(() => leer(codigo))
    const miss = await cuantoTarda(() => leer('99999999999999'))
    console.log(
      `[5A.2] con ${String(cantidad)} productos · acierto ${conocido.toFixed(1)} ms · ` +
        `codigo inexistente ${miss.toFixed(1)} ms`,
    )
    expect(conocido).toBeLessThan(TECHO_MS)
    expect(miss).toBeLessThan(TECHO_MS)
  }, 300_000)
})

// ---------------------------------------------------------------------------
// Los diez caminos de referencia
// ---------------------------------------------------------------------------

describe('Linea base de los diez caminos', () => {
  it('mide y deja el numero anotado en la salida', async () => {
    const medido: Array<[string, number]> = []
    const anotar = async (nombre: string, fn: () => Promise<unknown>) => {
      medido.push([nombre, await cuantoTarda(fn)])
    }

    await catalogoGrande(10_000)
    const cookieCaja = await sessionCookie(fx.cajero)
    const cookieAdmin = await sessionCookie(fx.admin)

    const productos = await prisma.product.findMany({
      where: { name: { startsWith: 'Producto ' } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 20,
    })
    const ids = productos.map((p) => p.id)
    const codigo = codigoDe(ids[10] ?? 0)

    // 1-2 · el lector
    const { GET: PORCODIGO } = await import('@/app/api/products/barcode/[code]/route')
    await anotar('barcode encontrado', () =>
      call(PORCODIGO, `/api/products/barcode/${codigo}`, {
        cookie: cookieCaja,
        params: { code: codigo },
      }),
    )
    await anotar('barcode inexistente', () =>
      call(PORCODIGO, '/api/products/barcode/99999999999999', {
        cookie: cookieCaja,
        params: { code: '99999999999999' },
      }),
    )

    // 3 · alta rapida
    const { POST: QUICK } = await import('@/app/api/products/quick/route')
    await anotar('alta rapida', async () => {
      const res = await call(QUICK, '/api/products/quick', {
        method: 'POST',
        cookie: cookieAdmin,
        body: {
          barcode: '00999888777666',
          name: 'Recien creado',
          price: '1000',
          categoryId: fx.categoryId,
          saleUnit: 'UNIT',
          initialStock: '1',
        },
      })
      expect(res.status, res.text).toBe(201)
    })

    // 4-5 · stock vendible y FEFO, sobre un producto con veinte lotes
    const conLotes = await prisma.product.create({
      data: {
        name: 'Yogur con lotes',
        price: 1000,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
        lotTracking: 'REQUIRED',
        expirationTracking: 'REQUIRED',
        barcodes: { create: { code: '00888777666555', isPrimary: true } },
      },
    })
    await prisma.branchStock.create({
      data: { branchId: fx.branchA.id, productId: conLotes.id, quantity: 200 },
    })
    await prisma.stockMovement.create({
      data: {
        branchId: fx.branchA.id,
        productId: conLotes.id,
        type: 'INITIAL',
        quantity: 200,
        previousQuantity: 0,
        resultingQuantity: 200,
        userId: fx.admin.id,
        reason: 'Preparacion de la medicion',
      },
    })
    for (let i = 0; i < 20; i++) {
      const code = `L-${String(i).padStart(3, '0')}`
      const lote = await prisma.productLot.create({
        data: {
          productId: conLotes.id,
          code,
          codeNormalized: code,
          // La mitad vencidos: es lo que obliga a separar vendible de total.
          expirationDate: new Date(`${diaLocal(i < 10 ? -i - 1 : i)}T00:00:00.000Z`),
          createdById: fx.admin.id,
        },
      })
      await prisma.branchLotStock.create({
        data: { branchId: fx.branchA.id, lotId: lote.id, quantity: 10 },
      })
    }

    await anotar('stock vendible (producto con 20 lotes)', async () => {
      const res = await call<{ sellableStock: string; expiredStock: string }>(
        PORCODIGO,
        '/api/products/barcode/00888777666555',
        { cookie: cookieCaja, params: { code: '00888777666555' } },
      )
      expect(res.status).toBe(200)
      expect(res.body.expiredStock).toBe('100.000')
      expect(res.body.sellableStock).toBe('100.000')
    })

    const { POST: VENDER } = await import('@/app/api/sales/route')
    await anotar('venta con FEFO (20 lotes)', async () => {
      const res = await call(VENDER, '/api/sales', {
        method: 'POST',
        cookie: cookieCaja,
        body: { items: [{ productId: conLotes.id, quantity: 25 }], paymentMethod: 'efectivo' },
      })
      expect(res.status, res.text).toBeLessThan(300)
    })

    // 6 · venta de quince lineas
    await anotar('venta de 15 lineas', async () => {
      const res = await call(VENDER, '/api/sales', {
        method: 'POST',
        cookie: cookieCaja,
        body: {
          items: ids.slice(0, 15).map((id) => ({ productId: id, quantity: 1 })),
          paymentMethod: 'efectivo',
        },
      })
      expect(res.status, res.text).toBeLessThan(300)
    })

    // 7 · recepcion de veinte lineas
    const { crearOrden, confirmarOrden } = await import('@/modules/purchases/service')
    const sesion = {
      userId: fx.admin.id,
      name: 'Admin',
      username: fx.admin.username,
      role: 'admin',
      branchId: fx.branchA.id,
      permissions: new Set([
        'purchases.create',
        'purchases.update',
        'purchases.receive',
        'purchases.view',
        'products.cost.view',
        'products.cost.update',
      ] as const),
    }
    const orden = await crearOrden(sesion, {
      supplierId: fx.proveedor.id,
      notes: null,
      items: ids.map((id) => ({ productId: id, quantity: '5', unitCost: '500' })),
    })
    await confirmarOrden(sesion, orden.id)
    const detalle = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: orden.id },
      select: { items: { select: { id: true } } },
    })
    const { POST: RECIBIR } = await import('@/app/api/purchases/[id]/receive/route')
    await anotar('recepcion de 20 lineas', async () => {
      const res = await call(RECIBIR, `/api/purchases/${String(orden.id)}/receive`, {
        method: 'POST',
        cookie: cookieAdmin,
        params: { id: String(orden.id) },
        body: { items: detalle.items.map((i) => ({ orderItemId: i.id, quantity: '5' })) },
      })
      expect(res.status, res.text).toBe(200)
    })

    // 8 · cuenta de un cliente
    const { GET: CUENTA_CLIENTE } = await import('@/app/api/clients/[id]/cuenta/route')
    const idCliente = String(fx.cliente.id)
    await anotar('cuenta corriente de un cliente', async () => {
      const res = await call(CUENTA_CLIENTE, `/api/clients/${idCliente}/cuenta?pageSize=25`, {
        cookie: cookieAdmin,
        params: { id: idCliente },
      })
      expect(res.status, res.text).toBe(200)
    })

    // 9 · cuenta de un proveedor
    const { GET: CUENTA_PROVEEDOR } = await import('@/app/api/suppliers/[id]/cuenta/route')
    const idProveedor = String(fx.proveedor.id)
    await anotar('cuenta corriente de un proveedor', async () => {
      const res = await call(CUENTA_PROVEEDOR, `/api/suppliers/${idProveedor}/cuenta?pageSize=25`, {
        cookie: cookieAdmin,
        params: { id: idProveedor },
      })
      expect(res.status, res.text).toBe(200)
    })

    // 10 · un inventario de mil lineas
    const mil = await prisma.product.findMany({
      where: { name: { startsWith: 'Producto ' } },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 1_000,
    })
    const { POST: CREAR_INV } = await import('@/app/api/inventarios/route')
    let inventarioId = 0
    await anotar('inventario de 1.000 lineas (crear)', async () => {
      const res = await call<{ id: number }>(CREAR_INV, '/api/inventarios', {
        method: 'POST',
        cookie: cookieAdmin,
        body: { scope: 'SELECTION', productIds: mil.map((p) => p.id), blindCount: false },
      })
      expect(res.status, res.text).toBe(201)
      inventarioId = res.body.id
    })

    const { GET: LINEAS } = await import('@/app/api/inventarios/[id]/lineas/route')
    await anotar('inventario de 1.000 lineas (leer una pagina)', async () => {
      const res = await call(
        LINEAS,
        `/api/inventarios/${String(inventarioId)}/lineas?pageSize=100`,
        {
          cookie: cookieAdmin,
          params: { id: String(inventarioId) },
        },
      )
      expect(res.status, res.text).toBe(200)
    })

    console.log('\n[5A.2] LINEA BASE (10.000 productos)')
    for (const [nombre, ms] of medido) {
      console.log(`  ${nombre.padEnd(42, ' ')} ${ms.toFixed(1).padStart(8, ' ')} ms`)
    }

    // Los techos son generosos a proposito: esto no compara maquinas, atrapa
    // una regresion de orden de magnitud. El numero fino queda en el log.
    for (const [nombre, ms] of medido) {
      expect(ms, `${nombre} tardo ${ms.toFixed(1)} ms`).toBeLessThan(30_000)
    }
  }, 300_000)
})
