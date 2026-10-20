import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, leerMetrica, leerMonto, terminarVenta } from './ayudantes'

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

const ticket = (page: Page) => page.getByRole('region', { name: 'Carrito' })
const campo = (page: Page) => page.locator('[data-barcode-input]')
const fila = (page: Page, nombre: string) =>
  page.getByRole('group', { name: 'Productos' }).getByRole('button', { name: new RegExp(`^${nombre}, `) }) // prettier-ignore

async function cobrarEnEfectivo(page: Page, recibido: string): Promise<void> {
  await ticket(page)
    .getByRole('button', { name: /^Cobrar/ })
    .click()
  const cobro = page.getByRole('dialog')
  await cobro.getByLabel(/^recibido/i).fill(recibido)
  await page.waitForTimeout(400)
  await cobro.getByRole('button', { name: /^Confirmar venta/ }).click()
  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------

test.describe('La caja, guiada', () => {
  test('10. cerrar la caja: contar, ver que cuadra y confirmar', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja/cerrar')

    // 1 · El turno: los cuatro renglones y lo que tiene que haber.
    await expect(page.getByRole('heading', { name: 'Cerrar la caja' })).toBeVisible()
    await expect(page.getByText('Empezó con')).toBeVisible()
    await expect(page.getByText('Egresos', { exact: true })).toBeVisible()
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

  test('registrar un ingreso y un egreso mueve lo que tiene que haber, exacto', async ({
    page,
  }) => {
    // UX V5: dos botones con verbo, sin elegir "tipo" adentro.
    await entrar(page, 'encargado')
    await page.goto('/caja')
    await expect(page.getByText('CAJA ABIERTA')).toBeVisible()

    const tieneQueHaber = async (): Promise<number> =>
      leerMonto(
        await page
          .getByText('Tiene que haber en el cajón')
          .locator('..')
          .getByText(/^\$/)
          .first()
          .innerText(),
      )
    const antes = await tieneQueHaber()

    await page.getByRole('button', { name: 'Registrar ingreso' }).click()
    let dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe').fill('1500')
    await dialogo.getByLabel('Motivo').fill('Cambio que trajo el dueño')
    await dialogo.getByRole('button', { name: 'Registrar ingreso' }).click()
    await expect(page.getByText('Ingreso registrado.')).toBeVisible({ timeout: 15_000 })
    await expect.poll(tieneQueHaber).toBe(antes + 1500)

    await page.getByRole('button', { name: 'Registrar egreso' }).click()
    dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe').fill('500')
    await dialogo.getByLabel('Motivo').fill('Pago al panadero')
    await dialogo.getByRole('button', { name: 'Registrar egreso' }).click()
    await expect(page.getByText('Egreso registrado.')).toBeVisible({ timeout: 15_000 })
    await expect.poll(tieneQueHaber).toBe(antes + 1000)

    // Y en los movimientos, el egreso dice lo que es, con palabra y signo.
    const fila = page.getByRole('row').filter({ hasText: 'Pago al panadero' }).first()
    await expect(fila).toContainText('Egreso')
    await expect(fila).toContainText('−$')
  })

  test('una venta en efectivo sube lo que tiene que haber y las ventas de hoy; contar cuadra', async ({
    page,
  }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')
    await expect(page.getByText('CAJA ABIERTA')).toBeVisible()
    // Las cuatro acciones, a la vista.
    for (const accion of ['Registrar ingreso', 'Registrar egreso', 'Contar caja']) {
      await expect(page.getByRole('button', { name: accion })).toBeVisible()
    }
    await expect(page.getByRole('link', { name: 'Cerrar caja' })).toBeVisible()

    const tieneQueHaber = async (): Promise<number> =>
      leerMonto(
        await page
          .getByText('Tiene que haber en el cajón')
          .locator('..')
          .getByText(/^\$/)
          .first()
          .innerText(),
      )
    const antes = await tieneQueHaber()
    const ventasAntes = await leerMetrica(page, 'Ventas de hoy')

    // Una venta con lo justo, solo con el teclado (V6): carrito, cobro,
    // Efectivo, Recibido vacio = justo, Confirmar. Cada Enter avanza un paso,
    // y entre dos Enter tiene que pasar la pausa entre etapas.
    await page.goto('/venta')
    await expect(campo(page)).toBeFocused()
    await escanear(page, PRODUCTOS.yerba.codigo)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog').getByRole('radio', { name: 'Efectivo' })).toBeFocused()
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /^confirmar venta/i }),
    ).toBeFocused()
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Venta registrada/).first()).toBeVisible({ timeout: 15_000 })

    await page.goto('/caja')
    await expect.poll(tieneQueHaber).toBe(antes + PRODUCTOS.yerba.precio)
    await expect
      .poll(() => leerMetrica(page, 'Ventas de hoy'))
      .toBe(ventasAntes + PRODUCTOS.yerba.precio)

    // Contar la caja con lo que tiene que haber: cuadra.
    const esperado = await tieneQueHaber()
    await page.getByRole('button', { name: 'Contar caja' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Efectivo contado').fill(String(esperado))
    await dialogo.getByRole('button', { name: 'Guardar conteo' }).click()
    await expect(dialogo).toBeHidden({ timeout: 15_000 })
    // La diferencia del conteo, arriba y sin abrir nada; y en los ultimos conteos.
    await expect(page.locator('[data-diferencia-caja="cuadra"]')).toBeVisible()
    await expect(page.getByText('✓ Cuadró').first()).toBeVisible()
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
    await expect(fila(page, PRODUCTOS.yerba.nombre)).toBeVisible()
    // Cada fila dice lo que hace falta para vender: nombre, estado y precio.
    // La categoria solo aparece desde 1536 px, y esto corre en 1366.
    const primera = page.locator('[data-fila]').first()
    await expect(primera).toContainText('$')
    await expect(fila(page, PRODUCTOS.yerba.nombre)).toContainText('u.')
    // Y el ticket vacio dice que hacer, con "Cobrar" a la vista pero apagado.
    await expect(page.getByText('El carrito está vacío')).toBeVisible()
    await expect(ticket(page).getByRole('button', { name: /^Cobrar/ })).toBeDisabled()
  })

  test('9. elegir un producto de la lista visible, tocando', async ({ page }) => {
    await page.getByRole('button', { name: 'Bebidas' }).click()
    await fila(page, PRODUCTOS.gaseosa.nombre).click()

    await expect(ticket(page).getByText(PRODUCTOS.gaseosa.nombre, { exact: true })).toBeVisible()
    // El foco vuelve al lector: el proximo codigo cae donde tiene que caer.
    await expect(campo(page)).toBeFocused()
  })

  test('elegir una categoria deja en la lista solo lo de esa categoria', async ({ page }) => {
    await page.getByRole('button', { name: 'Bebidas' }).click()
    await expect(fila(page, PRODUCTOS.gaseosa.nombre)).toBeVisible()
    await expect(fila(page, PRODUCTOS.yerba.nombre)).toBeHidden()

    // "Todos" la trae de vuelta.
    await page.getByRole('button', { name: 'Todos' }).click()
    await expect(fila(page, PRODUCTOS.yerba.nombre)).toBeVisible()
  })

  test('9. elegir un producto de la lista visible, con el teclado', async ({ page }) => {
    // ↓ elige una fila SIN mover el foco: el lector tiene que seguir
    // funcionando mientras se recorre la lista (V3). ↑ ↓ la recorren y →
    // agrega (V6).
    await page.getByRole('button', { name: 'Todos' }).click()
    await campo(page).click()
    await expect(campo(page)).toBeFocused()
    // Las filas, no cualquier boton: cada fila lleva ademas su estrella.
    await expect(page.locator('[data-fila]').first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    const filas = page.locator('[data-fila]')
    await expect(filas.first()).toHaveAttribute('data-elegida')
    await expect(campo(page)).toBeFocused()

    await page.keyboard.press('ArrowDown')
    const segunda = filas.nth(1)
    await expect(segunda).toHaveAttribute('data-elegida')
    const nombre = (await segunda.getAttribute('aria-label'))?.split(', ')[0] ?? ''
    await page.keyboard.press('ArrowRight')
    await expect(ticket(page).getByText(nombre, { exact: true })).toBeVisible()

    // Y el foco nunca se fue del campo.
    await expect(campo(page)).toBeFocused()
  })

  test('9b. Tab tambien entra a la lista, y ahi el foco es real', async ({ page }) => {
    // El camino de quien usa lector de pantalla: Tab entra, ↑ ↓ mueven el
    // foco de verdad, → agrega y Escape vuelve al lector.
    await page.getByRole('button', { name: 'Todos' }).click()
    const primera = page.locator('[data-fila]').first()
    await expect(primera).toBeVisible()
    await primera.focus()
    await page.keyboard.press('ArrowDown')
    const segunda = page.locator('[data-fila]').nth(1)
    await expect(segunda).toBeFocused()
    const nombre = (await segunda.getAttribute('aria-label'))?.split(', ')[0] ?? ''
    await page.keyboard.press('ArrowRight')
    await expect(ticket(page).getByText(nombre, { exact: true })).toBeVisible()
    await expect(segunda).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(campo(page)).toBeFocused()
  })

  test('buscar por nombre filtra la misma lista, y → agrega', async ({ page }) => {
    await campo(page).fill('yerba')
    await expect(page.getByRole('group', { name: 'Resultados de la búsqueda' })).toBeVisible()
    await campo(page).press('ArrowRight')
    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
    // La busqueda queda: se puede seguir sumando con →. Esc la limpia.
    await expect(campo(page)).toHaveValue('yerba')
    await campo(page).press('Escape')
    await expect(campo(page)).toHaveValue('')
  })

  test('8 y 3. escanear y cobrar en efectivo, con el vuelto a la vista', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)
    await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

    await ticket(page)
      .getByRole('button', { name: /^Cobrar/ })
      .click()
    const cobro = page.getByRole('dialog')
    await expect(cobro.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    await cobro.getByLabel(/^recibido/i).fill('20000')
    const total = PRODUCTOS.yerba.precio + PRODUCTOS.leche.precio
    const vuelto = String(20000 - total).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    await expect(cobro.getByText(new RegExp(vuelto))).toBeVisible()

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Confirmar venta/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/vuelto/i).first()).toBeVisible()

    // Nueva venta: el lector recupera el foco y el ticket queda vacio.
    await terminarVenta(page)
    await expect(campo(page)).toBeFocused()
    await expect(page.getByText('El carrito está vacío')).toBeVisible()
  })

  test('4. cobrar por transferencia: un toque y confirmar', async ({ page }) => {
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await ticket(page)
      .getByRole('button', { name: /^Cobrar/ })
      .click()
    const cobro = page.getByRole('dialog')

    await cobro.getByRole('radio', { name: 'Transferencia' }).click()
    await expect(cobro.getByText(/no entra al cajón/i)).toBeVisible()
    await expect(cobro.getByLabel(/^recibido/i)).toHaveCount(0)

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Confirmar venta/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  })

  test('5. cobrar combinado: lo cargado y lo que falta, siempre a la vista', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.gaseosa.codigo)
    await ticket(page)
      .getByRole('button', { name: /^Cobrar/ })
      .click()
    const cobro = page.getByRole('dialog')

    // V5: dividir el pago esta en "Más opciones".
    await cobro.getByRole('button', { name: /más opciones/i }).click()
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
    await cobro.getByRole('button', { name: /^Confirmar venta/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
  })

  test('6. un producto pesado pide el peso y lo muestra en kilos', async ({ page }) => {
    await escanear(page, PRODUCTOS.queso.codigo)
    await page.getByLabel(/^Peso$/).fill('0,5')
    await page.getByRole('button', { name: 'Agregar' }).click()
    await expect(
      ticket(page).getByRole('spinbutton', { name: /cantidad de queso/i }),
    ).toHaveAttribute('aria-valuetext', '0,500 kg')
    await cobrarEnEfectivo(page, '10000')
  })

  test('7. sacar una linea del ticket', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)

    // V5: cada linea tiene su "Quitar" a la vista, sin elegirla antes.
    await ticket(page)
      .getByRole('button', { name: `Quitar ${PRODUCTOS.yerba.nombre}` })
      .click()
    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toHaveCount(0)
    await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()

    // Sin la ultima, el ticket vuelve a estar vacio y "Cobrar" se apaga.
    await ticket(page)
      .getByRole('button', { name: `Quitar ${PRODUCTOS.leche.nombre}` })
      .click()
    await expect(page.getByText('El carrito está vacío')).toBeVisible()
    await expect(ticket(page).getByRole('button', { name: /^Cobrar/ })).toBeDisabled()
  })

  test('caso: un producto agotado se ve, se explica y no entra', async ({ page }) => {
    await escanear(page, PRODUCTOS.agotado.codigo)
    await expect(page.getByRole('status').first()).toContainText('agotado')
    await expect(page.getByText('El carrito está vacío')).toBeVisible()

    // En la lista tambien: la fila esta, apagada, y dice por que.
    await campo(page).fill('helado')
    const agotada = page
      .getByRole('group', { name: 'Resultados de la búsqueda' })
      .getByRole('button', { name: /^Helado 1 L, sin stock$/ })
    await expect(agotada).toBeDisabled()
  })

  test('caso: pedir mas de lo que hay se acota y se avisa', async ({ page }) => {
    await escanear(page, PRODUCTOS.leche.codigo)
    await ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true }).click()
    const cantidad = ticket(page).getByRole('spinbutton')
    await cantidad.fill('999')
    await cantidad.press('Tab')
    await expect(ticket(page).getByText(/no hay más stock/)).toBeVisible()
    const tope = Number(await cantidad.getAttribute('aria-valuemax'))
    expect(tope).toBeGreaterThan(0)
    expect(Number(await cantidad.getAttribute('aria-valuenow'))).toBe(tope)
  })
})
