import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, leerMonto } from './ayudantes'

/**
 * Caja y venta, de punta a punta. UX V2, Fase 2.
 *
 * Los diez flujos que pidio la fase, en el orden en que pasan en un dia:
 * cerrar la caja del turno anterior, ver que sin caja no se cobra, abrirla
 * desde la venta, vender de las tres maneras (escaneo, lista visible, peso),
 * cobrar de tres (efectivo, transferencia, combinado), sacar una linea.
 *
 * Y los casos de borde que una persona nueva se cruza el primer dia: el
 * ticket vacio, el producto agotado, el stock que no alcanza.
 *
 * Las pantallas nuevas son paginas, no dialogos: abrir y cerrar la caja se
 * navegan, y por eso se comprueban con URL y no con `getByRole('dialog')`.
 */

const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })
const campo = (page: Page) => page.locator('[data-barcode-input]')
const tarjeta = (page: Page, nombre: string) =>
  page.getByRole('group', { name: 'Productos' }).getByRole('button', { name: new RegExp(`^${nombre}, `) }) // prettier-ignore

async function cobrarEnEfectivo(page: Page, recibido: string): Promise<void> {
  await ticket(page).getByRole('button', { name: 'Cobrar' }).click()
  const cobro = page.getByRole('dialog')
  await cobro.getByLabel(/^paga con/i).fill(recibido)
  await page.waitForTimeout(400)
  await cobro.getByRole('button', { name: /^Cobrar/ }).click()
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------

test.describe('La caja, guiada', () => {
  test('10. cerrar la caja: contar, ver que cuadra y confirmar', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja/cerrar')

    // 1 · El turno: los cuatro renglones y lo que tiene que haber.
    await expect(page.getByRole('heading', { name: 'Cerrar la caja' })).toBeVisible()
    await expect(page.getByText('Efectivo inicial')).toBeVisible()
    await expect(page.getByText('Retiros y depósitos')).toBeVisible()
    const fila = page.getByText('Tiene que haber', { exact: true }).locator('..')
    const esperado = leerMonto(await fila.getByText(/^\$/).innerText())

    // 2 · Contar. Con menos, "Falta" en grande y una pista.
    const contado = page.getByLabel('Efectivo contado')
    await expect(contado).toBeFocused()
    await contado.fill(String(esperado - 1200))
    await expect(page.getByRole('status')).toContainText('Falta')
    await expect(page.getByText(/1\.200/)).toBeVisible()

    // Con lo justo, "Cuadra".
    await contado.fill(String(esperado))
    await expect(page.getByRole('status')).toContainText('Cuadra')

    await page.getByRole('button', { name: 'Cerrar caja' }).click()
    await expect(page.getByRole('heading', { name: 'Caja cerrada' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Cuadra')).toBeVisible()
  })

  test('caso: con la caja cerrada, la venta lo dice y lleva a abrirla', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')

    const aviso = page.getByText('La caja está cerrada')
    await expect(aviso).toBeVisible()
    // El ticket se puede armar igual: el aviso no bloquea la pantalla.
    await escanear(page, PRODUCTOS.yerba.codigo)
    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Abrir caja' }).click()
    await page.waitForURL(/\/caja\/abrir\?volver=%2Fventa|\/caja\/abrir\?volver=\/venta/)
  })

  test('1. abrir la caja desde la venta y volver a vender', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/caja/abrir?volver=/venta')

    await expect(page.getByRole('heading', { name: 'Abrir la caja' })).toBeVisible()
    // Quien abre y donde, a la vista y sin escribirlos.
    await expect(page.getByText('Sucursal')).toBeVisible()
    await expect(page.getByText('Abre')).toBeVisible()

    const inicial = page.getByLabel('Efectivo inicial')
    await expect(inicial).toBeFocused()
    await inicial.fill('25000')
    // Enter abre: es la unica accion de la pantalla.
    await inicial.press('Enter')

    await page.waitForURL(/\/venta$/, { timeout: 15_000 })
    await expect(page.getByText('La caja está cerrada')).toHaveCount(0)
  })

  test('la caja recien abierta lo dice, y no se puede abrir dos veces', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/caja/abrir')
    await expect(page.getByRole('heading', { name: 'La caja ya está abierta' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ir a vender' })).toBeVisible()
  })
})

test.describe('Vender', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')
    await page.evaluate(() => localStorage.removeItem('kiosco:ticket'))
    await page.goto('/venta')
    await expect(campo(page)).toBeFocused()
  })

  test('la pantalla ya muestra productos antes de escribir nada', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Todos' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Productos' })).toBeVisible()
    await expect(tarjeta(page, PRODUCTOS.yerba.nombre)).toBeVisible()
    // Y el ticket vacio dice que hacer, con "Cobrar" a la vista pero apagado.
    await expect(page.getByText('El ticket está vacío')).toBeVisible()
    await expect(ticket(page).getByRole('button', { name: 'Cobrar' })).toBeDisabled()
  })

  test('9. elegir un producto de la lista visible, tocando', async ({ page }) => {
    await page.getByRole('button', { name: 'Bebidas' }).click()
    await tarjeta(page, PRODUCTOS.gaseosa.nombre).click()

    await expect(ticket(page).getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toBeVisible()
    // El foco vuelve al lector: el proximo codigo cae donde tiene que caer.
    await expect(campo(page)).toBeFocused()
  })

  test('9. elegir un producto de la lista visible, con el teclado', async ({ page }) => {
    // Con el ticket vacio, ↓ entra a la grilla; las flechas la recorren y
    // Enter agrega.
    await page.getByRole('button', { name: 'Todos' }).click()
    await campo(page).click()
    await expect(campo(page)).toBeFocused()
    // Las tarjetas, no cualquier boton: cada tarjeta lleva ademas su estrella.
    await expect(page.locator('[data-tarjeta]').first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    const tarjetas = page.locator('[data-tarjeta]')
    await expect(tarjetas.first()).toBeFocused()

    await page.keyboard.press('ArrowRight')
    const segunda = tarjetas.nth(1)
    await expect(segunda).toBeFocused()
    const nombre = (await segunda.getAttribute('aria-label'))?.split(', ')[0] ?? ''
    await page.keyboard.press('Enter')
    await expect(ticket(page).getByText(nombre, { exact: true })).toBeVisible()

    // Escape devuelve el foco al lector.
    await page.keyboard.press('Escape')
    await expect(campo(page)).toBeFocused()
  })

  test('buscar por nombre filtra la misma grilla, y Enter agrega', async ({ page }) => {
    await campo(page).fill('yerba')
    await expect(page.getByRole('group', { name: 'Resultados de la búsqueda' })).toBeVisible()
    await campo(page).press('Enter')
    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
    await expect(campo(page)).toHaveValue('')
  })

  test('8 y 3. escanear y cobrar en efectivo, con el vuelto a la vista', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)
    await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

    await ticket(page).getByRole('button', { name: 'Cobrar' }).click()
    const cobro = page.getByRole('dialog')
    await expect(cobro.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    await cobro.getByLabel(/^paga con/i).fill('20000')
    const total = PRODUCTOS.yerba.precio + PRODUCTOS.leche.precio
    const vuelto = String(20000 - total).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    await expect(cobro.getByText(new RegExp(vuelto))).toBeVisible()

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/vuelto/i).first()).toBeVisible()

    // Nueva venta: el lector recupera el foco y el ticket queda vacio.
    await page.getByRole('button', { name: 'Nueva venta' }).click()
    await expect(campo(page)).toBeFocused()
    await expect(page.getByText('El ticket está vacío')).toBeVisible()
  })

  test('4. cobrar por transferencia: un toque y confirmar', async ({ page }) => {
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await ticket(page).getByRole('button', { name: 'Cobrar' }).click()
    const cobro = page.getByRole('dialog')

    await cobro.getByRole('radio', { name: 'Transferencia' }).click()
    await expect(cobro.getByText(/no entra al cajón/i)).toBeVisible()
    await expect(cobro.getByLabel(/^paga con/i)).toHaveCount(0)

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  })

  test('5. cobrar combinado: lo cargado y lo que falta, siempre a la vista', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await ticket(page).getByRole('button', { name: 'Cobrar' }).click()
    const cobro = page.getByRole('dialog')

    await cobro.getByRole('button', { name: 'Dividir el pago' }).click()
    // Dos renglones: el primero toma el resto, asi que ya cubre el total.
    await expect(cobro.getByText('Pago 1', { exact: true })).toBeVisible()
    await expect(cobro.getByText('Pago 2', { exact: true })).toBeVisible()
    await expect(cobro.getByText(/Cubre el total/)).toBeVisible()

    // Se declara el primero: el segundo se lleva lo que falta.
    await cobro.getByLabel('Importe del pago 1').fill('2000')
    await expect(cobro.getByText(/Cubre el total/)).toBeVisible()
    await cobro.getByLabel('Importe del pago 2').fill('1000')
    await expect(cobro.getByText(/^Falta/)).toBeVisible()
    await cobro.getByLabel('Importe del pago 2').fill('')
    await expect(cobro.getByText(/Cubre el total/)).toBeVisible()

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  })

  test('6. un producto pesado pide el peso y lo muestra en kilos', async ({ page }) => {
    await escanear(page, PRODUCTOS.queso.codigo)
    await page.getByLabel(/^Peso$/).fill('0,5')
    await page.getByRole('button', { name: 'Agregar' }).click()
    await expect(ticket(page).getByText('0,500 kg', { exact: true })).toBeVisible()
    await cobrarEnEfectivo(page, '10000')
  })

  test('7. sacar una linea del ticket', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)

    // Tocar la linea la elige y muestra sus controles; "Quitar" la saca.
    await ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true }).click()
    await ticket(page).getByRole('button', { name: 'Quitar', exact: true }).click()
    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toHaveCount(0)
    await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

    // Sin la ultima, el ticket vuelve a estar vacio y "Cobrar" se apaga.
    await ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true }).click()
    await ticket(page).getByRole('button', { name: 'Quitar', exact: true }).click()
    await expect(page.getByText('El ticket está vacío')).toBeVisible()
    await expect(ticket(page).getByRole('button', { name: 'Cobrar' })).toBeDisabled()
  })

  test('caso: un producto agotado se ve, se explica y no entra', async ({ page }) => {
    await escanear(page, PRODUCTOS.agotado.codigo)
    await expect(page.getByRole('status').first()).toContainText('agotado')
    await expect(page.getByText('El ticket está vacío')).toBeVisible()

    // En la grilla tambien: la tarjeta esta, apagada, y dice por que.
    await campo(page).fill('helado')
    const agotada = page
      .getByRole('group', { name: 'Resultados de la búsqueda' })
      .getByRole('button', { name: /^Helado 1 L, agotado$/ })
    await expect(agotada).toBeDisabled()
  })

  test('caso: pedir mas de lo que hay se acota y se avisa', async ({ page }) => {
    await escanear(page, PRODUCTOS.leche.codigo)
    await ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true }).click()
    const cantidad = ticket(page).getByRole('spinbutton')
    await cantidad.fill('999')
    await cantidad.press('Tab')
    await expect(ticket(page).getByText(/sin más stock/)).toBeVisible()
    const tope = Number(await cantidad.getAttribute('aria-valuemax'))
    expect(tope).toBeGreaterThan(0)
    expect(Number(await cantidad.getAttribute('aria-valuenow'))).toBe(tope)
  })
})
