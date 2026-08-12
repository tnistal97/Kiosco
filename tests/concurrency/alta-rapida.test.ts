/**
 * Dos cajas dando de alta el mismo codigo al mismo tiempo.
 *
 * El caso es real y no rebuscado: es media mañana, llega un producto nuevo, y
 * las dos cajas lo pasan por el lector con un minuto de diferencia. Las dos ven
 * "codigo no registrado" y las dos aprietan "Crear producto".
 *
 * Tres propiedades:
 *
 *   1. se crea UNO. Nunca dos productos con el mismo codigo, ni dos productos
 *      distintos que compiten por la misma etiqueta;
 *   2. la que pierde recibe un CONFLICTO con el producto adentro, no un 500 y
 *      no un "codigo ocupado" a secas: tiene que poder seguir vendiendo sin
 *      volver a escanear;
 *   3. el stock no se duplica. Si las dos declaran 5 unidades, quedan 5 y no
 *      10: la que perdio no aplico nada.
 *
 * La comprobacion previa --"¿esta libre el codigo?"-- no alcanza y ese es el
 * punto: entre esa lectura y la insercion hay una ventana. Lo que cierra el
 * caso es el indice unico de la base, y lo que se prueba aca es que ese rechazo
 * se traduzca en algo con lo que se puede seguir trabajando.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import { POST as QUICK } from '@/app/api/products/quick/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const CODIGO = '7791234567890'

interface Creado {
  id: number
  name: string
  totalStock: string
}

async function altaSimultanea(cantidad: number, initialStock = '1') {
  const cookie = await sessionCookie(fx.admin)
  return Promise.all(
    Array.from({ length: cantidad }, (_, i) =>
      call<Creado>(QUICK, '/api/products/quick', {
        method: 'POST',
        cookie,
        body: {
          barcode: CODIGO,
          // Nombres distintos: si se colaran dos, se ve cual gano.
          name: `Producto de la caja ${String(i + 1)}`,
          price: '1000',
          categoryId: fx.categoryId,
          saleUnit: 'UNIT',
          initialStock,
        },
      }),
    ),
  )
}

describe('dos cajas, el mismo codigo', () => {
  it('crea uno solo y la otra recibe el producto que ya existe', async () => {
    const [a, b] = await altaSimultanea(2)
    if (!a || !b) throw new Error('faltaron respuestas')

    const estados = [a.status, b.status].sort((x, y) => x - y)
    expect(estados).toEqual([201, 409])

    const ganadora = a.status === 201 ? a : b
    const perdedora = a.status === 201 ? b : a

    const e = errorDe(perdedora)
    expect(e.code, 'un conflicto normal, no un fallo interno').toBe('PRODUCT_ALREADY_EXISTS')

    // Y lo que hace que la caja pueda seguir: el producto viene adentro.
    const detalle = e.details as { producto: { id: number; name: string } }
    expect(detalle.producto.id).toBe(ganadora.body.id)
    expect(detalle.producto.name).toBe(ganadora.body.name)
  })

  it('con cinco intentos simultaneos sigue habiendo un solo producto', async () => {
    const res = await altaSimultanea(5)

    expect(res.filter((r) => r.status === 201)).toHaveLength(1)
    expect(res.filter((r) => r.status === 409)).toHaveLength(4)
    // Ninguna cae en un 500: un choque de codigo es una condicion prevista.
    expect(res.some((r) => r.status >= 500)).toBe(false)

    const codigos = await prisma.productBarcode.findMany({ where: { code: CODIGO } })
    expect(codigos).toHaveLength(1)
  })

  it('el stock no se suma dos veces', async () => {
    await altaSimultanea(3, '5')

    const fila = await prisma.productBarcode.findUniqueOrThrow({
      where: { code: CODIGO },
      select: { productId: true },
    })
    const stock = await prisma.branchStock.findFirstOrThrow({
      where: { productId: fila.productId, branchId: fx.branchA.id },
    })
    expect(stock.quantity.toString(), 'la que perdio no aplico nada').toBe('5')

    const movs = await prisma.stockMovement.count({ where: { productId: fila.productId } })
    expect(movs, 'un solo movimiento INITIAL').toBe(1)
  })

  it('no quedan productos huerfanos de la transaccion que perdio', async () => {
    const antes = await prisma.product.count()
    await altaSimultanea(4)

    // Exactamente uno mas. Si la transaccion perdedora no revirtiera entero,
    // habria un producto sin codigo dando vueltas por el catalogo.
    expect(await prisma.product.count()).toBe(antes + 1)
  })

  it('la bitacora registra un alta, no cuatro', async () => {
    await altaSimultanea(4)

    const fila = await prisma.productBarcode.findUniqueOrThrow({
      where: { code: CODIGO },
      select: { productId: true },
    })
    const entradas = await prisma.auditLog.count({
      where: { tableName: 'Product', recordId: fila.productId, actionType: 'create' },
    })
    expect(entradas).toBe(1)
  })
})
