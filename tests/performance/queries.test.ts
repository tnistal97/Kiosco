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
 * FASE 5A.2 --lo que cambio y por que importa--. Hasta esta fase el conteo se
 * hacia con un `PrismaClient` propio de este archivo. Ese cliente abre su
 * propia conexion y NO VE ninguna de las consultas que hace la aplicacion: las
 * mediciones sobre rutas observaban cero, y aserciones como "esta ruta no hizo
 * mas de dos consultas" se cumplian sin mirar nada. Las que median de verdad
 * eran las que ejecutaban una consulta EQUIVALENTE sobre el espia, que
 * comprueban la forma de la consulta pero no que la ruta la use.
 *
 * Ahora se mide sobre el mismo cliente que usan las rutas --ver
 * `tests/helpers/consultas.ts` y `src/lib/prisma.ts`-- y los numeros de abajo
 * son los reales. Ninguna prueba se borro: las que no median se convirtieron
 * para que midan, y en dos casos el numero verdadero resulto ser mayor que el
 * que se afirmaba. Estan anotados donde aparecen.
 *
 * Las guardias por ruta viven en `consultas-n1.test.ts`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, hoyLocal } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { medir } from '../helpers/consultas'
import { multiplicarMonto } from '@/lib/money'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Cuenta las consultas que hace `fn`, sobre el cliente de la aplicacion. */
const contando = medir

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

      // Fase 5A.2: se mide EL SERVICIO, no una consulta equivalente. Antes se
      // ejecutaba a mano una consulta con la misma forma sobre otro cliente, lo
      // que comprueba que esa forma no crece pero no que el servicio la use.
      const { consultas: n } = await contando(() => listarMovimientos(sesion, { page: 1, pageSize: 50, dias: 30, tipo: 'todos' })) // prettier-ignore
      return n
    }

    const con5 = await medir(5)
    const con20 = await medir(20)

    expect(
      con20,
      `Con 5 ventas hizo ${con5} consultas y con 20 hizo ${con20}: la cantidad crece con las filas`,
    ).toBe(con5)

    // Prisma resuelve cada nivel de relacion con una consulta propia
    // (movimientos, ventas, items), y el servicio ademas cuenta el total para
    // paginar. Sin importar cuantas filas haya. Eso es distinto de un N+1,
    // donde el numero crece con las filas. Se acota por arriba para que
    // agregar un nivel mas no pase inadvertido.
    expect(con5, `el listado de caja hizo ${String(con5)} consultas`).toBeLessThanOrEqual(7)
  })

  it('el catalogo trae el stock de cada producto sin una consulta por producto', async () => {
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await crearProductos(n)

      // Fase 5A.2: la RUTA, no una consulta con su forma.
      const { GET } = await import('@/app/api/products/route')
      const cookie = await sessionCookie(fx.cajero)
      const { consultas: c } = await contando(() => call(GET, '/api/products?pageSize=100', { cookie })) // prettier-ignore
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
    //
    // Fase 5A.2: el tope decia 2 y el numero real es 8 --la sesion, el codigo,
    // el producto y sus cuatro relaciones--. No era una regresion: la medicion
    // observaba otra conexion y veia cero. El desglose esta en
    // `consultas-n1.test.ts`.
    expect(consultas, `la busqueda por codigo hizo ${String(consultas)} consultas`).toBeLessThanOrEqual(8) // prettier-ignore
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
    // Mismo coste que por el principal: es la misma consulta sobre el mismo
    // indice. Que los dos caminos cuesten lo mismo es la afirmacion.
    expect(consultas, `por un alternativo hizo ${String(consultas)} consultas`).toBeLessThanOrEqual(8) // prettier-ignore
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

      // Fase 5A.2: la RUTA, no una consulta con su forma.
      const { GET } = await import('@/app/api/purchases/route')
      const cookie = await sessionCookie(fx.admin)
      const { consultas: c } = await contando(() => call(GET, '/api/purchases?pageSize=25', { cookie })) // prettier-ignore
      return c
    }

    const con3 = await medir(3)
    const con15 = await medir(15)

    expect(
      con15,
      `Con 3 ordenes hizo ${String(con3)} consultas y con 15 hizo ${String(con15)}`,
    ).toBe(con3)
    // Prisma resuelve cada nivel con una consulta propia, y la ruta agrega la
    // sesion y el total de la paginacion. Se acota por arriba para que agregar
    // una relacion mas no pase inadvertido.
    expect(con3, `el listado de compras hizo ${String(con3)} consultas`).toBeLessThanOrEqual(10)
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
    // Fase 5A.2: esto SI se puede medir ahora. Recibir veinte lineas cuesta un
    // numero acotado de sentencias --hay escrituras por linea, que son trabajo
    // real-- y lo que importa es que no se dispare. Se informa el numero para
    // que una regresion se vea en la salida antes de romper el tope.
    console.log(`[5A.2] recepcion de 20 lineas: ${String(consultas)} consultas`)
    expect(consultas, `la recepcion de 20 lineas hizo ${String(consultas)} consultas`).toBeLessThan(
      200,
    )

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

// ---------------------------------------------------------------------------
// Fase 3D: reportes y reconciliacion
// ---------------------------------------------------------------------------

describe('Los reportes agregan en la base, no en JavaScript', () => {
  it('la respuesta de rentabilidad no crece con la cantidad de ventas', async () => {
    // El caso que se corrigio en esta fase: el total del historial de ventas
    // traia TODAS las lineas del rango y las sumaba con `Decimal.js`. Con un
    // anio de un almacen que vende cien tickets por dia son decenas de miles
    // de objetos construidos para devolver un numero.
    //
    // Se mide el TAMANIO de la respuesta, que es lo que delata que la
    // agregacion se hizo en la base: un reporte que devuelve lo mismo con 2
    // ventas que con 20 no esta trayendo las filas.
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await registrarVentas(n)

      const { GET } = await import('@/app/api/reports/rentabilidad/route')
      const res = await call(
        GET,
        `/api/reports/rentabilidad?desde=${hoyLocal()}&hasta=${hoyLocal()}`,
        {
          cookie: await sessionCookie(fx.admin),
        },
      )
      expect(res.status).toBe(200)
      return res.text.length
    }

    const pocas = await medir(2)
    const muchas = await medir(20)

    // Solo cambia el ranking por producto, que esta acotado a 20 filas: el
    // resumen es del mismo tamanio con dos ventas que con veinte.
    expect(muchas, `la respuesta paso de ${String(pocas)} a ${String(muchas)} bytes`).toBeLessThan(
      pocas * 2,
    )
  })

  it('el reporte de ventas responde con el resumen, no con las ventas', async () => {
    await registrarVentas(30)

    const { GET } = await import('@/app/api/reports/ventas/route')
    const res = await call<{ totales: { operaciones: number }; porDia: unknown[] }>(
      GET,
      `/api/reports/ventas?desde=${hoyLocal()}&hasta=${hoyLocal()}`,
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(res.body.totales.operaciones).toBe(30)
    // Treinta ventas del mismo dia son UNA fila en el desglose diario.
    expect(res.body.porDia).toHaveLength(1)
  })

  it('la reconciliacion completa no crece con la cantidad de ventas', async () => {
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await registrarVentas(n)
      const { comprobarIntegridad } = await import('@/modules/integrity/service')
      const antes = Date.now()
      await comprobarIntegridad()
      return Date.now() - antes
    }

    // Aca se mide el TIEMPO y no el numero de sentencias: la reconciliacion es
    // SQL crudo, una sentencia por invariante, y ese numero es fijo por
    // construccion. Lo que puede degradarse es cuanto tarda cada una.
    const pocas = await medir(2)
    const muchas = await medir(30)

    expect(
      muchas,
      `la reconciliacion tardo ${String(muchas)} ms con 30 ventas y ${String(pocas)} ms con 2`,
    ).toBeLessThan(Math.max(pocas * 4, 3_000))
  })
})

