/**
 * Stock vendible: lo que la caja puede prometer. Fase 5A.2.
 *
 * El escenario del pedido, con sus numeros:
 *
 *   BranchStock = 10 · vencido = 7 · vendible = 3
 *
 * Hasta esta fase la caja veia 10, dejaba armar un ticket de 5 y el rechazo
 * llegaba al cobrar, con el cliente enfrente. Ahora el DTO trae los tres
 * numeros y el ticket se corta en 3.
 *
 * LA propiedad que se comprueba, y que es lo unico que hace confiable al numero
 * del cliente: `sellableStock` coincide EXACTAMENTE con lo que el cobro deja
 * pasar. No se comprueba contra una cuenta escrita a mano en la prueba --eso
 * seria comprobar que dos copias de la misma formula coinciden-- sino contra el
 * comportamiento real del endpoint de venta.
 *
 * El cliente sigue sin ser autoridad: hay una prueba que cambia el vencimiento
 * DESPUES de que el navegador leyo el numero, y el cobro lo rechaza igual.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, diaLocal, descuadresDelLibro, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface ProductoConVendible {
  id: number
  totalStock: string
  sellableStock: string
  expiredStock: string
  saleUnit: string
}

/**
 * Un producto con lotes, con el stock repartido como diga `lotes`.
 *
 * `vence` es en dias desde hoy, EN LA ZONA DE LA SUCURSAL: negativo es vencido,
 * cero es "vence hoy" --que todavia se vende-- y null es sin fecha.
 */
async function conLotes(
  lotes: Array<{ cantidad: number; vence: number | null }>,
  opciones: { saleUnit?: string; sinAsignar?: number } = {},
): Promise<number> {
  const enLotes = lotes.reduce((s, l) => s + l.cantidad, 0)
  const total = enLotes + (opciones.sinAsignar ?? 0)

  const producto = await prisma.product.create({
    data: {
      name: 'Yogur descremado',
      price: 1200,
      categoryId: fx.categoryId,
      branchId: fx.branchA.id,
      saleUnit: opciones.saleUnit ?? 'UNIT',
      purchaseUnit: opciones.saleUnit ?? 'UNIT',
      unitsPerPurchaseUnit: 1,
      lotTracking: 'OPTIONAL',
      expirationTracking: 'OPTIONAL',
      barcodes: { create: { code: '7790000000917', isPrimary: true } },
    },
  })

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
      reason: 'Saldo de partida de la prueba',
    },
  })

  for (const [i, l] of lotes.entries()) {
    const code = `L-${String(i).padStart(3, '0')}`
    const lote = await prisma.productLot.create({
      data: {
        productId: producto.id,
        code,
        codeNormalized: code,
        expirationDate: l.vence === null ? null : new Date(`${diaLocal(l.vence)}T00:00:00.000Z`),
        createdById: fx.admin.id,
      },
    })
    await prisma.branchLotStock.create({
      data: { branchId: fx.branchA.id, lotId: lote.id, quantity: l.cantidad },
    })
  }

  return producto.id
}

/** Lo que el lector devuelve, que es lo que ve la caja. */
async function porCodigo(code = '7790000000917'): Promise<ProductoConVendible> {
  const { GET } = await import('@/app/api/products/barcode/[code]/route')
  const res = await call<ProductoConVendible>(GET, `/api/products/barcode/${code}`, {
    cookie: await sessionCookie(fx.cajero),
    params: { code },
  })
  expect(res.status, res.text).toBe(200)
  return res.body
}

/** Intenta vender. Devuelve el resultado crudo, para poder mirar el 409. */
async function vender(productId: number, quantity: string) {
  const { POST } = await import('@/app/api/sales/route')
  return call(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: { items: [{ productId, quantity }], paymentMethod: 'efectivo' },
  })
}

/**
 * LA comprobacion que ata el numero del cliente al del servidor.
 *
 * Vender exactamente lo vendible tiene que salir bien; vender un poco mas
 * tiene que ser rechazado. Si el DTO mintiera para arriba, lo agarra el
 * segundo; si mintiera para abajo, el primero.
 */
async function elNumeroCoincideConElCobro(productId: number, vendible: string): Promise<void> {
  const deMas = await vender(productId, String(Number(vendible) + 1))
  expect(deMas.status, 'vender MAS de lo vendible tenia que ser rechazado').toBe(409)

  if (Number(vendible) <= 0) return

  const justo = await vender(productId, vendible)
  expect(justo.status, `vender exactamente ${vendible} tenia que salir bien: ${justo.text}`).toBeLessThan(300) // prettier-ignore
}

