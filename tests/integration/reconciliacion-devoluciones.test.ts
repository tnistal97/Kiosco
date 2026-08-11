/**
 * La reconciliación de la Fase 4C: que ENCUENTRE lo que tiene que encontrar.
 *
 * Una comprobación que nunca falló no demostró nada. Cada caso rompe la base a
 * mano --por SQL crudo, esquivando el servicio-- y espera que el motor lo
 * marque. Es el mismo trato que reciben las diecisiete anteriores.
 *
 * Para romper hay que APAGAR LOS DISPARADORES DE INMUTABILIDAD, y eso mismo es
 * media prueba: no existe ningún camino de la aplicación que pueda dejar la base
 * en estos estados. Se apagan y se encienden alrededor de cada daño.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import {
  devolucionesContraLoRecibido,
  devolucionesContraSusEfectos,
  imputacionesContraSusTopes,
} from '@/modules/integrity/checks'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

/** Corre algo con un disparador apagado, y lo vuelve a encender pase lo que pase. */
async function sinDisparador(tabla: string, disparador: string, fn: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" DISABLE TRIGGER "${disparador}"`)
  try {
    await fn()
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" ENABLE TRIGGER "${disparador}"`)
  }
}

async function recibir(cajas: string, costo: string): Promise<{ receiptId: number }> {
  const cookie = await sessionCookie(fx.admin)

  const { POST: crear } = await import('@/app/api/purchases/route')
  const orden = await call<{ id: number }>(crear, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost: costo }],
    },
  })

  const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
  const confirmada = await call<{ items: Array<{ id: number }> }>(
    confirmar,
    `/api/purchases/${String(orden.body.id)}/confirm`,
    { method: 'POST', cookie, params: { id: String(orden.body.id) } },
  )

  const { POST: recibirRuta } = await import('@/app/api/purchases/[id]/receive/route')
  const res = await call<{ receiptId: number }>(
    recibirRuta,
    `/api/purchases/${String(orden.body.id)}/receive`,
    {
      method: 'POST',
      cookie,
      params: { id: String(orden.body.id) },
      body: {
        items: [{ orderItemId: confirmada.body.items[0]?.id, quantity: cajas, unitCost: costo }],
      },
    },
  )
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

