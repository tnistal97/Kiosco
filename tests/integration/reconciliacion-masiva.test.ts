/**
 * Reconciliación sobre CIENTOS de operaciones.
 *
 * Las pruebas de `reconciliacion.test.ts` comprueban cada regla con dos o tres
 * filas, que es lo que hace legible una prueba. Ésta comprueba otra cosa: que
 * las nueve invariantes sigan cerrando cuando hay volumen, mezcla de medios de
 * pago, anulaciones, ajustes y ventas por peso.
 *
 * Los errores de redondeo y de acumulación no aparecen con tres ventas: se
 * hacen visibles cuando doscientos subtotales se suman por dos caminos
 * distintos --`Decimal.js` en la aplicación y `SUM()` en PostgreSQL-- y hay que
 * llegar al mismo centavo.
 *
 * Ver docs/PHASE3_RECONCILIATION.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { comprobarIntegridad } from '@/modules/integrity/service'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Cuántas ventas. Suficiente para que la aritmética se note, corto para correr. */
const CUANTAS = 240

describe('Doscientas cuarenta ventas y el sistema sigue cerrando', () => {
  it('ventas en efectivo, transferencia, combinadas y anuladas, todas cuadran', async () => {
    // Stock de sobra, POR EL LIBRO.
    //
    // La primera version escribia `BranchStock` directamente, y la
    // reconciliacion lo marco: el saldo dejaba de ser la suma del libro. Es
    // exactamente lo que tiene que hacer, y sirve de recordatorio de que ni
    // siquiera una prueba puede saltear la unica puerta.
    const { PATCH: ajustar } = await import('@/app/api/stock/[id]/route')
    const cookieAdmin = await sessionCookie(fx.admin)
    for (const id of [fx.productoA.id, fx.productoCaja.id, fx.productoPeso.id]) {
      const res = await call(ajustar, `/api/stock/${String(id)}`, {
        method: 'PATCH',
        cookie: cookieAdmin,
        params: { id: String(id) },
        body: { delta: '900', type: 'MANUAL_ADJUSTMENT', reason: 'Carga para la prueba' },
      })
      expect(res.status, `no se pudo cargar stock: ${res.text}`).toBe(200)
    }
    // Un costo cargado para que la rentabilidad tenga con qué calcular.
    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { cost: '8123.4567' },
    })

    const { POST: vender } = await import('@/app/api/sales/route')
    const { POST: anular } = await import('@/app/api/sales/[id]/cancel/route')
    const cookie = await sessionCookie(fx.admin)

    const creadas: number[] = []

    for (let i = 0; i < CUANTAS; i++) {
      // Cuatro formas de cobrar, rotando. La tercera es la que importa: un
      // pago combinado deja DOS movimientos de caja y sólo uno entra al cajón.
      const precio = 12_500
      const cantidad = (i % 3) + 1
      const total = (precio * cantidad).toFixed(2)
      const enEfectivo = (precio * cantidad * 0.4).toFixed(2)
      const resto = (precio * cantidad - Number(enEfectivo)).toFixed(2)

      const pagos =
        i % 4 === 0
          ? [{ method: 'CASH', amount: total }]
          : i % 4 === 1
            ? [{ method: 'TRANSFER', amount: total }]
            : i % 4 === 2
              ? [
                  { method: 'CASH', amount: enEfectivo },
                  { method: 'TRANSFER', amount: resto },
                ]
              : [{ method: 'DEBIT_CARD', amount: total }]

      const res = await call<{ id: number }>(vender, '/api/sales', {
        method: 'POST',
        cookie,
        body: {
          items: [{ productId: fx.productoA.id, quantity: String(cantidad) }],
          payments: pagos,
        },
      })
      expect(res.status, `la venta ${String(i + 1)} fallo: ${res.text}`).toBe(201)
      creadas.push(res.body.id)
    }

    // Una de cada veinte se anula: los movimientos inversos tienen que cerrar
    // exactamente, medio por medio.
    for (let i = 0; i < creadas.length; i += 20) {
      const id = creadas[i]
      if (id === undefined) continue
      const res = await call(anular, `/api/sales/${String(id)}/cancel`, {
        method: 'POST',
        cookie,
        params: { id: String(id) },
        body: { reason: 'Prueba de volumen' },
      })
      expect(res.status).toBe(200)
    }

    // Y unas ventas POR PESO, con tres decimales, que son las que rompen la
    // aritmética cuando está mal hecha.
    for (const kilos of ['0.425', '1.750', '0.125', '2.333']) {
      const res = await call(vender, '/api/sales', {
        method: 'POST',
        cookie,
        body: {
          items: [{ productId: fx.productoPeso.id, quantity: kilos }],
          payments: [{ method: 'CASH', amount: (9800 * Number(kilos)).toFixed(2) }],
        },
      })
      expect(res.status, `la venta de ${kilos} kg fallo: ${res.text}`).toBe(201)
    }

    const informe = await comprobarIntegridad()

    expect(
      informe.comprobaciones
        .filter((c) => c.inconsistencias.length > 0)
        .map((c) => `${c.nombre}: ${JSON.stringify(c.inconsistencias.slice(0, 3))}`),
      'con volumen, algo dejó de cerrar',
    ).toEqual([])

    // Y que de verdad haya mirado el volumen: un informe que revisa cero
    // filas también daría cero inconsistencias.
    const ventas = informe.comprobaciones.find((c) => c.nombre === 'Ventas')
    expect(ventas?.revisadas).toBe(CUANTAS + 4)
  }, 180_000)
})
