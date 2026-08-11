/**
 * Reportes: rentabilidad historica, permisos y privacidad del costo.
 *
 * La prueba central del archivo es "la ganancia del lunes no cambia el
 * viernes": es el motivo entero de que `SaleItem.costAtSale` exista.
 *
 * Ver docs/REPORTING_MODEL.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const hoy = () => hoyLocal()

async function fijarCosto(productId: number, cost: string, reason: string) {
  const { PUT } = await import('@/app/api/products/[id]/cost/route')
  return call(PUT, `/api/products/${String(productId)}/cost`, {
    method: 'PUT',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(productId) },
    body: { cost, reason },
  })
}

async function vender(productId: number, quantity: string, amount: string, usuario = fx.admin) {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number; total: string }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: {
      items: [{ productId, quantity }],
      payments: [{ method: 'CASH', amount }],
    },
  })
}

interface Rentabilidad {
  facturado: string
  costoVendido: string
  gananciaBruta: string
  margenBruto: string | null
  lineasSinCosto: number
  lineasTotales: number
  facturadoSinCosto: string
  porProducto: Array<{ producto: string; ganancia: string }>
}

async function rentabilidad(usuario = fx.admin) {
  const { GET } = await import('@/app/api/reports/rentabilidad/route')
  return call<Rentabilidad>(GET, `/api/reports/rentabilidad?desde=${hoy()}&hasta=${hoy()}`, {
    cookie: await sessionCookie(usuario),
  })
}

// ---------------------------------------------------------------------------
// La venta de las 21:30
// ---------------------------------------------------------------------------

describe('una venta despues de las 21:00 aparece en SU dia', () => {
  /**
   * Es la regresion de un error que sobrevivio a la Fase 3D entera.
   *
   * La 3D arreglo el calculo del rango --se hace con la zona IANA de la
   * sucursal, y eso estaba bien-- pero las consultas de reporte comparaban la
   * columna contra un `Date` de JavaScript. El conector lo manda como
   * `timestamptz`, y PostgreSQL convierte LA COLUMNA usando la zona de la
   * SESION, que sale del sistema operativo del servidor de base de datos.
   *
   * Con la base en Argentina, una venta de las 21:30 --guardada como 00:30 UTC
   * del dia siguiente-- se convertia a 03:30 y quedaba fuera de un dia que
   * termina a las 02:59:59.999. Desaparecia de su propio dia.
   *
   * LA SUITE NO LO DETECTABA porque las ventas de las otras pruebas se crean
   * con `now()`: solo fallaban si la suite corria despues de las 21:00. Un
   * error que aparece tres horas por dia es peor que uno permanente, porque
   * parece intermitente.
   *
   * Esta prueba NO depende del reloj: fija la fecha de la venta a mano en la
   * franja peligrosa y pregunta por el dia local que le corresponde.
   */
  it('LA REGRESION: una venta de las 21:30 no desaparece de su dia', async () => {
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    const venta = await vender(fx.productoA.id, '1', '12500.00')
    expect(venta.status).toBe(201)

    // 15 de mayo de 2026, 21:30 en Buenos Aires = 16 de mayo 00:30 UTC.
    //
    // Es la franja en la que el dia local y el dia UTC ya no coinciden, que es
    // donde vivia el error. Se escribe directo porque lo que se prueba es la
    // LECTURA, no como se creo la venta.
    const instante = new Date('2026-05-16T00:30:00.000Z')
    await prisma.sale.update({ where: { id: venta.body.id }, data: { date: instante } })

    const { GET } = await import('@/app/api/reports/rentabilidad/route')
    const reporte = await call<{ facturado: string; lineasTotales: number }>(
      GET,
      '/api/reports/rentabilidad?desde=2026-05-15&hasta=2026-05-15',
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(reporte.status).toBe(200)
    expect(
      reporte.body.facturado,
      'la venta de las 21:30 desaparecio del 15 de mayo: el rango se calculo bien ' +
        'pero la comparacion en SQL convirtio la columna con la zona de la sesion',
    ).toBe('12500.00')
    expect(reporte.body.lineasTotales).toBe(1)
  })

  it('y NO aparece en el dia siguiente', async () => {
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    const venta = await vender(fx.productoA.id, '1', '12500.00')
    await prisma.sale.update({
      where: { id: venta.body.id },
      data: { date: new Date('2026-05-16T00:30:00.000Z') },
    })

    const { GET } = await import('@/app/api/reports/rentabilidad/route')
    const reporte = await call<{ facturado: string }>(
      GET,
      '/api/reports/rentabilidad?desde=2026-05-16&hasta=2026-05-16',
      { cookie: await sessionCookie(fx.admin) },
    )

    // La otra mitad: arreglar el limite de abajo corriendo todo un dia hacia
    // adelante habria hecho pasar la prueba anterior y roto esta.
    expect(reporte.body.facturado, 'la venta se conto en el dia equivocado').toBe('0.00')
  })

  it('el reporte de ventas la encuentra igual', async () => {
    const venta = await vender(fx.productoA.id, '1', '12500.00')
    await prisma.sale.update({
      where: { id: venta.body.id },
      data: { date: new Date('2026-05-16T00:30:00.000Z') },
    })

    const { GET } = await import('@/app/api/reports/ventas/route')
    const reporte = await call<{ totales: { facturado: string; operaciones: number } }>(
      GET,
      '/api/reports/ventas?desde=2026-05-15&hasta=2026-05-15',
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(reporte.body.totales.operaciones, 'el reporte de ventas tiene el mismo problema').toBe(1)
    expect(reporte.body.totales.facturado).toBe('12500.00')
  })
})

