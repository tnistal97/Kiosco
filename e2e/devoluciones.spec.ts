import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { entrar } from './ayudantes'

/** La misma base que usa el servidor de las pruebas. Ver playwright.config.ts. */
const BASE_DE_DATOS =
  process.env.E2E_DATABASE_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

/**
 * El circuito de anticipos y devoluciones, de punta a punta.
 *
 * No comprueba una pantalla: comprueba que el CIRCUITO cierra. Anticipar,
 * recibir, imputar, devolver y acreditar son operaciones que se tocan entre sí,
 * y los errores que importan aparecen en las juntas.
 *
 * LO QUE ESTA PRUEBA EXISTE PARA DEMOSTRAR, en dos frases:
 *
 *   se entregó plata sin deber nada, llegó mercadería, el anticipo se aplicó y
 *   el saldo no se movió por aplicarlo;
 *
 *   volvió mercadería al proveedor, salió del depósito, nos acreditó su costo
 *   ORIGINAL, y una entrega ya pagada quedó con crédito a favor.
 *
 * Todo lo demás --el tope que se respeta, el permiso que falta, la bitácora--
 * es el contexto que hace que esas dos afirmaciones signifiquen algo.
 *
 * Corre en serie: cada caso depende del anterior.
 */
test.describe.configure({ mode: 'serial' })

/** El proveedor de la demostración, el único con plazo de pago pactado. */
const PROVEEDOR = 'Bebidas Andinas'

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

async function idDelProveedor(page: Page, nombre: string): Promise<number> {
  const id = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/suppliers?q=${encodeURIComponent(n)}&pageSize=50`)
    if (!r.ok) throw new Error(`${String(r.status)} al listar proveedores`)
    const p = (await r.json()) as { data: Array<{ id: number; name: string }> }
    return p.data.find((x) => x.name === n)?.id ?? null
  }, nombre)

  expect(id, `no apareció "${nombre}" en el listado`).not.toBeNull()
  return id as number
}

async function cuentaDe(
  page: Page,
  id: number,
): Promise<{ balance: number; sinImputar: number; devuelto: number; devoluciones: number }> {
  return page.evaluate(async (i: number) => {
    const r = await fetch(`/api/suppliers/${String(i)}/cuenta/resumen`)
    if (!r.ok) throw new Error(`${String(r.status)} al leer la cuenta`)
    const c = (await r.json()) as {
      balance: string
      sinImputar: string
      devuelto: string
      devoluciones: number
    }
    return {
      balance: Number(c.balance),
      sinImputar: Number(c.sinImputar),
      devuelto: Number(c.devuelto),
      devoluciones: c.devoluciones,
    }
  }, id)
}

/** El stock de la gaseosa de la demostración. */
async function stockDeLaGaseosa(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await fetch('/api/products?q=Gaseosa cola&pageSize=10')
    const p = (await r.json()) as { data: Array<{ name: string; stock: string }> }
    const g = p.data.find((x) => x.name.includes('Gaseosa cola'))
    if (!g) throw new Error('falta la gaseosa de la demostración')
    return Number(g.stock)
  })
}

/**
 * Recibe mercadería por la API: crea la orden, la confirma y la recibe.
 *
 * Va por la API y no por la pantalla a propósito. La recepción ya tiene su
 * propio E2E desde la Fase 3C --`compras.spec.ts` la recorre con el ratón-- y
 * repetirla acá alargaría esta prueba sin comprobar nada nuevo. Lo que esta
 * prueba mira es lo que pasa DESPUÉS, que es lo nuevo.
 */
async function recibir(
  page: Page,
  supplierId: number,
  cajas: string,
  costo: string,
  aplicarAnticipos = false,
): Promise<{ receiptId: number; total: string; anticipos: Array<{ amount: string }> }> {
  return page.evaluate(
    async ({ supplierId: s, cajas: q, costo: c, aplicarAnticipos: aa }) => {
      const productos = await fetch('/api/products?pageSize=100').then(
        (r) => r.json() as Promise<{ data: Array<{ id: number; name: string }> }>,
      )
      const gaseosa = productos.data.find((p) => p.name.includes('Gaseosa cola'))
      if (!gaseosa) throw new Error('falta la gaseosa de la demostración')

      const orden = (await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          supplierId: s,
          items: [{ productId: gaseosa.id, quantity: q, unitCost: c }],
        }),
      }).then((r) => r.json())) as { id: number }

      const confirmada = (await fetch(`/api/purchases/${String(orden.id)}/confirm`, {
        method: 'POST',
      }).then((r) => r.json())) as { items: Array<{ id: number }> }

      const res = await fetch(`/api/purchases/${String(orden.id)}/receive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ orderItemId: confirmada.items[0]?.id, quantity: q, unitCost: c }],
          aplicarAnticipos: aa,
        }),
      })
      if (!res.ok) throw new Error(`${String(res.status)} al recibir: ${await res.text()}`)
      return (await res.json()) as {
        receiptId: number
        total: string
        anticipos: Array<{ amount: string }>
      }
    },
    { supplierId, cajas, costo, aplicarAnticipos },
  )
}

