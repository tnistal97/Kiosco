/**
 * La reconciliacion de cuentas por pagar: que CIERRE, y que sepa detectar
 * cuando no.
 *
 * Dos mitades, y la segunda es la que importa:
 *
 *   1. Una base sana no reporta nada.
 *   2. Una base rota reporta EXACTAMENTE lo que se rompio. Es lo que separa una
 *      comprobacion de un adorno: si no falla cuando tiene que fallar, que pase
 *      no significa nada.
 *
 * Cada inconsistencia se inyecta con SQL DIRECTO, saltando los servicios Y los
 * disparadores de inmutabilidad --que hay que desactivar y volver a poner--
 * porque es la unica forma de producir un estado que la aplicacion impide.
 * Simula lo que si puede pasar de verdad: una restauracion parcial, una edicion
 * a mano, un error de una version anterior.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { comprobarIntegridad } from '@/modules/integrity/service'
import type { Informe } from '@/modules/integrity/tipos'

import { POST as CREAR_ORDEN } from '@/app/api/purchases/route'
import { POST as CONFIRMAR } from '@/app/api/purchases/[id]/confirm/route'
import { POST as RECIBIR } from '@/app/api/purchases/[id]/receive/route'
import { POST as PAGAR } from '@/app/api/suppliers/[id]/pagos/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Las inconsistencias de una comprobacion concreta. */
function de(informe: Informe, nombre: string) {
  const c = informe.comprobaciones.find((x) => x.nombre === nombre)
  expect(c, `no existe la comprobacion "${nombre}"`).toBeDefined()
  return c?.inconsistencias ?? []
}

/**
 * Corre `fn` con los disparadores de inmutabilidad apagados.
 *
 * Los vuelve a habilitar SIEMPRE, incluso si `fn` falla: dejarlos apagados
 * haria que las pruebas siguientes corrieran sin la proteccion que dicen tener.
 */
async function sinDisparadores(fn: () => Promise<void>): Promise<void> {
  const tablas = [
    ['SupplierAccountMovement', 'SupplierAccountMovement_inmutable'],
    ['SupplierPayment', 'SupplierPayment_inmutable'],
    ['SupplierPaymentAllocation', 'SupplierPaymentAllocation_inmutable'],
    ['PurchaseReceipt', 'PurchaseReceipt_inmutable'],
  ] as const

  for (const [tabla, trigger] of tablas) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" DISABLE TRIGGER "${trigger}"`)
  }
  try {
    await fn()
  } finally {
    for (const [tabla, trigger] of tablas) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${tabla}" ENABLE TRIGGER "${trigger}"`)
    }
  }
}

/** Una entrega de $120.000 recibida entera. */
async function recibir(cajas = '10', costo = '12000'): Promise<number> {
  const cookie = await sessionCookie(fx.admin)
  const orden = await call<{ id: number }>(CREAR_ORDEN, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost: costo }],
    },
  })
  const c = await call<{ items: Array<{ id: number }> }>(
    CONFIRMAR,
    `/api/purchases/${String(orden.body.id)}/confirm`,
    { method: 'POST', cookie, params: { id: String(orden.body.id) } },
  )
  const r = await call<{ receiptId: number }>(
    RECIBIR,
    `/api/purchases/${String(orden.body.id)}/receive`,
    {
      method: 'POST',
      cookie,
      params: { id: String(orden.body.id) },
      body: { items: [{ orderItemId: c.body.items[0]?.id, quantity: cajas }] },
    },
  )
  return r.body.receiptId
}

async function pagar(monto: string, method = 'TRANSFER') {
  return call<{ id: number; number: string }>(
    PAGAR,
    `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { imputacion: 'automatica', amount: monto, method },
    },
  )
}

// ===========================================================================
// 1. Una base sana cierra
// ===========================================================================

describe('Una base sana', () => {
  it('no reporta nada después de recibir y pagar', async () => {
    await recibir()
    await pagar('40000')
    await pagar('30000', 'CASH')

    const informe = await comprobarIntegridad()
    expect(de(informe, 'Proveedores')).toHaveLength(0)
    expect(de(informe, 'Deuda por recepción')).toHaveLength(0)
    expect(de(informe, 'Pagos a proveedores')).toHaveLength(0)
    expect(de(informe, 'Imputaciones')).toHaveLength(0)
    expect(informe.total, 'ninguna de las 17 comprobaciones encuentra nada').toBe(0)
  })

  it('las recepciones anteriores a la fase NO se leen como error', async () => {
    // Es el caso del objetivo 36: en produccion no se genera deuda historica.
    // Una recepcion sin cargo y sin marca es correcta.
    const receiptId = await recibir()
    await sinDisparadores(async () => {
      await prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "receiptId" = ${receiptId}`
      await prisma.$executeRaw`UPDATE "PurchaseReceipt" SET "debtRecorded" = false WHERE "id" = ${receiptId}`
      await prisma.$executeRaw`UPDATE "Supplier" SET "balance" = 0 WHERE "id" = ${fx.proveedor.id}`
    })

    const informe = await comprobarIntegridad()
    expect(de(informe, 'Deuda por recepción')).toHaveLength(0)
    expect(de(informe, 'Proveedores')).toHaveLength(0)
  })
})

