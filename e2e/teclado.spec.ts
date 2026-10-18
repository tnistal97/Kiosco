import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, leerMonto, totalDelTicket } from './ayudantes'

/**
 * El cajero sin mouse. UX V5 (sobre la V3).
 *
 * Una venta entera con el lector, las flechas, Enter, Escape, + y −. Es la
 * prueba principal de la pantalla: si esto no pasa, la gramatica de teclado no
 * existe. Ningun `click` en la venta salvo donde se prueba justamente que el
 * mouse no rompe el lector.
 *
 * Las reglas de la V5 que se prueban aca:
 *
 *   - las FLECHAS solo se mueven: nunca cambian una cantidad;
 *   - ENTER elige o avanza una etapa (producto → ticket → forma de pago →
 *     confirmar). Nunca es "+1 unidad";
 *   - la cantidad cambia con + y − (o con los botones de la linea);
 *   - el LECTOR (CODIGO + Enter) sigue agregando: dos lecturas, dos unidades;
 *     y funciona aunque el foco este en otro lado o haya texto escrito.
 */

const campo = (page: Page) => page.locator('[data-barcode-input]')
const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })
const elegida = (page: Page) => ticket(page).locator('li[aria-current="true"]')
const cantidad = (page: Page, nombre: string) =>
  ticket(page).getByRole('spinbutton', { name: new RegExp(`cantidad de ${nombre}`, 'i') })

/** Escribe un codigo como lo haria un lector USB: rapido, digitos y Enter. */
async function lector(page: Page, codigo: string): Promise<void> {
  await page.keyboard.type(codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
}

/** Enter con el campo vacio: pasa a revisar el ticket. */
async function revisar(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Revisá el ticket/)).toBeVisible()
}

/** Desde el ticket: Enter abre el cobro, con el foco en la forma de pago. */
async function abrirCobro(page: Page) {
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByRole('radio', { name: 'Efectivo' })).toBeFocused()
  return dialogo
}

test.beforeEach(async ({ page }) => {
  await entrar(page, 'cajero')
  await page.goto('/venta')
  await expect(campo(page)).toBeFocused()
})

test('una venta completa solo con teclado: lector, ticket, forma de pago, recibido, vuelto', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await lector(page, PRODUCTOS.leche.codigo)

  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

  // Enter con el campo vacio NO cobra: pasa a revisar, con lo ultimo escaneado
  // elegido.
  await revisar(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(elegida(page)).toContainText(PRODUCTOS.leche.nombre)

  // ↑ elige la anterior; + le suma una unidad. El foco no se movio del campo.
  await page.keyboard.press('ArrowUp')
  await expect(elegida(page)).toContainText(PRODUCTOS.yerba.nombre)
  await page.keyboard.press('+')
  await expect(campo(page)).toBeFocused()
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')
  const total = PRODUCTOS.yerba.precio * 2 + PRODUCTOS.leche.precio
  expect(await totalDelTicket(page)).toBe(total)

  // Enter abre el cobro; el foco esta en la forma de pago. Enter elige
  // Efectivo y pasa a "Recibido".
  const dialogo = await abrirCobro(page)
  await page.keyboard.press('Enter')
  const recibido = dialogo.getByLabel(/^recibido/i)
  await expect(recibido).toBeFocused()
  await expect(recibido).toHaveValue('')

  // Cuanto dio, y el vuelto en pantalla antes de confirmar.
  await page.keyboard.type('20000')
  const vuelto = 20000 - total
  await expect(
    dialogo.getByText(new RegExp(String(vuelto).replace(/\B(?=(\d{3})+(?!\d))/g, '\\.'))),
  ).toBeVisible()

  // Enter confirma (pasados los 300 ms que separan un Enter a proposito de
  // uno que rebota).
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('VUELTO')).toBeVisible()

  // Enter otra vez: nueva venta, y el lector ya tiene el foco.
  await page.keyboard.press('Enter')
  await expect(campo(page)).toBeFocused()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()

  // El siguiente escaneo arranca el proximo ticket sin tocar nada.
  await lector(page, PRODUCTOS.gaseosa.codigo)
  await expect(ticket(page).getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toBeVisible()
})

test('flechas izquierda y derecha, y despues Enter, NO suman unidades de mas', async ({ page }) => {
  // El error que reporto el dueño: en la lista, → sumaba una unidad y el
  // Enter de despues volvia a sumar.
  await page.keyboard.type('yerba')
  await expect(page.locator('[data-fila]').first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  // Las flechas no agregaron nada.
  await expect(page.getByText('El ticket está vacío')).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  await expect(campo(page)).toBeFocused()
  await expect(campo(page)).toHaveValue('')
})

test('Enter sobre un producto que ya esta en el ticket no suma otro: lo hace +', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await page.keyboard.type('yerba')
  await expect(page.locator('[data-fila]').first()).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  await expect(page.getByRole('status').filter({ hasText: /ya está en el ticket/ })).toBeAttached()
  // Y se ve, en el renglon de arriba de la lista.
  await expect(page.getByText(/ya está en el ticket/).last()).toBeVisible()

  // + suma; − resta. Explicito.
  await page.keyboard.press('+')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')
  await page.keyboard.press('-')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
})

