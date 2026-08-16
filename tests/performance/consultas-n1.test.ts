/**
 * Guardias contra el N+1, sobre el cliente Prisma DE LA APLICACION.
 *
 * Fase 5A.2. Reemplaza a las mediciones de `queries.test.ts`, que contaban con
 * un `PrismaClient` propio del archivo de pruebas: ese cliente abre su propia
 * conexion y no ve ni una de las consultas que hace una ruta. Cinco aserciones
 * del estilo "esta ruta no hizo mas de dos consultas" se cumplian observando
 * CERO. Parecian una red de seguridad y no habia red.
 *
 * Lo que se mide, y por que es lo unico que sirve:
 *
 *   Un N+1 no se detecta con un cronometro --con veinte filas es imperceptible
 *   y con veinte mil tira el servidor-- ni con un plan de consulta --que mira
 *   UNA consulta y el problema es que hay muchas--. Se detecta corriendo el
 *   MISMO escenario con dos volumenes y comprobando que el numero de sentencias
 *   no se mueve.
 *
 * El primer bloque prueba el instrumento antes de usarlo: que ve las consultas
 * de la aplicacion, y que la guardia FALLA cuando tiene que fallar. Una guardia
 * que nunca se vio fallar no es una guardia.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, diaLocal, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { medir, cuantasConsultas, exigirQueNoCrezca } from '../helpers/consultas'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Crea `n` productos con codigo y stock. Devuelve sus ids. */
