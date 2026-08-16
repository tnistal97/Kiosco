/**
 * Que lee el operario cuando algo sale mal. Fase 5A.2.
 *
 * Dos preguntas por cada error del sistema:
 *
 *   1. ¿Se entiende QUE paso, sin saber como esta hecho el sistema?
 *   2. ¿El mensaje filtra el interior --Prisma, SQL, un nombre de restriccion,
 *      una ruta del servidor, un stack--?
 *
 * La segunda no es cosmetica. `Unique constraint failed on the fields:
 * (barcode)` le describe el esquema a cualquiera que provoque el error a
 * proposito, y `Invalid prisma.user.create() invocation in /var/www/kiosco/...`
 * regala ademas la ruta de instalacion. La traduccion existe desde la Fase 1
 * --ver src/server/http/prismaErrors.ts-- y esta prueba es la que impide que se
 * abra un agujero nuevo.
 *
 * Lo que SI tiene que viajar: el `code`, para que el navegador pueda tratar el
 * caso, y el `requestId`, que es como se encuentra el detalle tecnico en el log
 * del servidor sin ponerlo en la pantalla de la caja.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, ponerStock, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie, type CallResult } from '../helpers/http'
import { mensajeVisible } from '@/lib/api-client'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * Lo que NUNCA puede aparecer en una respuesta de error.
 *
 * Cada entrada estuvo alguna vez en un mensaje de este sistema o de otro. El
 * `.ts:` y el `node_modules` atrapan un stack; `invocation` es la palabra con la
 * que Prisma encabeza sus errores; `constraint` y `violates` son de PostgreSQL.
 */
const PROHIBIDO = [
  'prisma',
  'postgres',
  'postgresql://',
  'node_modules',
  'invocation',
  'constraint',
  'violates',
  'sqlstate',
  'select ',
  'insert into',
  'update "',
  'delete from',
  '.ts:',
  'at async',
  'errno',
  'econnrefused',
  'kiosco_test',
  'c:\\',
  '/var/www',
]

/**
 * Comprueba el contrato y la ausencia de fugas.
 *
 * `pista` es lo que el operario tiene que poder leer: no se exige el mensaje
 * completo --que puede cambiar de redaccion-- sino que nombre la cosa concreta
 * de la que habla. Un mensaje generico que no dice de que producto se trata no
 * ayuda a nadie parado en la caja.
 */
