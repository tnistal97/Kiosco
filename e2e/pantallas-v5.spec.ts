import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, leerMonto, terminarVenta } from './ayudantes'

/**
 * Venta, Caja y Reportes: la segunda vuelta de la UX V5, de punta a punta.
 *
 *   /venta     "Ventas de hoy" junto al titulo: la venta recien cobrada con
 *              su detalle completo, y al cerrar se sigue vendiendo.
 *   /caja      la cuenta entera y la diferencia a la vista, sin "Ver
 *              detalle"; "Cómo funciona" explica abrir y cerrar.
 *   /reportes  el resumen de hoy (Mercado Pago aparte) y un acceso por
 *              reporte.
 *
 * Contra la compilacion de produccion y la base sembrada, como el resto.
 */

const campo = (page: Page) => page.locator('[data-barcode-input]')
const carrito = (page: Page) => page.getByRole('region', { name: 'Carrito' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Ventas de hoy' })

/** Las pruebas de caja de otros archivos la cierran y la abren: no se supone. */
async function cajaAbierta(page: Page): Promise<void> {
  await page.goto('/caja')
  const estado = page.locator('[data-estado-caja]')
  await estado.waitFor({ timeout: 20_000 })
  if ((await estado.getAttribute('data-estado-caja')) === 'abierta') return
  await page.goto('/caja/abrir')
  const inicial = page.getByLabel('Efectivo inicial')
  await inicial.fill('20000')
  await inicial.press('Enter')
  await page.waitForURL(/\/(caja|venta)$/, { timeout: 15_000 })
}

async function cobrar(page: Page, medio: 'Efectivo' | 'Mercado Pago', recibido?: string) {
  await carrito(page)
    .getByRole('button', { name: /^Cobrar/ })
    .click()
  const cobro = page.getByRole('dialog')
  if (medio !== 'Efectivo') await cobro.getByRole('radio', { name: medio }).click()
  if (recibido !== undefined) await cobro.getByLabel(/^recibido/i).fill(recibido)
  await page.waitForTimeout(400)
  await cobro.getByRole('button', { name: /^Confirmar venta/ }).click()
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  await terminarVenta(page)
}

test.describe('Vender: "Ventas de hoy"', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'encargado')
    await cajaAbierta(page)
  })

  test('la venta recien cobrada aparece con su detalle: productos, recibido y vuelto', async ({
    page,
  }) => {
    await page.goto('/venta')
    await expect(campo(page)).toBeFocused()
    await escanear(page, PRODUCTOS.leche.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)
    await cobrar(page, 'Efectivo', '5000')

    // El boton esta en la cabecera, al lado de "Vender".
    const cabecera = page.getByRole('banner')
    await expect(cabecera.getByRole('heading', { name: 'Vender' })).toBeVisible()
    await cabecera.getByRole('button', { name: 'Ventas de hoy' }).click()

    const lista = panel(page).getByRole('list', { name: 'Ventas de hoy' })
    const ultima = lista.getByRole('button').first()
    await expect(ultima).toContainText('Efectivo')
    await expect(ultima).toContainText('Marina Sosa')
    await expect(ultima).toContainText('Vigente')
    await expect(ultima).toContainText('3.380,00')

    await ultima.click()
    const detalle = panel(page).getByRole('article')
    await expect(
      detalle.getByRole('row').filter({ hasText: PRODUCTOS.leche.nombre }),
    ).toContainText('2 u.')
    const pago = detalle.getByRole('region', { name: 'Pago' })
    await expect(pago).toContainText(/Recibido\s*\$\s*5\.000,00/)
    await expect(pago).toContainText(/Vuelto\s*\$\s*1\.620,00/)

    // Cerrar vuelve al lector: se sigue vendiendo sin tocar el mouse.
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(campo(page)).toBeFocused()
    await escanear(page, PRODUCTOS.yerba.codigo)
    await expect(carrito(page)).toContainText(PRODUCTOS.yerba.nombre)
  })

  test('Mercado Pago se nombra como tal, no como transferencia', async ({ page }) => {
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await cobrar(page, 'Mercado Pago')

    await page.getByRole('banner').getByRole('button', { name: 'Ventas de hoy' }).click()
    const ultima = panel(page).getByRole('list', { name: 'Ventas de hoy' }).getByRole('button').first() // prettier-ignore
    await expect(ultima).toContainText('Mercado Pago')
    await expect(ultima).toContainText('3.450,00')
  })
})

