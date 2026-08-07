import { test, expect } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, leerMonto, totalDelTicket } from './ayudantes'

/**
 * El camino que se recorre cien veces por dia: escanear, cobrar, siguiente.
 *
 * Se prueba entero, contra la base, con la construccion de produccion. Las
 * pruebas de componentes cubren las piezas; esta cubre que encajen.
 */

test.beforeEach(async ({ page }) => {
  await entrar(page, 'cajero')
  await page.goto('/venta')
})

test('registra una venta de tres productos escaneando', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)
  await escanear(page, PRODUCTOS.gaseosa.codigo)
  await escanear(page, PRODUCTOS.leche.codigo)

  const ticket = page.getByRole('region', { name: 'Ticket en curso' })
  await expect(ticket.getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(ticket.getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toBeVisible()
  await expect(ticket.getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

  const esperado = PRODUCTOS.yerba.precio + PRODUCTOS.gaseosa.precio + PRODUCTOS.leche.precio
  expect(await totalDelTicket(page)).toBe(esperado)

  await page.getByRole('button', { name: /^cobrar/i }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()

  await dialogo.getByRole('button', { name: /^cobrar/i }).click()

  await expect(page.getByText('Venta registrada')).toBeVisible()
  await expect(page.getByText(/^#\d+$/)).toBeVisible()
})

test('el foco vuelve al codigo despues de una venta', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)
  await page.keyboard.press('F12')

  const dialogo = page.getByRole('dialog')
  await dialogo.getByRole('button', { name: /^cobrar/i }).click()
  await expect(page.getByText('Venta registrada')).toBeVisible()

  await page.getByRole('button', { name: 'Nueva venta' }).click()

  // Listo para el proximo cliente sin tocar nada.
  await expect(page.locator('[data-barcode-input]')).toBeFocused()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
})

test('escanear el mismo producto dos veces suma cantidad, no lineas', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)
  await escanear(page, PRODUCTOS.yerba.codigo)

  const ticket = page.getByRole('region', { name: 'Ticket en curso' })
  await expect(ticket.getByText(PRODUCTOS.yerba.nombre, { exact: true })).toHaveCount(1)
  await expect(
    ticket.getByText('1 artículo'),
    'el segundo escaneo abrio una linea nueva',
  ).toBeVisible()
  expect(await totalDelTicket(page)).toBe(PRODUCTOS.yerba.precio * 2)
})

test('un codigo desconocido avisa y no agrega nada', async ({ page }) => {
  await escanear(page, '0000000000000')

  await expect(page.getByText(/desconocido/i)).toBeVisible()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
})

test('un producto agotado no se puede vender', async ({ page }) => {
  await escanear(page, PRODUCTOS.agotado.codigo)

  await expect(page.getByText(/sin stock disponible|agotado/i).first()).toBeVisible()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
})

test('un producto dado de baja se distingue de uno inexistente', async ({ page }) => {
  await escanear(page, PRODUCTOS.deBaja.codigo)

  // El cajero necesita poder decirle al cliente por que no se puede vender.
  await expect(page.getByText(/dado de baja/i)).toBeVisible()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
})

test('la venta se puede hacer entera con el teclado', async ({ page }) => {
  // Sin un solo clic desde que carga la pantalla.
  await page.locator('[data-barcode-input]').press('Escape')

  const campo = page.locator('[data-barcode-input]')
  await expect(campo).toBeFocused()

  await campo.type(PRODUCTOS.yerba.codigo)
  await campo.press('Enter')
  await page.waitForTimeout(700)

  await campo.type(PRODUCTOS.leche.codigo)
  await campo.press('Enter')
  await page.waitForTimeout(700)

  await page.keyboard.press('F12')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()

  await dialogo.getByRole('button', { name: /^cobrar/i }).click()
  await expect(page.getByText('Venta registrada')).toBeVisible()
})

test('Ctrl+K lleva a la busqueda por nombre', async ({ page }) => {
  await page.keyboard.press('Control+k')
  const buscador = page.getByPlaceholder('Buscar por nombre…')
  await expect(buscador).toBeFocused()

  await buscador.type('Yerba')
  await page.waitForTimeout(800)

  // Flecha abajo y Enter: el resultado entra al ticket sin tocar el mouse.
  await page.keyboard.press('Enter')

  const ticket = page.getByRole('region', { name: 'Ticket en curso' })
  await expect(ticket.getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
})

test('el escaner NO agrega productos con el dialogo de cobro abierto', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)
  const antes = await totalDelTicket(page)

  await page.keyboard.press('F12')
  await expect(page.getByRole('dialog')).toBeAttached()

  // Rafaga de lector con el dialogo abierto: el bug que motivo la fase.
  for (const c of PRODUCTOS.gaseosa.codigo) {
    await page.keyboard.press(c)
    await page.waitForTimeout(8)
  }
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  // Ni se agrego nada ni se cobro de mas.
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toHaveCount(0)
  const totalEnDialogo = leerMonto(await dialogo.getByText(/^\$/).first().innerText())
  expect(totalEnDialogo).toBe(antes)
})

test('el ticket sobrevive a un F5 y se restaura con precios del servidor', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)
  await escanear(page, PRODUCTOS.leche.codigo)
  const antes = await totalDelTicket(page)

  await page.reload()
  await page.getByText(/ticket recuperado/i).waitFor()

  const ticket = page.getByRole('region', { name: 'Ticket en curso' })
  await expect(ticket.getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(ticket.getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()
  expect(await totalDelTicket(page)).toBe(antes)
})

test('cerrar sesion borra el ticket guardado', async ({ page }) => {
  await escanear(page, PRODUCTOS.yerba.codigo)

  await page.getByRole('button', { name: /cuenta de/i }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await page.waitForURL(/\/login/)

  await entrar(page, 'cajero')
  await page.goto('/venta')

  await expect(page.getByText('El ticket está vacío')).toBeVisible()
  await expect(page.getByText(/ticket recuperado/i)).toHaveCount(0)
})
