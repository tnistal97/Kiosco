import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, leerMonto, totalDelTicket } from './ayudantes'

/**
 * El cajero sin mouse. UX V3.
 *
 * Una venta entera con el lector, las flechas, Enter, Escape y numeros. Es
 * la prueba principal de la fase: si esto no pasa, la gramatica de teclado no
 * existe. Ningun `click` en la venta; los unicos son los del `beforeEach`,
 * que son de la prueba y no del cajero.
 *
 * Lo que cambio en la V3 y se prueba aca:
 *
 *   - ← y → mueven el cursor mientras se escribe, y solo cambian cantidades
 *     cuando hay algo elegido a la vista;
 *   - Enter con el campo vacio pasa a REVISAR; el cobro es el Enter siguiente;
 *   - dentro del cobro, Enter no vende hasta que alguien diga como se paga;
 *   - la ultima ← quita la linea, con "Deshacer" a mano.
 */

const campo = (page: Page) => page.locator('[data-barcode-input]')
const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })
const elegida = (page: Page) => ticket(page).locator('li[aria-current="true"]')

/** Escribe un codigo como lo haria el lector: digitos y Enter, en el campo. */
async function escanearConTeclado(page: Page, codigo: string): Promise<void> {
  await page.keyboard.type(codigo)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
}

/** Enter con el campo vacio: pasa a revisar el ticket. */
async function revisar(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Revisá el ticket/)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await entrar(page, 'cajero')
  await page.goto('/venta')
  await expect(campo(page)).toBeFocused()
})

test('una venta completa: escanear, revisar, sumar, cobrar, vuelto y siguiente', async ({
  page,
}) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  await escanearConTeclado(page, PRODUCTOS.leche.codigo)

  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

  // Enter con el campo vacio NO cobra: pasa a revisar, con lo ultimo escaneado
  // elegido.
  await revisar(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(elegida(page)).toContainText(PRODUCTOS.leche.nombre)

  // ↑ elige la anterior; → le suma una unidad. El foco no se movio del campo.
  await page.keyboard.press('ArrowUp')
  await expect(elegida(page)).toContainText(PRODUCTOS.yerba.nombre)
  await page.keyboard.press('ArrowRight')
  await expect(campo(page)).toBeFocused()
  await expect(ticket(page).getByText('2 u.', { exact: true })).toBeVisible()
  expect(await totalDelTicket(page)).toBe(PRODUCTOS.yerba.precio * 2 + PRODUCTOS.leche.precio)

  // Recien ahora Enter abre el cobro. Efectivo por omision, foco en "paga con".
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
  const pagaCon = dialogo.getByLabel(/^paga con/i)
  await expect(pagaCon).toBeFocused()
  await expect(pagaCon).toHaveValue('')

  // Con cuanto paga, y el vuelto en pantalla antes de confirmar.
  await page.keyboard.type('20000')
  const total = PRODUCTOS.yerba.precio * 2 + PRODUCTOS.leche.precio
  const vuelto = 20000 - total
  await expect(
    dialogo.getByText(new RegExp(String(vuelto).replace(/\B(?=(\d{3})+(?!\d))/g, '\\.'))),
  ).toBeVisible()

  // Enter cobra (pasados los 300 ms que separan un Enter a proposito de uno
  // que rebota).
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/vuelto/i).first()).toBeVisible()

  // Enter otra vez: nueva venta, y el lector ya tiene el foco.
  await page.keyboard.press('Enter')
  await expect(campo(page)).toBeFocused()
  await expect(page.getByText('El ticket está vacío')).toBeVisible()

  // El siguiente escaneo arranca el proximo ticket sin tocar nada.
  await escanearConTeclado(page, PRODUCTOS.gaseosa.codigo)
  await expect(ticket(page).getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toBeVisible()
})