function revisar(res: CallResult<unknown>, esperado: { status: number; pista?: RegExp }) {
  expect(res.status, `respondio ${String(res.status)}: ${res.text}`).toBe(esperado.status)

  const error = errorDe(res)
  expect(error.code, 'todo error tiene un codigo que el navegador pueda mirar').toBeTruthy()
  expect(error.requestId, 'sin requestId el fallo no se puede rastrear en el log').toBeTruthy()
  expect(error.message.length, 'un mensaje vacio no le dice nada a nadie').toBeGreaterThan(5)

  // Ni un stack, ni varias lineas de volcado.
  expect(error.message.split('\n').length, 'el mensaje tiene saltos de linea').toBe(1)

  const cuerpo = res.text.toLowerCase()
  for (const filtracion of PROHIBIDO) {
    expect(cuerpo, `la respuesta contiene "${filtracion}"`).not.toContain(filtracion)
  }

  if (esperado.pista) {
    // Se comprueba lo que la PERSONA va a leer, que para un rechazo de
    // validacion no es `message` --generico-- sino el motivo por campo. La
    // traduccion se importa de la aplicacion en vez de repetirse aca: si
    // cambiara, esta prueba tiene que cambiar con ella y no despues.
    const visible = mensajeVisible(error.code, error.message, error.details)
    expect(visible, 'el mensaje no dice de que esta hablando').toMatch(esperado.pista)
  }
  return error
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

describe('Los errores de la caja', () => {
  async function vender(body: unknown, usuario = fx.cajero) {
    const { POST } = await import('@/app/api/sales/route')
    return call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(usuario),
      body,
    })
  }

  it('sin sesion: 401 y nada mas', async () => {
    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET, '/api/products')
    revisar(res, { status: 401 })
  })

  it('codigo que no existe: 404 con un mensaje que se entiende', async () => {
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const code = '7799999999999'
    const res = await call(GET, `/api/products/barcode/${code}`, {
      cookie: await sessionCookie(fx.cajero),
      params: { code },
    })
    revisar(res, { status: 404, pista: /codigo/i })
  })

  it('producto dado de baja: 404, y NO dice "no existe"', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { isActive: false } })
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const res = await call(GET, `/api/products/barcode/${fx.productoA.barcode}`, {
      cookie: await sessionCookie(fx.cajero),
      params: { code: fx.productoA.barcode },
    })
    // El 404 es correcto --para la caja no esta disponible-- y la pantalla
    // distingue los dos casos preguntando con `?estado=todos`. Ver el POS.
    revisar(res, { status: 404 })
  })

  it('sin stock: dice cuanto hay y de que producto', async () => {
    await ponerStock(fx.branchA.id, fx.productoA.id, 2, fx.admin.id)
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 5 }],
      paymentMethod: 'efectivo',
    })
    const error = revisar(res, { status: 409, pista: /Fernet/ })
    expect(error.code).toBe('INSUFFICIENT_STOCK')
    // El numero concreto, no "no hay suficiente".
    expect(error.message).toMatch(/2/)
  })

  it('producto de otra sucursal: no confirma que exista en otro lado', async () => {
    const res = await vender({
      items: [{ productId: fx.productoB.id, quantity: 1 }],
      paymentMethod: 'efectivo',
    })
    // 400 y no 404: el id existe, lo que no corresponde es la sucursal. El
    // codigo `PRODUCT_NOT_IN_BRANCH` deja al navegador tratarlo distinto.
    const error = revisar(res, { status: 400, pista: /sucursal/i })
    expect(error.code).toBe('PRODUCT_NOT_IN_BRANCH')
    // No puede nombrar la otra sucursal ni el producto: seria contarle a un
    // cajero que hay un catalogo que no le corresponde.
    expect(error.message).not.toMatch(/Yerba|Sucursal B/i)
  })

  it('turno cerrado: lo dice antes de cobrar, no despues', async () => {
    // Se cierra con TODOS los campos del cierre: la restriccion
    // `CashShift_close_fields_check` impide dejar un turno a medio cerrar, y un
    // atajo aca fallaria contra ella. Es la restriccion haciendo su trabajo.
    await prisma.cashShift.updateMany({
      where: { branchId: fx.branchA.id, status: 'open' },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closedById: fx.admin.id,
        expectedAmount: 0,
        countedAmount: 0,
        difference: 0,
      },
    })
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'efectivo',
    })
    revisar(res, { status: 409, pista: /caja|turno/i })
  })

  it('venta a cuenta sin cliente: dice que falta el cliente', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      payments: [{ method: 'ACCOUNT', amount: '12500.00' }],
    })
    const error = revisar(res, { status: 400, pista: /cliente/i })
    expect(error.code).toBe('ACCOUNT_SALE_NEEDS_CLIENT')
  })

  it('la forma vieja de fiar: el motivo concreto llega en `details`', async () => {
    // `paymentMethod: 'ACCOUNT'` es de antes de que existiera el fiado y el
    // esquema lo rechaza. El servidor manda "Datos invalidos" con el motivo por
    // campo; hasta la Fase 5A.2 la pantalla mostraba solo lo primero, que no
    // dice que hacer. Ahora `mensajeVisible` --el mismo que usa el navegador--
    // devuelve el motivo.
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'ACCOUNT',
    })
    const error = revisar(res, { status: 400, pista: /pagos y el cliente/i })
    expect(error.code).toBe('VALIDATION')
    expect(error.message, 'el mensaje del servidor sigue siendo el generico').toBe(
      'Datos invalidos',
    )
  })

  it('limite de credito: dice el limite y lo que falta', async () => {
    // El cliente tiene $50.000 de limite. Un fernet vale $12.500: cinco son
    // $62.500 y pasan el limite.
    await ponerStock(fx.branchA.id, fx.productoA.id, 20, fx.admin.id)
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 5 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '62500.00' }],
    })
    const error = revisar(res, { status: 409, pista: /credito|crédito|límite|limite/i })
    expect(error.code).toBe('CREDIT_LIMIT_EXCEEDED')
  })

  it('un campo que no existe en el cuerpo: 400 sin describir el esquema', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'efectivo',
      branchId: fx.branchB.id,
      total: '1',
    })
    revisar(res, { status: 400 })
  })
})

// ---------------------------------------------------------------------------
// Alta rapida
// ---------------------------------------------------------------------------