describe('Los tres numeros del stock', () => {
  it('ninguno vencido: vendible es el total', async () => {
    const id = await conLotes([
      { cantidad: 3, vence: 30 },
      { cantidad: 7, vence: 60 },
    ])

    const p = await porCodigo()
    expect(p.totalStock).toBe('10.000')
    expect(p.sellableStock).toBe('10.000')
    expect(p.expiredStock).toBe('0.000')

    await elNumeroCoincideConElCobro(id, '10')
  })

  it('parcialmente vencido: 10 totales, 7 vencidos, 3 vendibles', async () => {
    // El ejemplo del pedido, con sus numeros.
    const id = await conLotes([
      { cantidad: 3, vence: 30 },
      { cantidad: 7, vence: -1 },
    ])

    const p = await porCodigo()
    expect(p.totalStock).toBe('10.000')
    expect(p.sellableStock).toBe('3.000')
    expect(p.expiredStock).toBe('7.000')

    // Y vender 5 --lo que el pedido describe como el callejon-- se rechaza.
    const cinco = await vender(id, '5')
    expect(cinco.status).toBe(409)
    expect(errorDe(cinco).code).toBe('INSUFFICIENT_SELLABLE_STOCK')

    await elNumeroCoincideConElCobro(id, '3')
  })

  it('todo vencido: vendible cero, y el total sigue diciendo la verdad', async () => {
    const id = await conLotes([{ cantidad: 10, vence: -5 }])

    const p = await porCodigo()
    expect(p.totalStock).toBe('10.000')
    expect(p.sellableStock).toBe('0.000')
    // El total NO se toca: la mercaderia existe, ocupa lugar y hay que darla de
    // baja. Ponerlo en cero seria hacerla desaparecer del inventario.
    expect(p.expiredStock).toBe('10.000')

    const uno = await vender(id, '1')
    expect(uno.status).toBe(409)
  })

  it('el que vence HOY todavia se vende', async () => {
    // La frontera: `VENCE_HOY` no es `VENCIDO`. Un yogur que vence el 15 se
    // vende el 15. Si esto se corriera un dia, la caja tiraria mercaderia
    // buena o venderia mercaderia vencida, segun hacia donde se corra.
    const id = await conLotes([{ cantidad: 4, vence: 0 }])

    const p = await porCodigo()
    expect(p.sellableStock).toBe('4.000')
    expect(p.expiredStock).toBe('0.000')

    await elNumeroCoincideConElCobro(id, '4')
  })

  it('sin control de vencimiento: los lotes sin fecha no vencen nunca', async () => {
    const id = await conLotes([
      { cantidad: 6, vence: null },
      { cantidad: 4, vence: null },
    ])

    const p = await porCodigo()
    expect(p.sellableStock).toBe('10.000')
    expect(p.expiredStock).toBe('0.000')

    await elNumeroCoincideConElCobro(id, '10')
  })

  it('un producto SIN seguimiento por lote: vendible es el total, siempre', async () => {
    const p = await porCodigo(fx.productoA.barcode)
    expect(p.totalStock).toBe('10.000')
    expect(p.sellableStock).toBe('10.000')
    expect(p.expiredStock).toBe('0.000')
  })

  it('un producto que DEJO de seguir lotes no arrastra sus vencidos', async () => {
    // El caso raro y real: la politica se aflojo a NONE y quedaron lotes
    // viejos. `resolverSalida()` ni los mira, asi que el cobro deja vender las
    // 10; contarlos como vencidos haria que la caja bloqueara una venta que el
    // servidor autoriza. Mentir por exceso de celo cuesta lo mismo que mentir
    // por defecto.
    const id = await conLotes([
      { cantidad: 3, vence: 30 },
      { cantidad: 7, vence: -1 },
    ])
    await prisma.product.update({
      where: { id },
      data: { lotTracking: 'NONE', expirationTracking: 'NONE' },
    })

    const p = await porCodigo()
    expect(p.totalStock).toBe('10.000')
    expect(p.sellableStock).toBe('10.000')
    expect(p.expiredStock).toBe('0.000')

    await elNumeroCoincideConElCobro(id, '10')
  })

  it('con stock sin asignar, vendible = sin asignar + lotes no vencidos', async () => {
    // 12 en total: 5 sueltos, 3 buenos y 4 vencidos. Vendibles, 8.
    const id = await conLotes(
      [
        { cantidad: 3, vence: 30 },
        { cantidad: 4, vence: -2 },
      ],
      { sinAsignar: 5 },
    )

    const p = await porCodigo()
    expect(p.totalStock).toBe('12.000')
    expect(p.sellableStock).toBe('8.000')
    expect(p.expiredStock).toBe('4.000')

    await elNumeroCoincideConElCobro(id, '8')
  })
})

