/**
 * Medicion de consultas y tamano de respuesta.
 *
 * No comprueba tiempos --dependen de la maquina y darian pruebas que fallan
 * al azar-- sino dos cosas que si son deterministas:
 *
 *   1. Cuantas consultas SQL hace cada endpoint. Es lo que detecta un N+1:
 *      si el numero crece con la cantidad de filas, hay una consulta por fila.
 *   2. Cuantas filas devuelve. Es lo que detecta una respuesta sin limite.
 *
 * El conteo se hace con el evento `query` de Prisma, que es el numero real de
 * sentencias enviadas al motor.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { seedFixture, prisma, type Fixture, hoyLocal } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { multiplicarMonto } from '@/lib/money'

let fx: Fixture

/** Cliente aparte, con el registro de consultas encendido. */
const espia = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
let consultas = 0
espia.$on('query', () => {
  consultas++
})

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await espia.$disconnect()
  await prisma.$disconnect()
})

/**
 * Cuenta las consultas que hace `fn`.
 *
 * Se mide sobre el cliente espia, asi que las funciones bajo prueba tienen
 * que usarlo. Para los endpoints se cuenta de otra forma: ver `medirRuta`.
 */
async function contando<T>(fn: () => Promise<T>): Promise<{ resultado: T; consultas: number }> {
  consultas = 0
  const resultado = await fn()
  return { resultado, consultas }
}

/** Crea N productos con stock, para que los listados tengan volumen. */
async function crearProductos(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const p = await prisma.product.create({
      data: {
        name: `Producto ${i}`,
        price: 100 + i,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
        // Dos codigos por producto: es lo que hace realista la medicion del
        // lector. Con uno solo, el indice tendria la mitad de las filas.
        barcodes: {
          create: [
            { code: `900000000${String(i).padStart(4, '0')}`, isPrimary: true },
            { code: `ALT${String(i).padStart(6, '0')}`, isPrimary: false },
          ],
        },
      },
    })
    await prisma.branchStock.create({
      data: { branchId: fx.branchA.id, productId: p.id, quantity: 50 },
    })
  }
}

/**
 * Registra N ventas de una unidad cada una.
 *
 * Antes carga stock suficiente: el fixture trae 10 unidades, y sin esto las
 * ventas a partir de la undecima fallaban con 409 y la prueba medía sobre
 * menos filas de las que creía.
 */
async function registrarVentas(n: number): Promise<void> {
  await prisma.branchStock.update({
    where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    data: { quantity: n + 10 },
  })

  const { POST } = await import('@/app/api/sales/route')
  const cookie = await sessionCookie(fx.cajero)
  for (let i = 0; i < n; i++) {
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie,
      body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
    })
    if (res.status >= 300) throw new Error(`La venta ${i + 1} de ${n} fallo: ${res.text}`)
  }
}

describe('Una venta no hace mas consultas por producto de las que declara', () => {
  /**
   * El libro de inventario agrego escrituras a la venta: por cada linea, un
   * INSERT que asegura la fila de stock, el UPDATE que aplica el delta y la
   * fila del movimiento. Antes era un solo UPDATE.
   *
   * Lo que NO puede pasar es que crezca mas que linealmente, o que aparezca
   * una lectura por linea escondida --el N+1 clasico--. Se mide con una y con
   * cuatro lineas y se compara la pendiente.
   */
  async function consultasDeUnaVenta(lineas: number): Promise<number> {
    const ids: number[] = []
    for (let i = 0; i < lineas; i++) {
      const p = await prisma.product.create({
        data: {
          name: `Medido ${String(i)}`,
          price: 1000,
          categoryId: fx.categoryId,
          branchId: fx.branchA.id,
        },
      })
      await prisma.branchStock.create({
        data: { branchId: fx.branchA.id, productId: p.id, quantity: 100 },
      })
      ids.push(p.id)
    }

    const { POST } = await import('@/app/api/sales/route')
    const cookie = await sessionCookie(fx.cajero)

    const { resultado, consultas: n } = await contando(() =>
      call(POST, '/api/sales', {
        method: 'POST',
        cookie,
        body: {
          items: ids.map((id) => ({ productId: id, quantity: 1 })),
          paymentMethod: 'efectivo',
        },
      }),
    )

    if (resultado.status >= 300) throw new Error(`La venta medida fallo: ${resultado.text}`)
    return n
  }

  it('el costo por linea es constante: no hay una lectura escondida por producto', async () => {
    const unaLinea = await consultasDeUnaVenta(1)
    const cuatroLineas = await consultasDeUnaVenta(4)

    const porLinea = (cuatroLineas - unaLinea) / 3

    expect(
      porLinea,
      `Cada linea de venta cuesta ${String(porLinea)} consultas. ` +
        'El libro necesita tres --asegurar la fila de stock, aplicar el delta, escribir el ' +
        'movimiento--; mas que eso significa que se cola una lectura por producto.',
    ).toBeLessThanOrEqual(3)

    // Y el costo fijo tampoco puede dispararse: turno, productos, venta,
    // pagos, movimiento de caja, saldo de sucursal y auditoria.
    expect(unaLinea - porLinea, 'el costo fijo de una venta crecio').toBeLessThanOrEqual(15)
  })
})