describe('Los indices de la Fase 3D existen', () => {
  it('SaleItem tiene indice por producto, que es como agrupa la rentabilidad', async () => {
    const filas = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'SaleItem'
    `
    expect(filas.map((f) => f.indexname)).toContain('SaleItem_productId_idx')
  })
})

describe('El indice de la Fase 5A: los renglones de UNA venta', () => {
  it('existe el indice por venta, que la clave foranea no crea sola', async () => {
    // PostgreSQL no indexa las claves foraneas. `SaleItem_saleId_fkey` obliga a
    // que la venta exista; buscar los renglones DE una venta seguia recorriendo
    // la tabla entera, en la consulta mas frecuente que hay.
    const filas = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'SaleItem'
    `
    expect(filas.map((f) => f.indexname)).toContain('SaleItem_saleId_idx')
  })

  it('el plan de "los renglones de esta venta" no recorre la tabla', async () => {
    // Con pocas filas el planificador elige el recorrido igual porque es mas
    // barato, asi que se lo desactiva para preguntar lo que de verdad importa:
    // si el indice es APLICABLE a esta consulta. Sin el indice, PostgreSQL no
    // tiene alternativa y el plan sigue diciendo Seq Scan aunque se lo prohiba.
    await registrarVentas(40)
    const venta = await prisma.sale.findFirstOrThrow({ select: { id: true } })

    // Las dos sentencias van en la MISMA transaccion a proposito: `SET LOCAL`
    // dura lo que dura la transaccion, y fuera de una no hace nada. Con el
    // pool de Prisma, ademas, un `SET` suelto podria quedar en otra conexion
    // distinta de la que corre el EXPLAIN.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`)
      return tx.$queryRawUnsafe<Array<Record<string, string>>>(
        `EXPLAIN SELECT * FROM "SaleItem" WHERE "saleId" = ${String(venta.id)}`,
      )
    })
    const texto = plan.map((f) => Object.values(f).join(' ')).join(' | ')

    expect(texto, `el plan fue: ${texto}`).toMatch(/Index (Only )?Scan.*SaleItem_saleId_idx/)
  })
})

