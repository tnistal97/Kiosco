import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, leerMonto, salir } from './ayudantes'

/**
 * El libro de inventario, de punta a punta.
 *
 * El recorrido completo: abrir el turno, vender, comprobar que el movimiento
 * quedo escrito, anular, comprobar el inverso, ajustar, registrar una perdida
 * y ver la alerta de stock bajo.
 *
 * Todo contra PostgreSQL descartable: `e2e/seed.setup.ts` vuelve a sembrar la
 * base antes de cada corrida.
 */

/** Fila del historial correspondiente a un producto y un tipo. */
function filaDe(page: Page, producto: string, tipo: string) {
  return page.getByRole('row').filter({ hasText: producto }).filter({ hasText: tipo }).first()
}

async function irAMovimientos(page: Page, filtroProducto?: string) {
  await page.goto('/stock/movimientos')
  await expect(page.getByText(/este libro no se edita/i)).toBeVisible()
  if (filtroProducto) {
    await page.getByRole('searchbox', { name: /buscar producto/i }).fill(filtroProducto)
    // El campo espera antes de consultar; sin esta pausa se lee la tabla vieja.
    await page.waitForTimeout(900)
  }
}

/** Stock que muestra la pantalla de inventario para un producto. */
async function stockEnPantalla(page: Page, nombre: string): Promise<number> {
  await page.goto('/stock')
  await page.getByRole('searchbox', { name: /buscar productos/i }).fill(nombre)
  await page.waitForTimeout(900)

  const fila = page.getByRole('row').filter({ hasText: nombre }).first()
  const texto = await fila.getByText(/en stock|quedan|agotado/i).innerText()
  if (/agotado/i.test(texto)) return 0
  return Number(/(\d+)/.exec(texto)?.[1] ?? '-1')
}

test.describe('Una venta deja su rastro y la anulacion lo revierte', () => {
  test('vender, ver el SALE, anular, ver el SALE_CANCEL', async ({ page }) => {
    // 1) Abrir la caja. El seed ya deja el turno abierto, asi que lo que se
    //    comprueba aca es que la venta pueda ocurrir: sin turno, no se vende.
    await entrar(page, 'cajero')
    await page.goto('/caja')
    await expect(page.getByText(/caja abierta por/i).first()).toBeVisible()

    // 2) Vender dos unidades de yerba.
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.yerba.codigo)

    await page.keyboard.press('F12')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cobrar/i })
      .click()
    await expect(page.getByText('Venta registrada')).toBeVisible()

    const numero = (await page.getByText(/^#\d+$/).innerText()).replace('#', '')
    await page.getByRole('button', { name: 'Nueva venta' }).click()
    await salir(page)

    // 3) El movimiento de venta esta en el libro, con los dos saldos.
    await entrar(page, 'encargado')
    await irAMovimientos(page, PRODUCTOS.yerba.nombre)

    const venta = filaDe(page, PRODUCTOS.yerba.nombre, 'Venta')
    await expect(venta).toBeVisible()
    await expect(venta.getByText('−2')).toBeVisible()
    await expect(
      venta.getByRole('link', { name: `Venta #${numero}` }),
      'el movimiento tiene que decir DE QUE venta salio',
    ).toBeVisible()

    // 4) Anular esa venta.
    await page.goto('/ventas')
    await page.getByLabel('N° de venta').fill(numero)
    await page.waitForTimeout(1200)

    const fila = page.getByRole('row', { name: new RegExp(`#${numero}\\b`) })
    await fila.getByRole('button', { name: 'Anular' }).click()

    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/motivo/i).fill('Se llevó el producto equivocado')
    await dialogo.getByRole('button', { name: /anular la venta/i }).click()
    await expect(page.getByText(/venta anulada/i)).toBeVisible()

    // 5) El inverso aparece, y el original SIGUE ahi.
    await irAMovimientos(page, PRODUCTOS.yerba.nombre)

    const anulacion = filaDe(page, PRODUCTOS.yerba.nombre, 'Anulación de venta')
    await expect(anulacion).toBeVisible()
    await expect(anulacion.getByText('+2')).toBeVisible()
    await expect(anulacion.getByText(/se llevó el producto equivocado/i)).toBeVisible()

    await expect(
      filaDe(page, PRODUCTOS.yerba.nombre, 'Venta'),
      'la anulacion no puede borrar ni editar el movimiento original',
    ).toBeVisible()
  })
})

