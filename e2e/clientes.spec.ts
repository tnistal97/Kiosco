import { test, expect, type Page } from '@playwright/test'
import { entrar, PRODUCTOS } from './ayudantes'

/**
 * El circuito de fiado, de punta a punta y en una sola sesion del navegador.
 *
 * No comprueba una pantalla: comprueba que el CIRCUITO cierra. Fiar, cobrar,
 * anular y volver a comprar son operaciones que se tocan entre si, y los
 * errores que importan aparecen en las juntas.
 *
 * LO QUE ESTA PRUEBA EXISTE PARA DEMOSTRAR:
 *
 *   se le fio $X, pago una parte, se anulo la venta, y le quedo A FAVOR
 *   exactamente lo que habia puesto.
 *
 * Todo lo demas --el limite que frena, la autorizacion que lo levanta, el
 * comprobante que se imprime-- es el contexto que hace que esa afirmacion
 * signifique algo.
 *
 * Corre en serie: cada caso depende del anterior.
 */
test.describe.configure({ mode: 'serial' })

/** El cliente que esta prueba crea y usa. Nombre unico por corrida. */
const CLIENTE = `Cliente E2E ${String(Date.now() % 100000)}`

/** El saldo del cliente, leido de la API con la sesion de la pantalla. */
async function saldoDe(page: Page, nombre: string): Promise<number> {
  const saldo = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/clients/buscar?q=${encodeURIComponent(n)}`)
    if (!r.ok) throw new Error(`${String(r.status)} al buscar el cliente`)
    const c = (await r.json()) as Array<{ name: string; balance: string }>
    return c.find((x) => x.name === n)?.balance ?? null
  }, nombre)

  expect(saldo, `no aparecio "${nombre}" en la busqueda`).not.toBeNull()
  return Number(saldo)
}

/** El id del cliente, para las pantallas que lo necesitan en la URL. */
async function idDe(page: Page, nombre: string): Promise<number> {
  const id = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/clients/buscar?q=${encodeURIComponent(n)}`)
    const c = (await r.json()) as Array<{ id: number; name: string }>
    return c.find((x) => x.name === n)?.id ?? null
  }, nombre)
  expect(id).not.toBeNull()
  return Number(id)
}

/** El esperado del turno: lo que tiene que haber en el cajon. */
async function cajaEsperada(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await fetch('/api/cash/balance')
    const c = (await r.json()) as { balance: string | null }
    return Number(c.balance ?? '0')
  })
}

/**
 * Vende un producto eligiendo cliente y medio. Devuelve el id de la venta.
 *
 * Se hace por la API con la sesion de la pantalla y no clic por clic: lo que
 * esta suite comprueba es que el CIRCUITO cierre, y armar un carrito con el
 * raton en cada uno de los quince casos convertiria la prueba en una lista de
 * selectores frágiles. La pantalla de cobro tiene sus propias pruebas de
 * interfaz mas abajo.
 */
async function vender(
  page: Page,
  opciones: {
    productId: number
    cantidad: number
    efectivo?: number
    aCuenta?: number
    clientId?: number
    autorizar?: boolean
  },
): Promise<{ status: number; id: number | null; codigo: string | null; saldo: string | null }> {
  return page.evaluate(async (o) => {
    const pagos: Array<{ method: string; amount: string }> = []
    if (o.efectivo !== undefined && o.efectivo > 0) {
      pagos.push({ method: 'CASH', amount: o.efectivo.toFixed(2) })
    }
    if (o.aCuenta !== undefined && o.aCuenta > 0) {
      pagos.push({ method: 'ACCOUNT', amount: o.aCuenta.toFixed(2) })
    }

    const r = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: o.productId, quantity: o.cantidad }],
        payments: pagos,
        ...(o.clientId === undefined ? {} : { clientId: o.clientId }),
        ...(o.autorizar === true ? { autorizarExcesoDeCredito: true } : {}),
      }),
    })

    const cuerpo = (await r.json()) as {
      id?: number
      account?: { resultingBalance: string } | null
      error?: { code: string }
    }

    return {
      status: r.status,
      id: cuerpo.id ?? null,
      codigo: cuerpo.error?.code ?? null,
      saldo: cuerpo.account?.resultingBalance ?? null,
    }
  }, opciones)
}