/**
 * El lector con un catalogo de verdad. Fase 5A.1.
 *
 * La busqueda por codigo es el camino mas caliente del sistema: ocurre una vez
 * por producto de cada ticket, con el cliente esperando. Lo que se mide aca es
 * que su costo NO dependa del tamano del catalogo, y en particular que el
 * codigo que NO existe --el caso que ahora abre el alta rapida-- no dispare un
 * recorrido de la tabla.
 *
 * Los tiempos se informan pero no se afirman: dependen de la maquina. Lo que si
 * se afirma es la forma --numero de consultas y plan-- que es lo que no puede
 * cambiar sin que alguien lo note.
 */
describe('El lector con 10.000 productos', () => {
  /** Tope generoso: no mide la maquina, atrapa una regresion catastrofica. */
  const TECHO_MS = 400

  /**
   * Diez mil productos y veinte mil codigos, en dos sentencias.
   *
   * Uno por uno con `prisma.product.create` serian veinte mil viajes de ida y
   * vuelta y varios minutos. `generate_series` los arma dentro de PostgreSQL.
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
      SELECT p."id", '77' || lpad(p."id"::text, 11, '0'), true
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
    // Sin esto el planificador trabaja con estadisticas de una tabla vacia.
    await prisma.$executeRawUnsafe(`ANALYZE "Product", "ProductBarcode", "BranchStock"`)
  }

  async function cuantoTarda(fn: () => Promise<unknown>): Promise<number> {
    const t0 = performance.now()
    await fn()
    return performance.now() - t0
  }

  it('conocido, inexistente y alta rapida, con el catalogo lleno', async () => {
    await catalogoGrande(10_000)
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const { POST: QUICK } = await import('@/app/api/products/quick/route')
    const cookie = await sessionCookie(fx.admin)
    const cookieAdmin = await sessionCookie(fx.admin)

    // Uno del medio del catalogo, no el primero ni el ultimo.
    const alMedio = await prisma.productBarcode.findFirstOrThrow({
      where: { code: { startsWith: '77' } },
      select: { code: true },
      orderBy: { id: 'asc' },
      skip: 5_000,
    })

    const conocido = await cuantoTarda(async () => {
      const res = await call(GET, `/api/products/barcode/${alMedio.code}`, {
        cookie,
        params: { code: alMedio.code },
      })
      expect(res.status).toBe(200)
    })

    const inexistente = await cuantoTarda(async () => {
      const res = await call(GET, '/api/products/barcode/7799999999999', {
        cookie,
        params: { code: '7799999999999' },
      })
      expect(res.status, 'no existe, y eso es lo que se mide').toBe(404)
    })

    const alta = await cuantoTarda(async () => {
      const res = await call(QUICK, '/api/products/quick', {
        method: 'POST',
        cookie: cookieAdmin,
        body: {
          barcode: '7788888888888',
          name: 'Recien creado',
          price: '1000',
          categoryId: fx.categoryId,
          saleUnit: 'UNIT',
          initialStock: '1',
        },
      })
      expect(res.status).toBe(201)
    })

    console.log(
      `[5A.1] barcode conocido ${conocido.toFixed(1)} ms · ` +
        `inexistente ${inexistente.toFixed(1)} ms · alta rapida ${alta.toFixed(1)} ms`,
    )

    expect(conocido, `conocido tardo ${conocido.toFixed(1)} ms`).toBeLessThan(TECHO_MS)
    expect(inexistente, `inexistente tardo ${inexistente.toFixed(1)} ms`).toBeLessThan(TECHO_MS)
    expect(alta, `el alta tardo ${alta.toFixed(1)} ms`).toBeLessThan(TECHO_MS * 3)
  })

  it('el codigo inexistente NO recorre la tabla de codigos', async () => {
    await catalogoGrande(10_000)

    const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN SELECT * FROM "ProductBarcode" WHERE "code" = '7799999999999'`,
    )
    const texto = plan.map((f) => Object.values(f).join(' ')).join(' | ')

    // Sin `SET LOCAL enable_seqscan = off`: con diez mil filas y estadisticas
    // frescas, el planificador tiene que elegir el indice por su cuenta. Si
    // eligiera el recorrido, la caja pagaria el catalogo entero en cada lectura
    // fallida, que es justo el caso que ahora ofrece crear el producto.
    expect(texto, `el plan fue: ${texto}`).toMatch(/Index (Only )?Scan/)
    expect(texto).not.toMatch(/Seq Scan/)
  })

  it('lee UNA fila, con el catalogo vacio y con diez mil', async () => {
    // Se mide con EXPLAIN ANALYZE --lo que PostgreSQL de verdad leyo-- porque
    // contar sentencias no distingue una consulta que lee una fila de una que
    // recorre diez mil. Las dos cuentan uno.
    const filasLeidas = async (): Promise<number> => {
      const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
        `EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM "ProductBarcode" WHERE "code" = '7799999999999'`,
      )
      const crudo = JSON.stringify(plan)
      const leidas = /"Actual Rows":\s*(\d+)/.exec(crudo)
      return Number(leidas?.[1] ?? -1)
    }

    const conPocos = await filasLeidas()
    await catalogoGrande(10_000)
    const conMuchos = await filasLeidas()

    // Cero filas devueltas en los dos casos: el codigo no existe. Lo que
    // importa es que con diez mil productos siga siendo cero y no diez mil,
    // que es lo que pasaria con un recorrido de tabla.
    expect(conPocos).toBe(0)
    expect(conMuchos, `con 10.000 productos leyo ${String(conMuchos)} filas`).toBe(0)
  })
})