test.describe('Ajustes y perdidas', () => {
  test('un ajuste queda en el historial con su motivo y sus dos saldos', async ({ page }) => {
    await entrar(page, 'encargado')

    const antes = await stockEnPantalla(page, PRODUCTOS.leche.nombre)
    expect(antes).toBeGreaterThan(0)

    const fila = page.getByRole('row').filter({ hasText: PRODUCTOS.leche.nombre }).first()
    await fila.getByRole('button', { name: 'Ajustar' }).click()

    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/qué pasó/i).selectOption('MANUAL_ADJUSTMENT')
    await dialogo.getByLabel(/^cantidad en /i).fill('12')
    await dialogo.getByLabel('Motivo').fill('Entrada de mercadería del jueves')
    await dialogo.getByRole('button', { name: /guardar ajuste/i }).click()

    await expect(page.getByText(/libro de inventario/i)).toBeVisible()

    // El stock subió exactamente lo ajustado.
    expect(await stockEnPantalla(page, PRODUCTOS.leche.nombre)).toBe(antes + 12)

    // Y el movimiento lo cuenta entero.
    await irAMovimientos(page, PRODUCTOS.leche.nombre)
    const ajuste = filaDe(page, PRODUCTOS.leche.nombre, 'Ajuste')
    await expect(ajuste).toBeVisible()
    await expect(ajuste.getByText('+12')).toBeVisible()
    // Los dos saldos, con su unidad. Desde la Fase 3B la fila los muestra
    // formateados --"30 u."-- y no como numero pelado.
    await expect(ajuste).toContainText(String(antes))
    await expect(ajuste).toContainText(String(antes + 12))
    await expect(ajuste.getByText(/entrada de mercadería del jueves/i)).toBeVisible()
  })

  test('una rotura se carga en positivo y descuenta stock', async ({ page }) => {
    await entrar(page, 'encargado')

    const antes = await stockEnPantalla(page, PRODUCTOS.gaseosa.nombre)
    expect(antes).toBeGreaterThan(3)

    const fila = page.getByRole('row').filter({ hasText: PRODUCTOS.gaseosa.nombre }).first()
    await fila.getByRole('button', { name: 'Ajustar' }).click()

    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/qué pasó/i).selectOption('BREAKAGE')

    // En el mostrador nadie dice "se rompieron menos tres": se escribe 3 y el
    // diálogo manda −3.
    await dialogo.getByLabel(/^cuánto sale/i).fill('3')
    await dialogo.getByLabel('Motivo').fill('Se cayó el cajón al descargar')
    await expect(dialogo.getByText(new RegExp(`va a quedar en\\s*${String(antes - 3)}`, 'i'))).toBeVisible() // prettier-ignore
    await dialogo.getByRole('button', { name: /guardar ajuste/i }).click()

    expect(await stockEnPantalla(page, PRODUCTOS.gaseosa.nombre)).toBe(antes - 3)

    await irAMovimientos(page, PRODUCTOS.gaseosa.nombre)
    const rotura = filaDe(page, PRODUCTOS.gaseosa.nombre, 'Rotura')
    await expect(rotura).toBeVisible()
    await expect(rotura.getByText('−3')).toBeVisible()
  })

  test('no se puede sacar mas de lo que hay', async ({ page }) => {
    await entrar(page, 'encargado')

    const antes = await stockEnPantalla(page, PRODUCTOS.leche.nombre)
    const fila = page.getByRole('row').filter({ hasText: PRODUCTOS.leche.nombre }).first()
    await fila.getByRole('button', { name: 'Ajustar' }).click()

    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/qué pasó/i).selectOption('LOSS')
    await dialogo.getByLabel(/^cuánto sale/i).fill(String(antes + 50))
    await dialogo.getByLabel('Motivo').fill('Intento imposible')

    await expect(dialogo.getByText(/no alcanza/i)).toBeVisible()
    await expect(dialogo.getByRole('button', { name: /guardar ajuste/i })).toBeDisabled()
  })
})

test.describe('El libro no se toca', () => {
  test('no hay forma de editar ni borrar un movimiento desde la pantalla', async ({ page }) => {
    await entrar(page, 'encargado')
    await irAMovimientos(page)

    await expect(page.getByRole('button', { name: /^editar/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^eliminar/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^borrar/i })).toHaveCount(0)
    await expect(page.getByText(/este libro no se edita/i)).toBeVisible()
  })

  test('el cajero no llega al historial', async ({ page }) => {
    await entrar(page, 'cajero')

    // No esta en el menu...
    await expect(page.getByRole('link', { name: 'Movimientos' })).toHaveCount(0)

    // ...y entrando a mano tampoco.
    await page.goto('/stock/movimientos')
    await expect(page.getByText(/no tenés acceso al historial/i)).toBeVisible()
  })
})

