/**
 * Alta rapida de productos desde la caja. Fase 5A.1.
 *
 * Tres frentes, y el segundo es el que da sentido a toda la fase:
 *
 *   1. que se cree lo que se pidio y NADA MAS;
 *   2. que el stock inicial entre por el LIBRO, no escribiendo `BranchStock`
 *      a mano --si no, un producto nace con un saldo que ningun movimiento
 *      explica y la reconciliacion de la Fase 3D lo encuentra al dia
 *      siguiente--;
 *   3. que el permiso nuevo signifique algo y que el contrato no acepte de
 *      contrabando lo que el formulario largo si acepta.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import { POST as QUICK } from '@/app/api/products/quick/route'
import { GET as POR_CODIGO } from '@/app/api/products/barcode/[code]/route'
import { ORIGEN_ALTA_RAPIDA } from '@/modules/products/service'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface ProductoCreado {
  id: number
  name: string
  barcode: string | null
  price: string
  totalStock: string
  saleUnit: string
  isActive: boolean
  cost?: string | null
}

const BASE = {
  name: 'Alfajor triple',
  price: '1200',
  saleUnit: 'UNIT' as const,
  initialStock: '1',
}

async function crear(usuario = fx.admin, cuerpo: Record<string, unknown> = {}) {
  return call<ProductoCreado>(QUICK, '/api/products/quick', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { ...BASE, categoryId: fx.categoryId, ...cuerpo },
  })
}

// ---------------------------------------------------------------------------

describe('crea el producto y lo deja vendible', () => {
  it('devuelve 201 con el producto listo para el ticket', async () => {
    const res = await crear(fx.admin, { barcode: '7791234567890' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Alfajor triple')
    expect(res.body.barcode).toBe('7791234567890')
    expect(res.body.price).toBe('1200.00')
    expect(res.body.totalStock).toBe('1.000')
    expect(res.body.isActive).toBe(true)
  })

  it('el codigo queda buscable por el mismo endpoint que usa el lector', async () => {
    await crear(fx.admin, { barcode: '7790000111222' })

    const res = await call<ProductoCreado>(POR_CODIGO, '/api/products/barcode/7790000111222', {
      cookie: await sessionCookie(fx.cajero),
      params: { code: '7790000111222' },
    })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Alfajor triple')
  })

  it('conserva los ceros iniciales del codigo', async () => {
    // El caso que un `Number()` en el camino romperia en silencio.
    const res = await crear(fx.admin, { barcode: '0000750123' })
    expect(res.body.barcode).toBe('0000750123')

    const guardado = await prisma.productBarcode.findUnique({ where: { code: '0000750123' } })
    expect(guardado?.code).toBe('0000750123')
  })

  it('sin codigo tambien se puede: el producto artesanal', async () => {
    const res = await crear(fx.admin, {})
    expect(res.status).toBe(201)
    expect(res.body.barcode).toBeNull()
  })

  it('nace en la sucursal de la SESION', async () => {
    const res = await crear(fx.admin, { barcode: '7790000333444' })
    const p = await prisma.product.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(p.branchId).toBe(fx.branchA.id)
  })

  it('nace SIN rastreo de lotes: eso no se configura desde la caja', async () => {
    const res = await crear(fx.admin, { barcode: '7790000555666' })
    const p = await prisma.product.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(p.lotTracking).toBe('NONE')
    expect(p.expirationTracking).toBe('NONE')
  })

  it('sin minimo configurado y sin proveedor', async () => {
    const res = await crear(fx.admin, { barcode: '7790000777888' })
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { suppliers: true },
    })
    expect(p.minimumStock.toString()).toBe('0')
    expect(p.suppliers).toHaveLength(0)
  })
})

describe('el stock inicial entra por el libro', () => {
  it('emite un movimiento INITIAL con los dos saldos', async () => {
    const res = await crear(fx.admin, { barcode: '7791111000011', initialStock: '5' })

    const movs = await prisma.stockMovement.findMany({ where: { productId: res.body.id } })
    expect(movs).toHaveLength(1)
    expect(movs[0]?.type).toBe('INITIAL')
    expect(movs[0]?.quantity.toString()).toBe('5')
    expect(movs[0]?.previousQuantity.toString()).toBe('0')
    expect(movs[0]?.resultingQuantity.toString()).toBe('5')
    expect(movs[0]?.userId).toBe(fx.admin.id)
  })

  it('el saldo materializado coincide con la suma del libro', async () => {
    const res = await crear(fx.admin, { barcode: '7791111000028', initialStock: '7' })

    const stock = await prisma.branchStock.findFirstOrThrow({
      where: { productId: res.body.id, branchId: fx.branchA.id },
    })
    const suma = await prisma.stockMovement.aggregate({
      where: { productId: res.body.id },
      _sum: { quantity: true },
    })
    expect(stock.quantity.toString()).toBe('7')
    expect(suma._sum.quantity?.toString()).toBe('7')
  })

  it('con cero unidades NO emite movimiento: la suma vacia ya da cero', async () => {
    const res = await crear(fx.admin, { barcode: '7791111000035', initialStock: '0' })

    expect(res.body.totalStock).toBe('0.000')
    expect(await prisma.stockMovement.count({ where: { productId: res.body.id } })).toBe(0)
  })

  it('una fraccion en un producto por unidad se rechaza', async () => {
    const res = await crear(fx.admin, {
      barcode: '7791111000042',
      saleUnit: 'UNIT',
      initialStock: '1.5',
    })
    expect(res.status).toBe(400)
    expect(errorDe(res).message).toContain('Stock inicial')
  })

  it('en un producto por kilo, la fraccion es valida', async () => {
    const res = await crear(fx.admin, {
      barcode: '7791111000059',
      saleUnit: 'KG',
      initialStock: '0.425',
    })
    expect(res.status).toBe(201)
    expect(res.body.totalStock).toBe('0.425')
  })

  it('un fallo deja la base como estaba: no hay producto sin su movimiento', async () => {
    const antes = await prisma.product.count()
    // Cantidad invalida para la unidad: falla DESPUES de validar la categoria.
    await crear(fx.admin, { barcode: '7791111000066', initialStock: '2.5' })
    expect(await prisma.product.count()).toBe(antes)
    expect(await prisma.productBarcode.findUnique({ where: { code: '7791111000066' } })).toBeNull()
  })
})

describe('permisos', () => {
  it('sin sesion, 401', async () => {
    const res = await call(QUICK, '/api/products/quick', {
      method: 'POST',
      body: { ...BASE, categoryId: fx.categoryId },
    })
    expect(res.status).toBe(401)
  })

  it('el cajero NO puede: es la decision del reparto', async () => {
    const res = await crear(fx.cajero, { barcode: '7792222000019' })
    expect(res.status).toBe(403)
    expect(await prisma.productBarcode.findUnique({ where: { code: '7792222000019' } })).toBeNull()
  })

  it('el auditor no puede: quien revisa no modifica lo que revisa', async () => {
    const auditor = fx.porRol.auditor
    if (!auditor) throw new Error('falta el auditor en la fixture')
    expect((await crear(auditor, {})).status).toBe(403)
  })

  it('el repositor no puede: no esta en el mostrador y hoy no da altas', async () => {
    const repositor = fx.porRol.repositor
    if (!repositor) throw new Error('falta el repositor en la fixture')
    expect((await crear(repositor, {})).status).toBe(403)
  })

  it('el supervisor SI puede: es quien destraba la caja de noche', async () => {
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const res = await crear(supervisor, { barcode: '7792222000026' })
    expect(res.status).toBe(201)
  })

  it('el encargado y compras pueden', async () => {
    for (const [rol, codigo] of [
      ['encargado', '7792222000033'],
      ['compras', '7792222000040'],
    ] as const) {
      const usuario = fx.porRol[rol]
      if (!usuario) throw new Error(`falta ${rol} en la fixture`)
      expect((await crear(usuario, { barcode: codigo })).status, rol).toBe(201)
    }
  })
})

describe('el precio y el costo', () => {
  it('quien puede crear fija el precio inicial aunque no tenga products.price.update', async () => {
    // El supervisor NO tiene `products.price.update`. Puede poner el precio con
    // el que NACE un producto --sin precio no se puede vender, que es lo que se
    // viene a destrabar-- y no el de uno que ya existe.
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const res = await crear(supervisor, { barcode: '7793333000012', price: '999.50' })
    expect(res.status).toBe(201)
    expect(res.body.price).toBe('999.50')
  })

  it('...pero el mismo supervisor NO puede cambiar el precio de uno existente', async () => {
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const { PUT } = await import('@/app/api/products/[id]/route')
    const res = await call(PUT, `/api/products/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(supervisor),
      params: { id: String(fx.productoA.id) },
      body: { price: '1' },
    })
    expect(res.status).toBe(403)
  })

  it('el costo sin permiso se rechaza, no se ignora', async () => {
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const res = await crear(supervisor, { barcode: '7793333000029', cost: '500' })
    expect(res.status).toBe(403)
    expect(await prisma.productBarcode.findUnique({ where: { code: '7793333000029' } })).toBeNull()
  })

  it('el costo NO viaja en la respuesta de quien no puede verlo', async () => {
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const res = await crear(supervisor, { barcode: '7793333000036' })
    // Ni la clave: `undefined` es "no te lo puedo mostrar" y `null` es "no hay".
    expect('cost' in res.body).toBe(false)
    expect(res.text).not.toContain('"cost"')
  })

  it('con permiso, el costo se guarda y vuelve', async () => {
    const res = await crear(fx.admin, { barcode: '7793333000043', cost: '700.5' })
    expect(res.status).toBe(201)
    expect(res.body.cost).toBe('700.5000')
  })
})

describe('el contrato no acepta nada de contrabando', () => {
  const rechazados: Array<[string, Record<string, unknown>]> = [
    ['la sucursal', { branchId: 2 }],
    ['el usuario', { createdBy: 1 }],
    ['el estado', { isActive: false }],
    ['el stock por la puerta de atras', { totalStock: '999' }],
    ['el minimo', { minimumStock: '5' }],
    ['la politica de lotes', { lotTracking: 'REQUIRED' }],
    ['el vencimiento', { expirationTracking: 'REQUIRED' }],
    ['el proveedor', { supplierId: 1 }],
    ['codigos alternativos', { alternateBarcodes: ['123'] }],
    ['un id elegido a mano', { id: 999 }],
  ]

  for (const [que, extra] of rechazados) {
    it(`rechaza ${que}`, async () => {
      const res = await crear(fx.admin, { barcode: '7794444000015', ...extra })
      expect(res.status).toBe(400)
      // Y no creo nada por las dudas.
      expect(
        await prisma.productBarcode.findUnique({ where: { code: '7794444000015' } }),
      ).toBeNull()
    })
  }

  it('rechaza un codigo invalido antes de tocar la base', async () => {
    const res = await crear(fx.admin, { barcode: '779 1234' })
    expect(res.status).toBe(400)
    // El motivo concreto viaja en `details`; `message` es el generico del
    // contrato de validacion. Lo que importa es que llegue la razon, no un
    // "codigo invalido" a secas.
    expect(JSON.stringify(errorDe(res).details)).toContain('espacios')
  })

  it('exige nombre, precio y categoria', async () => {
    for (const falta of ['name', 'price', 'categoryId'] as const) {
      const cuerpo: Record<string, unknown> = { ...BASE, categoryId: fx.categoryId }
      delete cuerpo[falta]
      const res = await call(QUICK, '/api/products/quick', {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: cuerpo,
      })
      expect(res.status, falta).toBe(400)
    }
  })

  it('una categoria que no existe se explica, no revienta', async () => {
    const res = await crear(fx.admin, { barcode: '7794444000022', categoryId: 999_999 })
    expect(res.status).toBe(400)
    expect(errorDe(res).message).toContain('categoria')
  })
})

describe('cuando el codigo ya existe', () => {
  it('devuelve el producto de ESTA sucursal para poder seguir vendiendo', async () => {
    const res = await crear(fx.admin, { barcode: fx.productoA.barcode })

    expect(res.status).toBe(409)
    const e = errorDe(res)
    expect(e.code).toBe('PRODUCT_ALREADY_EXISTS')
    expect(e.message).toContain('Otro usuario acaba de registrar')

    const detalle = e.details as { producto: ProductoCreado }
    expect(detalle.producto.id).toBe(fx.productoA.id)
    expect(detalle.producto.name).toBe(fx.productoA.name)
  })

  it('el detalle del conflicto NO filtra el costo', async () => {
    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { cost: '123.4567' },
    })

    const res = await crear(supervisor, { barcode: fx.productoA.barcode })
    expect(res.status).toBe(409)
    expect(res.text).not.toContain('123.4567')
  })

  it('un codigo de OTRA sucursal no revela nada, y tampoco es un 500', async () => {
    const res = await crear(fx.admin, { barcode: fx.productoB.barcode })

    expect(res.status).toBe(409)
    const e = errorDe(res)
    expect(e.code).toBe('DUPLICATE_BARCODE')
    // Ni el nombre del producto ajeno ni la sucursal.
    expect(res.text).not.toContain(fx.productoB.name)
    expect(res.text).not.toContain(fx.branchB.name)
    expect(e.message).toContain('no pertenece a esta sucursal')
  })

  it('si el que lo tiene esta dado de baja, lo dice: hay que reactivarlo', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { isActive: false } })

    const res = await crear(fx.admin, { barcode: fx.productoA.barcode })
    const e = errorDe(res)
    expect(e.code).toBe('PRODUCT_ALREADY_EXISTS')
    expect(e.message).toContain('dado de baja')
  })

  it('nunca crea un duplicado', async () => {
    const antes = await prisma.product.count()
    await crear(fx.admin, { barcode: fx.productoA.barcode })
    expect(await prisma.product.count()).toBe(antes)
  })
})

describe('auditoria', () => {
  it('deja una entrada con su propio origen, distinguible del alta larga', async () => {
    const res = await crear(fx.admin, { barcode: '7795555000018', initialStock: '3' })

    const fila = await prisma.auditLog.findFirstOrThrow({
      where: { tableName: 'Product', recordId: res.body.id },
    })
    expect(fila.origin).toBe(ORIGEN_ALTA_RAPIDA)
    expect(fila.actionType).toBe('create')
    expect(fila.userId).toBe(fx.admin.id)
    expect(fila.branchId).toBe(fx.branchA.id)

    // Lo que hace falta para reconstruir el hecho: codigo, precio y el stock
    // que se declaro.
    const despues = JSON.stringify(fila.changes)
    expect(despues).toContain('7795555000018')
    expect(despues).toContain('1200')
    expect(despues).toContain('3')
  })

  it('el alta larga sigue teniendo SU origen', async () => {
    const { POST } = await import('@/app/api/products/route')
    const res = await call<ProductoCreado>(POST, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Por el formulario largo',
        price: '100',
        categoryId: fx.categoryId,
        barcode: '7795555000025',
      },
    })
    const fila = await prisma.auditLog.findFirstOrThrow({
      where: { tableName: 'Product', recordId: res.body.id },
    })
    expect(fila.origin).toBe('POST /api/products')
  })
})