test.describe('Caja: todo a la vista', () => {
  test('estado, la cuenta entera, la diferencia y "Cómo funciona"', async ({ page }) => {
    await entrar(page, 'encargado')
    await cajaAbierta(page)
    await page.goto('/caja')
    await expect(page.getByText('CAJA ABIERTA')).toBeVisible()
    await expect(page.getByRole('button', { name: /ver detalle/i })).toHaveCount(0)

    const cuenta = page.locator('[data-cuenta-caja]')
    for (const renglon of [
      'Monto inicial',
      'Ventas en efectivo',
      'Ingresos',
      'Egresos',
      'Saldo esperado',
    ]) {
      await expect(cuenta.getByText(renglon)).toBeVisible()
    }
    // El total de la cuenta es lo que tiene que haber en el cajon.
    const esperado = leerMonto(
      await cuenta.getByText('Saldo esperado').locator('..').getByText(/^\$/).innerText(),
    )
    const tieneQueHaber = leerMonto(
      await page
        .getByText('Tiene que haber en el cajón')
        .locator('..')
        .getByText(/^\$/)
        .first()
        .innerText(),
    )
    expect(esperado).toBe(tieneQueHaber)
    await expect(page.locator('[data-diferencia-caja]')).toContainText('Diferencia')

    await page.getByRole('button', { name: 'Cómo funciona' }).click()
    const ayuda = page.getByRole('dialog', { name: 'Cómo funciona la caja' })
    for (const pregunta of [
      '¿Qué es abrir la caja?',
      '¿Cuándo hay que abrirla?',
      '¿Qué es cerrar la caja?',
      '¿Qué revisar antes de cerrar?',
      '¿Y si hay diferencia?',
    ]) {
      await expect(ayuda.getByRole('heading', { name: pregunta })).toBeVisible()
    }
    await ayuda.getByRole('button', { name: 'Entendido' }).click()
    await expect(ayuda).toBeHidden()
  })
})

test.describe('Reportes', () => {
  const tarjeta = (page: Page, titulo: string) =>
    page.locator('[data-resumen-hoy]').getByText(titulo, { exact: true }).locator('..')
  const importe = async (page: Page, titulo: string) =>
    leerMonto(await tarjeta(page, titulo).getByText(/^\$/).innerText())

  test('el resumen de hoy: una venta por Mercado Pago suma en su tarjeta, no en transferencia', async ({
    page,
  }) => {
    await entrar(page, 'encargado')
    await cajaAbierta(page)
    await page.goto('/reportes')
    await page.locator('[data-resumen-hoy]').waitFor({ timeout: 20_000 })
    for (const titulo of [
      'Total vendido hoy',
      'Cantidad de ventas',
      'Efectivo',
      'Transferencia',
      'Mercado Pago',
      'Ticket promedio',
    ]) {
      await expect(tarjeta(page, titulo)).toBeVisible()
    }
    const mercadoPago = await importe(page, 'Mercado Pago')
    const transferencia = await importe(page, 'Transferencia')
    const total = await importe(page, 'Total vendido hoy')

    await page.goto('/venta')
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await cobrar(page, 'Mercado Pago')

    await page.goto('/reportes')
    await page.locator('[data-resumen-hoy]').waitFor({ timeout: 20_000 })
    expect(await importe(page, 'Mercado Pago')).toBe(mercadoPago + PRODUCTOS.gaseosa.precio)
    expect(await importe(page, 'Transferencia')).toBe(transferencia)
    expect(await importe(page, 'Total vendido hoy')).toBe(total + PRODUCTOS.gaseosa.precio)
  })

  test('cada acceso abre su reporte, de a uno', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/reportes')

    for (const nombre of [
      'Ventas por día',
      'Ventas por medio de pago',
      'Ventas por producto',
      'Ventas por usuario',
      'Cierres de caja',
    ]) {
      await page.getByRole('button', { name: new RegExp(`^${nombre}`) }).click()
      const reporte = page.getByRole('region', { name: nombre })
      await expect(reporte).toBeVisible()
      await expect(
        reporte
          .getByRole('table')
          .first()
          .or(reporte.getByText(/^No (hubo|se abrió)/)),
      ).toBeVisible({ timeout: 20_000 })
      // Un reporte a la vez.
      await expect(page.locator('[data-reporte]')).toHaveCount(1)
    }

    // El elegido queda en la direccion: se puede volver directo.
    await expect(page).toHaveURL(/\?ver=caja$/)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Cierres de caja' })).toBeVisible()
  })
})