test('el lector: CODIGO + Enter agrega, y dos lecturas son dos unidades', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await lector(page, PRODUCTOS.yerba.codigo)
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')
  await expect(campo(page)).toBeFocused()
  await expect(campo(page)).toHaveValue('')
})

test('el lector funciona aunque el foco haya quedado en otro boton', async ({ page }) => {
  // Despues de tocar una categoria o una linea con el mouse, el foco quedaba
  // ahi y la lectura se perdia. Ahora vuelve al campo.
  await page.getByRole('button', { name: 'Bebidas' }).first().click()
  await lector(page, PRODUCTOS.leche.codigo)
  await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')

  // Y tambien con el foco en el boton Vaciar del ticket.
  await ticket(page).getByRole('button', { name: 'Vaciar' }).focus()
  await lector(page, PRODUCTOS.leche.codigo)
  await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('2')
})

test('el lector encima de un nombre a medio escribir: lee el codigo y deja lo escrito', async ({
  page,
}) => {
  await page.keyboard.type('coc', { delay: 120 })
  await page.waitForTimeout(300)
  await lector(page, PRODUCTOS.gaseosa.codigo)
  await expect(cantidad(page, PRODUCTOS.gaseosa.nombre)).toHaveValue('1')
  await expect(campo(page)).toHaveValue('coc')
})

test('Enter no saltea etapas: cada Enter avanza una sola', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)

  // 1: revisar. 2: cobro, con el foco en la forma de pago. Ninguna venta.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByRole('radio', { name: 'Efectivo' })).toBeFocused()
  await expect(page.getByText('Venta registrada')).toHaveCount(0)

  // 3: elige Efectivo y pasa a Recibido. Tampoco hay venta todavia.
  await page.keyboard.press('Enter')
  await expect(dialogo.getByLabel(/^recibido/i)).toBeFocused()
  await expect(page.getByText('Venta registrada')).toHaveCount(0)

  // 4: confirma, en efectivo justo.
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect(dialogo).not.toBeAttached({ timeout: 15_000 })
  await expect(page.getByText(/Venta registrada/).first()).toBeVisible()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
})

test('Supr quita la linea elegida y el foco sigue en el lector', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await lector(page, PRODUCTOS.leche.codigo)
  await lector(page, PRODUCTOS.gaseosa.codigo)

  // Revisar, ↑ ↑ elige la primera; Supr la quita; la que sigue queda elegida.
  await revisar(page)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(elegida(page)).toContainText(PRODUCTOS.yerba.nombre)
  await page.keyboard.press('Delete')

  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toHaveCount(0)
  await expect(elegida(page)).toContainText(PRODUCTOS.leche.nombre)
  await expect(campo(page)).toBeFocused()

  // Dos Supr mas y el ticket queda vacio; el foco nunca cayo al body.
  await page.keyboard.press('Delete')
  await page.keyboard.press('Delete')
  await expect(page.getByText('El ticket está vacío')).toBeVisible()
  await expect(campo(page)).toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
})

test('mientras se escribe, ← mueve el cursor y no toca ninguna cantidad', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)

  await page.keyboard.type('coca colaa')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Backspace')
  await expect(campo(page)).toHaveValue('coca cola')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
})

test('Enter sobre un producto por peso abre el peso', async ({ page }) => {
  await page.keyboard.type('queso')
  await page.waitForTimeout(600)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByText(PRODUCTOS.queso.nombre)).toBeVisible()

  await page.keyboard.type('0,500')
  await page.keyboard.press('Enter')
  await expect(dialogo).not.toBeAttached()

  await expect(campo(page)).toBeFocused()
  await expect(cantidad(page, PRODUCTOS.queso.nombre)).toHaveAttribute('aria-valuetext', '0,500 kg')
})

test('− hasta cero quita la linea y deja deshacerlo', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await revisar(page)
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('3')

  await page.keyboard.press('-')
  await page.keyboard.press('-')
  await page.keyboard.press('-')
  await expect(page.getByText('El ticket está vacío')).toBeVisible()

  // Sin modal de confirmacion, pero con vuelta atras.
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
})

test('Escape vuelve un paso por vez: cobro, revisar, buscador', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  const antes = await totalDelTicket(page)

  await revisar(page)
  await abrirCobro(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeAttached()
  await expect(campo(page)).toBeFocused()
  await expect(page.getByText(/Revisá el ticket/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByText(/Revisá el ticket/)).toHaveCount(0)
  await expect(campo(page)).toBeFocused()
  expect(await totalDelTicket(page)).toBe(antes)
})

test('en el cobro, una letra elige la forma de pago y Enter avanza hasta confirmar', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.leche.codigo)
  await revisar(page)
  const dialogo = await abrirCobro(page)

  await page.keyboard.press('t')
  await expect(dialogo.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
  await expect(dialogo.getByLabel(/^recibido/i)).toHaveCount(0)
  await expect(dialogo.getByRole('radio', { name: 'Transferencia' })).toBeFocused()

  // Enter elige la transferencia y pasa a "Confirmar venta"; el segundo Enter
  // confirma. Sin vuelto que dar, la venta termina sola.
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect(dialogo.getByRole('button', { name: /^confirmar venta/i })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialogo).not.toBeAttached({ timeout: 15_000 })
  await expect(page.getByText(/Venta registrada/).first()).toBeVisible()
})