test.describe('Filtros y paginacion del historial', () => {
  test('filtra por tipo y por producto', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/stock/movimientos')

    // El seed deja ventas y saldos iniciales: los dos tipos tienen filas.
    await page.getByLabel('Tipo').selectOption('SALE')
    await page.waitForTimeout(900)
    await expect(page.getByRole('row').filter({ hasText: 'Venta' }).first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Saldo inicial' })).toHaveCount(0)

    await page.getByLabel('Tipo').selectOption('INITIAL')
    await page.waitForTimeout(900)
    await expect(page.getByRole('row').filter({ hasText: 'Saldo inicial' }).first()).toBeVisible()

    // Un producto que no existe deja la tabla vacia, con explicacion.
    await page.getByLabel('Tipo').selectOption('')
    await page.getByRole('searchbox', { name: /buscar producto/i }).fill('NoExisteEsteProducto')
    await page.waitForTimeout(900)
    await expect(page.getByText(/nada con esos filtros/i)).toBeVisible()
  })

  test('el historial se pagina', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/stock/movimientos')
    await page.waitForTimeout(900)

    // El seed deja mas de 25 movimientos: 41 saldos iniciales y 30 de ventas.
    await expect(page.getByRole('navigation', { name: /paginacion/i })).toBeVisible()

    const primeraFila = page.getByRole('row').nth(1)
    const textoPrimera = await primeraFila.innerText()

    await page.getByRole('button', { name: /siguiente/i }).click()
    await page.waitForTimeout(900)

    expect(await page.getByRole('row').nth(1).innerText()).not.toBe(textoPrimera)
  })
})

test.describe('Alertas de reposicion', () => {
  test('el panel y el inventario cuentan lo mismo', async ({ page }) => {
    await entrar(page, 'encargado')

    // El seed deja productos agotados y productos bajo minimo.
    await page.goto('/')
    const faltantes = page.getByText('Faltantes', { exact: true }).locator('../..')
    await expect(faltantes).toBeVisible()
    await expect(faltantes.getByText(/agotados/i)).toBeVisible()
    await expect(faltantes.getByText(/bajo mínimo/i)).toBeVisible()

    // El filtro del inventario muestra exactamente esos.
    await page.goto('/stock')
    await page.getByLabel('Filtro de stock').selectOption('bajos')
    await page.waitForTimeout(900)

    const filas = page.getByRole('row').filter({ hasText: /mín\./ })
    expect(await filas.count(), 'el filtro de bajo minimo no devolvio nada').toBeGreaterThan(0)

    await page.getByLabel('Filtro de stock').selectOption('agotados')
    await page.waitForTimeout(900)
    await expect(page.getByText('Agotado').first()).toBeVisible()
  })

  test('vender hasta el minimo enciende la alerta', async ({ page }) => {
    await entrar(page, 'encargado')

    // Se le pone un minimo alto a la leche para poder cruzarlo vendiendo poco.
    await page.goto('/productos')
    await page.getByRole('searchbox').first().fill(PRODUCTOS.leche.nombre)
    await page.waitForTimeout(900)

    const fila = page.getByRole('row').filter({ hasText: PRODUCTOS.leche.nombre }).first()
    await fila.locator('button[aria-expanded]').first().click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()

    // El stock ya no es un campo de la ficha: se lee de la seccion Inventario,
    // que desde la Fase 3B es de solo lectura. Mover inventario se hace con el
    // boton "Ajustar", que pide motivo y deja fila en el libro.
    const ficha = page.getByRole('dialog')
    const stockActual = leerMonto(
      (
        await ficha
          .getByText(/^\d+([.,]\d+)? u\.$/)
          .first()
          .innerText()
      ).replace(' u.', ''),
    )
    await ficha.getByLabel(/mínimo de reposición/i).fill(String(stockActual))
    await expect(ficha.getByText(/ya está bajo mínimo/i)).toBeVisible()
    await ficha.getByRole('button', { name: 'Guardar cambios' }).click()
    await page.waitForTimeout(1200)

    // Ahora el inventario lo marca.
    await page.goto('/stock')
    await page.getByLabel('Filtro de stock').selectOption('bajos')
    await page.waitForTimeout(900)
    await expect(
      page.getByRole('row').filter({ hasText: PRODUCTOS.leche.nombre }).first(),
    ).toBeVisible()
  })
})
