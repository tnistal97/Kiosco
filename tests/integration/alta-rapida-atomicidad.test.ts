/**
 * Atomicidad del alta rapida, con fallos INYECTADOS. Fase 5A.2.
 *
 * El alta escribe cinco cosas en una transaccion:
 *
 *   Product · ProductBarcode · BranchStock · StockMovement INITIAL · AuditLog
 *
 * La Fase 5A.1 comprobo que las cinco quedan escritas cuando todo sale bien, y
 * que un error de negocio --codigo repetido-- no deja nada a medias. Lo que NO
 * comprobo es que pasa si falla el CUARTO paso: la unica forma de saberlo es
 * hacerlo fallar.
 *
 * Como se inyecta el fallo, y por que asi:
 *
 *   Un disparador `BEFORE INSERT` sobre la tabla elegida que hace `RAISE
 *   EXCEPTION`. Falla exactamente donde se quiere, no toca una linea del codigo
 *   de la aplicacion --que es lo que la hace una prueba de lo que corre en
 *   produccion y no de una version instrumentada-- y se borra despues.
 *
 *   La alternativa --simular el cliente Prisma-- probaria que un doble se
 *   comporta como se le dijo. Esta prueba el motor de verdad haciendo ROLLBACK.
 *
 * De paso comprueba la otra mitad: que un fallo interno NO le cuenta al cajero
 * que existe un disparador, una tabla ni un motor de base de datos.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { seedFixture, prisma, descuadresDelLibro, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

// Red de seguridad: si una prueba se corta antes de limpiar, el disparador
// quedaria puesto y las 1.500 pruebas siguientes fallarian sin motivo visible.
afterEach(async () => {
  await limpiarDisparadores()
})

afterAll(async () => {
  await limpiarDisparadores()
  await prisma.$disconnect()
})

/** Las cinco tablas que el alta escribe, en el orden en que las escribe. */
const TABLAS = ['Product', 'ProductBarcode', 'BranchStock', 'StockMovement', 'AuditLog'] as const
type Tabla = (typeof TABLAS)[number]

const NOMBRE = 'falla_inyectada_5a2'