/** Una devolución confirmada, entera, por los caminos reales. */
async function devolver(receiptId: number, cajas: string): Promise<{ id: number; number: string }> {
  const cookie = await sessionCookie(fx.admin)

  const { GET } = await import('@/app/api/purchases/recepciones/[id]/retornables/route')
  const r = await call<{ lineas: Array<{ receiptItemId: number }> }>(
    GET,
    `/api/purchases/recepciones/${String(receiptId)}/retornables`,
    { cookie, params: { id: String(receiptId) } },
  )

  const { POST: crear } = await import('@/app/api/devoluciones/route')
  const d = await call<{ id: number; number: string }>(crear, '/api/devoluciones', {
    method: 'POST',
    cookie,
    body: {
      purchaseReceiptId: receiptId,
      reason: 'DAMAGED',
      items: [{ receiptItemId: r.body.lineas[0]?.receiptItemId, quantity: cajas }],
    },
  })

  const { POST: confirmar } = await import('@/app/api/devoluciones/[id]/confirmar/route')
  const res = await call(confirmar, `/api/devoluciones/${String(d.body.id)}/confirmar`, {
    method: 'POST',
    cookie,
    params: { id: String(d.body.id) },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return d.body
}

// ===========================================================================
// El caso sano
// ===========================================================================

describe('Sobre una base sana', () => {
  it('las tres comprobaciones no encuentran nada', async () => {
    const r = await recibir('10', '1000')
    await devolver(r.receiptId, '2')

    for (const check of [
      devolucionesContraSusEfectos,
      devolucionesContraLoRecibido,
      imputacionesContraSusTopes,
    ]) {
      const resultado = await check()
      expect(resultado.inconsistencias, resultado.nombre).toEqual([])
    }
  })

  it('el exceso causado por una devolución posterior NO se marca', async () => {
    // Es el caso legítimo del objetivo 24: la entrega se pagó entera y después
    // se devolvió parte. Lo imputado supera la obligación neta y está bien.
    const r = await recibir('10', '10000')

    const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
    await call(POST, `/api/suppliers/${String(fx.proveedor.id)}/pagos`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { imputacion: 'automatica', amount: '100000', method: 'TRANSFER' },
    })

    await devolver(r.receiptId, '2')

    const resultado = await imputacionesContraSusTopes()
    expect(resultado.inconsistencias, 'el exceso está explicado por la devolución').toEqual([])
  })
})

// ===========================================================================
// Devoluciones contra sus efectos
// ===========================================================================

describe('Devoluciones', () => {
  it('marca una devolución cuyo importe no es la suma de sus renglones', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador('PurchaseReturn', 'PurchaseReturn_inmutable', async () => {
      await prisma.$executeRaw`UPDATE "PurchaseReturn" SET "total" = 9999 WHERE "id" = ${d.id}`
    })

    const resultado = await devolucionesContraSusEfectos()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('suma de sus renglones'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.entidad).toContain(d.number)
    expect(falla?.esperado).toBe('2000.00')
    expect(falla?.encontrado).toBe('9999.00')

    // Y ademas salta la del credito, que ya no coincide con el importe. Las dos
    // miran el mismo daño desde lados distintos, y eso es correcto: una fila
    // rota tiene que aparecer en todas las reglas que viola, no en la primera.
    expect(resultado.inconsistencias.map((i) => i.regla)).toContain(
      'toda devolucion confirmada acredita al proveedor',
    )
  })

  it('marca una devolución confirmada sin su movimiento de stock', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador('StockMovement', 'StockMovement_inmutable', async () => {
      await prisma.$executeRaw`
        DELETE FROM "StockMovement"
         WHERE "referenceType" = 'PurchaseReturn' AND "referenceId" = ${d.id}
      `
    })

    const resultado = await devolucionesContraSusEfectos()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('saco su mercaderia'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.encontrado).toBe('0')
  })

  it('marca una devolución confirmada sin su crédito', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador(
      'SupplierAccountMovement',
      'SupplierAccountMovement_inmutable',
      async () => {
        await prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "returnId" = ${d.id}`
      },
    )

    const resultado = await devolucionesContraSusEfectos()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('acredita al proveedor'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.esperado).toBe('-2000.00')
  })

  it('marca un crédito que apunta a una devolución sin confirmar', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador('PurchaseReturn', 'PurchaseReturn_inmutable', async () => {
      await prisma.$executeRaw`
        UPDATE "PurchaseReturn"
           SET "status" = 'CANCELLED', "cancelledAt" = now(), "cancelledById" = ${fx.admin.id},
               "confirmedAt" = NULL, "confirmedById" = NULL
         WHERE "id" = ${d.id}
      `
    })

    const resultado = await devolucionesContraSusEfectos()
    const falla = resultado.inconsistencias.find((i) =>
      i.regla.includes('viene de una devolucion confirmada'),
    )
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.encontrado).toBe('CANCELLED')
  })
})

// ===========================================================================
// Cantidades devueltas
// ===========================================================================

describe('Cantidades devueltas', () => {
  it('marca haber devuelto más de lo que llegó', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador('PurchaseReturnItem', 'PurchaseReturnItem_inmutable', async () => {
      await prisma.$executeRaw`
        UPDATE "PurchaseReturnItem" SET "quantity" = 40, "stockQuantity" = 320
         WHERE "purchaseReturnId" = ${d.id}
      `
    })

    const resultado = await devolucionesContraLoRecibido()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('mas de lo que llego'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.esperado).toBe('<= 10.000')
    expect(falla?.encontrado).toBe('40.000')
  })

  it('marca un renglón devuelto a un costo distinto del de la recepción', async () => {
    const r = await recibir('10', '1000')
    const d = await devolver(r.receiptId, '2')

    await sinDisparador('PurchaseReturnItem', 'PurchaseReturnItem_inmutable', async () => {
      await prisma.$executeRaw`
        UPDATE "PurchaseReturnItem" SET "unitCost" = 1350
         WHERE "purchaseReturnId" = ${d.id}
      `
    })

    const resultado = await devolucionesContraLoRecibido()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('costo congelado'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.esperado).toBe('1000.0000')
    expect(falla?.encontrado).toBe('1350.0000')
  })
})

// ===========================================================================
// Imputaciones
// ===========================================================================

describe('Imputaciones', () => {
  it('marca un pago con más imputado que su importe', async () => {
    // La entrega existe para que el pago tenga contra qué imputarse; su id no
    // hace falta después, porque el daño se hace sobre la imputación.
    await recibir('10', '10000')

    const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
    const pago = await call<{ id: number; number: string }>(
      POST,
      `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.proveedor.id) },
        body: { imputacion: 'automatica', amount: '50000', method: 'TRANSFER' },
      },
    )

    await sinDisparador(
      'SupplierPaymentAllocation',
      'SupplierPaymentAllocation_inmutable',
      async () => {
        await prisma.$executeRaw`
          UPDATE "SupplierPaymentAllocation" SET "amount" = 90000
           WHERE "paymentId" = ${pago.body.id}
        `
      },
    )

    const resultado = await imputacionesContraSusTopes()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('importe del pago'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.entidad).toContain(pago.body.number)
    expect(falla?.esperado).toBe('<= 50000.00')

    // La entrega vale $100.000, así que $90.000 no supera el bruto: esta fila
    // solo la encuentra la regla del pago. Es la que hace falta.
    expect(resultado.inconsistencias.filter((i) => i.regla.includes('lo que costo'))).toEqual([])
  })

  it('marca imputar por encima del importe ORIGINAL, aun con devoluciones de por medio', async () => {
    const entrega = await recibir('10', '10000')

    const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
    const pago = await call<{ id: number }>(
      POST,
      `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.proveedor.id) },
        body: { imputacion: 'automatica', amount: '100000', method: 'TRANSFER' },
      },
    )
    await devolver(entrega.receiptId, '2')

    // Hasta acá todo es legítimo: $100.000 imputados sobre una obligación neta
    // de $80.000, con $20.000 devueltos que lo explican. Se rompe llevando lo
    // imputado por encima del importe original, que es lo único que ninguna
    // devolución puede explicar.
    await sinDisparador(
      'SupplierPaymentAllocation',
      'SupplierPaymentAllocation_inmutable',
      async () => {
        await prisma.$executeRaw`
          UPDATE "SupplierPaymentAllocation" SET "amount" = 120000
           WHERE "paymentId" = ${pago.body.id}
        `
      },
    )

    const resultado = await imputacionesContraSusTopes()
    const falla = resultado.inconsistencias.find((i) => i.regla.includes('lo que costo'))
    expect(falla, JSON.stringify(resultado.inconsistencias)).toBeDefined()
    expect(falla?.esperado).toBe('<= 100000.00')
    expect(falla?.encontrado).toBe('120000.00')
  })

  /**
   * LA REGLA QUE NO ESTA, y por qué no está.
   *
   * El objetivo 24 pide comprobar que lo imputado no supere la obligación NETA,
   * "o documentar expresamente el caso válido de exceso causado por devolución
   * posterior". Está documentado, y hay algo más: escrita como regla aparte
   * sería una comprobación que NO PUEDE FALLAR NUNCA.
   *
   *     exceso = imputado - (total - devuelto)
   *     exceso > devuelto  <=>  imputado > total
   *
   * Es decir: exactamente la regla del importe original, que sí está. Esta
   * prueba fija esa equivalencia. Si algún día deja de valer --porque el neto
   * pase a descontar algo más que las devoluciones-- va a fallar, y ahí sí va a
   * hacer falta la segunda regla.
   */
  it('el exceso sobre el neto y el exceso sobre el bruto son la misma regla', async () => {
    const r = await recibir('10', '10000')

    const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
    await call(POST, `/api/suppliers/${String(fx.proveedor.id)}/pagos`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { imputacion: 'automatica', amount: '100000', method: 'TRANSFER' },
    })
    const d = await devolver(r.receiptId, '2')

    // Se achica la devolución: el neto sube y el exceso baja, LOS DOS a la vez.
    await sinDisparador('PurchaseReturn', 'PurchaseReturn_inmutable', async () => {
      await prisma.$executeRaw`UPDATE "PurchaseReturn" SET "total" = 5000 WHERE "id" = ${d.id}`
    })

    const filas = await prisma.$queryRaw<
      Array<{ imputado: string; total: string; devuelto: string }>
    >`
      SELECT COALESCE(sum(a."amount"), 0)::numeric(14,2)::text AS imputado,
             r."total"::numeric(14,2)::text                     AS total,
             COALESCE((
               SELECT sum(x."total") FROM "PurchaseReturn" x
                WHERE x."purchaseReceiptId" = r."id" AND x."status" = 'CONFIRMED'
             ), 0)::numeric(14,2)::text                         AS devuelto
        FROM "PurchaseReceipt" r
        LEFT JOIN "SupplierPaymentAllocation" a ON a."receiptId" = r."id"
       WHERE r."id" = ${r.receiptId}
       GROUP BY r."id", r."total"
    `
    const f = filas[0]
    const imputado = Number(f?.imputado)
    const total = Number(f?.total)
    const devuelto = Number(f?.devuelto)
    const exceso = imputado - (total - devuelto)

    expect(exceso, 'hay exceso sobre el neto').toBeGreaterThan(0)
    expect(exceso > devuelto, 'y NO lo explican las devoluciones').toBe(false)
    expect(imputado > total, 'que es lo mismo que decir que no supera el bruto').toBe(false)
  })
})

// ===========================================================================
// El motor completo
// ===========================================================================

describe('El motor entero', () => {
  it('corre las veintitrés comprobaciones y las nuevas están adentro', async () => {
    const { COMPROBACIONES } = await import('@/modules/integrity/checks')
    expect(COMPROBACIONES).toHaveLength(23)

    const nombres = await Promise.all(COMPROBACIONES.map(async (c) => (await c()).nombre))
    expect(nombres).toContain('Devoluciones')
    expect(nombres).toContain('Cantidades devueltas')
  })
})