async function catalogo(n: number): Promise<number[]> {
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const p = await prisma.product.create({
      data: {
        name: `Producto ${String(i)}`,
        price: 100 + i,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
        barcodes: { create: { code: `900000000${String(i).padStart(4, '0')}`, isPrimary: true } },
      },
    })
    await prisma.branchStock.create({
      data: { branchId: fx.branchA.id, productId: p.id, quantity: 500 },
    })
    await prisma.stockMovement.create({
      data: {
        branchId: fx.branchA.id,
        productId: p.id,
        type: 'INITIAL',
        quantity: 500,
        previousQuantity: 0,
        resultingQuantity: 500,
        userId: fx.admin.id,
        reason: 'Preparacion de la medicion',
      },
    })
    ids.push(p.id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// 0. El instrumento, antes de usarlo
// ---------------------------------------------------------------------------

describe('La instrumentacion mide de verdad', () => {
  it('ve las consultas que hace la APLICACION, no otras', async () => {
    // Es la comprobacion que faltaba. Si esto diera cero --que es lo que daba
    // el cliente espia-- todas las guardias de abajo pasarian sin mirar nada.
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const cookie = await sessionCookie(fx.cajero)

    const { consultas, resultado } = await medir(() =>
      call(GET, `/api/products/barcode/${fx.productoA.barcode}`, {
        cookie,
        params: { code: fx.productoA.barcode },
      }),
    )

    expect(resultado.status).toBe(200)
    expect(
      consultas,
      'la medicion vio cero consultas: esta observando otra conexion, que es ' +
        'exactamente el defecto que la Fase 5A.2 vino a corregir',
    ).toBeGreaterThan(0)
  })

  it('cuenta lo mismo dos veces seguidas: no se le escapan eventos', async () => {
    const una = async () => {
      const { GET } = await import('@/app/api/products/barcode/[code]/route')
      return call(GET, `/api/products/barcode/${fx.productoA.barcode}`, {
        cookie: await sessionCookie(fx.cajero),
        params: { code: fx.productoA.barcode },
      })
    }

    const primera = await cuantasConsultas(una)
    const segunda = await cuantasConsultas(una)

    // Si los eventos llegaran tarde, el numero bailaria entre corridas y
    // cualquier guardia construida encima seria un generador de fallos al azar.
    expect(segunda, `midio ${String(primera)} y despues ${String(segunda)}`).toBe(primera)
  })

  it('PRUEBA NEGATIVA: con un N+1 deliberado, la guardia falla', async () => {
    // El mismo trabajo --leer n productos-- hecho de las dos maneras, con el
    // MISMO cliente. La version buena no crece; la mala crece una consulta por
    // fila, y la guardia tiene que decirlo.
    const ids = await catalogo(12)

    const enUna = (n: number) =>
      cuantasConsultas(() =>
        prisma.product.findMany({ where: { id: { in: ids.slice(0, n) } }, select: { name: true } }),
      )

    const unaPorFila = (n: number) =>
      cuantasConsultas(async () => {
        for (const id of ids.slice(0, n)) {
          await prisma.product.findUnique({ where: { id }, select: { name: true } })
        }
      })

    // La buena pasa.
    await expect(
      exigirQueNoCrezca(enUna, { pocas: 3, muchas: 12, que: 'leer n productos de una' }),
    ).resolves.toBeDefined()

    // La mala falla, y el mensaje dice cuanto crece.
    await expect(
      exigirQueNoCrezca(unaPorFila, { pocas: 3, muchas: 12, que: 'leer n productos de a uno' }),
    ).rejects.toThrow(/consultas por fila/)
  })
})

// ---------------------------------------------------------------------------
// 1. El lector de la caja
// ---------------------------------------------------------------------------

describe('El lector no crece con el catalogo', () => {
  it('el mismo numero de consultas con 5 productos y con 40', async () => {
    const medirCon = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await catalogo(n)
      const { GET } = await import('@/app/api/products/barcode/[code]/route')
      const cookie = await sessionCookie(fx.cajero)
      const code = '9000000000000'
      return cuantasConsultas(() => call(GET, `/api/products/barcode/${code}`, { cookie, params: { code } })) // prettier-ignore
    }

    const { conPocas } = await exigirQueNoCrezca(medirCon, {
      pocas: 5,
      muchas: 40,
      que: 'la busqueda por codigo',
    })

    // Y ademas: cuanto cuesta en absoluto. Medido en la Fase 5A.2, son OCHO
    // sentencias y ninguna es una sorpresa:
    //
    //   1-2  la sesion: el usuario y su rol
    //   3    ProductBarcode por el indice unico  <- la busqueda propiamente dicha
    //   4    el producto
    //   5-8  cada relacion del producto por su cuenta: categoria, proveedor
    //        principal, stock de la sucursal y codigo principal
    //
    // Prisma resuelve cada nivel de relacion con una consulta propia; eso no
    // crece con el catalogo --lo comprueba la guardia de arriba-- pero si crece
    // con cuantas relaciones pida el DTO. El tope existe para que agregar una
    // relacion al camino mas caliente del sistema sea una decision y no un
    // descuido. Antes de esta fase la prueba afirmaba "no mas de dos", y era
    // falso: estaba contando sobre otra conexion y veia cero.
    expect(conPocas, `el lector hizo ${String(conPocas)} consultas`).toBeLessThanOrEqual(8)
  })

  it('un producto SIN lotes no paga ninguna consulta por el stock vendible', async () => {
    // Fase 5A.2: el DTO ahora trae `sellableStock`. Para el catalogo entero
    // --todo `lotTracking = NONE`-- ese numero es el total y no hace falta
    // preguntar nada. Si algun dia costara una consulta, esta prueba lo dice.
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const cookie = await sessionCookie(fx.cajero)

    const sinLotes = await cuantasConsultas(() =>
      call(GET, `/api/products/barcode/${fx.productoA.barcode}`, {
        cookie,
        params: { code: fx.productoA.barcode },
      }),
    )

    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { lotTracking: 'OPTIONAL', expirationTracking: 'OPTIONAL' },
    })

    const conLotes = await cuantasConsultas(() =>
      call(GET, `/api/products/barcode/${fx.productoA.barcode}`, {
        cookie,
        params: { code: fx.productoA.barcode },
      }),
    )

    // Con lotes cuesta dos mas --la zona horaria de la sucursal y el agregado
    // de vencidos-- y eso es aceptable. Sin lotes tiene que costar CERO mas.
    expect(conLotes - sinLotes, 'el producto con lotes pago mas de dos consultas').toBeLessThanOrEqual(2) // prettier-ignore
    expect(conLotes).toBeGreaterThan(sinLotes)
  })
})