describe('Los errores del alta rapida', () => {
  async function alta(body: unknown, usuario = fx.admin) {
    const { POST } = await import('@/app/api/products/quick/route')
    return call(POST, '/api/products/quick', {
      method: 'POST',
      cookie: await sessionCookie(usuario),
      body,
    })
  }

  const CUERPO = {
    barcode: '7791111111118',
    name: 'Producto nuevo',
    price: '1000',
    saleUnit: 'UNIT',
    initialStock: '1',
  }

  it('sin permiso: dice a quien pedirselo', async () => {
    const res = await alta({ ...CUERPO, categoryId: fx.categoryId }, fx.cajero)
    revisar(res, { status: 403, pista: /permiso/i })
  })

  it('categoria inexistente: 400 sin nombrar la tabla', async () => {
    const res = await alta({ ...CUERPO, categoryId: 999_999 })
    revisar(res, { status: 400, pista: /categor/i })
  })

  it('codigo ya usado por un producto de la sucursal: nombra el producto', async () => {
    const res = await alta({ ...CUERPO, barcode: fx.productoA.barcode, categoryId: fx.categoryId })
    const error = revisar(res, { status: 409, pista: /Fernet/ })
    expect(error.code).toBe('PRODUCT_ALREADY_EXISTS')
  })

  it('codigo de OTRA sucursal: dice que pida ayuda, sin revelar de donde', async () => {
    const res = await alta({ ...CUERPO, barcode: fx.productoB.barcode, categoryId: fx.categoryId })
    const error = revisar(res, { status: 409, pista: /sucursal/i })
    expect(error.message).not.toMatch(/Yerba|Sucursal B/i)
  })

  it('cantidad imposible para la unidad: dice por que', async () => {
    const res = await alta({ ...CUERPO, categoryId: fx.categoryId, initialStock: '1.235' })
    revisar(res, { status: 400 })
  })
})

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

describe('Los errores de compras', () => {
  async function crearOrden(body: unknown) {
    const { POST } = await import('@/app/api/purchases/route')
    return call(POST, '/api/purchases', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body,
    })
  }

  it('proveedor inexistente: 400 legible', async () => {
    const res = await crearOrden({
      supplierId: 999_999,
      items: [{ productId: fx.productoA.id, quantity: '1', unitCost: '100' }],
    })
    revisar(res, { status: 404, pista: /proveedor/i })
  })

  it('proveedor dado de baja: dice que esta dado de baja', async () => {
    const res = await crearOrden({
      supplierId: fx.proveedorInactivo.id,
      items: [{ productId: fx.productoA.id, quantity: '1', unitCost: '100' }],
    })
    // 409 y con nombre propio: dice cual proveedor, que le pasa y como se
    // arregla. Es el mensaje que un encargado puede resolver solo.
    const error = revisar(res, { status: 409, pista: /baja|inactiv/i })
    expect(error.code).toBe('SUPPLIER_INACTIVE')
    expect(error.message).toMatch(/Mayorista Cerrado/)
  })

  it('producto de otra sucursal en la orden: 404 sin nombrarlo', async () => {
    const res = await crearOrden({
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoB.id, quantity: '1', unitCost: '100' }],
    })
    // 404 con el id que mando el cliente, y nada mas: no se confirma que el
    // producto exista en otra sucursal.
    const error = revisar(res, { status: 404 })
    expect(error.message).not.toMatch(/Yerba|Sucursal B/i)
  })

  it('una orden que no existe: 404 y nada mas', async () => {
    const { GET } = await import('@/app/api/purchases/[id]/route')
    const res = await call(GET, '/api/purchases/999999', {
      cookie: await sessionCookie(fx.admin),
      params: { id: '999999' },
    })
    revisar(res, { status: 404 })
  })
})

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

describe('Los errores del inventario', () => {
  it('sin permiso para contar: 403 con motivo', async () => {
    const { POST } = await import('@/app/api/inventarios/route')
    const res = await call(POST, '/api/inventarios', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { scope: 'SELECTION', productIds: [fx.productoA.id], blindCount: true },
    })
    revisar(res, { status: 403, pista: /permiso/i })
  })

  it('un inventario que no existe: 404', async () => {
    const { GET } = await import('@/app/api/inventarios/[id]/route')
    const res = await call(GET, '/api/inventarios/999999', {
      cookie: await sessionCookie(fx.admin),
      params: { id: '999999' },
    })
    revisar(res, { status: 404 })
  })

  it('un id que no es un numero: 400, no un 500', async () => {
    // Es el caso que separa "validado" de "lo agarro el catch de arriba": un
    // id invalido tiene que morir en la validacion, no en la consulta.
    const { GET } = await import('@/app/api/inventarios/[id]/route')
    const res = await call(GET, '/api/inventarios/pepe', {
      cookie: await sessionCookie(fx.admin),
      params: { id: 'pepe' },
    })
    revisar(res, { status: 400 })
  })
})