test('buscar por nombre, recorrer con las flechas y elegir con Enter, en el mismo campo', async ({
  page,
}) => {
  await page.keyboard.type('Yerba')
  await expect(page.getByRole('button', { name: /Yerba mate 1 kg/ }).first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')

  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  await expect(campo(page)).toHaveValue('')
  await expect(campo(page)).toBeFocused()
})

test('los alias viejos siguen funcionando: F12 cobra, Ctrl+K enfoca', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)

  await page.getByRole('button', { name: 'Vaciar' }).focus()
  await expect(campo(page)).not.toBeFocused()
  await page.keyboard.press('Control+k')
  await expect(campo(page)).toBeFocused()

  await page.keyboard.press('F12')
  await expect(page.getByRole('dialog')).toBeAttached()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /^confirmar venta/i }),
  ).toBeVisible()
})

test('el TOTAL se ve grande y Cobrar entra sin desplazar', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await expect(ticket(page).getByText('TOTAL')).toBeVisible()
  expect(await totalDelTicket(page)).toBe(PRODUCTOS.yerba.precio)
  const cobrar = ticket(page).getByRole('button', { name: /^Cobrar/ })
  await expect(cobrar).not.toContainText('F12')
  await expect(cobrar).toBeInViewport()
})

test('el cobro entero entra en 1366 x 768: "Confirmar venta" se ve sin desplazar', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await lector(page, PRODUCTOS.leche.codigo)
  await lector(page, PRODUCTOS.gaseosa.codigo)
  await revisar(page)
  const dialogo = await abrirCobro(page)

  const confirmar = dialogo.getByRole('button', { name: /^confirmar venta/i })
  await expect(confirmar).toBeInViewport()
  await expect(dialogo.getByText('VUELTO')).toBeInViewport()

  // Ni siquiera con el pago dividido, que es lo mas largo que tiene.
  await dialogo.getByRole('button', { name: /más opciones/i }).click()
  await dialogo.getByRole('button', { name: /dividir el pago/i }).click()
  await expect(confirmar).toBeInViewport()
})

test('hacer clic en el campo y escribir enseguida despues de cerrar un dialogo no pierde texto', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await revisar(page)
  await abrirCobro(page)
  await page.keyboard.press('Escape')

  await campo(page).click()
  await page.keyboard.type('gase')
  await page.waitForTimeout(700)
  await expect(campo(page)).toHaveValue('gase')
  await expect(page.getByRole('button', { name: /Gaseosa cola/ }).first()).toBeVisible()
})

test('el VUELTO se lee en grande en el resultado', async ({ page }) => {
  await lector(page, PRODUCTOS.leche.codigo)
  await revisar(page)
  const dialogo = await abrirCobro(page)
  await page.keyboard.press('Enter')
  await expect(dialogo.getByLabel(/^recibido/i)).toBeFocused()
  await page.keyboard.type('5000')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')

  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  const cifra = dialogo.getByText(/^\$/).first()
  const alto = await cifra.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(alto, 'el vuelto no esta en el tamanio mas grande').toBeGreaterThanOrEqual(36)
  expect(leerMonto(await cifra.innerText())).toBe(5000 - PRODUCTOS.leche.precio)
})

test('Tab desde la cantidad de una linea sigue por el ticket, no vuelve al campo', async ({
  page,
}) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await cantidad(page, PRODUCTOS.yerba.nombre).focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(100)

  await expect(campo(page)).not.toBeFocused()
  const enElTicket = await ticket(page).evaluate((el) => el.contains(document.activeElement))
  expect(enElTicket).toBe(true)
})

test('+ y − con el foco en la pantalla cambian la cantidad, no se escriben', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  // Como un clic en un lugar vacio de la pantalla.
  await page.locator('main').focus()
  await page.keyboard.press('+')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')
  await page.keyboard.press('-')
  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  await expect(campo(page)).toHaveValue('')
})

test('"/" lleva al campo sin escribirse', async ({ page }) => {
  await lector(page, PRODUCTOS.yerba.codigo)
  await ticket(page).getByRole('button', { name: 'Vaciar' }).focus()
  await page.keyboard.press('/')

  await expect(campo(page)).toBeFocused()
  await expect(campo(page)).toHaveValue('')
})

test('el lector despues de numeros escritos a mano no mezcla los dos codigos', async ({ page }) => {
  await page.keyboard.type('123', { delay: 120 })
  await page.waitForTimeout(400)
  await lector(page, PRODUCTOS.yerba.codigo)

  await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  // Lo escrito a mano vuelve al campo, como estaba.
  await expect(campo(page)).toHaveValue('123')
})