// ---------------------------------------------------------------------------
// El costo congelado
// ---------------------------------------------------------------------------

describe('La ganancia de una venta no cambia despues', () => {
  it('la venta guarda el costo QUE HABIA, no el de hoy', async () => {
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    const venta = await vender(fx.productoA.id, '2', '25000.00')
    expect(venta.status).toBe(201)

    const linea = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.body.id },
      select: { costAtSale: true, price: true },
    })
    expect(linea.costAtSale?.toFixed(4)).toBe('8000.0000')

    // Llega mercaderia mas cara. La venta de antes no se entera.
    await fijarCosto(fx.productoA.id, '10400.00', 'Aumento del proveedor')

    const despues = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.body.id },
      select: { costAtSale: true },
    })
    expect(despues.costAtSale?.toFixed(4), 'el costo de la venta se movio solo').toBe('8000.0000')
  })

  it('EL CASO DEL PEDIDO: la ganancia del lunes sigue siendo la del lunes', async () => {
    // Lunes: costaba $8.000, se vendio a $12.500. Ganancia $4.500 por unidad.
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    await vender(fx.productoA.id, '1', '12500.00')

    const lunes = await rentabilidad()
    expect(lunes.body.facturado).toBe('12500.00')
    expect(lunes.body.costoVendido).toBe('8000.00')
    expect(lunes.body.gananciaBruta).toBe('4500.00')

    // Viernes: llega mercaderia a $10.400.
    await fijarCosto(fx.productoA.id, '10400.00', 'Aumento del proveedor')

    const viernes = await rentabilidad()
    expect(
      viernes.body.gananciaBruta,
      'la ganancia del lunes cambio porque llego un camion el viernes',
    ).toBe('4500.00')
    expect(viernes.body.costoVendido).toBe('8000.00')
  })

  it('un producto sin costo cargado deja la linea en NULL, no en cero', async () => {
    // `productoA` arranca sin costo, como todo el catalogo migrado.
    const venta = await vender(fx.productoA.id, '1', '12500.00')

    const linea = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.body.id },
      select: { costAtSale: true },
    })
    expect(linea.costAtSale, 'cero seria "no me costo nada", que es otra cosa').toBeNull()
  })

  it('las lineas sin costo quedan FUERA del calculo y se informan', async () => {
    // Una con costo y una sin.
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    await vender(fx.productoA.id, '1', '12500.00')
    await vender(fx.productoCaja.id, '1', '3450.00')

    const r = (await rentabilidad()).body

    expect(r.lineasTotales).toBe(2)
    expect(r.lineasSinCosto).toBe(1)
    // La facturacion que se compara contra el costo es SOLO la de las lineas
    // con costo conocido: comparar la facturacion completa contra un costo
    // parcial daria un margen inflado.
    expect(r.facturado).toBe('12500.00')
    expect(r.facturadoSinCosto).toBe('3450.00')
    expect(r.gananciaBruta).toBe('4500.00')
    expect(r.margenBruto).toBe('36.0')
  })

  it('sin ventas, el margen es null y no una division por cero', async () => {
    const r = (await rentabilidad()).body
    expect(r.facturado).toBe('0.00')
    expect(r.margenBruto).toBeNull()
  })

  it('una venta anulada no suma a la rentabilidad', async () => {
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    const venta = await vender(fx.productoA.id, '1', '12500.00')

    const { POST } = await import('@/app/api/sales/[id]/cancel/route')
    await call(POST, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(venta.body.id) },
      body: { reason: 'Se arrepintio' },
    })

    const r = (await rentabilidad()).body
    expect(r.facturado).toBe('0.00')
    expect(r.gananciaBruta).toBe('0.00')
  })
})

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