// ---------------------------------------------------------------------------
// 2. La venta
// ---------------------------------------------------------------------------

describe('Una venta de quince lineas no lee una vez por linea', () => {
  it('el costo por linea es escritura, no lectura escondida', async () => {
    const ids = await catalogo(15)
    const { POST } = await import('@/app/api/sales/route')
    const cookie = await sessionCookie(fx.cajero)

    const medirCon = async (lineas: number): Promise<number> => {
      const { consultas, resultado } = await medir(() =>
        call(POST, '/api/sales', {
          method: 'POST',
          cookie,
          body: {
            items: ids.slice(0, lineas).map((id) => ({ productId: id, quantity: 1 })),
            paymentMethod: 'efectivo',
          },
        }),
      )
      if (resultado.status >= 300) throw new Error(`la venta fallo: ${resultado.text}`)
      return consultas
    }

    // El libro de inventario cobra tres escrituras por linea --asegurar la fila
    // de stock, aplicar el delta, escribir el movimiento-- y eso es trabajo
    // real. Lo que no puede aparecer es una LECTURA por producto.
    const { conPocas, conMuchas, porFila } = await exigirQueNoCrezca(medirCon, {
      pocas: 1,
      muchas: 15,
      tolerancia: 3,
      que: 'la venta',
    })

    console.log(
      `[5A.2] venta: 1 linea = ${String(conPocas)} consultas · ` +
        `15 lineas = ${String(conMuchas)} · ${porFila.toFixed(2)} por linea`,
    )
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 3. El listado de productos
// ---------------------------------------------------------------------------

describe('El listado de productos no crece con la pagina', () => {
  it('mismo numero de consultas con 5 y con 40 productos', async () => {
    const medirCon = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await catalogo(n)
      const { GET } = await import('@/app/api/products/route')
      const cookie = await sessionCookie(fx.cajero)
      return cuantasConsultas(() => call(GET, '/api/products?pageSize=100', { cookie }))
    }

    await exigirQueNoCrezca(medirCon, { pocas: 5, muchas: 40, que: 'el listado de productos' })
  }, 60_000)

  it('con lotes vencidos en la pagina, sigue siendo UNA consulta agregada', async () => {
    // El caso que la Fase 5A.2 agrego: `sellableStock` necesita saber cuanto
    // hay vencido. La forma ingenua --preguntar por cada producto-- seria un
    // N+1 nuevo introducido justamente por una mejora de UX.
    const medirCon = async (n: number): Promise<number> => {
      fx = await seedFixture()
      const ids = await catalogo(n)
      await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { lotTracking: 'OPTIONAL', expirationTracking: 'OPTIONAL' },
      })
      for (const id of ids) {
        const lote = await prisma.productLot.create({
          data: {
            productId: id,
            code: `L-${String(id)}`,
            codeNormalized: `L-${String(id)}`,
            expirationDate: new Date(`${diaLocal(-30)}T00:00:00.000Z`),
            createdById: fx.admin.id,
          },
        })
        await prisma.branchLotStock.create({
          data: { branchId: fx.branchA.id, lotId: lote.id, quantity: 10 },
        })
      }

      const { GET } = await import('@/app/api/products/route')
      const cookie = await sessionCookie(fx.cajero)
      return cuantasConsultas(() => call(GET, '/api/products?pageSize=100', { cookie }))
    }

    await exigirQueNoCrezca(medirCon, {
      pocas: 5,
      muchas: 40,
      que: 'el listado con lotes vencidos',
    })
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 4. El panel
// ---------------------------------------------------------------------------

describe('El panel no crece con los datos', () => {
  it('las nueve consultas de la pantalla de inicio son las mismas con 3 y con 20 ventas', async () => {
    const medirCon = async (ventas: number): Promise<number> => {
      fx = await seedFixture()
      const ids = await catalogo(3)
      const { POST } = await import('@/app/api/sales/route')
      const cookieCaja = await sessionCookie(fx.cajero)
      for (let i = 0; i < ventas; i++) {
        const res = await call(POST, '/api/sales', {
          method: 'POST',
          cookie: cookieCaja,
          body: { items: [{ productId: ids[0], quantity: 1 }], paymentMethod: 'efectivo' },
        })
        if (res.status >= 300) throw new Error(`la venta ${String(i)} fallo: ${res.text}`)
      }

      const cookie = await sessionCookie(fx.admin)
      const hoy = hoyLocal()
      const rutas = await Promise.all([
        import('@/app/api/cash/balance/route'),
        import('@/app/api/inventory/replenishment/route'),
        import('@/app/api/purchases/summary/route'),
        import('@/app/api/reportes/vencimientos/route'),
        import('@/app/api/suppliers/cartera/route'),
        import('@/app/api/reports/rentabilidad/route'),
        import('@/app/api/reports/clientes/route'),
        import('@/app/api/admin/sales/route'),
      ])
      const urls = [
        '/api/cash/balance',
        '/api/inventory/replenishment',
        '/api/purchases/summary',
        '/api/reportes/vencimientos',
        '/api/suppliers/cartera',
        `/api/reports/rentabilidad?desde=${hoy}&hasta=${hoy}`,
        `/api/reports/clientes?desde=${hoy}&hasta=${hoy}`,
        `/api/admin/sales?start=${hoy}&end=${hoy}&page=1&pageSize=5`,
      ]

      return cuantasConsultas(async () => {
        for (const [i, mod] of rutas.entries()) {
          const res = await call(mod.GET, urls[i] ?? '', { cookie })
          if (res.status >= 300) throw new Error(`${urls[i] ?? ''} dio ${String(res.status)}`)
        }
      })
    }

    await exigirQueNoCrezca(medirCon, { pocas: 3, muchas: 20, que: 'el panel' })
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 5. La cuenta de un proveedor
// ---------------------------------------------------------------------------

describe('La cuenta corriente de un proveedor no crece con los movimientos', () => {
  it('mismo numero de consultas con 3 y con 20 recepciones', async () => {
    const medirCon = async (n: number): Promise<number> => {
      fx = await seedFixture()
      const ids = await catalogo(1)
      const productId = ids[0] ?? 0

      const { crearOrden, confirmarOrden, recibirMercaderia } =
        await import('@/modules/purchases/service')
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

      for (let i = 0; i < n; i++) {
        const orden = await crearOrden(sesion, {
          supplierId: fx.proveedor.id,
          notes: null,
          items: [{ productId, quantity: '2', unitCost: '1000' }],
        })
        await confirmarOrden(sesion, orden.id)
        const detalle = await prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: orden.id },
          select: { items: { select: { id: true } } },
        })
        await recibirMercaderia(sesion, orden.id, {
          items: detalle.items.map((it) => ({ orderItemId: it.id, quantity: '2' })),
          aplicarAnticipos: false,
        })
      }

      const { GET } = await import('@/app/api/suppliers/[id]/cuenta/route')
      const cookie = await sessionCookie(fx.admin)
      const id = String(fx.proveedor.id)
      return cuantasConsultas(async () => {
        const res = await call(GET, `/api/suppliers/${id}/cuenta?pageSize=25`, {
          cookie,
          params: { id },
        })
        if (res.status >= 300) throw new Error(`la cuenta dio ${String(res.status)}: ${res.text}`)
      })
    }

    await exigirQueNoCrezca(medirCon, { pocas: 3, muchas: 20, que: 'la cuenta del proveedor' })
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 6. FEFO
// ---------------------------------------------------------------------------

describe('FEFO no hace una consulta por lote', () => {
  it('vender de un producto con 2 lotes cuesta lo mismo que con 20', async () => {
    const medirCon = async (lotes: number): Promise<number> => {
      fx = await seedFixture()
      const producto = await prisma.product.create({
        data: {
          name: 'Yogur',
          price: 1000,
          categoryId: fx.categoryId,
          branchId: fx.branchA.id,
          lotTracking: 'REQUIRED',
          expirationTracking: 'REQUIRED',
        },
      })

      const total = lotes * 10
      await prisma.branchStock.create({
        data: { branchId: fx.branchA.id, productId: producto.id, quantity: total },
      })
      await prisma.stockMovement.create({
        data: {
          branchId: fx.branchA.id,
          productId: producto.id,
          type: 'INITIAL',
          quantity: total,
          previousQuantity: 0,
          resultingQuantity: total,
          userId: fx.admin.id,
          reason: 'Preparacion de la medicion',
        },
      })

      for (let i = 0; i < lotes; i++) {
        const lote = await prisma.productLot.create({
          data: {
            productId: producto.id,
            code: `L-${String(i).padStart(3, '0')}`,
            codeNormalized: `L-${String(i).padStart(3, '0')}`,
            // Vencimientos escalonados: FEFO tiene que elegir, no encontrarse
            // con un solo candidato.
            expirationDate: new Date(`${diaLocal(10 + i)}T00:00:00.000Z`),
            createdById: fx.admin.id,
          },
        })
        await prisma.branchLotStock.create({
          data: { branchId: fx.branchA.id, lotId: lote.id, quantity: 10 },
        })
      }

      const { POST } = await import('@/app/api/sales/route')
      const cookie = await sessionCookie(fx.cajero)
      const { consultas, resultado } = await medir(() =>
        call(POST, '/api/sales', {
          method: 'POST',
          cookie,
          // Cinco unidades: sale del primer lote entero y medio del segundo.
          // El reparto no depende de cuantos lotes haya en total.
          body: { items: [{ productId: producto.id, quantity: 5 }], paymentMethod: 'efectivo' },
        }),
      )
      if (resultado.status >= 300) throw new Error(`la venta fallo: ${resultado.text}`)
      return consultas
    }

    await exigirQueNoCrezca(medirCon, { pocas: 2, muchas: 20, que: 'la venta con FEFO' })
  }, 120_000)
})

// ---------------------------------------------------------------------------
// 7. La revision de un inventario
// ---------------------------------------------------------------------------

describe('La revision de un inventario no crece con las lineas', () => {
  it('mismo numero de consultas con 5 y con 40 lineas', async () => {
    const medirCon = async (n: number): Promise<number> => {
      fx = await seedFixture()
      const ids = await catalogo(n)

      const { POST } = await import('@/app/api/inventarios/route')
      const cookie = await sessionCookie(fx.admin)
      const creado = await call<{ id: number }>(POST, '/api/inventarios', {
        method: 'POST',
        cookie,
        body: { scope: 'SELECTION', productIds: ids, blindCount: false },
      })
      if (creado.status >= 300) throw new Error(`el inventario fallo: ${creado.text}`)

      const { GET } = await import('@/app/api/inventarios/[id]/lineas/route')
      const id = String(creado.body.id)
      return cuantasConsultas(async () => {
        const res = await call(GET, `/api/inventarios/${id}/lineas?pageSize=100`, {
          cookie,
          params: { id },
        })
        if (res.status >= 300) throw new Error(`las lineas dieron ${String(res.status)}`)
      })
    }

    await exigirQueNoCrezca(medirCon, { pocas: 5, muchas: 40, que: 'la revision del inventario' })
  }, 120_000)
})