async function limpiarDisparadores(): Promise<void> {
  for (const tabla of TABLAS) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${NOMBRE} ON "${tabla}"`)
  }
}

/**
 * Corre `fn` con la primera insercion en `tabla` condenada a fallar.
 *
 * El disparador se borra pase lo que pase: si quedara puesto, el fallo se
 * mudaria a la prueba siguiente y el diagnostico costaria una tarde.
 */
async function conFalloAlInsertarEn<T>(tabla: Tabla, fn: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${NOMBRE}() RETURNS trigger AS $cuerpo$
    BEGIN
      RAISE EXCEPTION 'fallo inyectado por la prueba en %', TG_TABLE_NAME;
    END;
    $cuerpo$ LANGUAGE plpgsql;
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${NOMBRE} BEFORE INSERT ON "${tabla}"
    FOR EACH ROW EXECUTE FUNCTION ${NOMBRE}()
  `)
  try {
    return await fn()
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${NOMBRE} ON "${tabla}"`)
  }
}

const CODIGO = '7791234567890'

async function altaRapida(cookie: string) {
  const { POST } = await import('@/app/api/products/quick/route')
  return call(POST, '/api/products/quick', {
    method: 'POST',
    cookie,
    body: {
      barcode: CODIGO,
      name: 'Producto del fallo',
      price: '1500',
      categoryId: fx.categoryId,
      saleUnit: 'UNIT',
      initialStock: '5',
    },
  })
}

/** Cuantas filas hay de cada cosa. Se compara antes contra despues. */
async function censo() {
  const [productos, codigos, stocks, movimientos, bitacora] = await Promise.all([
    prisma.product.count(),
    prisma.productBarcode.count(),
    prisma.branchStock.count(),
    prisma.stockMovement.count(),
    prisma.auditLog.count(),
  ])
  return { productos, codigos, stocks, movimientos, bitacora }
}

describe('Un fallo en cualquier paso deja la base como estaba', () => {
  for (const tabla of TABLAS) {
    it(`fallo al insertar en ${tabla}: no queda nada a medias`, async () => {
      const cookie = await sessionCookie(fx.admin)
      const antes = await censo()

      const res = await conFalloAlInsertarEn(tabla, () => altaRapida(cookie))

      // Un fallo de infraestructura es 500, no un 4xx: no lo causo el usuario.
      expect(res.status, `respondio ${String(res.status)}: ${res.text}`).toBe(500)

      const despues = await censo()
      expect(despues, `quedaron filas escritas tras fallar en ${tabla}`).toEqual(antes)

      // Y en particular: ningun producto con ese nombre, ningun codigo suelto.
      expect(await prisma.product.count({ where: { name: 'Producto del fallo' } })).toBe(0)
      expect(await prisma.productBarcode.count({ where: { code: CODIGO } })).toBe(0)

      // El libro sigue cuadrado: no hay un movimiento sin su saldo ni al reves.
      expect(await descuadresDelLibro()).toEqual([])
    })
  }

  it('despues de un fallo, el mismo codigo se puede volver a dar de alta', async () => {
    // Es la comprobacion que le importa al cajero: el intento fallido no dejo
    // el codigo "ocupado" por una fila fantasma. Sin rollback completo, el
    // segundo intento chocaria contra el indice unico y el producto seria
    // imposible de cargar hasta que alguien mirara la base.
    const cookie = await sessionCookie(fx.admin)

    const fallido = await conFalloAlInsertarEn('AuditLog', () => altaRapida(cookie))
    expect(fallido.status).toBe(500)

    const segundo = await altaRapida(cookie)
    expect(segundo.status, segundo.text).toBe(201)

    const producto = await prisma.product.findFirstOrThrow({
      where: { name: 'Producto del fallo' },
      select: { id: true },
    })
    const movimientos = await prisma.stockMovement.findMany({
      where: { productId: producto.id },
      select: { type: true, quantity: true },
    })
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.type).toBe('INITIAL')
    expect(await descuadresDelLibro()).toEqual([])
  })
})

describe('Un fallo interno no le cuenta al cajero como esta hecha la base', () => {
  it('el mensaje no nombra el disparador, la tabla, el SQL ni Prisma', async () => {
    const cookie = await sessionCookie(fx.admin)
    const res = await conFalloAlInsertarEn('StockMovement', () => altaRapida(cookie))

    const error = errorDe(res)
    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('Error interno del servidor')

    // El requestId SI viaja: es lo que permite encontrar el detalle tecnico en
    // el log del servidor sin ponerlo en la pantalla de la caja.
    expect(error.requestId, 'sin requestId el fallo no se puede rastrear').toBeTruthy()

    // Y nada de lo que describe el interior aparece en la respuesta.
    const cuerpo = res.text.toLowerCase()
    for (const filtracion of [
      'fallo inyectado',
      'trigger',
      'disparador',
      'raise',
      'stockmovement',
      'prisma',
      'postgres',
      'insert',
      'select',
      'invocation',
      'node_modules',
      'kiosco_test',
      '.ts:',
    ]) {
      expect(cuerpo, `la respuesta contiene "${filtracion}"`).not.toContain(filtracion)
    }
  })
})

describe('Dos cajas creando el MISMO codigo con datos distintos', () => {
  it('queda un solo producto, un solo INITIAL y una sola alta en la bitacora', async () => {
    // El caso del pedido: mismo codigo, distinto nombre, distinto precio y
    // distinto stock inicial. Gana uno; el otro tiene que poder seguir
    // vendiendo, no quedarse con un 500.
    const { POST } = await import('@/app/api/products/quick/route')
    const cookie = await sessionCookie(fx.admin)

    const variantes = [
      { name: 'Gaseosa lima 500', price: '1200', initialStock: '3' },
      { name: 'Gaseosa limón 500 ml', price: '1350', initialStock: '7' },
      { name: 'GASEOSA LIMA', price: '1290', initialStock: '0' },
    ]

    const respuestas = await Promise.all(
      variantes.map((v) =>
        call(POST, '/api/products/quick', {
          method: 'POST',
          cookie,
          body: { barcode: CODIGO, categoryId: fx.categoryId, saleUnit: 'UNIT', ...v },
        }),
      ),
    )

    const creadas = respuestas.filter((r) => r.status === 201)
    const perdedoras = respuestas.filter((r) => r.status !== 201)

    expect(creadas, 'tiene que crear exactamente una').toHaveLength(1)
    expect(perdedoras).toHaveLength(2)

    // Ninguna perdedora se convierte en 500: un choque de codigo es una
    // situacion normal de dos cajas trabajando, no un fallo del sistema.
    for (const p of perdedoras) {
      expect(p.status, `una perdedora respondio ${String(p.status)}: ${p.text}`).toBe(409)
      expect(errorDe(p).code).toBe('PRODUCT_ALREADY_EXISTS')
    }

    // Un producto, un codigo.
    const productos = await prisma.product.findMany({
      where: { barcodes: { some: { code: CODIGO } } },
      select: { id: true, name: true, price: true },
    })
    expect(productos).toHaveLength(1)
    expect(await prisma.productBarcode.count({ where: { code: CODIGO } })).toBe(1)

    const productId = productos[0]?.id ?? 0

    // COMO MUCHO un INITIAL, nunca dos. Puede ser ninguno: una de las tres
    // variantes declara stock cero, y con cero el alta no emite movimiento a
    // proposito --la suma vacia ya da cero--. Cual gane es indeterminado, asi
    // que la prueba afirma la invariante, no el ganador.
    const movimientos = await prisma.stockMovement.findMany({
      where: { productId },
      select: { type: true, quantity: true },
    })
    const iniciales = movimientos.filter((m) => m.type === 'INITIAL')
    expect(iniciales.length, 'se escribio mas de un saldo de partida').toBeLessThanOrEqual(1)

    // Una sola alta en la bitacora, siempre. Esta no depende del ganador.
    const altas = await prisma.auditLog.count({
      where: { tableName: 'Product', recordId: productId, actionType: 'create' },
    })
    expect(altas, 'la bitacora registro mas de un alta del mismo producto').toBe(1)

    // Y el saldo coincide con su movimiento, o no hay ninguno de los dos.
    const stock = await prisma.branchStock.findMany({ where: { productId } })
    expect(stock.length, 'quedo mas de una fila de stock para el mismo producto').toBeLessThanOrEqual(1) // prettier-ignore
    expect(stock[0]?.quantity.toFixed(3) ?? '0.000').toBe(
      iniciales[0]?.quantity.toFixed(3) ?? '0.000',
    )
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('la perdedora recibe el producto que gano y lo puede vender', async () => {
    // Es lo que convierte el 409 en algo util: la caja que perdio no tiene que
    // volver a escanear ni preguntarle nada al cliente.
    const { POST } = await import('@/app/api/products/quick/route')
    const cookie = await sessionCookie(fx.admin)

    const primera = await call<{ id: number }>(POST, '/api/products/quick', {
      method: 'POST',
      cookie,
      body: {
        barcode: CODIGO,
        name: 'Alfajor triple',
        price: '900',
        categoryId: fx.categoryId,
        saleUnit: 'UNIT',
        initialStock: '4',
      },
    })
    expect(primera.status).toBe(201)

    const segunda = await call(POST, '/api/products/quick', {
      method: 'POST',
      cookie,
      body: {
        barcode: CODIGO,
        name: 'Alfajor triple chocolate',
        price: '950',
        categoryId: fx.categoryId,
        saleUnit: 'UNIT',
        initialStock: '2',
      },
    })
    expect(segunda.status).toBe(409)

    const detalle = errorDe(segunda)
    expect(detalle.code).toBe('PRODUCT_ALREADY_EXISTS')
    expect(detalle.message).toContain('Alfajor triple')

    const producto = (detalle.details as { producto?: { id: number; name: string } } | undefined)
      ?.producto
    expect(producto?.id, 'el 409 tiene que traer el producto que gano').toBe(primera.body.id)

    // Y se puede vender de una, con el id que vino en el error.
    const { POST: VENDER } = await import('@/app/api/sales/route')
    const venta = await call(VENDER, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { items: [{ productId: producto?.id ?? 0, quantity: 1 }], paymentMethod: 'efectivo' },
    })
    expect(venta.status, venta.text).toBeLessThan(300)
  })
})
