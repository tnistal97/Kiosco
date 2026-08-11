/**
 * La reconciliacion de la cuenta corriente: que CIERRE, y que sepa detectar
 * cuando no.
 *
 * Mismas dos mitades que `reconciliacion.test.ts`, y la segunda es la que
 * importa:
 *
 *   1. Una base sana no reporta nada.
 *   2. Una base rota reporta EXACTAMENTE lo que se rompio. Es lo que separa una
 *      comprobacion de un adorno: si no falla cuando tiene que fallar, que pase
 *      no significa nada.
 *
 * Cada inconsistencia se inyecta con SQL DIRECTO, saltando los servicios Y los
 * disparadores de inmutabilidad --que hay que desactivar y volver a poner-- es
 * la unica forma de producir un estado que la aplicacion impide. Simula lo que
 * si puede pasar de verdad: una restauracion parcial, una edicion a mano, un
 * error de una version anterior.
 *
 * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { comprobarIntegridad } from '@/modules/integrity/service'
import type { Informe } from '@/modules/integrity/tipos'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as COBRAR } from '@/app/api/clients/[id]/pagos/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '10000.00' } })
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
 * Es la unica forma de inyectar el defecto: el libro NO se puede editar, y esa
 * es justamente la defensa que hace falta saltear para comprobar que la
 * reconciliacion detecta lo que la defensa impide.
 *
 * Los vuelve a habilitar SIEMPRE, incluso si `fn` falla: dejarlos apagados
 * haria que las pruebas siguientes corrieran sin la proteccion que dicen tener.
 */
async function sinDisparadores(fn: () => Promise<void>): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "CustomerAccountMovement" DISABLE TRIGGER "CustomerAccountMovement_inmutable"',
  )
  try {
    await fn()
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "CustomerAccountMovement" ENABLE TRIGGER "CustomerAccountMovement_inmutable"',
    )
  }
}

/** Venta de $30.000: $10.000 en efectivo y $20.000 a cuenta de Juan. */
async function ventaFiada() {
  return call<{ id: number }>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: {
      items: [{ productId: fx.productoA.id, quantity: 3 }],
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    },
  })
}

async function cobrar(monto: string, method = 'CASH') {
  return call<{ id: number; number: string }>(
    COBRAR,
    `/api/clients/${String(fx.cliente.id)}/pagos`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { amount: monto, method },
      params: { id: String(fx.cliente.id) },
    },
  )
}

// ---------------------------------------------------------------------------
// La base sana cierra
// ---------------------------------------------------------------------------

describe('una base sana no reporta nada', () => {
  it('la fixture con clientes cierra en las diecisiete comprobaciones', async () => {
    const informe = await comprobarIntegridad()
    expect(
      informe.comprobaciones.filter((c) => c.inconsistencias.length > 0).map((c) => c.nombre),
      'la fixture no deberia tener inconsistencias',
    ).toEqual([])
    // El numero se fija a proposito: si alguien agrega una comprobacion y se
    // olvida de actualizarlo, esta prueba lo dice. Trece de la Fase 4A, mas
    // las cuatro de cuentas por pagar de la 4B.
    expect(informe.comprobaciones).toHaveLength(17)
  })

  it('despues de fiar, cobrar y anular sigue cerrando', async () => {
    const venta = await ventaFiada()
    expect(venta.status).toBe(201)

    expect((await cobrar('8000.00')).status).toBe(201)
    expect((await cobrar('2000.00', 'TRANSFER')).status).toBe(201)

    const anulada = await call(ANULAR, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { reason: 'Se arrepintio' },
      params: { id: String(venta.body.id) },
    })
    expect(anulada.status).toBeLessThan(300)

    const informe = await comprobarIntegridad()
    expect(
      informe.comprobaciones
        .filter((c) => c.inconsistencias.length > 0)
        .map((c) => `${c.nombre}: ${JSON.stringify(c.inconsistencias)}`),
      'el circuito completo de cuenta corriente tiene que cerrar',
    ).toEqual([])
  })

  it('las cuatro comprobaciones nuevas estan en el informe', async () => {
    const informe = await comprobarIntegridad()
    const nombres = informe.comprobaciones.map((c) => c.nombre)
    expect(nombres).toContain('Clientes')
    expect(nombres).toContain('Venta a cuenta')
    expect(nombres).toContain('Cobros a clientes')
    expect(nombres).toContain('Anulaciones de cuenta')
  })
})

// ---------------------------------------------------------------------------
// Clientes: saldo contra libro
// ---------------------------------------------------------------------------