// ===========================================================================
// 2. Una base rota se detecta
// ===========================================================================

describe('Una base rota', () => {
  it('detecta un saldo que no cierra contra el libro', async () => {
    await recibir()
    await sinDisparadores(async () => {
      await prisma.$executeRaw`
        UPDATE "Supplier" SET "balance" = 999 WHERE "id" = ${fx.proveedor.id}
      `
    })

    const fallas = de(await comprobarIntegridad(), 'Proveedores')
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.regla).toContain('suma del libro')
    expect(fallas[0]?.encontrado).toBe('999.00')
    expect(fallas[0]?.esperado).toBe('120000.00')
  })

  it('detecta una fila del libro cuyos tres numeros no concuerdan', async () => {
    await recibir()

    // Para llegar a esta regla hay que sacar TAMBIEN la restriccion CHECK, y
    // que haga falta es la noticia: en una base con el esquema al dia, esta
    // fila NO PUEDE EXISTIR. El primer intento de esta prueba murio contra
    // `SupplierAccountMovement_saldos_check`, que es exactamente lo que se
    // quiere de una restriccion.
    //
    // La comprobacion sigue valiendo la pena igual, como segunda linea: una
    // restauracion desde un volcado anterior a la restriccion, o una base a la
    // que alguien le saco el CHECK para "arreglar" algo, entran por aca.
    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "SupplierAccountMovement" DROP CONSTRAINT "SupplierAccountMovement_saldos_check"',
      )
      try {
        await prisma.$executeRaw`
          UPDATE "SupplierAccountMovement" SET "resultingBalance" = 1
           WHERE "type" = 'PURCHASE_CHARGE'
        `
      } finally {
        // Se vuelve a poner SIEMPRE: dejarla fuera haria que las pruebas
        // siguientes corrieran sin la proteccion que dicen tener.
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "SupplierAccountMovement" ADD CONSTRAINT ' +
            '"SupplierAccountMovement_saldos_check" ' +
            'CHECK ("resultingBalance" = "previousBalance" + "amount") NOT VALID',
        )
      }
    })

    const fallas = de(await comprobarIntegridad(), 'Proveedores')

    // UNA sola falla, y es la de la fila. La del SALDO no salta, y es correcto:
    // solo se toco `resultingBalance`, asi que `sum(amount)` sigue dando el
    // saldo. Es justamente el motivo por el que las tres reglas existen por
    // separado en vez de una sola: cada una ve algo que las otras no.
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.regla).toContain('previo + delta')
  })

  it('detecta un movimiento borrado en el medio, por la cadena', async () => {
    await recibir()
    await pagar('40000')
    await recibir('5', '10000')

    await sinDisparadores(async () => {
      // Se borra el pago del medio y se corrige el saldo para tapar la huella.
      // Las dos primeras reglas quedarian conformes; la cadena, no.
      await prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "type" = 'PAYMENT'`
      await prisma.$executeRaw`
        UPDATE "Supplier" SET "balance" = 170000 WHERE "id" = ${fx.proveedor.id}
      `
    })

    const fallas = de(await comprobarIntegridad(), 'Proveedores')
    expect(fallas.some((f) => f.regla.includes('arranca donde termino'))).toBe(true)
  })

  it('detecta una recepción marcada que perdió su cargo', async () => {
    const receiptId = await recibir()
    await sinDisparadores(async () => {
      await prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "receiptId" = ${receiptId}`
      await prisma.$executeRaw`UPDATE "Supplier" SET "balance" = 0 WHERE "id" = ${fx.proveedor.id}`
    })

    const fallas = de(await comprobarIntegridad(), 'Deuda por recepción')
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.encontrado).toContain('0 cargo')
  })

  it('detecta una recepción SIN marcar que igual tiene cargo', async () => {
    // La otra direccion de la invariante: alguien escribio en el libro por
    // fuera del servicio.
    const receiptId = await recibir()
    await sinDisparadores(async () => {
      await prisma.$executeRaw`UPDATE "PurchaseReceipt" SET "debtRecorded" = false WHERE "id" = ${receiptId}`
    })

    const fallas = de(await comprobarIntegridad(), 'Deuda por recepción')
    expect(fallas.some((f) => f.regla.includes('<=>'))).toBe(true)
  })

  it('detecta un cargo por un importe distinto del de la entrega', async () => {
    const receiptId = await recibir()
    await sinDisparadores(async () => {
      await prisma.$executeRaw`
        UPDATE "SupplierAccountMovement"
           SET "amount" = 99000, "resultingBalance" = 99000
         WHERE "receiptId" = ${receiptId}
      `
      await prisma.$executeRaw`UPDATE "Supplier" SET "balance" = 99000 WHERE "id" = ${fx.proveedor.id}`
    })

    const fallas = de(await comprobarIntegridad(), 'Deuda por recepción')
    expect(fallas.some((f) => f.regla.includes('lo que costo la entrega'))).toBe(true)
  })

  it('detecta un pago en efectivo sin su egreso de caja', async () => {
    await recibir()
    const pago = await pagar('30000', 'CASH')
    await sinDisparadores(async () => {
      await prisma.$executeRaw`
        DELETE FROM "CashRegisterMovement" WHERE "supplierPaymentId" = ${pago.body.id}
      `
    })

    const fallas = de(await comprobarIntegridad(), 'Pagos a proveedores')
    expect(fallas.some((f) => f.regla.includes('sale del cajon'))).toBe(true)
  })

  it('detecta una transferencia que SÍ tocó la caja', async () => {
    await recibir()
    const pago = await pagar('30000', 'TRANSFER')
    await sinDisparadores(async () => {
      await prisma.$executeRaw`
        INSERT INTO "CashRegisterMovement"
          ("branchId", "userId", "amount", "paymentMethod", "type", "supplierPaymentId")
        VALUES (${fx.branchA.id}, ${fx.admin.id}, -30000, 'TRANSFER', 'supplier_payment',
                ${pago.body.id})
      `
    })

    const fallas = de(await comprobarIntegridad(), 'Pagos a proveedores')
    expect(fallas.some((f) => f.regla.includes('NO sale del cajon'))).toBe(true)
  })

  it('detecta una imputación que supera lo que costó la entrega', async () => {
    const receiptId = await recibir()
    const pago = await pagar('120000')
    await sinDisparadores(async () => {
      await prisma.$executeRaw`
        UPDATE "SupplierPaymentAllocation" SET "amount" = 200000
         WHERE "paymentId" = ${pago.body.id} AND "receiptId" = ${receiptId}
      `
    })

    const fallas = de(await comprobarIntegridad(), 'Imputaciones')
    expect(fallas.some((f) => f.regla.includes('no supera lo que costo'))).toBe(true)
    expect(fallas.some((f) => f.regla.includes('no supera el importe del pago'))).toBe(true)
  })

  it('detecta una imputación contra una entrega que no entró al libro', async () => {
    const receiptId = await recibir()
    await pagar('120000')
    await sinDisparadores(async () => {
      await prisma.$executeRaw`UPDATE "PurchaseReceipt" SET "debtRecorded" = false WHERE "id" = ${receiptId}`
    })

    const fallas = de(await comprobarIntegridad(), 'Imputaciones')
    expect(fallas.some((f) => f.regla.includes('entro al libro'))).toBe(true)
  })
})

// ===========================================================================
// 3. El punto ciego, dicho en voz alta
// ===========================================================================

describe('El punto ciego', () => {
  it('borrar el ÚLTIMO movimiento y ajustar el saldo es invisible a las tres reglas', async () => {
    await recibir()
    await pagar('40000')

    await sinDisparadores(async () => {
      const ultimo = await prisma.supplierAccountMovement.findFirstOrThrow({
        orderBy: { id: 'desc' },
      })
      await prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "id" = ${ultimo.id}`
      await prisma.$executeRaw`
        UPDATE "Supplier" SET "balance" = 120000 WHERE "id" = ${fx.proveedor.id}
      `
      // Y el pago que lo origino tambien, para que no lo delate la otra regla.
      await prisma.$executeRaw`DELETE FROM "SupplierPaymentAllocation"`
      await prisma.$executeRaw`DELETE FROM "SupplierPayment"`
    })

    const fallas = de(await comprobarIntegridad(), 'Proveedores')
    expect(
      fallas,
      'esta prueba documenta un limite REAL: lo tapa el disparador de inmutabilidad, ' +
        'no la reconciliacion. Si algun dia lo detecta, hay que borrar esta prueba.',
    ).toHaveLength(0)
  })
})