test('dos Enter seguidos desde el buscador NO registran una venta', async ({ page }) => {
  // El accidente que la V3 vino a cerrar: con el campo vacio, apretar Enter
  // varias veces llegaba a "Venta registrada" sin que nadie hubiera dicho un
  // importe. Ahora el primero revisa, el segundo abre el cobro, y el tercero
  // se planta pidiendo que se declare el pago.
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)

  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')

  await expect(page.getByText('Venta registrada')).toHaveCount(0)
  await expect(page.getByText(/falta decir cómo se paga/i)).toBeVisible()

  // Y con el pago declarado --J pone el importe justo-- cobra en un Enter.
  await page.keyboard.press('j')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
})

test('Supr quita la linea elegida y el foco sigue en el lector', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  await escanearConTeclado(page, PRODUCTOS.leche.codigo)
  await escanearConTeclado(page, PRODUCTOS.gaseosa.codigo)

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
  // Corregir un nombre mal tipeado es lo mas comun del mundo y la V2 lo hacia
  // imposible: con una linea elegida, ← restaba una unidad.
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)

  await page.keyboard.type('coca colaa')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Backspace')
  await expect(campo(page)).toHaveValue('coca cola')
  // La cantidad de la yerba no se movio.
  await expect(ticket(page).getByText('1 u.', { exact: true })).toBeVisible()
})

test('↓ elige un producto de la lista; → suma sin perder el foco ni la busqueda', async ({
  page,
}) => {
  await page.keyboard.type('yerba')
  const fila = page.locator('[data-fila]').first()
  await expect(fila).toBeVisible()

  // ↓ elige: la fila queda marcada y el foco sigue en el campo.
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-fila][data-elegida]')).toHaveCount(1)
  await expect(campo(page)).toBeFocused()

  // → suma de a una, sin limpiar lo escrito.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(ticket(page).getByText('2 u.', { exact: true })).toBeVisible()
  await expect(campo(page)).toHaveValue('yerba')
  await expect(campo(page)).toBeFocused()

  // ← resta.
  await page.keyboard.press('ArrowLeft')
  await expect(ticket(page).getByText('1 u.', { exact: true })).toBeVisible()

  // Con otro nombre, ↓ → agrega OTRO producto sin tocar el anterior: dos
  // Escape --uno suelta la fila, otro limpia-- y a escribir.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.type('leche')
  await page.waitForTimeout(500)
  // Dos resultados --"Dulce de leche" primero, por orden alfabetico--: la
  // segunda ↓ es la que llega a la leche.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()
  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(campo(page)).toHaveValue('leche')

  // Escape suelta la fila y devuelve el mando al texto: lo escrito no se
  // pierde y ← vuelve a ser el cursor, no una unidad menos.
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-fila][data-elegida]')).toHaveCount(0)
  await expect(campo(page)).toHaveValue('leche')
  await page.keyboard.press('ArrowLeft')
  await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()
  await expect(ticket(page).getByText('1 u.').first()).toBeVisible()
})

test('→ sobre un producto por peso abre el peso y vuelve donde estaba', async ({ page }) => {
  // Un producto por kilo no tiene "una unidad mas": → abre el flujo de peso
  // que ya existia. Y al cerrarlo se vuelve al contexto anterior --el nombre
  // buscado sigue escrito-- porque se llego desde la lista, no con Enter.
  await page.keyboard.type('queso')
  await page.waitForTimeout(600)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')

  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByText(PRODUCTOS.queso.nombre)).toBeVisible()

  await page.keyboard.type('0,500')
  await page.keyboard.press('Enter')
  await expect(dialogo).not.toBeAttached()

  await expect(campo(page)).toBeFocused()
  await expect(campo(page)).toHaveValue('queso')
  await expect(ticket(page).getByText('0,500 kg', { exact: true })).toBeVisible()
})

test('la ultima ← quita la linea y deja deshacerlo', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  await revisar(page)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(ticket(page).getByText('3 u.', { exact: true })).toBeVisible()

  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('El ticket está vacío')).toBeVisible()

  // Sin modal de confirmacion, pero con vuelta atras.
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  await expect(ticket(page).getByText('1 u.', { exact: true })).toBeVisible()
})

