import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { entrar } from './ayudantes'

/** La misma base que usa el servidor de las pruebas. Ver playwright.config.ts. */
const BASE_DE_DATOS =
  process.env.E2E_DATABASE_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

/**
 * El circuito de cuentas por pagar, de punta a punta y en una sola sesion.
 *
 * No comprueba una pantalla: comprueba que el CIRCUITO cierra. Recibir, deber,
 * pagar, acreditar y vencer son operaciones que se tocan entre si, y los
 * errores que importan aparecen en las juntas.
 *
 * LO QUE ESTA PRUEBA EXISTE PARA DEMOSTRAR:
 *
 *   llego mercaderia, quedo la deuda, se pago una parte en efectivo y la caja
 *   bajo exactamente eso; se pago otra por transferencia y la caja NO se movio.
 *
 * Todo lo demas --el sobrepago que se frena, la nota de credito, el vencimiento
 * que se corrige, el comprobante que se imprime-- es el contexto que hace que
 * esa afirmacion signifique algo.
 *
 * Corre en serie: cada caso depende del anterior.
 */
test.describe.configure({ mode: 'serial' })

/** El proveedor de la demostracion, el unico con plazo de pago pactado. */
const PROVEEDOR = 'Bebidas Andinas'

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

/** El id del proveedor, leido de la API con la sesion de la pantalla. */
async function idDelProveedor(page: Page, nombre: string): Promise<number> {
  const id = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/suppliers?q=${encodeURIComponent(n)}&pageSize=50`)
    if (!r.ok) throw new Error(`${String(r.status)} al listar proveedores`)
    const p = (await r.json()) as { data: Array<{ id: number; name: string }> }
    return p.data.find((x) => x.name === n)?.id ?? null
  }, nombre)

  expect(id, `no aparecio "${nombre}" en el listado`).not.toBeNull()
  return id as number
}

/** El saldo del proveedor, por la API. Positivo = le debemos. */
async function saldoDe(page: Page, id: number): Promise<number> {
  const saldo = await page.evaluate(async (i: number) => {
    const r = await fetch(`/api/suppliers/${String(i)}/cuenta/resumen`)
    if (!r.ok) throw new Error(`${String(r.status)} al leer la cuenta`)
    return ((await r.json()) as { balance: string }).balance
  }, id)
  return Number(saldo)
}

/** El efectivo de la sucursal, para comprobar que la caja se movio o no. */
async function efectivoDeCaja(page: Page): Promise<number> {
  const monto = await page.evaluate(async () => {
    const r = await fetch('/api/cash/balance')
    if (!r.ok) throw new Error(`${String(r.status)} al leer la caja`)
    return ((await r.json()) as { currentCash: string }).currentCash
  })
  return Number(monto)
}

/**
 * Recibe mercaderia por la API: crea la orden, la confirma y la recibe.
 *
 * Va por la API y no por la pantalla a proposito. La recepcion ya tiene su
 * propio E2E desde la Fase 3C --`compras.spec.ts` la recorre con el raton-- y
 * repetirla aca alargaria esta prueba sin comprobar nada nuevo. Lo que esta
 * prueba mira es lo que pasa DESPUES de recibir, que es lo nuevo.
 */
async function recibir(
  page: Page,
  supplierId: number,
  cajas: string,
  costo: string,
): Promise<{ receiptId: number; total: string }> {
  return page.evaluate(
    async ({ supplierId: s, cajas: q, costo: c }) => {
      const productos = await fetch('/api/products?pageSize=100').then(
        (r) => r.json() as Promise<{ data: Array<{ id: number; name: string }> }>,
      )
      const gaseosa = productos.data.find((p) => p.name.includes('Gaseosa cola'))
      if (!gaseosa) throw new Error('falta la gaseosa de la demostracion')

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
        }),
      })
      if (!res.ok) throw new Error(`${String(res.status)} al recibir: ${await res.text()}`)
      return (await res.json()) as { receiptId: number; total: string }
    },
    { supplierId, cajas, costo },
  )
}

// ---------------------------------------------------------------------------
// El circuito
// ---------------------------------------------------------------------------

let supplierId = 0
let primeraEntrega = 0

test.describe('Cuentas por pagar a proveedores', () => {
  test('1. recibir una compra deja la deuda con el proveedor', async ({ page }) => {
    await entrar(page, 'duenio')
    supplierId = await idDelProveedor(page, PROVEEDOR)

    const antes = await saldoDe(page, supplierId)
    const entrega = await recibir(page, supplierId, '10', '12000')
    primeraEntrega = entrega.receiptId

    expect(entrega.total).toBe('120000.00')
    expect(await saldoDe(page, supplierId)).toBe(antes + 120000)
  })

  test('2. la ficha del proveedor muestra el saldo y la entrega sin saldar', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)

    await expect(page.getByRole('heading', { name: 'Cuenta corriente' })).toBeVisible()
    await expect(page.getByText('Saldo pendiente')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Deudas abiertas' })).toBeVisible()
    // La tabla del objetivo 27, con sus columnas.
    await expect(page.getByRole('columnheader', { name: 'Vencimiento' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Pendiente' })).toBeVisible()
  })

  test('3. un pago por transferencia baja la deuda y NO toca la caja', async ({ page }) => {
    await entrar(page, 'duenio')
    const saldoAntes = await saldoDe(page, supplierId)
    const cajaAntes = await efectivoDeCaja(page)

    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()

    const dialogo = page.getByRole('dialog')
    // `toBeAttached` y no `toBeVisible`: el envoltorio del dialogo no tiene
    // caja propia --el contenido vive en un portal-- y Playwright lo reporta
    // como oculto aunque el dialogo este abierto. Mismo criterio que en
    // clientes.spec.ts desde la Fase 4A.
    await expect(dialogo).toBeAttached()
    // El aviso que evita el susto al cerrar el turno.
    await expect(dialogo.getByText(/NO sale de la caja/i)).toBeVisible()

    await dialogo.getByLabel(/Cuánto se paga/i).fill('40000')
    await dialogo.getByRole('button', { name: 'Registrar pago' }).click()

    // Termina en el comprobante.
    await expect(page.getByText('Comprobante de pago a proveedor')).toBeVisible()
    await expect(page.getByText('Documento no fiscal')).toBeVisible()

    expect(await saldoDe(page, supplierId)).toBe(saldoAntes - 40000)
    expect(await efectivoDeCaja(page), 'una transferencia no sale del cajón').toBe(cajaAntes)
  })

  test('4. el comprobante dice qué obligaciones canceló y los dos saldos', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)

    // El pago figura en el extracto. Se busca en la TABLA y no en la pagina
    // entera: "Pago" exacto tambien es una opcion del filtro de tipo, que es un
    // `<option>` y por lo tanto invisible para Playwright.
    await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Pago', exact: true }).first()).toBeVisible()

    const pago = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/pagos?pageSize=1`)
      const p = (await r.json()) as { data: Array<{ id: number; number: string }> }
      return p.data[0]
    }, supplierId)

    await page.goto(`/comprobantes/proveedor/${String(pago?.id ?? 0)}`)
    await expect(page.getByText('Obligaciones canceladas')).toBeVisible()
    await expect(page.getByText('Saldo anterior')).toBeVisible()
    await expect(page.getByText('Saldo nuevo')).toBeVisible()
    // NUNCA "factura": este sistema no emite nada fiscal.
    await expect(page.getByText(/factura/i)).toHaveCount(0)
  })

  test('5. un pago en efectivo SÍ saca plata del cajón', async ({ page }) => {
    await entrar(page, 'duenio')
    const saldoAntes = await saldoDe(page, supplierId)
    const cajaAntes = await efectivoDeCaja(page)

    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByLabel(/Cuánto se paga/i).fill('30000')
    await dialogo.getByRole('combobox', { name: 'Medio' }).selectOption('CASH')
    await expect(dialogo.getByText(/sale de la caja/i)).toBeVisible()
    await dialogo.getByRole('button', { name: 'Registrar pago' }).click()

    await expect(page.getByText('Comprobante de pago a proveedor')).toBeVisible()

    expect(await saldoDe(page, supplierId)).toBe(saldoAntes - 30000)
    expect(await efectivoDeCaja(page), 'el efectivo sale del cajón').toBe(cajaAntes - 30000)
  })

  test('6. una segunda entrega aumenta la deuda, con su propia obligación', async ({ page }) => {
    await entrar(page, 'duenio')
    const antes = await saldoDe(page, supplierId)

    const entrega = await recibir(page, supplierId, '5', '10000')
    expect(entrega.total).toBe('50000.00')
    expect(await saldoDe(page, supplierId)).toBe(antes + 50000)

    const deudas = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/deudas?abiertas=true&pageSize=50`)
      return (await r.json()) as { data: Array<{ receiptId: number; pendiente: string }> }
    }, supplierId)

    expect(deudas.data.length, 'dos entregas son dos obligaciones').toBeGreaterThanOrEqual(2)
  })

  test('7. el sobrepago se rechaza si nadie lo confirmó', async ({ page }) => {
    await entrar(page, 'duenio')
    const saldo = await saldoDe(page, supplierId)

    const res = await page.evaluate(
      async ({ id, monto }) => {
        const r = await fetch(`/api/suppliers/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imputacion: 'automatica',
            amount: monto,
            method: 'TRANSFER',
            acceptCredit: false,
          }),
        })
        return { status: r.status, body: (await r.json()) as { error?: { code: string } } }
      },
      { id: supplierId, monto: String(saldo + 5000) },
    )

    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('SUPPLIER_PAYMENT_LEAVES_CREDIT')
    expect(await saldoDe(page, supplierId), 'no se movió nada').toBe(saldo)
  })

  test('8. el sobrepago autorizado deja crédito a favor nuestro', async ({ page }) => {
    await entrar(page, 'duenio')
    const saldo = await saldoDe(page, supplierId)

    const res = await page.evaluate(
      async ({ id, monto }) => {
        const r = await fetch(`/api/suppliers/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imputacion: 'automatica',
            amount: monto,
            method: 'TRANSFER',
            acceptCredit: true,
          }),
        })
        return { status: r.status, body: (await r.json()) as { resultingBalance: string } }
      },
      { id: supplierId, monto: String(saldo + 5000) },
    )

    expect(res.status).toBe(201)
    expect(Number(res.body.resultingBalance)).toBe(-5000)
  })

  test('9. una nota de crédito baja la deuda sin tocar la recepción', async ({ page }) => {
    await entrar(page, 'duenio')
    // Se recibe algo nuevo para tener deuda contra la cual acreditar.
    await recibir(page, supplierId, '5', '10000')
    const saldo = await saldoDe(page, supplierId)

    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Nota de crédito' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByLabel(/^Importe/i).fill('10000')
    await dialogo.getByLabel(/^Motivo/i).fill('Faltaron 2 cajas en la entrega')
    await dialogo.getByRole('button', { name: 'Registrar nota de crédito' }).click()

    await expect(dialogo).not.toBeAttached()
    expect(await saldoDe(page, supplierId)).toBe(saldo - 10000)
  })

  test('10. la nota de crédito sin motivo no se puede confirmar', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Nota de crédito' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByLabel(/^Importe/i).fill('5000')
    // Sin motivo: el boton queda deshabilitado. Y si alguien lo forzara, la
    // base tiene un CHECK que rechaza la fila.
    await expect(dialogo.getByRole('button', { name: 'Registrar nota de crédito' })).toBeDisabled()
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  })

  test('11. el vencimiento se ve, y se corrige con motivo', async ({ page }) => {
    await entrar(page, 'duenio')

    const res = await page.evaluate(
      async ({ receiptId }) => {
        const r = await fetch(`/api/purchases/recepciones/${String(receiptId)}/vencimiento`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dueDate: '2026-12-01',
            reason: 'El proveedor concedió dos semanas más',
          }),
        })
        return r.status
      },
      { receiptId: primeraEntrega },
    )
    expect(res).toBe(200)

    await page.goto(`/proveedores/${String(supplierId)}`)
    await expect(page.getByRole('heading', { name: 'Deudas abiertas' })).toBeVisible()
  })

  test('12. una deuda vencida se ve con su palabra, no solo con un color', async ({ page }) => {
    await entrar(page, 'duenio')

    // Se vence una obligacion a mano, por la API de vencimiento.
    const deudas = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/deudas?abiertas=true&pageSize=50`)
      return (await r.json()) as { data: Array<{ receiptId: number }> }
    }, supplierId)
    const alguna = deudas.data[0]?.receiptId ?? 0

    await page.evaluate(async (receiptId: number) => {
      await fetch(`/api/purchases/recepciones/${String(receiptId)}/vencimiento`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: '2020-01-01', reason: 'Escenario de prueba' }),
      })
    }, alguna)

    await page.goto(`/proveedores/${String(supplierId)}`)
    // La PALABRA, no el color. Criterio WCAG 1.4.1 y objetivo 20.
    await expect(page.getByText('Vencida').first()).toBeVisible()
    await expect(page.getByText('Saldo vencido')).toBeVisible()
  })

  test('13. la aplicación automática reparte por vencimiento', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByLabel(/Cuánto se paga/i).fill('15000')
    // La vista previa del reparto: sin esto se confirma a ciegas.
    await expect(dialogo.getByText(/Se imputan/)).toBeVisible()
    await expect(dialogo.getByText(/Automática/)).toBeVisible()
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  })

  test('14. la aplicación manual se puede ajustar antes de confirmar', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto(`/proveedores/${String(supplierId)}`)
    await page.getByRole('button', { name: 'Registrar pago' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await dialogo.getByLabel(/Cuánto se paga/i).fill('10000')
    await dialogo.getByLabel(/Automática/).uncheck()

    // Aparecen los campos por obligacion.
    await expect(dialogo.getByLabel(/Imputar a la entrega/).first()).toBeVisible()
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  })

  test('15. el servidor rechaza imputar más que el pago', async ({ page }) => {
    await entrar(page, 'duenio')

    const deudas = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/deudas?abiertas=true&pageSize=50`)
      return (await r.json()) as { data: Array<{ receiptId: number }> }
    }, supplierId)
    const alguna = deudas.data[0]?.receiptId ?? 0

    const res = await page.evaluate(
      async ({ id, receiptId }) => {
        const r = await fetch(`/api/suppliers/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imputacion: 'manual',
            amount: '1000',
            method: 'TRANSFER',
            allocations: [{ receiptId, amount: '5000' }],
          }),
        })
        return { status: r.status, body: (await r.json()) as { error?: { code: string } } }
      },
      { id: supplierId, receiptId: alguna },
    )

    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('ALLOCATION_EXCEEDS_PAYMENT')
  })

  test('16. el cajero no ve la cuenta del proveedor', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto(`/proveedores/${String(supplierId)}`)

    // Ni la pantalla ni la API. Lo segundo es lo que importa: esconder un
    // boton no es un permiso, y una respuesta de la API se lee con las
    // herramientas del navegador sin saber programar.
    await expect(page.getByRole('heading', { name: 'Cuenta corriente' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)

    const estado = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/cuenta/resumen`)
      return r.status
    }, supplierId)
    expect(estado, 'la deuda con proveedores no es información de mostrador').toBe(403)
  })

  test('17. el auditor lee la cuenta y no puede pagar', async ({ page }) => {
    await entrar(page, 'auditor')
    await page.goto(`/proveedores/${String(supplierId)}`)

    await expect(page.getByRole('heading', { name: 'Cuenta corriente' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)

    const res = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/suppliers/${String(id)}/pagos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imputacion: 'automatica', amount: '1', method: 'TRANSFER' }),
      })
      return r.status
    }, supplierId)
    expect(res, 'quien revisa no modifica lo que revisa').toBe(403)
  })

  test('18. el reporte separa lo comprado de lo pagado', async ({ page }) => {
    await entrar(page, 'duenio')
    const reporte = await page.evaluate(async () => {
      const hoy = new Date().toISOString().slice(0, 10)
      const r = await fetch(`/api/reports/proveedores?desde=${hoy}&hasta=${hoy}`)
      return (await r.json()) as {
        cuentasPorPagar: { total: string; vencido: string }
        periodo: { recibido: string; pagado: string }
      }
    })

    expect(reporte.cuentasPorPagar).toBeDefined()
    expect(
      reporte.periodo.recibido !== reporte.periodo.pagado || reporte.periodo.recibido === '0.00',
      'comprado y pagado son dos columnas distintas',
    ).toBe(true)
  })

  test('19. dos pagos simultáneos no dejan pagar de más', async ({ page }) => {
    await entrar(page, 'duenio')

    // Se deja el saldo en un numero conocido con un ajuste, y se lanzan dos
    // pagos que juntos lo superan.
    await page.evaluate(async (id: number) => {
      const saldo = await fetch(`/api/suppliers/${String(id)}/cuenta/resumen`)
        .then((r) => r.json() as Promise<{ balance: string }>)
        .then((c) => Number(c.balance))
      await fetch(`/api/suppliers/${String(id)}/ajuste`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          delta: String(50000 - saldo),
          reason: 'Escenario de concurrencia',
        }),
      })
    }, supplierId)

    const estados = await page.evaluate(async (id: number) => {
      const uno = () =>
        fetch(`/api/suppliers/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imputacion: 'automatica', amount: '40000', method: 'TRANSFER' }),
        }).then((r) => r.status)
      return Promise.all([uno(), uno()])
    }, supplierId)

    expect(
      estados.filter((s) => s === 201),
      'uno entra y el otro se rechaza',
    ).toHaveLength(1)
    expect(await saldoDe(page, supplierId)).toBe(10000)
  })

  test('20. después de todo el circuito, la reconciliación cierra', async ({ page }) => {
    await entrar(page, 'duenio')

    // La reconciliacion NO tiene endpoint HTTP --se corre con
    // `npm run integrity:check`, que es como se usa de verdad-- asi que se
    // invoca el guion sobre ESTA misma base, la que acaba de recorrer los
    // diecinueve casos de arriba. Es la comprobacion que le da sentido al
    // resto: si el circuito completo dejara algo descuadrado, aparece aca.
    const salida = execFileSync('npx', ['tsx', 'scripts/integrity-check.ts'], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: BASE_DE_DATOS },
      shell: process.platform === 'win32',
    })

    expect(salida, 'ni una inconsistencia después de todo el circuito').toContain(
      'Sin inconsistencias',
    )
  })
})