/** El producto de la yerba, con su id y su precio. */
async function yerba(page: Page): Promise<{ id: number; precio: number }> {
  const p = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/products?q=${encodeURIComponent(n)}&pageSize=5&estado=todos`)
    const c = (await r.json()) as { data: Array<{ id: number; name: string; price: string }> }
    const encontrado = c.data.find((x) => x.name === n)
    return encontrado ? { id: encontrado.id, precio: Number(encontrado.price) } : null
  }, PRODUCTOS.yerba.nombre)

  expect(p, 'no aparecio la yerba en el catalogo').not.toBeNull()
  if (!p) throw new Error('sin producto')
  return p
}

let clienteId = 0
let ventaFiada = 0

// ===========================================================================
// 1-2. Crear el cliente, por la pantalla
// ===========================================================================

test.describe('el alta', () => {
  test('1. se crea un cliente con nombre y nada mas', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/clientes')

    await page.getByRole('button', { name: 'Nuevo cliente' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()

    // LO UNICO obligatorio es el nombre: el boton se habilita sin tocar nada
    // mas. Es la afirmacion central del modelo.
    await dialogo.getByLabel('Nombre').fill(CLIENTE)
    await dialogo.getByLabel(/Límite de crédito/i).fill('50000')
    await dialogo.getByRole('button', { name: 'Crear cliente' }).click()

    await expect(page.getByRole('link', { name: CLIENTE })).toBeVisible({ timeout: 15_000 })

    clienteId = await idDe(page, CLIENTE)
    expect(await saldoDe(page, CLIENTE), 'un cliente nuevo arranca en cero').toBe(0)
  })

  test('2. una venta normal NO necesita cliente', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)

    const res = await vender(page, { productId: p.id, cantidad: 1, efectivo: p.precio })

    expect(res.status, 'obligar a identificar a todo comprador no es la idea').toBe(201)
    expect(res.saldo, 'sin fiado no hay cuenta').toBeNull()
  })
})

// ===========================================================================
// 3-5. Fiar
// ===========================================================================

test.describe('fiar', () => {
  test('3. venta 100 % fiada: la caja no se mueve y la deuda es el total', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)
    const cajaAntes = await cajaEsperada(page)

    const res = await vender(page, {
      productId: p.id,
      cantidad: 1,
      aCuenta: p.precio,
      clientId: clienteId,
    })

    expect(res.status).toBe(201)
    expect(await saldoDe(page, CLIENTE)).toBe(p.precio)
    expect(await cajaEsperada(page), 'lo fiado no entra al cajon').toBe(cajaAntes)
  })

  test('4. venta parcial: la caja sube SOLO por el efectivo', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)
    const cajaAntes = await cajaEsperada(page)
    const saldoAntes = await saldoDe(page, CLIENTE)

    // Dos unidades. La mitad en efectivo, la mitad a cuenta.
    const total = p.precio * 2
    const mitad = total / 2

    const res = await vender(page, {
      productId: p.id,
      cantidad: 2,
      efectivo: mitad,
      aCuenta: total - mitad,
      clientId: clienteId,
    })

    expect(res.status).toBe(201)
    ventaFiada = res.id ?? 0

    expect(await cajaEsperada(page), 'la caja sube solo por el efectivo').toBe(cajaAntes + mitad)
    expect(await saldoDe(page, CLIENTE)).toBe(saldoAntes + (total - mitad))
  })

  test('5. fiar sin cliente se rechaza', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)

    const res = await vender(page, { productId: p.id, cantidad: 1, aCuenta: p.precio })

    expect(res.status).toBe(400)
    expect(res.codigo).toBe('ACCOUNT_SALE_NEEDS_CLIENT')
  })
})

// ===========================================================================
// 6-9. Cobrar
// ===========================================================================

test.describe('cobrar', () => {
  test('6. cobro en efectivo, por la pantalla: baja el saldo y sube la caja', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto(`/clientes/${String(clienteId)}`)

    const saldoAntes = await saldoDe(page, CLIENTE)
    const cajaAntes = await cajaEsperada(page)

    await page.getByRole('button', { name: 'Registrar pago' }).click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()

    // La pantalla propone lo que debe. Se cobra menos: una parte.
    await dialogo.getByLabel(/Cuánto paga/i).fill('1000')
    await dialogo.getByRole('combobox', { name: 'Medio' }).selectOption({ label: 'Efectivo' })

    // Y dice lo que va a pasar con la caja ANTES de confirmar.
    await expect(dialogo.getByText(/entra a la caja/i)).toBeVisible()

    await dialogo.getByRole('button', { name: 'Registrar pago' }).click()

    // 19. El comprobante se abre solo: el cliente esta esperando el papel.
    await expect(page.getByText('Comprobante de pago')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Documento no fiscal')).toBeVisible()
    await expect(page.getByText(/RC-\d{8}/)).toBeVisible()

    expect(await saldoDe(page, CLIENTE)).toBe(saldoAntes - 1000)
    expect(await cajaEsperada(page), 'el efectivo cobrado entra al cajon').toBe(cajaAntes + 1000)
  })

  test('7. el comprobante muestra los dos saldos', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto(`/clientes/${String(clienteId)}`)

    // Se abre desde el extracto, que es como se reimprime.
    await page
      .getByRole('link', { name: /RC-\d{8}/ })
      .first()
      .click()

    await expect(page.getByText('Saldo anterior')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Saldo nuevo')).toBeVisible()
    await expect(page.getByText('Importe recibido')).toBeVisible()
  })

  test('8. cobro por transferencia: baja el saldo y la caja NO sube', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto(`/clientes/${String(clienteId)}`)

    const saldoAntes = await saldoDe(page, CLIENTE)
    const cajaAntes = await cajaEsperada(page)

    await page.getByRole('button', { name: 'Registrar pago' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/Cuánto paga/i).fill('500')
    await dialogo.getByRole('combobox', { name: 'Medio' }).selectOption({ label: 'Transferencia' })

    // Y lo dice antes: sin este aviso, la caja que no sube se lee como un error.
    await expect(dialogo.getByText(/NO entra a la caja/i)).toBeVisible()

    await dialogo.getByRole('button', { name: 'Registrar pago' }).click()
    await expect(page.getByText('Comprobante de pago')).toBeVisible({ timeout: 15_000 })

    expect(await saldoDe(page, CLIENTE)).toBe(saldoAntes - 500)
    expect(await cajaEsperada(page), 'una transferencia no entra al cajon').toBe(cajaAntes)
  })

  test('9. el extracto muestra la cadena de saldos', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto(`/clientes/${String(clienteId)}`)

    await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible()
    // Los cuatro conceptos que ya ocurrieron.
    await expect(page.getByText('Venta a cuenta').first()).toBeVisible()
    await expect(page.getByText('Pago').first()).toBeVisible()
  })
})

// ===========================================================================
// 10-11. El limite
// ===========================================================================

test.describe('el limite de credito', () => {
  test('10. una venta que se pasa del limite se rechaza', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)

    // Muchas unidades: seguro se pasa de los $50.000.
    const cuantas = Math.ceil(60000 / p.precio)
    const res = await vender(page, {
      productId: p.id,
      cantidad: cuantas,
      aCuenta: p.precio * cuantas,
      clientId: clienteId,
    })

    expect(res.status).toBe(409)
    expect(res.codigo).toBe('CREDIT_LIMIT_EXCEEDED')
  })

  test('11. el cajero NO puede autorizar el exceso', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)
    const cuantas = Math.ceil(60000 / p.precio)

    const res = await vender(page, {
      productId: p.id,
      cantidad: cuantas,
      aCuenta: p.precio * cuantas,
      clientId: clienteId,
      autorizar: true,
    })

    expect(res.status, 'pedir una autorizacion que no se tiene es un rechazo').toBe(403)
  })

  test('12. el encargado SI puede, y queda registrado', async ({ page }) => {
    await entrar(page, 'encargado')
    const p = await yerba(page)
    const cuantas = Math.ceil(60000 / p.precio)

    const res = await vender(page, {
      productId: p.id,
      cantidad: cuantas,
      aCuenta: p.precio * cuantas,
      clientId: clienteId,
      autorizar: true,
    })

    expect(res.status).toBe(201)

    // Y el extracto lo dice, sin cruzar dos tablas.
    await page.goto(`/clientes/${String(clienteId)}`)
    await expect(page.getByText(/Autorizado por/i).first()).toBeVisible({ timeout: 15_000 })
  })
})

// ===========================================================================
// 13-15. LA PRUEBA: anular despues de que el cliente pago
// ===========================================================================

test.describe('anulacion despues de un pago', () => {
  test('13. se anula la venta parcial y la cuenta se revierte entera', async ({ page }) => {
    await entrar(page, 'admin')

    const saldoAntes = await saldoDe(page, CLIENTE)

    // Lo que se habia fiado en ESA venta, no lo que el cliente debe hoy.
    const fiado = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/clients/${String(id)}/ventas?page=1&pageSize=50`)
      const c = (await r.json()) as { data: Array<{ id: number; aCuenta: string }> }
      return c.data
    }, clienteId)

    const laVenta = fiado.find((v) => v.id === ventaFiada)
    expect(laVenta, 'no se encontro la venta parcial').toBeDefined()
    const importeFiado = Number(laVenta?.aCuenta ?? '0')
    expect(importeFiado).toBeGreaterThan(0)

    const res = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/sales/${String(id)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'La mercadería estaba fallada' }),
      })
      const c = (await r.json()) as { account?: { reverted: string; resultingBalance: string } }
      return { status: r.status, cuenta: c.account ?? null }
    }, ventaFiada)

    expect(res.status).toBeLessThan(300)

    // LA AFIRMACION: se revierte EXACTAMENTE lo que la venta habia cargado, no
    // "lo que quede". El pago anterior no se toca.
    expect(Number(res.cuenta?.reverted ?? '0')).toBe(importeFiado)
    expect(await saldoDe(page, CLIENTE)).toBe(saldoAntes - importeFiado)
  })

  test('14. los movimientos originales siguen ahi: se agrega el inverso', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto(`/clientes/${String(clienteId)}`)

    // La anulacion NO borra el cargo: agrega su opuesto. Los dos se leen.
    await expect(page.getByText('Anulación de venta').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Venta a cuenta').first()).toBeVisible()
  })

  test('15. un sobrepago deja saldo a favor, y hay que confirmarlo', async ({ page }) => {
    await entrar(page, 'encargado')
    const saldo = await saldoDe(page, CLIENTE)

    // Se paga MAS de lo que debe. Sin confirmar, se rechaza.
    const sinConfirmar = await page.evaluate(
      async ([id, importe]) => {
        const r = await fetch(`/api/clients/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount: String(importe), method: 'CASH' }),
        })
        const c = (await r.json()) as { error?: { code: string } }
        return { status: r.status, codigo: c.error?.code ?? null }
      },
      [clienteId, saldo + 2000],
    )

    expect(sinConfirmar.status, 'el sobrepago no puede ocurrir en silencio').toBe(409)
    expect(sinConfirmar.codigo).toBe('PAYMENT_LEAVES_CREDIT')

    // Confirmado, entra y deja saldo a favor.
    const confirmado = await page.evaluate(
      async ([id, importe]) => {
        const r = await fetch(`/api/clients/${String(id)}/pagos`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            amount: String(importe),
            method: 'CASH',
            aceptarSaldoAFavor: true,
          }),
        })
        return r.status
      },
      [clienteId, saldo + 2000],
    )

    expect(confirmado).toBe(201)
    expect(await saldoDe(page, CLIENTE), 'negativo = tiene plata a favor').toBe(-2000)
  })

  test('16. y la venta siguiente consume ese saldo a favor', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)

    const res = await vender(page, {
      productId: p.id,
      cantidad: 1,
      aCuenta: p.precio,
      clientId: clienteId,
    })

    expect(res.status).toBe(201)
    expect(
      await saldoDe(page, CLIENTE),
      'de lo fiado hay que descontar los 2.000 que tenia a favor',
    ).toBe(p.precio - 2000)
  })
})

// ===========================================================================
// 17-18. Fiado cortado y permisos
// ===========================================================================

test.describe('fiado cortado y permisos', () => {
  test('17. se corta el fiado y la venta a cuenta se rechaza', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto(`/clientes/${String(clienteId)}`)

    await page.getByRole('button', { name: 'Cortar fiado' }).click()
    await expect(page.getByText('Fiado cortado').first()).toBeVisible({ timeout: 15_000 })

    const p = await yerba(page)
    const res = await vender(page, {
      productId: p.id,
      cantidad: 1,
      aCuenta: p.precio,
      clientId: clienteId,
    })

    expect(res.status).toBe(409)
    expect(res.codigo).toBe('CLIENT_CREDIT_DISABLED')
  })

  test('18. pero sigue comprando de contado', async ({ page }) => {
    await entrar(page, 'cajero')
    const p = await yerba(page)

    const res = await vender(page, {
      productId: p.id,
      cantidad: 1,
      efectivo: p.precio,
      clientId: clienteId,
    })

    expect(res.status, 'cortar el fiado no es dar de baja al cliente').toBe(201)
  })

  test('19. el cajero no puede ajustar una cuenta, ni ve el boton', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto(`/clientes/${String(clienteId)}`)

    await expect(page.getByRole('heading', { level: 2 })).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: 'Ajustar cuenta' }),
      'quien cobra no puede bajarle la deuda a nadie',
    ).toHaveCount(0)

    // Y el endpoint tampoco lo deja, que es lo que de verdad protege.
    const res = await page.evaluate(async (id: number) => {
      const r = await fetch(`/api/clients/${String(id)}/ajuste`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delta: '-100000', reason: 'Perdonado' }),
      })
      return r.status
    }, clienteId)

    expect(res).toBe(403)
  })

  test('20. el auditor lee la cuenta pero no la modifica', async ({ page }) => {
    await entrar(page, 'auditor')
    await page.goto(`/clientes/${String(clienteId)}`)

    // Ve la ficha y el extracto.
    await expect(page.getByRole('heading', { name: 'Cuenta corriente' })).toBeVisible({
      timeout: 15_000,
    })

    // Y no puede cobrar ni ajustar.
    await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ajustar cuenta' })).toHaveCount(0)
  })
})

// ===========================================================================
// 21. El cierre: todo tiene que cuadrar
// ===========================================================================

test.describe('el cierre', () => {
  test('21. la reconciliacion no encuentra nada despues de todo el circuito', async ({ page }) => {
    // Es el cierre de la simulacion. Despues de fiar, cobrar en dos medios,
    // pasarse del limite con autorizacion, anular una venta ya pagada y
    // consumir el saldo a favor, las TRECE invariantes tienen que seguir dando.
    await entrar(page, 'admin')

    const { comprobarIntegridad } = await import('../src/modules/integrity/service')
    const informe = await comprobarIntegridad()

    expect(
      informe.comprobaciones
        .filter((c) => c.inconsistencias.length > 0)
        .map((c) => `${c.nombre}: ${JSON.stringify(c.inconsistencias.slice(0, 2))}`),
      'el circuito de cuenta corriente dejo el sistema descuadrado',
    ).toEqual([])

    expect(informe.comprobaciones).toHaveLength(13)
  })
})
