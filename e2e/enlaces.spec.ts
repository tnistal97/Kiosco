import { test, expect } from '@playwright/test'
import { entrar } from './ayudantes'

/**
 * Los enlaces que la auditoria encontro rotos (H-04). UX V2, Fase 1.
 *
 *   libro de movimientos → venta        `/ventas?venta=N`: la query ahora se lee
 *   libro de movimientos → recepcion    `/compras/recepcion/N`: redirige a la orden
 *   devolucion → producto               `/productos?producto=N`: abre la ficha
 *   proveedor → producto                idem
 *
 * Los numeros salen de la pantalla, no del seed: cada corrida los vuelve a
 * generar.
 */

test.beforeEach(async ({ page }) => {
  await entrar(page, 'admin')
})

test('desde el libro de movimientos se llega a la venta, ya desplegada', async ({ page }) => {
  await page.goto('/stock/movimientos')
  const enlace = page.getByRole('link', { name: /^Venta #\d+$/ }).first()
  await expect(enlace).toBeVisible({ timeout: 20_000 })
  const numero = (await enlace.innerText()).replace(/\D/g, '')

  await enlace.click()
  await expect(page).toHaveURL(new RegExp(`/ventas\\?venta=${numero}$`))

  // La venta esta, es la unica, y esta abierta con su detalle.
  const fila = page.locator('tr[aria-selected="true"]')
  await expect(fila).toBeVisible({ timeout: 20_000 })
  await expect(fila).toContainText(`#${numero}`)
  await expect(page.getByRole('row')).toHaveCount(3) // encabezado + venta + detalle
})

test('desde el libro de movimientos se llega a la recepcion, dentro de su orden', async ({
  page,
}) => {
  await page.goto('/stock/movimientos')
  const enlace = page.getByRole('link', { name: /^Recepción #\d+$/ }).first()
  await expect(enlace).toBeVisible({ timeout: 20_000 })
  const numero = (await enlace.innerText()).replace(/\D/g, '')

  await enlace.click()
  await expect(page).toHaveURL(new RegExp(`/compras/\\d+#recepcion-${numero}$`), {
    timeout: 20_000,
  })

  const recepcion = page.locator(`#recepcion-${numero}`)
  await expect(recepcion).toBeVisible({ timeout: 20_000 })
  await expect(recepcion.getByRole('heading', { level: 3 })).toContainText('Recepción')
})

test('una recepcion que no existe no es una pantalla en blanco', async ({ page }) => {
  const respuesta = await page.goto('/compras/recepcion/99999999')
  expect(respuesta?.status()).toBe(404)
})

test('desde una devolucion se abre la ficha del producto', async ({ page }) => {
  await page.goto('/devoluciones')
  const primera = page.getByRole('table').getByRole('link').first()
  await primera.waitFor({ state: 'attached', timeout: 20_000 })
  await primera.click()
  await expect(page).toHaveURL(/\/devoluciones\/\d+/)

  const producto = page
    .getByRole('table')
    .first()
    .getByRole('link')
    .filter({ hasNot: page.locator('[data-numeric]') })
    .first()
  await expect(producto).toBeVisible({ timeout: 20_000 })
  const nombre = await producto.innerText()

  await producto.click()
  await expect(page).toHaveURL(/\/productos\?producto=\d+$/)
  const ficha = page.getByRole('dialog')
  await expect(ficha).toBeAttached({ timeout: 20_000 })
  await expect(ficha.getByLabel('Nombre')).toHaveValue(nombre)
})

test('desde un proveedor se abre la ficha del producto', async ({ page }) => {
  await page.goto('/proveedores')
  await page
    .getByRole('link', { name: /Distribuidora del Norte/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/proveedores\/\d+/)

  const producto = page.getByRole('link', { name: /Yerba mate 1 kg/ }).first()
  await expect(producto).toBeVisible({ timeout: 20_000 })
  await producto.click()

  await expect(page).toHaveURL(/\/productos\?producto=\d+$/)
  const ficha = page.getByRole('dialog')
  await expect(ficha).toBeAttached({ timeout: 20_000 })
  await expect(ficha.getByLabel('Nombre')).toHaveValue('Yerba mate 1 kg')
})