describe('Por peso, con lotes', () => {
  it('los tres numeros salen con tres decimales y el cobro coincide', async () => {
    const id = await conLotes(
      [
        { cantidad: 2, vence: 20 },
        { cantidad: 3, vence: -1 },
      ],
      { saleUnit: 'KG' },
    )

    const p = await porCodigo()
    expect(p.saleUnit).toBe('KG')
    expect(p.totalStock).toBe('5.000')
    expect(p.sellableStock).toBe('2.000')
    expect(p.expiredStock).toBe('3.000')

    // Fraccionado: 1,750 kg entra, 2,250 kg no.
    const parcial = await vender(id, '1.750')
    expect(parcial.status, parcial.text).toBeLessThan(300)

    const pasado = await vender(id, '2.250')
    expect(pasado.status).toBe(409)
  })
})

describe('El numero del cliente NO es autoridad', () => {
  it('si el lote vence entre la lectura y el cobro, el cobro rechaza igual', async () => {
    // La caja leyo "3 vendibles" y armo el ticket. Antes de cobrar, alguien
    // corrige la fecha del lote --llego mal cargada-- y ahora esta vencido. El
    // servidor no le cree al numero que el navegador tiene en pantalla.
    const id = await conLotes([
      { cantidad: 3, vence: 5 },
      { cantidad: 7, vence: -1 },
    ])

    const antes = await porCodigo()
    expect(antes.sellableStock).toBe('3.000')

    await prisma.productLot.updateMany({
      where: { productId: id, code: 'L-000' },
      data: { expirationDate: new Date(`${diaLocal(-1)}T00:00:00.000Z`) },
    })

    const res = await vender(id, '3')
    expect(res.status, 'el cobro tenia que recalcular y rechazar').toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_SELLABLE_STOCK')

    // Y el libro no se movio: una venta rechazada no descuenta nada.
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('dos cajas vendiendo a la vez no pasan del vendible', async () => {
    // 3 vendibles, dos cajas piden 2 cada una. Una sola puede ganar: el
    // servidor recalcula dentro de la transaccion, con el lote bloqueado.
    const id = await conLotes([
      { cantidad: 3, vence: 30 },
      { cantidad: 7, vence: -1 },
    ])

    const { POST } = await import('@/app/api/sales/route')
    const cookie = await sessionCookie(fx.cajero)
    const pedir = () =>
      call(POST, '/api/sales', {
        method: 'POST',
        cookie,
        body: { items: [{ productId: id, quantity: '2' }], paymentMethod: 'efectivo' },
      })

    const [a, b] = await Promise.all([pedir(), pedir()])
    const exitosas = [a, b].filter((r) => r.status < 300)
    const rechazadas = [a, b].filter((r) => r.status === 409)

    expect(exitosas, 'las dos ventas entraron: 2 + 2 = 4 y solo habia 3 vendibles').toHaveLength(1)
    expect(rechazadas).toHaveLength(1)

    // Queda 1 vendible y los 7 vencidos siguen ahi.
    const p = await porCodigo()
    expect(p.sellableStock).toBe('1.000')
    expect(p.expiredStock).toBe('7.000')
    expect(p.totalStock).toBe('8.000')
    expect(await descuadresDelLibro()).toEqual([])
  })
})

describe('El listado tambien trae los tres numeros', () => {
  it('la busqueda por texto no miente sobre lo vendible', async () => {
    // La caja tiene dos caminos --el lector y el buscador-- y los dos tienen
    // que decir lo mismo. Que solo uno supiera de vencidos seria peor que que
    // ninguno lo supiera.
    await conLotes([
      { cantidad: 3, vence: 30 },
      { cantidad: 7, vence: -1 },
    ])

    const { GET } = await import('@/app/api/products/route')
    const res = await call<{ data: ProductoConVendible[] }>(GET, '/api/products?q=Yogur', {
      cookie: await sessionCookie(fx.cajero),
    })

    expect(res.status).toBe(200)
    const fila = res.body.data[0]
    expect(fila?.totalStock).toBe('10.000')
    expect(fila?.sellableStock).toBe('3.000')
    expect(fila?.expiredStock).toBe('7.000')
  })
})
