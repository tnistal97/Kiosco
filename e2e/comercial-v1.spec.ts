import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, hoyDelNegocio } from './ayudantes'

/**
 * V1 comercial, primera tanda. Los seis cambios, de punta a punta:
 *
 *   1. Mercado Pago como medio propio, solo y combinado.
 *   2. Cierre del dia con los numeros del servidor.
 *   3. Inicio por acciones; el cajero entra directo a Venta.
 *   4. Ticket termico: boton despues de la venta y desde el historial.
 *   5. Consultar precio.
 *   6. Menu nuevo y lenguaje de almacen.
 */

const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })

/**
 * Reemplaza `window.print` por una captura del portal de impresion. La
 * cookie de sesion es Secure y `page.request` no la manda por http, asi que
 * todo lo que hable con la API pasa por el navegador.
 */
async function interceptarImpresion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __papel: string | null }
    w.__papel = null
    window.print = () => {
      w.__papel = document.getElementById('impresion')?.innerText ?? ''
      window.dispatchEvent(new Event('afterprint'))
    }
  })
}

async function papelImpreso(page: Page): Promise<string> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __papel: string | null }).__papel))
    .not.toBeNull()
  return page.evaluate(() => (window as unknown as { __papel: string | null }).__papel ?? '')
}

async function desdeElNavegador<T>(page: Page, url: string): Promise<T> {
  return page.evaluate(async (u) => {
    const r = await fetch(u)
    if (!r.ok) throw new Error(`${u} respondio ${String(r.status)}`)
    return (await r.json()) as unknown
  }, url) as Promise<T>
}