test('Escape vuelve un paso por vez: cobro, revisar, buscador', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  const antes = await totalDelTicket(page)

  await revisar(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeAttached()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeAttached()
  await expect(campo(page)).toBeFocused()
  await expect(page.getByText(/Revisá el ticket/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByText(/Revisá el ticket/)).toHaveCount(0)
  await expect(campo(page)).toBeFocused()
  expect(await totalDelTicket(page)).toBe(antes)
})

test('una letra en el cobro elige el medio; Enter confirma una transferencia', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.leche.codigo)
  await revisar(page)
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()

  await page.keyboard.press('t')
  await expect(dialogo.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
  await expect(dialogo.getByLabel(/^paga con/i)).toHaveCount(0)

  // Elegir el medio ya es declarar como se paga: Enter confirma.
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Transferencia')).toBeVisible()
})

test('buscar por nombre, elegir con las flechas y agregar con Enter, en el mismo campo', async ({
  page,
}) => {
  await page.keyboard.type('Yerba')
  await expect(page.getByRole('button', { name: /Yerba mate 1 kg/ }).first()).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')

  await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
  // El campo quedo vacio y listo para el proximo codigo.
  await expect(campo(page)).toHaveValue('')
  await expect(campo(page)).toBeFocused()
})

test('los alias viejos siguen funcionando: F12 cobra, Ctrl+K enfoca', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)

  await page.getByRole('button', { name: 'Vaciar' }).focus()
  await expect(campo(page)).not.toBeFocused()
  await page.keyboard.press('Control+k')
  await expect(campo(page)).toBeFocused()

  await page.keyboard.press('F12')
  await expect(page.getByRole('dialog')).toBeAttached()
  await expect(page.getByRole('dialog').getByRole('button', { name: /^cobrar/i })).toBeVisible()
})

test('el boton de cobrar lleva el importe y no anuncia F12', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  const cobrar = ticket(page).getByRole('button', { name: /^Cobrar/ })
  await expect(cobrar).toBeVisible()
  await expect(cobrar).not.toContainText('F12')
  await expect(cobrar).toContainText('4.850')
  // En 1366 x 768 el boton entra sin desplazar nada.
  await expect(cobrar).toBeInViewport()
})

test('el cobro entero entra en 1366 x 768: "Cobrar" se ve sin desplazar', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  await escanearConTeclado(page, PRODUCTOS.leche.codigo)
  await escanearConTeclado(page, PRODUCTOS.gaseosa.codigo)
  await revisar(page)
  await page.keyboard.press('Enter')

  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()
  const cobrar = dialogo.getByRole('button', { name: /^cobrar/i })
  await expect(cobrar).toBeInViewport()

  // Ni siquiera con el pago dividido, que es lo mas largo que tiene.
  await dialogo.getByRole('button', { name: /dividir el pago/i }).click()
  await expect(cobrar).toBeInViewport()
})

test('hacer clic en el campo y escribir enseguida despues de cerrar un dialogo no pierde texto', async ({
  page,
}) => {
  // El caso de la auditoria (H-18): tras cerrar un dialogo, el foco volvia al
  // lector a la fuerza durante 600 ms y pisaba lo que el cajero tipeaba.
  await escanearConTeclado(page, PRODUCTOS.yerba.codigo)
  await revisar(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeAttached()
  await page.keyboard.press('Escape')

  await campo(page).click()
  await page.keyboard.type('gase')
  await page.waitForTimeout(700)
  await expect(campo(page)).toHaveValue('gase')
  await expect(page.getByRole('button', { name: /Gaseosa cola/ }).first()).toBeVisible()
})

test('el vuelto se lee en grande en el resultado', async ({ page }) => {
  await escanearConTeclado(page, PRODUCTOS.leche.codigo)
  await revisar(page)
  await page.keyboard.press('Enter')
  const dialogo = page.getByRole('dialog')
  await expect(dialogo.getByLabel(/^paga con/i)).toBeFocused()
  await page.keyboard.type('5000')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')

  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  const cifra = dialogo.getByText(/^\$/).first()
  const alto = await cifra.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(alto, 'el vuelto no esta en el tamanio mas grande').toBeGreaterThanOrEqual(36)
  expect(leerMonto(await cifra.innerText())).toBe(5000 - PRODUCTOS.leche.precio)
})