describe('Cada reporte pide SU permiso', () => {
  const CASOS: Array<{ ruta: string; modulo: string; permiso: string }> = [
    { ruta: 'ventas', modulo: '@/app/api/reports/ventas/route', permiso: 'reports.sales.view' },
    {
      ruta: 'rentabilidad',
      modulo: '@/app/api/reports/rentabilidad/route',
      permiso: 'reports.costs.view',
    },
    {
      ruta: 'inventario',
      modulo: '@/app/api/reports/inventario/route',
      permiso: 'reports.inventory.view',
    },
    { ruta: 'caja', modulo: '@/app/api/reports/caja/route', permiso: 'reports.cash.view' },
    {
      ruta: 'compras',
      modulo: '@/app/api/reports/compras/route',
      permiso: 'reports.purchases.view',
    },
  ]

  it.each(CASOS)('el cajero no puede ver /reports/$ruta', async ({ ruta, modulo }) => {
    const { GET } = (await import(modulo)) as {
      GET: (req: Request, ctx: unknown) => Promise<Response>
    }
    const res = await call(GET, `/api/reports/${ruta}?desde=${hoy()}&hasta=${hoy()}`, {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.status).toBe(403)
  })

  it('el encargado de compras ve compras pero NO la caja', async () => {
    const compras = fx.porRol.compras
    expect(compras).toBeDefined()
    if (!compras) return

    const { GET: verCompras } = await import('@/app/api/reports/compras/route')
    const ok = await call(verCompras, `/api/reports/compras?desde=${hoy()}&hasta=${hoy()}`, {
      cookie: await sessionCookie(compras),
    })
    expect(ok.status).toBe(200)

    const { GET: verCaja } = await import('@/app/api/reports/caja/route')
    const no = await call(verCaja, `/api/reports/caja?desde=${hoy()}&hasta=${hoy()}`, {
      cookie: await sessionCookie(compras),
    })
    expect(no.status, 'quien compra no tiene por que ver la caja').toBe(403)
  })

  it('el supervisor ve ventas y caja pero NO la rentabilidad', async () => {
    const supervisor = fx.porRol.supervisor
    expect(supervisor).toBeDefined()
    if (!supervisor) return

    const { GET: verVentas } = await import('@/app/api/reports/ventas/route')
    expect(
      (
        await call(verVentas, `/api/reports/ventas?desde=${hoy()}&hasta=${hoy()}`, {
          cookie: await sessionCookie(supervisor),
        })
      ).status,
    ).toBe(200)

    expect((await rentabilidad(supervisor)).status, 'el margen no es de mostrador').toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Privacidad del dinero
// ---------------------------------------------------------------------------

describe('El costo no sale para quien no puede verlo', () => {
  it('la valorizacion del inventario llega nula sin permiso de costos', async () => {
    const supervisor = fx.porRol.supervisor
    expect(supervisor).toBeDefined()
    if (!supervisor) return

    const { GET } = await import('@/app/api/reports/inventario/route')
    const res = await call<{ valorizado: string | null; productos: number }>(
      GET,
      `/api/reports/inventario?desde=${hoy()}&hasta=${hoy()}`,
      { cookie: await sessionCookie(supervisor) },
    )

    expect(res.status).toBe(200)
    expect(res.body.productos, 'las cantidades si las ve').toBeGreaterThan(0)
    expect(res.body.valorizado, 'la valorizacion es informacion de costos').toBeNull()

    // Y el administrador si.
    const conPermiso = await call<{ valorizado: string | null }>(
      GET,
      `/api/reports/inventario?desde=${hoy()}&hasta=${hoy()}`,
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(conPermiso.body.valorizado).not.toBeNull()
  })

  it('el cajero ve el historial de ventas pero NO la recaudacion', async () => {
    // Hasta la Fase 3D esta pantalla le respondia 403 al cajero, aunque el
    // menu le mostrara el enlace: el endpoint pedia el permiso de reportes.
    await vender(fx.productoA.id, '1', '12500.00', fx.cajero)

    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{
      data: unknown[]
      totales: { ventas: number; recaudado: string | null }
    }>(GET, `/api/admin/sales?start=${hoy()}&end=${hoy()}`, {
      cookie: await sessionCookie(fx.cajero),
    })

    expect(res.status, 'el cajero tiene que poder abrir su historial de ventas').toBe(200)
    expect(res.body.totales.ventas).toBe(1)
    expect(res.body.data.length).toBe(1)
    expect(res.body.totales.recaudado, 'cuanto factura el local no es de mostrador').toBeNull()

    const admin = await call<{ totales: { recaudado: string | null } }>(
      GET,
      `/api/admin/sales?start=${hoy()}&end=${hoy()}`,
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(admin.body.totales.recaudado).toBe('12500.00')
  })
})

// ---------------------------------------------------------------------------
// El rango
// ---------------------------------------------------------------------------

describe('El rango se interpreta en la zona de la sucursal', () => {
  it('una venta de las 23:30 entra en el reporte de SU dia', async () => {
    await fijarCosto(fx.productoA.id, '8000.00', 'Lista de mayo')
    const venta = await vender(fx.productoA.id, '1', '12500.00')

    // Se la mueve a las 23:30 de hoy EN LA SUCURSAL. Con la convencion vieja
    // --medianoche UTC-- este instante caia en el dia siguiente.
    const { inicioDelDia } = await import('@/lib/tiempo')
    const a2330 = new Date(inicioDelDia(hoy(), 'America/Argentina/Buenos_Aires').getTime() + 84_600_000) // prettier-ignore
    await prisma.$executeRaw`UPDATE "Sale" SET "date" = ${a2330} WHERE "id" = ${venta.body.id}`

    const { GET } = await import('@/app/api/reports/ventas/route')
    const res = await call<{ totales: { operaciones: number; facturado: string } }>(
      GET,
      `/api/reports/ventas?desde=${hoy()}&hasta=${hoy()}`,
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.body.totales.operaciones, 'la venta de las 23:30 desaparecio del dia').toBe(1)
    expect(res.body.totales.facturado).toBe('12500.00')
  })

  it('un rango invertido se rechaza con un mensaje y no con una lista vacia', async () => {
    const { GET } = await import('@/app/api/reports/ventas/route')
    const res = await call(GET, `/api/reports/ventas?desde=${hoy()}&hasta=2020-01-01`, {
      cookie: await sessionCookie(fx.admin),
    })
    expect(res.status).toBe(400)
  })
})