test.describe('Inicio y menú', () => {
  test('el cajero entra directo a Venta', async ({ page }) => {
    await entrar(page, 'cajero')
    await expect(page).toHaveURL(/\/venta$/, { timeout: 15_000 })
    await page.goto('/')
    await expect(page).toHaveURL(/\/venta$/, { timeout: 15_000 })
  })

  test('el dueño ve "¿Qué querés hacer?", las acciones, HOY y el menú nuevo', async ({ page }) => {
    await entrar(page, 'duenio')
    await expect(page.getByRole('heading', { name: '¿Qué querés hacer?' })).toBeVisible()
    const acciones = page.getByRole('navigation', { name: 'Acciones' })
    for (const nombre of [
      'Vender',
      'Caja',
      'Consultar precio',
      'Llegó mercadería',
      'Fiados',
      'Cambiar precios',
    ]) {
      await expect(acciones.getByText(nombre, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('Hoy', { exact: true })).toBeVisible()
    await expect(page.getByText('Ganancia estimada')).toBeVisible({ timeout: 15_000 })

    const menu = page.locator('aside')
    for (const grupo of ['Vender', 'Negocio', 'Control', 'Sistema', 'Más']) {
      await expect(menu.getByText(grupo, { exact: true }).first()).toBeVisible()
    }
    await expect(menu.getByRole('link', { name: 'Clientes y fiado' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Llegó mercadería' })).toBeVisible()
    // "Más" arranca plegado: lo de una vez por semana no ocupa lugar.
    await expect(menu.getByRole('link', { name: 'Historial de cambios' })).toHaveCount(0)
    await menu.getByRole('button', { name: 'Más' }).click()
    await expect(menu.getByRole('link', { name: 'Historial de cambios' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Historial de stock' })).toBeVisible()
  })

  test('el repositor ve solo consultar precio como acción', async ({ page }) => {
    await entrar(page, 'repositor')
    const acciones = page.getByRole('navigation', { name: 'Acciones' })
    await expect(acciones.getByText('Consultar precio')).toBeVisible()
    await expect(acciones.getByText('Vender')).toHaveCount(0)
    await expect(page.getByText('Ganancia estimada')).toHaveCount(0)
  })
})

test.describe('Consultar precio', () => {
  test('el cajero escanea y ve el precio en grande; Esc limpia', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/consultar-precio')
    await expect(page.getByRole('heading', { level: 1, name: 'Consultar precio' })).toBeVisible()

    const campo = page.getByRole('textbox', { name: 'Escaneá o escribí un producto' })
    await expect(campo).toBeFocused()
    await campo.fill(PRODUCTOS.gaseosa.codigo)
    await campo.press('Enter')
    await expect(page.getByText(PRODUCTOS.gaseosa.nombre)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('$ 3.450,00')).toBeVisible()
    await expect(page.getByText(/^Stock:/)).toBeVisible()
    // No se agrego nada a ningun ticket: no hay ticket en esta pantalla.
    await expect(ticket(page)).toHaveCount(0)

    await campo.press('Escape')
    await expect(page.getByText(PRODUCTOS.gaseosa.nombre)).toHaveCount(0)
    await expect(campo).toHaveValue('')
  })

  test('un código que no existe dice "No está cargado" y, con permiso, ofrece cargarlo', async ({
    page,
  }) => {
    // El encargado tiene `products.quickCreate`; el cajero no lo tiene por
    // omision y solo ve el aviso.
    await entrar(page, 'encargado')
    await page.goto('/consultar-precio')
    const campo = page.getByRole('textbox', { name: 'Escaneá o escribí un producto' })
    await campo.fill('99999999999')
    await campo.press('Enter')
    await expect(page.getByText('No está cargado')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Cargar producto' })).toBeVisible()
  })
})

test.describe('Mercado Pago y el ticket', () => {
  test('una venta por Mercado Pago, combinada con efectivo, se cobra y se imprime', async ({
    page,
  }) => {
    await entrar(page, 'cajero')
    await page.goto('/caja')
    // Con la caja abierta (la deja la fixture o una prueba anterior) se vende.
    if (
      await page
        .getByRole('link', { name: 'Abrir caja' })
        .isVisible()
        .catch(() => false)
    ) {
      await page.goto('/caja/abrir')
      await page.getByLabel(/con cu[aá]nto/i).fill('10000')
      await page.getByRole('button', { name: /abrir/i }).click()
      await page.waitForURL(/\/venta$/, { timeout: 15_000 })
    }
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)

    await ticket(page)
      .getByRole('button', { name: /^Cobrar/ })
      .click()
    const cobro = page.getByRole('dialog')
    await expect(cobro.getByRole('radio', { name: 'Mercado Pago' })).toBeVisible()

    // Pago dividido: $2.000 en efectivo y el resto ($4.540) por Mercado Pago.
    await cobro.getByRole('button', { name: 'Dividir el pago' }).click()
    await cobro.getByRole('radio', { name: 'Mercado Pago' }).nth(1).click()
    await cobro.getByLabel('Importe del pago 1').fill('2000')
    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog').getByText('Mercado Pago')).toBeVisible()

    // El ticket: se imprime con window.print, que aca se intercepta. El papel
    // se lee en el momento de imprimir, porque despues de `afterprint` el
    // portal se vacia (es lo correcto: ya salio).
    await interceptarImpresion(page)
    await page.getByRole('button', { name: 'Imprimir ticket' }).click()
    const papel = await papelImpreso(page)
    expect(papel).toContain('No válido como factura')
    expect(papel).toContain('Mercado Pago')
    expect(papel).toContain('Efectivo')
    expect(papel).toContain('Venta N°')
  })

  test('desde el historial se reimprime', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/ventas')
    await expect(page.getByRole('heading', { level: 1, name: 'Historial de ventas' })).toBeVisible()
    await interceptarImpresion(page)
    const primera = page.getByRole('row').nth(1)
    await primera.click()
    await page.getByRole('button', { name: 'Imprimir ticket' }).first().click()
    const papel = await papelImpreso(page)
    expect(papel).toContain('Venta N°')
    expect(papel).toContain('No válido como factura')
  })
})

test.describe('Cierre del día', () => {
  test('responde ventas, medios y caja, y separa ventas de efectivo', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')
    await page.getByRole('link', { name: 'Cierre del día' }).click()
    await expect(page).toHaveURL(/\/caja\/cierre$/)
    await expect(page.getByRole('heading', { name: 'Cierre del día' })).toBeVisible()

    await expect(page.getByText('Operaciones', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Medios de pago')).toBeVisible()
    const caja = page.getByTestId('cuenta-de-caja')
    await expect(caja.getByText('Debería haber')).toBeVisible()
    await expect(caja.getByText('Caja inicial')).toBeVisible()
    await expect(page.getByLabel('Día del cierre')).toHaveValue(hoyDelNegocio())

    // Los numeros del servidor: los mismos que el reporte de ventas.
    const datos = await desdeElNavegador<{
      ventas: { total: string; operaciones: number }
      caja: { deberiaHaber: string }
    }>(page, `/api/cash/cierre?fecha=${hoyDelNegocio()}`)
    const r = await desdeElNavegador<{ totales: { facturado: string; operaciones: number } }>(
      page,
      `/api/reports/ventas?desde=${hoyDelNegocio()}&hasta=${hoyDelNegocio()}`,
    )
    expect(datos.ventas.total).toBe(r.totales.facturado)
    expect(datos.ventas.operaciones).toBe(r.totales.operaciones)

    // Imprimir el cierre: el mismo portal.
    await interceptarImpresion(page)
    await page.getByRole('button', { name: 'Imprimir cierre' }).click()
    expect(await papelImpreso(page)).toContain('Cierre del día')
  })

  test('el cajero no entra al cierre del día', async ({ page }) => {
    await entrar(page, 'cajero')
    const estado = await page.evaluate(() => fetch('/api/cash/cierre').then((r) => r.status))
    expect(estado).toBe(403)
  })
})