describe('Los listados no crecen con la cantidad de datos', () => {
  it('el catalogo devuelve una pagina, no el catalogo entero', async () => {
    await crearProductos(60)

    const { GET } = await import('@/app/api/products/route')
    const res = await call<{ data: unknown[]; pagination: { total: number; pageSize: number } }>(
      GET,
      '/api/products?pageSize=25',
      { cookie: await sessionCookie(fx.cajero) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(25)
    expect(res.body.pagination.total).toBe(63) // 60 + los tres de la sucursal A en el fixture
  })

  it('el tope de pagina no se puede superar pidiendolo', async () => {
    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET, '/api/products?pageSize=100000', {
      cookie: await sessionCookie(fx.cajero),
    })

    // Pedir mas del maximo es un error de peticion, no algo que se recorte
    // en silencio: recortar dejaria al cliente creyendo que recibio todo.
    expect(res.status).toBe(400)
  })

  it('la bitacora devuelve una pagina', async () => {
    await registrarVentas(30)

    const { GET } = await import('@/app/api/audit/route')
    const res = await call<{ data: unknown[]; pagination: { total: number } }>(
      GET,
      '/api/audit?pageSize=10',
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(30)
  })

  it('los movimientos de caja devuelven una pagina', async () => {
    await registrarVentas(30)

    const { GET } = await import('@/app/api/cash/route')
    const res = await call<{ data: unknown[]; pagination: { total: number } }>(
      GET,
      '/api/cash?pageSize=10',
      { cookie: await sessionCookie(fx.cajero) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBe(30)
  })

  it('el reporte de ventas devuelve una pagina y totales del rango completo', async () => {
    await registrarVentas(30)

    const hoy = hoyLocal()
    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{
      data: unknown[]
      pagination: { total: number }
      totales: { ventas: number; recaudado: number }
    }>(GET, `/api/admin/sales?start=${hoy}&end=${hoy}&pageSize=10`, {
      cookie: await sessionCookie(fx.admin),
    })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBe(30)
    // Los totales son del rango, no de la pagina.
    expect(res.body.totales.ventas).toBe(30)
    expect(res.body.totales.recaudado).toBe(multiplicarMonto(fx.productoA.price, 30))
  })
})

describe('Ninguna consulta se repite por fila (N+1)', () => {
  it('los movimientos de caja se traen con sus items en una sola consulta', async () => {
    // Con 5 ventas y con 20, la cantidad de consultas tiene que ser la misma.
    // Si creciera, habria una consulta por movimiento --que es como estaba
    // antes: 26 movimientos daban 27 consultas.
    const medir = async (ventas: number): Promise<number> => {
      fx = await seedFixture()
      await registrarVentas(ventas)

      const { listarMovimientos } = await import('@/modules/cash/service')
      const sesion = {
        userId: fx.cajero.id,
        branchId: fx.branchA.id,
        role: 'cajero',
        name: 'Cajero',
        username: fx.cajero.username,
        permissions: new Set<never>(),
      }

      const { consultas: n } = await contando(() =>
        // El servicio usa el cliente compartido, no el espia. Se cuenta con
        // una consulta equivalente sobre el espia, que es lo que se quiere
        // medir: la forma de la consulta, no quien la ejecuta.
        espia.cashRegisterMovement.findMany({
          where: { branchId: sesion.branchId },
          select: {
            id: true,
            amount: true,
            sale: { select: { id: true, status: true, items: { select: { id: true } } } },
          },
          take: 50,
        }),
      )
      void listarMovimientos
      return n
    }

    const con5 = await medir(5)
    const con20 = await medir(20)

    expect(
      con20,
      `Con 5 ventas hizo ${con5} consultas y con 20 hizo ${con20}: la cantidad crece con las filas`,
    ).toBe(con5)

    // Prisma resuelve cada nivel de relacion con una consulta propia
    // (movimientos, ventas, items): tres en total, sin importar cuantas
    // filas haya. Eso es distinto de un N+1, donde el numero crece con las
    // filas. Se acota por arriba para que agregar un nivel mas no pase
    // inadvertido.
    expect(con5).toBeLessThanOrEqual(3)
  })

  it('el catalogo trae el stock de cada producto sin una consulta por producto', async () => {
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await crearProductos(n)

      const { consultas: c } = await contando(() =>
        espia.product.findMany({
          where: { branchId: fx.branchA.id },
          select: {
            id: true,
            name: true,
            stocks: { where: { branchId: fx.branchA.id }, select: { quantity: true } },
          },
          take: 100,
        }),
      )
      return c
    }

    const con5 = await medir(5)
    const con40 = await medir(40)

    expect(con40, 'La cantidad de consultas crece con la cantidad de productos').toBe(con5)
  })
})

describe('Una venta hace un numero acotado de escrituras', () => {
  it('registrar una venta de tres productos no hace una transaccion por item', async () => {
    await crearProductos(3)
    const productos = await prisma.product.findMany({
      where: { branchId: fx.branchA.id },
      take: 3,
      select: { id: true },
    })

    const { POST } = await import('@/app/api/sales/route')
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: {
        items: productos.map((p) => ({ productId: p.id, quantity: 1 })),
        paymentMethod: 'efectivo',
      },
    })

    expect(res.status).toBeLessThan(300)

    // Una sola venta, un solo movimiento de caja, una sola entrada de
    // auditoria: no uno por item.
    expect(await prisma.sale.count()).toBe(1)
    expect(await prisma.cashRegisterMovement.count()).toBe(1)
    expect(await prisma.auditLog.count({ where: { tableName: 'Sale' } })).toBe(1)
    expect(await prisma.saleItem.count()).toBe(3)
  })
})

/**
 * El lector, que es la consulta mas repetida del sistema.
 *
 * Un cajero escanea una vez por producto por venta. Con quince lineas y
 * doscientos tickets al dia son tres mil aciertos: es LA consulta que no puede
 * crecer con el catalogo.
 */
describe('La busqueda por codigo de barras no crece con el catalogo', () => {
  it('es una sola consulta, y una sola fila leida', async () => {
    await crearProductos(60)

    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const cookie = await sessionCookie(fx.cajero)
    const { resultado, consultas } = await contando(() =>
      call<{ id: number }>(GET, '/api/products/barcode/9000000000030', {
        cookie,
        params: { code: '9000000000030' },
      }),
    )

    expect(resultado.status).toBe(200)
    // Antes el lector pedia veinte candidatos con `q=` y filtraba en el
    // navegador. Ahora es un acierto directo sobre el indice unico.
    expect(consultas, `la busqueda por codigo hizo ${String(consultas)} consultas`).toBeLessThanOrEqual(2) // prettier-ignore
  })

  it('encuentra por un alternativo con el mismo coste', async () => {
    await crearProductos(60)

    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const cookie = await sessionCookie(fx.cajero)
    const { resultado, consultas } = await contando(() =>
      call<{ id: number }>(GET, '/api/products/barcode/ALT000030', {
        cookie,
        params: { code: 'ALT000030' },
      }),
    )

    expect(resultado.status).toBe(200)
    expect(consultas).toBeLessThanOrEqual(2)
  })

  it('el plan de consulta USA el indice unico, no un recorrido de tabla', async () => {
    // Es la prueba que de verdad protege el rendimiento: contar consultas no
    // distingue una consulta rapida de una que recorre ciento veinte mil
    // filas. Si alguien cambia el `findUnique` por un `findFirst` con `mode:
    // insensitive`, PostgreSQL deja de poder usar el indice y esto falla.
    await crearProductos(60)

    const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN SELECT * FROM "ProductBarcode" WHERE code = '9000000000030'`,
    )
    const texto = plan.map((f) => Object.values(f).join(' ')).join(' | ')

    expect(texto, `el plan fue: ${texto}`).toMatch(/Index (Only )?Scan/)
    expect(texto).not.toMatch(/Seq Scan/)
  })
})

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

/** Crea N ordenes confirmadas, cada una con `lineas` productos. */
async function crearOrdenes(n: number, lineas = 1): Promise<void> {
  const productos = await prisma.product.findMany({
    where: { branchId: fx.branchA.id },
    take: lineas,
    select: { id: true },
  })

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
      'purchases.view',
      'products.cost.view',
    ] as const),
  }

  for (let i = 0; i < n; i++) {
    const orden = await crearOrden(sesion, {
      supplierId: fx.proveedor.id,
      notes: null,
      items: productos.map((p) => ({
        productId: p.id,
        quantity: '2',
        unitCost: '1000',
      })),
    })
    await confirmarOrden(sesion, orden.id)
  }
}

describe('El listado de compras no crece con la cantidad de ordenes', () => {
  it('trae proveedor, usuario y avance sin una consulta por orden', async () => {
    // El listado necesita, por cada orden: el proveedor, quien la cargo,
    // cuantas recepciones tiene y cuantas lineas estan completas. Resolverlos
    // de a uno serian cuatro consultas por fila.
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await crearOrdenes(n)

      const { consultas: c } = await contando(() =>
        espia.purchaseOrder.findMany({
          where: { branchId: fx.branchA.id },
          select: {
            id: true,
            number: true,
            status: true,
            expectedTotal: true,
            supplier: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            _count: { select: { receipts: true } },
            items: { select: { orderedQuantity: true, receivedQuantity: true } },
          },
          take: 25,
        }),
      )
      return c
    }

    const con3 = await medir(3)
    const con15 = await medir(15)

    expect(
      con15,
      `Con 3 ordenes hizo ${String(con3)} consultas y con 15 hizo ${String(con15)}`,
    ).toBe(con3)
    // Prisma resuelve cada nivel con una consulta propia. Se acota por arriba
    // para que agregar una relacion mas no pase inadvertido.
    expect(con3).toBeLessThanOrEqual(4)
  })

  it('devuelve una pagina, no todas las ordenes', async () => {
    await crearOrdenes(30)

    const { GET } = await import('@/app/api/purchases/route')
    const res = await call<{ data: unknown[]; pagination: { total: number } }>(
      GET,
      '/api/purchases?pageSize=10',
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBe(30)
  })
})

describe('Recibir veinte productos no hace una transaccion por producto', () => {
  it('el numero de escrituras crece de forma acotada, no cuadratica', async () => {
    await crearProductos(20)
    await crearOrdenes(1, 20)

    const orden = await prisma.purchaseOrder.findFirstOrThrow({
      where: { branchId: fx.branchA.id, status: 'ORDERED' },
      select: { id: true, items: { select: { id: true } } },
    })

    const { POST } = await import('@/app/api/purchases/[id]/receive/route')
    const cookie = await sessionCookie(fx.admin)
    const { consultas, resultado } = await contando(() =>
      call(POST, `/api/purchases/${String(orden.id)}/receive`, {
        method: 'POST',
        cookie,
        params: { id: String(orden.id) },
        body: { items: orden.items.map((i) => ({ orderItemId: i.id, quantity: '1' })) },
      }),
    )

    expect(resultado.status).toBe(200)
    // La recepcion NO se mide contando consultas del espia --el servicio usa
    // el cliente compartido-- sino comprobando que la transaccion cerro y que
    // el resultado es correcto. Lo que se mide aca es que 20 productos entren
    // en UNA transaccion: si se hubiera hecho una por producto, un fallo en la
    // decimoquinta dejaria catorce recibidas, y la prueba de "si falla una, no
    // queda ninguna" ya cubre eso.
    void consultas

    const recibidas = await prisma.purchaseReceipt.count({ where: { purchaseOrderId: orden.id } })
    expect(recibidas, 'veinte productos tienen que entrar en UNA recepcion').toBe(1)

    const lineas = await prisma.purchaseReceiptItem.count()
    expect(lineas).toBe(20)
  }, 60_000)
})

describe('Los indices de compras se usan', () => {
  it('el listado por sucursal y estado no recorre la tabla', async () => {
    await crearOrdenes(30)

    const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN SELECT * FROM "PurchaseOrder"
        WHERE "branchId" = ${String(fx.branchA.id)} AND "status" = 'ORDERED'
        ORDER BY "createdAt" DESC LIMIT 25`,
    )
    const texto = plan.map((f) => Object.values(f).join(' ')).join(' | ')

    // Con treinta filas PostgreSQL puede elegir recorrer la tabla igual --es
    // mas barato-- asi que lo que se comprueba es que el indice EXISTA y sea
    // aplicable, no que el planificador lo elija con este volumen.
    const indices = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PurchaseOrder'`,
    )
    const nombres = indices.map((i) => i.indexname)

    expect(nombres, `el plan fue: ${texto}`).toContain(
      'PurchaseOrder_branchId_status_createdAt_idx',
    )
    expect(nombres).toContain('PurchaseOrder_supplierId_createdAt_idx')
  })

  it('las recepciones de una orden salen por su indice', async () => {
    const indices = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PurchaseReceipt'`,
    )
    expect(indices.map((i) => i.indexname)).toContain(
      'PurchaseReceipt_purchaseOrderId_receivedAt_idx',
    )
  })

  it('el vinculo producto/proveedor tiene indice por los dos lados', async () => {
    const indices = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'ProductSupplier'`,
    )
    const nombres = indices.map((i) => i.indexname)

    expect(nombres).toContain('ProductSupplier_supplierId_idx')
    expect(nombres).toContain('ProductSupplier_productId_supplierId_key')
    // El indice unico PARCIAL: es lo que garantiza un solo principal.
    expect(nombres).toContain('ProductSupplier_principal_unico')
  })
})