// ---------------------------------------------------------------------------
// El circuito
// ---------------------------------------------------------------------------

let supplierId = 0
let anticipoId = 0
let entregaConAnticipo = 0
let entregaPagada = 0
let devolucionId = 0

test.describe('Anticipos y devoluciones a proveedor', () => {
  // ---------------------------------------------------------- anticipos

  test('1. registrar un anticipo deja el saldo a favor', async ({ page }) => {
    await entrar(page, 'duenio')
    supplierId = await idDelProveedor(page, PROVEEDOR)

    const antes = await cuentaDe(page, supplierId)

    const pago = await page.evaluate(async (id: number) => {
      const res = await fetch(`/api/suppliers/${String(id)}/pagos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imputacion: 'ninguna',
          amount: '50000',
          method: 'TRANSFER',
          acceptCredit: true,
          notes: 'Anticipo para asegurar la entrega.',
        }),
      })
      if (!res.ok) throw new Error(`${String(res.status)}: ${await res.text()}`)
      return (await res.json()) as { id: number; number: string; sinImputar: string }
    }, supplierId)

    anticipoId = pago.id
    expect(pago.number).toMatch(/^PP-\d{8}$/)
    expect(pago.sinImputar, 'no se imputó a nada').toBe('50000.00')

    const despues = await cuentaDe(page, supplierId)
    expect(despues.balance, 'el saldo bajó $50.000').toBe(antes.balance - 50000)
  })

  test('2. el saldo negativo se ve en la ficha, y dice a favor', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)

    await expect(page.getByRole('heading', { name: 'Pagos sin imputar' })).toBeVisible()
    await expect(page.getByText('Plata ya entregada')).toBeVisible()
    // La métrica nueva, con su palabra.
    await expect(page.getByText('Pagos sin imputar').first()).toBeVisible()
  })

  test('3. recibir mercadería sin pedirlo NO consume el anticipo', async ({ page }) => {
    await entrar(page, 'duenio')
    const antes = await cuentaDe(page, supplierId)

    const entrega = await recibir(page, supplierId, '2', '10000')

    expect(entrega.anticipos, 'nadie pidió aplicarlos').toHaveLength(0)
    const despues = await cuentaDe(page, supplierId)
    expect(despues.sinImputar, 'el anticipo sigue entero').toBe(antes.sinImputar)
    expect(despues.balance).toBe(antes.balance + 20000)
  })

  test('4. recibir pidiéndolo SÍ lo aplica, y el saldo no cambia por eso', async ({ page }) => {
    await entrar(page, 'duenio')
    const antes = await cuentaDe(page, supplierId)

    const entrega = await recibir(page, supplierId, '3', '10000', true)
    entregaConAnticipo = entrega.receiptId

    expect(entrega.total).toBe('30000.00')
    expect(entrega.anticipos.length, 'consumió crédito').toBeGreaterThan(0)

    const despues = await cuentaDe(page, supplierId)
    // El saldo sube por el CARGO de la entrega, no baja por la imputación.
    expect(despues.balance, 'imputar no mueve el saldo').toBe(antes.balance + 30000)
    expect(despues.sinImputar, 'el anticipo se consumió').toBeLessThan(antes.sinImputar)
  })

  test('5. lo que quedó sin imputar se ve en la lista de anticipos', async ({ page }) => {
    await entrar(page, 'duenio')
    const cuenta = await cuentaDe(page, supplierId)

    if (cuenta.sinImputar > 0) {
      await page.goto(`/proveedores/${String(supplierId)}`)
      await expect(page.getByRole('columnheader', { name: 'Disponible' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Ya imputado' })).toBeVisible()
    }
    expect(
      cuenta.sinImputar,
      'quedó algo o se consumió entero, las dos son válidas',
    ).toBeGreaterThanOrEqual(0)
  })

  test('6. imputar a mano el resto, desde la ficha', async ({ page }) => {
    await entrar(page, 'duenio')

    // Se deja una entrega abierta contra la cual imputar.
    const entrega = await recibir(page, supplierId, '1', '5000')

    const resultado = await page.evaluate(
      async ({ id, pagoId, receiptId }) => {
        const disponible = await fetch(`/api/suppliers/${String(id)}/anticipos?pageSize=50`)
          .then(
            (r) =>
              r.json() as Promise<{
                data: Array<{ paymentId: number; unallocatedAmount: string }>
              }>,
          )
          .then((p) => p.data.find((x) => x.paymentId === pagoId))

        if (!disponible || Number(disponible.unallocatedAmount) <= 0) return null

        const cuanto = Math.min(Number(disponible.unallocatedAmount), 5000).toFixed(2)
        const res = await fetch(`/api/suppliers/${String(id)}/pagos/${String(pagoId)}/imputar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ allocations: [{ receiptId, amount: cuanto }] }),
        })
        if (!res.ok) throw new Error(`${String(res.status)}: ${await res.text()}`)
        return (await res.json()) as { allocatedAmount: string; unallocatedAmount: string }
      },
      { id: supplierId, pagoId: anticipoId, receiptId: entrega.receiptId },
    )

    if (resultado !== null) {
      expect(Number(resultado.allocatedAmount)).toBeGreaterThan(0)
    }
  })

  test('7. imputar de más se rechaza con un mensaje que dice cuánto queda', async ({ page }) => {
    await entrar(page, 'duenio')

    const error = await page.evaluate(
      async ({ id, pagoId, receiptId }) => {
        const res = await fetch(`/api/suppliers/${String(id)}/pagos/${String(pagoId)}/imputar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ allocations: [{ receiptId, amount: '999999' }] }),
        })
        return { estado: res.status, cuerpo: await res.text() }
      },
      { id: supplierId, pagoId: anticipoId, receiptId: entregaConAnticipo },
    )

    expect(error.estado).toBe(409)
    expect(error.cuerpo).toMatch(/ALLOCATION_EXCEEDS/)
  })

  // -------------------------------------------------------- devoluciones

  test('8. la entrega muestra el botón de devolver mercadería', async ({ page }) => {
    await entrar(page, 'duenio')

    const ordenId = await page.evaluate(async (receiptId: number) => {
      const r = await fetch('/api/purchases?pageSize=50')
      const p = (await r.json()) as { data: Array<{ id: number }> }
      for (const o of p.data) {
        const detalle = (await fetch(`/api/purchases/${String(o.id)}`).then((x) => x.json())) as {
          receipts: Array<{ id: number }>
        }
        if (detalle.receipts.some((x) => x.id === receiptId)) return o.id
      }
      return null
    }, entregaConAnticipo)

    expect(ordenId).not.toBeNull()
    await page.goto(`/compras/${String(ordenId)}`)
    await expect(page.getByRole('button', { name: 'Devolver mercadería' }).first()).toBeVisible()
    // Las columnas del objetivo 22.
    await expect(page.getByRole('columnheader', { name: 'Devuelto' }).first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Neto' }).first()).toBeVisible()
  })

  test('9. el diálogo muestra los dos topes y el costo original', async ({ page }) => {
    await entrar(page, 'duenio')

    const retornables = await page.evaluate(async (receiptId: number) => {
      const r = await fetch(`/api/purchases/recepciones/${String(receiptId)}/retornables`)
      if (!r.ok) throw new Error(`${String(r.status)}`)
      return (await r.json()) as {
        lineas: Array<{
          recibido: string
          devuelto: string
          disponible: string
          stockActual: string
          unitCost: string
        }>
      }
    }, entregaConAnticipo)

    const linea = retornables.lineas[0]
    expect(linea?.recibido).toBe('3.000')
    expect(linea?.devuelto).toBe('0.000')
    expect(linea?.disponible, 'el tope histórico').toBe('3.000')
    expect(Number(linea?.stockActual), 'el tope físico').toBeGreaterThan(0)
    expect(Number(linea?.unitCost), 'el costo con el que entró').toBe(10000)
  })

  test('10. crear la devolución la deja en borrador, sin mover nada', async ({ page }) => {
    await entrar(page, 'duenio')
    const stockAntes = await stockDeLaGaseosa(page)
    const cuentaAntes = await cuentaDe(page, supplierId)

    const creada = await page.evaluate(async (receiptId: number) => {
      const retornables = (await fetch(
        `/api/purchases/recepciones/${String(receiptId)}/retornables`,
      ).then((r) => r.json())) as { lineas: Array<{ receiptItemId: number }> }

      const res = await fetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseReceiptId: receiptId,
          reason: 'DAMAGED',
          notes: 'Dos cajas llegaron abiertas.',
          items: [{ receiptItemId: retornables.lineas[0]?.receiptItemId, quantity: '2' }],
        }),
      })
      if (!res.ok) throw new Error(`${String(res.status)}: ${await res.text()}`)
      return (await res.json()) as { id: number; number: string; status: string; total: string }
    }, entregaConAnticipo)

    devolucionId = creada.id
    expect(creada.number).toMatch(/^DV-\d{8}$/)
    expect(creada.status).toBe('DRAFT')
    expect(creada.total, '2 cajas al costo original de $10.000').toBe('20000.00')

    expect(await stockDeLaGaseosa(page), 'la mercadería sigue acá').toBe(stockAntes)
    expect((await cuentaDe(page, supplierId)).balance, 'el proveedor no acreditó nada').toBe(
      cuentaAntes.balance,
    )
  })

  test('11. la pantalla de la devolución avisa que es un borrador', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/devoluciones/${String(devolucionId)}`)

    await expect(page.getByText('Todavía es un')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirmar devolución' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Renglones' })).toBeVisible()
    await expect(page.getByText('Al costo con el que entró')).toBeVisible()
  })

  test('12. confirmar saca la mercadería del depósito', async ({ page }) => {
    await entrar(page, 'duenio')
    const stockAntes = await stockDeLaGaseosa(page)

    await page.goto(`/devoluciones/${String(devolucionId)}`)
    await page.getByRole('button', { name: 'Confirmar devolución' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByRole('button', { name: 'Confirmar devolución' }).click()

    await expect(page.getByText('Confirmada el')).toBeVisible({ timeout: 15_000 })

    // La gaseosa se compra por caja de 8: 2 cajas son 16 unidades.
    expect(await stockDeLaGaseosa(page)).toBe(stockAntes - 16)
  })

  test('13. y deja un PURCHASE_RETURN en el libro de inventario', async ({ page }) => {
    await entrar(page, 'duenio')

    const movimientos = await page.evaluate(async () => {
      const r = await fetch('/api/inventory/movements?tipo=PURCHASE_RETURN&pageSize=10')
      if (!r.ok) throw new Error(`${String(r.status)}`)
      return (await r.json()) as {
        data: Array<{ type: string; quantity: string; referenceType: string | null }>
      }
    })

    expect(movimientos.data.length).toBeGreaterThan(0)
    expect(movimientos.data[0]?.type).toBe('PURCHASE_RETURN')
    expect(Number(movimientos.data[0]?.quantity), 'negativo: la mercadería sale').toBeLessThan(0)
    expect(movimientos.data[0]?.referenceType).toBe('PurchaseReturn')
  })

  test('14. el proveedor nos acreditó el costo ORIGINAL', async ({ page }) => {
    await entrar(page, 'duenio')
    const cuenta = await cuentaDe(page, supplierId)

    expect(cuenta.devoluciones, 'la del seed más la nuestra').toBeGreaterThanOrEqual(1)
    expect(cuenta.devuelto).toBeGreaterThanOrEqual(20000)

    const extracto = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/cuenta?tipo=PURCHASE_CREDIT&pageSize=10`)
      return (await r.json()) as { data: Array<{ amount: string; reference: string | null }> }
    }, supplierId)

    expect(extracto.data.some((m) => m.amount === '-20000.00')).toBe(true)
  })

  test('15. la entrega muestra recibido, devuelto y neto por separado', async ({ page }) => {
    await entrar(page, 'duenio')

    const deudas = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/deudas?abiertas=false&pageSize=50`)
      return (await r.json()) as {
        data: Array<{
          receiptId: number
          total: string
          devuelto: string
          neto: string
          pendiente: string
        }>
      }
    }, supplierId)

    const fila = deudas.data.find((d) => d.receiptId === entregaConAnticipo)
    expect(fila?.total, 'el importe original NO se pisa').toBe('30000.00')
    expect(fila?.devuelto).toBe('20000.00')
    expect(fila?.neto).toBe('10000.00')
  })

  test('16. devolver de más se rechaza, y dice cuánto queda', async ({ page }) => {
    await entrar(page, 'duenio')

    const error = await page.evaluate(async (receiptId: number) => {
      const retornables = (await fetch(
        `/api/purchases/recepciones/${String(receiptId)}/retornables`,
      ).then((r) => r.json())) as { lineas: Array<{ receiptItemId: number; disponible: string }> }

      const res = await fetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseReceiptId: receiptId,
          reason: 'DAMAGED',
          items: [{ receiptItemId: retornables.lineas[0]?.receiptItemId, quantity: '99' }],
        }),
      })
      return {
        estado: res.status,
        cuerpo: await res.text(),
        disponible: retornables.lineas[0]?.disponible,
      }
    }, entregaConAnticipo)

    expect(error.disponible, 'quedaba 1 de las 3').toBe('1.000')
    expect(error.estado).toBe(409)
    expect(error.cuerpo).toContain('RETURN_EXCEEDS_RECEIVED')
  })

  // -------------------------------------- devolución sobre lo ya pagado

  test('17. una entrega PAGADA que se devuelve deja crédito a favor', async ({ page }) => {
    await entrar(page, 'duenio')

    const entrega = await recibir(page, supplierId, '5', '10000')
    entregaPagada = entrega.receiptId

    // Se paga esa entrega, entera y a mano, para que la imputación sea exacta.
    await page.evaluate(
      async ({ id, receiptId }) => {
        const res = await fetch(`/api/suppliers/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imputacion: 'manual',
            amount: '50000',
            method: 'TRANSFER',
            acceptCredit: true,
            allocations: [{ receiptId, amount: '50000' }],
          }),
        })
        if (!res.ok) throw new Error(`${String(res.status)}: ${await res.text()}`)
      },
      { id: supplierId, receiptId: entrega.receiptId },
    )

    const antes = await cuentaDe(page, supplierId)

    const devuelta = await page.evaluate(async (receiptId: number) => {
      const retornables = (await fetch(
        `/api/purchases/recepciones/${String(receiptId)}/retornables`,
      ).then((r) => r.json())) as { lineas: Array<{ receiptItemId: number }> }

      const creada = (await fetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseReceiptId: receiptId,
          reason: 'QUALITY',
          items: [{ receiptItemId: retornables.lineas[0]?.receiptItemId, quantity: '2' }],
        }),
      }).then((r) => r.json())) as { id: number }

      const res = await fetch(`/api/devoluciones/${String(creada.id)}/confirmar`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`${String(res.status)}: ${await res.text()}`)
      return (await res.json()) as { total: string; saldoProveedor: string; saldoAFavor: string }
    }, entrega.receiptId)

    expect(devuelta.total).toBe('20000.00')
    const despues = await cuentaDe(page, supplierId)
    expect(despues.balance, 'el saldo bajó exactamente el crédito').toBe(antes.balance - 20000)
  })

  test('18. las imputaciones históricas NO se movieron: la entrega quedó con exceso', async ({
    page,
  }) => {
    await entrar(page, 'duenio')

    const deudas = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/deudas?abiertas=false&pageSize=50`)
      return (await r.json()) as {
        data: Array<{ receiptId: number; pagado: string; neto: string; exceso: string }>
      }
    }, supplierId)

    const fila = deudas.data.find((d) => d.receiptId === entregaPagada)
    expect(fila?.pagado, 'lo imputado no se reescribió').toBe('50000.00')
    expect(fila?.neto).toBe('30000.00')
    expect(fila?.exceso, 'y el exceso se informa como crédito').toBe('20000.00')
  })

  // ------------------------------------------------ permisos y bitácora

  test('19. el repositor ve las devoluciones pero no las arma', async ({ page }) => {
    await entrar(page, 'repositor')

    await page.goto('/devoluciones')
    await expect(page.getByRole('heading', { name: 'Devoluciones a proveedor' })).toBeVisible()

    const negado = await page.evaluate(async (receiptId: number) => {
      const res = await fetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseReceiptId: receiptId,
          reason: 'DAMAGED',
          items: [{ receiptItemId: 1, quantity: '1' }],
        }),
      })
      return res.status
    }, entregaConAnticipo)

    expect(negado, 'armarla es elegir renglones Y ver su costo').toBe(403)
  })

  test('20. la bitácora registra la devolución, y la reconciliación cierra', async ({ page }) => {
    await entrar(page, 'duenio')

    const eventos = await page.evaluate(async () => {
      const r = await fetch('/api/audit?tabla=PurchaseReturn&pageSize=20')
      if (!r.ok) throw new Error(`${String(r.status)} en la bitácora`)
      return (await r.json()) as { data: Array<{ actionType: string; tableName: string }> }
    })

    expect(eventos.data.length, 'crear y confirmar').toBeGreaterThanOrEqual(2)
    expect(eventos.data.every((e) => e.tableName === 'PurchaseReturn')).toBe(true)

    // Y la comprobación que resume todo lo anterior: después de un circuito
    // entero de anticipos y devoluciones, la base cierra.
    //
    // Se corre el GUION y no la función, igual que en `clientes.spec.ts`: es lo
    // que de verdad va a ejecutar alguien, con su código de salida y su salida
    // por pantalla.
    const salida = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/integrity-check.ts'],
      { encoding: 'utf8', env: { ...process.env, DATABASE_URL: BASE_DE_DATOS } },
    )

    expect(salida, 'el circuito de devoluciones dejó el sistema descuadrado').toContain(
      'Sin inconsistencias',
    )

    // Y las dos comprobaciones nuevas corrieron de verdad, no se saltearon.
    for (const nombre of ['Devoluciones', 'Cantidades devueltas']) {
      expect(salida, `falta la comprobación "${nombre}"`).toContain(nombre)
    }
  })
})