describe('Clientes — detecta un saldo que no coincide con su libro', () => {
  it('un saldo tocado a mano aparece con la diferencia exacta', async () => {
    await ventaFiada()

    // El saldo se cambia por SQL directo: la regla de ESLint y la unica puerta
    // impiden hacerlo desde el codigo, que es exactamente el punto.
    await prisma.$executeRawUnsafe(
      `UPDATE "Client" SET "balance" = 15000 WHERE "id" = ${String(fx.cliente.id)}`,
    )

    const fallas = de(await comprobarIntegridad(), 'Clientes')
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.entidad).toBe('Juan Pérez')
    expect(fallas[0]?.regla).toBe('saldo = suma del libro')
    expect(fallas[0]?.esperado).toBe('20000.00')
    expect(fallas[0]?.encontrado).toBe('15000.00')
    expect(fallas[0]?.diferencia).toBe('-5000')
  })

  it('un movimiento cuyos tres numeros no concuerdan', async () => {
    await ventaFiada()

    // Este defecto NO se puede producir con el disparador apagado: lo impide
    // ademas una restriccion CHECK, que un DISABLE TRIGGER no toca.
    //
    // Para llegar al estado hay que quitar tambien la restriccion, y eso no es
    // una trampa de la prueba: es EXACTAMENTE el escenario contra el que existe
    // esta regla. Una base restaurada desde un respaldo anterior a la Fase 4A
    // trae filas escritas cuando esa defensa no existia, y la reconciliacion
    // tiene que encontrarlas igual.
    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "CustomerAccountMovement" DROP CONSTRAINT "CustomerAccountMovement_saldos_check"',
      )
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "CustomerAccountMovement" SET "resultingBalance" = 99999
            WHERE "clientId" = ${String(fx.cliente.id)}`,
        )
      } finally {
        // Se repone SIN validar las filas existentes (`NOT VALID`): la fila que
        // se acaba de romper es justamente la que no la cumple. Reponerla es lo
        // que impide que las pruebas siguientes corran sin la defensa.
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "CustomerAccountMovement"
             ADD CONSTRAINT "CustomerAccountMovement_saldos_check"
             CHECK ("resultingBalance" = "previousBalance" + "amount") NOT VALID`,
        )
      }
    })

    const fallas = de(await comprobarIntegridad(), 'Clientes')
    const suelta = fallas.find((f) => f.regla === 'previo + delta = resultante')
    expect(suelta, 'no detecto la fila que no cierra sola').toBeDefined()
    expect(suelta?.esperado).toBe('99999.00')
  })

  it('un movimiento BORRADO del medio rompe la cadena', async () => {
    // Tres movimientos: cargo, pago, pago. Se borra el del medio.
    await ventaFiada()
    await cobrar('5000.00')
    await cobrar('3000.00')

    const movimientos = await prisma.customerAccountMovement.findMany({
      where: { clientId: fx.cliente.id },
      orderBy: { id: 'asc' },
    })
    expect(movimientos).toHaveLength(3)
    const delMedio = movimientos[1]

    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement" WHERE "id" = ${String(delMedio?.id ?? 0)}`,
      )
      // Y se "arregla" el saldo a mano para tapar la primera regla, que es lo
      // que haria alguien que borra una fila y quiere que no se note.
      await prisma.$executeRawUnsafe(
        `UPDATE "Client" SET "balance" = 12000 WHERE "id" = ${String(fx.cliente.id)}`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Clientes')
    const cadena = fallas.find((f) => f.regla === 'empieza donde termino el anterior')

    expect(
      cadena,
      'la tercera regla es la que detecta una fila borrada del medio aunque el saldo cuadre',
    ).toBeDefined()
    expect(cadena?.detalle).toContain('falta un movimiento')
  })

  it('DOCUMENTA EL PUNTO CIEGO: borrar el ULTIMO movimiento y ajustar el saldo no se detecta', async () => {
    await ventaFiada()
    await cobrar('5000.00')

    const movimientos = await prisma.customerAccountMovement.findMany({
      where: { clientId: fx.cliente.id },
      orderBy: { id: 'asc' },
    })
    const ultimo = movimientos[movimientos.length - 1]

    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement" WHERE "id" = ${String(ultimo?.id ?? 0)}`,
      )
      await prisma.$executeRawUnsafe(
        `UPDATE "Client" SET "balance" = 20000 WHERE "id" = ${String(fx.cliente.id)}`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Clientes')

    // Las tres reglas del libro pasan: el saldo suma, cada fila cierra sola y
    // la cadena es continua. Es el MISMO punto ciego que el libro de stock, y
    // se deja escrito porque decirlo vale mas que fingir lo contrario.
    //
    // Contra esto protege el DISPARADOR de inmutabilidad --que esta prueba tuvo
    // que desactivar para llegar hasta aca-- y no la reconciliacion.
    expect(
      fallas,
      'si algun dia esto detecta el caso, la limitacion documentada dejo de existir ' +
        'y hay que actualizar docs/CUSTOMER_ACCOUNT_LEDGER.md',
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Venta a cuenta contra el libro
// ---------------------------------------------------------------------------

describe('Venta a cuenta — detecta lo fiado que no llego a la cuenta', () => {
  it('un cargo borrado deja la venta fiada sin su movimiento', async () => {
    const venta = await ventaFiada()

    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement"
          WHERE "saleId" = ${String(venta.body.id)} AND "type" = 'SALE_CHARGE'`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Venta a cuenta')
    const importes = fallas.find((f) => f.regla === 'lo fiado en la venta = lo cargado a la cuenta')

    expect(importes, 'se fiaron 20.000 y no se cargaron a ninguna cuenta').toBeDefined()
    expect(importes?.esperado).toBe('20000.00')
    expect(importes?.encontrado).toBe('0.00')
  })

  it('una venta con parte a cuenta y sin cliente', async () => {
    const venta = await ventaFiada()

    await prisma.$executeRawUnsafe(
      `UPDATE "Sale" SET "clientId" = NULL WHERE "id" = ${String(venta.body.id)}`,
    )

    const fallas = de(await comprobarIntegridad(), 'Venta a cuenta')
    const sinCliente = fallas.find((f) => f.regla === 'una venta con saldo a cuenta tiene cliente')

    expect(sinCliente, 'una deuda sin deudor no se puede cobrar').toBeDefined()
    expect(sinCliente?.detalle).toContain('20000.00')
  })

  it('EL PEOR CASO: la deuda cargada a OTRO cliente', async () => {
    const venta = await ventaFiada()

    // Los importes cuadran perfecto: 20.000 fiados y 20.000 cargados. Lo que
    // esta mal es a QUIEN. Sin la tercera regla, esto pasaria la reconciliacion.
    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "CustomerAccountMovement"
            SET "clientId" = ${String(fx.clienteSinLimite.id)}
          WHERE "saleId" = ${String(venta.body.id)} AND "type" = 'SALE_CHARGE'`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Venta a cuenta')
    const otro = fallas.find((f) => f.regla === 'el cargo es al cliente de la venta')

    expect(otro, 'una deuda cargada a otra persona cuadra en los importes').toBeDefined()
    expect(otro?.esperado).toBe(`cliente ${String(fx.cliente.id)}`)
    expect(otro?.encontrado).toBe(`cliente ${String(fx.clienteSinLimite.id)}`)
  })
})

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

describe('Cobros a clientes — detecta el cobro que no movio lo que debia', () => {
  it('un cobro sin su movimiento de cuenta', async () => {
    await ventaFiada()
    const pago = await cobrar('8000.00')

    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement" WHERE "paymentId" = ${String(pago.body.id)}`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Cobros a clientes')
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.entidad).toBe('Cobro RC-00000001')
    expect(fallas[0]?.encontrado).toBe('0.00 en 0')
  })

  it('un cobro en efectivo que no entro al cajon', async () => {
    await ventaFiada()
    const pago = await cobrar('8000.00')

    await prisma.$executeRawUnsafe(
      `DELETE FROM "CashRegisterMovement" WHERE "customerPaymentId" = ${String(pago.body.id)}`,
    )

    const fallas = de(await comprobarIntegridad(), 'Cobros a clientes')
    const caja = fallas.find((f) => f.regla === 'un cobro en efectivo entra al cajon')

    expect(caja, 'el efectivo cobrado tiene que llegar al cajon').toBeDefined()
    expect(caja?.esperado).toBe('8000.00')
    expect(caja?.encontrado).toBe('0.00')
  })

  it('una transferencia que SI entro al cajon', async () => {
    await ventaFiada()
    const pago = await cobrar('8000.00', 'TRANSFER')

    // Se le inventa un movimiento de caja a un cobro que no fue en efectivo.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CashRegisterMovement"
        ("branchId", "userId", "amount", "paymentMethod", "description", "type", "customerPaymentId")
      VALUES (${String(fx.branchA.id)}, ${String(fx.cajero.id)}, 8000, 'CASH',
              'Movimiento inventado', 'customer_payment', ${String(pago.body.id)})
    `)

    const fallas = de(await comprobarIntegridad(), 'Cobros a clientes')
    const noEfectivo = fallas.find(
      (f) => f.regla === 'un cobro que no es en efectivo NO entra al cajon',
    )

    expect(noEfectivo, 'una transferencia no puede aumentar el efectivo fisico').toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Anulaciones
// ---------------------------------------------------------------------------

describe('Anulaciones de cuenta — detecta la reversion que no revirtio', () => {
  it('una venta anulada cuyo cargo quedo vivo', async () => {
    const venta = await ventaFiada()

    await call(ANULAR, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { reason: 'Prueba' },
      params: { id: String(venta.body.id) },
    })

    await sinDisparadores(async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement"
          WHERE "saleId" = ${String(venta.body.id)} AND "type" = 'SALE_CANCEL'`,
      )
    })

    const fallas = de(await comprobarIntegridad(), 'Anulaciones de cuenta')
    expect(fallas).toHaveLength(1)
    expect(fallas[0]?.regla).toBe('cargo + reversion = 0')
    expect(fallas[0]?.encontrado).toBe('20000.00')
  })

  it('un pago previo NO cuenta como descuadre de la anulacion', async () => {
    // Es el caso del objetivo 18, y la comprobacion tiene que dejarlo pasar:
    // el cliente pago, se anulo la venta, y le quedaron 8.000 a favor. El SALDO
    // no volvio a lo que era --y esta bien-- pero los movimientos DE ESA VENTA
    // si suman cero.
    const venta = await ventaFiada()
    await cobrar('8000.00')
    await call(ANULAR, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { reason: 'Fallada' },
      params: { id: String(venta.body.id) },
    })

    const informe = await comprobarIntegridad()
    expect(de(informe, 'Anulaciones de cuenta')).toEqual([])
    expect(informe.total, 'un saldo a favor legitimo no es un descuadre').toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Inmutabilidad
// ---------------------------------------------------------------------------

describe('inmutabilidad, en la base y no solo en el codigo', () => {
  it('un movimiento de cuenta no se puede editar ni con SQL directo', async () => {
    await ventaFiada()
    const [movimiento] = await prisma.customerAccountMovement.findMany({
      where: { clientId: fx.cliente.id },
    })

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "CustomerAccountMovement" SET "amount" = 1 WHERE "id" = ${String(movimiento?.id ?? 0)}`,
      ),
      'sin esto, bajarle la deuda a alguien no dejaria rastro',
    ).rejects.toThrow(/inmutable/i)
  })

  it('ni borrar', async () => {
    await ventaFiada()
    const [movimiento] = await prisma.customerAccountMovement.findMany({
      where: { clientId: fx.cliente.id },
    })

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM "CustomerAccountMovement" WHERE "id" = ${String(movimiento?.id ?? 0)}`,
      ),
    ).rejects.toThrow(/inmutable/i)
  })

  it('un cobro tampoco se edita', async () => {
    await ventaFiada()
    const pago = await cobrar('8000.00')

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "CustomerPayment" SET "amount" = 1 WHERE "id" = ${String(pago.body.id)}`,
      ),
      'el cliente tiene un comprobante en la mano con ese importe',
    ).rejects.toThrow(/inmutable/i)
  })

  it('la base rechaza un movimiento cuyos tres numeros no concuerdan', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "CustomerAccountMovement"
          ("branchId","clientId","type","amount","previousBalance","resultingBalance","userId","reason")
        VALUES (${String(fx.branchA.id)}, ${String(fx.cliente.id)}, 'MANUAL_ADJUSTMENT',
                100, 0, 999, ${String(fx.cajero.id)}, 'Con motivo, para que falle la otra regla')
      `),
      'que una fila diga que 0 mas 100 son 999 tiene que ser imposible, no improbable',
    ).rejects.toThrow(/saldos_check/i)
  })

  it('la base rechaza un pago con importe positivo', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "CustomerAccountMovement"
          ("branchId","clientId","type","amount","previousBalance","resultingBalance","userId","paymentId")
        VALUES (${String(fx.branchA.id)}, ${String(fx.cliente.id)}, 'PAYMENT',
                100, 0, 100, ${String(fx.cajero.id)}, 1)
      `),
      'un pago que aumente la deuda es una fila que PostgreSQL rechaza',
    ).rejects.toThrow(/tipo_signo_check/i)
  })

  it('la base rechaza un ajuste manual sin motivo', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "CustomerAccountMovement"
          ("branchId","clientId","type","amount","previousBalance","resultingBalance","userId")
        VALUES (${String(fx.branchA.id)}, ${String(fx.cliente.id)}, 'MANUAL_ADJUSTMENT',
                100, 0, 100, ${String(fx.cajero.id)})
      `),
    ).rejects.toThrow(/motivo_check/i)
  })

  it('la base rechaza un cargo de venta que apunte a un pago', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "CustomerAccountMovement"
          ("branchId","clientId","type","amount","previousBalance","resultingBalance","userId","paymentId")
        VALUES (${String(fx.branchA.id)}, ${String(fx.cliente.id)}, 'SALE_CHARGE',
                100, 0, 100, ${String(fx.cajero.id)}, 1)
      `),
      'cada tipo apunta a lo que le corresponde y a nada mas',
    ).rejects.toThrow(/origen_check/i)
  })
})
