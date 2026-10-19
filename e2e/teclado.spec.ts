import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, leerMonto, totalDelTicket } from './ayudantes'

/**
 * La venta sin mouse. Teclado V6.
 *
 * La venta tiene tres etapas y el teclado sabe siempre en cual esta:
 *
 *   1. Productos  ↑ ↓ eligen · → suma una · ← resta una · Enter continua ·
 *                 Esc limpia · escribir busca (aunque el foco este en otro lado)
 *   2. Carrito    ↑ ↓ eligen linea · → +1 · ← −1 · Enter cobra · Esc vuelve
 *   3. Cobro      ← → forma de pago · Enter avanza un paso · Esc vuelve
 *
 * El lector (CODIGO + Enter) agrega una unidad y NO cambia de etapa. Un Enter
 * sostenido no se repite, y dos Enter mas pegados que la pausa entre etapas
 * avanzan una sola.
 *
 * Los "casos" son los diecinueve que pidio el dueño para esta version; el
 * ultimo bloque es la venta entera, de punta a punta, solo con el teclado.
 * Ningun `click` salvo donde se prueba justamente que el foco quedo en otro
 * lado.
 */

/** Mas que la pausa entre etapas (300 ms): el Enter siguiente es deliberado. */
const PAUSA = 400

const campo = (page: Page) => page.locator('[data-barcode-input]')
const carrito = (page: Page) => page.getByRole('region', { name: 'Carrito' })
const lineaElegida = (page: Page) => carrito(page).locator('li[aria-current="true"]')
const cantidad = (page: Page, nombre: string) =>
  carrito(page).getByRole('spinbutton', { name: new RegExp(`cantidad de ${nombre}`, 'i') })
const filas = (page: Page) => page.locator('[data-fila]')
const filaElegida = (page: Page) => page.locator('[data-fila][data-elegida]')
const cobro = (page: Page) => page.getByRole('dialog')
const carritoVacio = (page: Page) => page.getByText('El carrito está vacío').first()

/** La etapa que marca la guia de arriba: productos, carrito o cobro. */
async function enEtapa(page: Page, etapa: 'productos' | 'carrito' | 'cobro'): Promise<void> {
  await expect(page.locator('[data-guia-de-teclado]')).toHaveAttribute('data-etapa', etapa)
}

/** Escribe un codigo como lo haria un lector USB: rapido, digitos y Enter. */
async function lector(page: Page, codigo: string): Promise<void> {
  await page.keyboard.type(codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
}

/** Escribe como una persona y espera a que la lista muestre lo buscado. */
async function buscar(page: Page, texto: string, primera: string): Promise<void> {
  await page.keyboard.type(texto, { delay: 40 })
  await expect(campo(page)).toHaveValue(texto)
  await expect(filas(page).first()).toContainText(primera)
}

/** Enter en productos: al carrito. Despues, la pausa para el Enter siguiente. */
async function alCarrito(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  await enEtapa(page, 'carrito')
  await page.waitForTimeout(PAUSA)
}

/** Enter en el carrito: el cobro, con el foco en la forma de pago. */
async function alCobro(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  await expect(cobro(page).getByRole('radio', { name: 'Efectivo' })).toBeFocused()
  await page.waitForTimeout(PAUSA)
}

/** Un EAN-13 valido (digito verificador correcto) que no esta en el seed. */
function codigoInexistente(): string {
  const base = '779999999999'
  let suma = 0
  for (let i = base.length - 1, peso = 3; i >= 0; i--, peso = 4 - peso) {
    suma += Number(base[i]) * peso
  }
  return base + String((10 - (suma % 10)) % 10)
}

test.beforeEach(async ({ page }) => {
  await entrar(page, 'cajero')
  await page.goto('/venta')
  await expect(campo(page)).toBeFocused()
  await enEtapa(page, 'productos')
})

test.describe('Etapa 1: productos', () => {
  test('caso 1: escribir busca, sin tocar el buscador', async ({ page }) => {
    // Letra por letra, como una persona.
    for (const letra of ['c', 'o', 'c', 'a']) await page.keyboard.press(letra)
    await expect(campo(page)).toHaveValue('coca')
    // En el seed no hay ninguna coca: la lista lo dice en vez de mostrar todo.
    await expect(page.getByText('Ningún producto coincide')).toBeVisible()

    await page.keyboard.press('Escape')
    for (const letra of ['c', 'o', 'l', 'a']) await page.keyboard.press(letra)
    await expect(campo(page)).toHaveValue('cola')
    await expect(filas(page)).toHaveCount(1)
    await expect(filas(page).first()).toContainText(PRODUCTOS.gaseosa.nombre)
  })

  test('caso 15: una letra con el foco en la lista va al buscador', async ({ page }) => {
    const primera = filas(page).first()
    await primera.focus()
    await expect(campo(page)).not.toBeFocused()

    await page.keyboard.press('l')
    await page.keyboard.press('e')
    await expect(campo(page)).toBeFocused()
    await expect(campo(page)).toHaveValue('le')
    await expect(page.getByRole('group', { name: 'Resultados de la búsqueda' })).toBeVisible()
  })

  test('caso 2: ↑ ↓ solo cambian el producto elegido', async ({ page }) => {
    await buscar(page, 'gaseosa', 'Gaseosa cola')
    // Escribiendo, el primer resultado queda elegido solo.
    await expect(filaElegida(page)).toContainText('Gaseosa cola')

    await page.keyboard.press('ArrowDown')
    await expect(filaElegida(page)).toContainText('Gaseosa lima limon')
    await page.keyboard.press('ArrowUp')
    await expect(filaElegida(page)).toContainText('Gaseosa cola')

    // Ninguna cantidad cambio y la etapa sigue siendo productos.
    await expect(carritoVacio(page)).toBeVisible()
    await enEtapa(page, 'productos')
    await expect(campo(page)).toHaveValue('gaseosa')
  })

  test('casos 3 a 6: → suma exactamente una, ← resta una, nunca negativo', async ({ page }) => {
    await buscar(page, 'yerba', PRODUCTOS.yerba.nombre)

    // Caso 3: → agrega UNA.
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    // Caso 4: → → → desde cero son tres.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('3')
    // Y la fila lo dice, sin mirar el otro panel.
    await expect(filaElegida(page).locator('[data-en-carrito]')).toHaveText('3 u.')

    // Caso 5: ← resta UNA.
    await page.keyboard.press('ArrowLeft')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')

    // Caso 6: ← hasta cero quita la linea; despues no hace nada. Nunca negativo.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(carritoVacio(page)).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(carritoVacio(page)).toBeVisible()
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveCount(0)

    // Las flechas horizontales nunca movieron la seleccion ni la busqueda.
    await expect(filaElegida(page)).toContainText(PRODUCTOS.yerba.nombre)
    await expect(campo(page)).toHaveValue('yerba')
  })

  test('caso 7: Enter pasa al carrito y no cambia cantidades', async ({ page }) => {
    await buscar(page, 'yerba', PRODUCTOS.yerba.nombre)
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    const antes = await totalDelTicket(page)

    await page.keyboard.press('Enter')
    await enEtapa(page, 'carrito')
    await expect(page.locator('[aria-current="step"]')).toContainText('Carrito')
    await expect(page.getByText(/Revisá el carrito/)).toBeVisible()
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    expect(await totalDelTicket(page)).toBe(antes)
    // Pasar al carrito limpia la busqueda: al volver se busca lo que sigue.
    await expect(campo(page)).toHaveValue('')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Enter con el carrito vacio no avanza: dice que agregar', async ({ page }) => {
    await page.keyboard.press('Enter')
    await enEtapa(page, 'productos')
    // El renglon de las secciones lo dice (el ultimo: el primero es el
    // anuncio para el lector de pantalla).
    await expect(page.getByText(/agregalo con →/).last()).toBeVisible()
  })

  test('caso 16: Retroceso edita la busqueda y no toca el carrito', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await page.keyboard.type('gaseosaa', { delay: 40 })
    await page.keyboard.press('Backspace')
    await expect(campo(page)).toHaveValue('gaseosa')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    await enEtapa(page, 'productos')
  })

  test('Esc limpia la busqueda, sigue en productos y no borra el carrito', async ({ page }) => {
    await lector(page, PRODUCTOS.leche.codigo)
    await buscar(page, 'yer', PRODUCTOS.yerba.nombre)

    await page.keyboard.press('Escape')
    await expect(campo(page)).toHaveValue('')
    await enEtapa(page, 'productos')
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')

    // Sin busqueda, Esc tampoco borra nada.
    await page.keyboard.press('Escape')
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')
  })

  test('caso 18: → sostenido agrega UNA unidad, no veinte', async ({ page }) => {
    await buscar(page, 'yerba', PRODUCTOS.yerba.nombre)
    // `down` repetido sin `up` es la tecla apretada: el navegador marca las
    // siguientes como repeticion.
    for (let i = 0; i < 20; i++) await page.keyboard.down('ArrowRight')
    await page.keyboard.up('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  })

  test('un producto por peso: → abre el peso en vez de sumar "una"', async ({ page }) => {
    await buscar(page, 'queso', PRODUCTOS.queso.nombre)
    await page.keyboard.press('ArrowRight')

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await expect(dialogo.getByText(PRODUCTOS.queso.nombre)).toBeVisible()
    await page.keyboard.type('0,500')
    await page.keyboard.press('Enter')
    await expect(dialogo).not.toBeAttached()

    await expect(campo(page)).toBeFocused()
    await expect(cantidad(page, PRODUCTOS.queso.nombre)).toHaveAttribute(
      'aria-valuetext',
      '0,500 kg',
    )
  })

  test('+ y − con el foco fuera del buscador son → y ←', async ({ page }) => {
    // ↓ elige la primera fila del catalogo (ya cargado: se ve antes de
    // apretar); un clic en un lugar vacio saca el foco del buscador.
    await expect(filas(page).first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    const nombre = (await filaElegida(page).getAttribute('aria-label'))?.split(', ')[0] ?? ''
    await page.locator('main').focus()

    await page.keyboard.press('+')
    await expect(cantidad(page, nombre)).toHaveValue('1')
    await page.keyboard.press('+')
    await expect(cantidad(page, nombre)).toHaveValue('2')
    await page.keyboard.press('-')
    await expect(cantidad(page, nombre)).toHaveValue('1')
    // No se escribieron en el buscador.
    await expect(campo(page)).toHaveValue('')
  })

  test('despues de un escaneo no queda ningun producto elegido: → no suma otro distinto', async ({
    page,
  }) => {
    // Se elige un producto con ↓ y se lee OTRO con el lector. → no puede
    // sumar el que el cajero dejo de mirar.
    await expect(filas(page).first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(filaElegida(page)).toHaveCount(1)
    await lector(page, PRODUCTOS.yerba.codigo)
    await expect(filaElegida(page)).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await expect(carrito(page).locator('li')).toHaveCount(1)
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  })
})

test.describe('Etapa 2: carrito', () => {
  test('casos 8 y 9: ↑ ↓ eligen linea; → ← cambian esa cantidad de a una', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await lector(page, PRODUCTOS.leche.codigo)
    await lector(page, PRODUCTOS.gaseosa.codigo)
    await alCarrito(page)

    // Arranca en la ultima que entro.
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.gaseosa.nombre)

    // Caso 8: ↑ ↓ solo cambian la linea elegida.
    await page.keyboard.press('ArrowUp')
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.leche.nombre)
    await page.keyboard.press('ArrowUp')
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.yerba.nombre)
    await page.keyboard.press('ArrowDown')
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.leche.nombre)
    for (const p of [PRODUCTOS.yerba, PRODUCTOS.leche, PRODUCTOS.gaseosa]) {
      await expect(cantidad(page, p.nombre)).toHaveValue('1')
    }

    // Caso 9: → ← sobre la elegida, de a una.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('3')
    await page.keyboard.press('ArrowLeft')
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('2')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    expect(await totalDelTicket(page)).toBe(
      PRODUCTOS.yerba.precio + PRODUCTOS.leche.precio * 2 + PRODUCTOS.gaseosa.precio,
    )
    await enEtapa(page, 'carrito')
  })

  test('← hasta cero quita la linea, se puede deshacer, y sin lineas se vuelve a productos', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await alCarrito(page)
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')

    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(carritoVacio(page)).toBeVisible()
    await enEtapa(page, 'productos')

    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
  })

  test('casos 10, 11 y 12: Enter abre el cobro; Esc vuelve al carrito y despues a productos', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    const antes = await totalDelTicket(page)
    await alCarrito(page)

    // Caso 10.
    await alCobro(page)
    await enEtapa(page, 'cobro')

    // Caso 11: Esc en el cobro vuelve al carrito, con la venta intacta.
    await page.keyboard.press('Escape')
    await expect(cobro(page)).not.toBeAttached()
    await enEtapa(page, 'carrito')
    await expect(page.getByText(/Revisá el carrito/)).toBeVisible()
    await expect(campo(page)).toBeFocused()

    // Caso 12: Esc en el carrito vuelve a productos. El carrito no se toca.
    await page.keyboard.press('Escape')
    await enEtapa(page, 'productos')
    await expect(page.getByText(/Revisá el carrito/)).toHaveCount(0)
    await expect(campo(page)).toBeFocused()
    expect(await totalDelTicket(page)).toBe(antes)
  })

  test('escribir mientras se revisa vuelve a productos y busca', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await alCarrito(page)
    await page.keyboard.type('lec', { delay: 40 })
    await enEtapa(page, 'productos')
    await expect(campo(page)).toHaveValue('lec')
    await expect(filas(page).first()).toContainText('leche')
  })

  test('Supr quita la linea elegida y el foco sigue en el buscador', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await lector(page, PRODUCTOS.leche.codigo)
    await alCarrito(page)
    await page.keyboard.press('ArrowUp')
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.yerba.nombre)
    await page.keyboard.press('Delete')

    await expect(carrito(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toHaveCount(0)
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.leche.nombre)
    await expect(campo(page)).toBeFocused()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  })
})

test.describe('El lector', () => {
  test('caso 13: CODIGO + Enter agrega una unidad y NO cambia de etapa', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    await enEtapa(page, 'productos')
    await expect(campo(page)).toHaveValue('')

    // Tambien revisando el carrito: se agrega y se sigue revisando.
    await alCarrito(page)
    await lector(page, PRODUCTOS.leche.codigo)
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')
    await enEtapa(page, 'carrito')
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.leche.nombre)
    await expect(cobro(page)).toHaveCount(0)
  })

  test('caso 14: dos lecturas son dos unidades', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await lector(page, PRODUCTOS.yerba.codigo)
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('2')
    await enEtapa(page, 'productos')
  })

  test('el Enter de mas de un lector no pasa al carrito', async ({ page }) => {
    // Hay lectores configurados para mandar CR y LF: dos Enter seguidos.
    await page.keyboard.type(PRODUCTOS.yerba.codigo, { delay: 5 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    await page.waitForTimeout(300)
    await enEtapa(page, 'productos')
  })

  test('con el foco en la lista', async ({ page }) => {
    await filas(page).nth(2).focus()
    await lector(page, PRODUCTOS.leche.codigo)
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')
    await enEtapa(page, 'productos')
    await expect(campo(page)).toHaveValue('')
  })

  test('con el foco en un boton', async ({ page }) => {
    // Despues de tocar una categoria o un boton del carrito, el foco queda
    // ahi: la lectura tiene que llegar igual.
    await page.getByRole('button', { name: 'Bebidas' }).first().click()
    await lector(page, PRODUCTOS.leche.codigo)
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('1')

    await carrito(page).getByRole('button', { name: 'Vaciar' }).focus()
    await lector(page, PRODUCTOS.leche.codigo)
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('2')
    await enEtapa(page, 'productos')
  })

  test('despues de escribir texto: lee el codigo y deja lo escrito', async ({ page }) => {
    await page.keyboard.type('coc', { delay: 120 })
    await page.waitForTimeout(300)
    await lector(page, PRODUCTOS.gaseosa.codigo)
    await expect(cantidad(page, PRODUCTOS.gaseosa.nombre)).toHaveValue('1')
    await expect(campo(page)).toHaveValue('coc')
    await enEtapa(page, 'productos')
  })

  test('despues de escribir numeros: no mezcla los dos codigos', async ({ page }) => {
    await page.keyboard.type('123', { delay: 120 })
    await page.waitForTimeout(400)
    await lector(page, PRODUCTOS.yerba.codigo)

    await expect(cantidad(page, PRODUCTOS.yerba.nombre)).toHaveValue('1')
    // Lo escrito a mano vuelve al campo, como estaba.
    await expect(campo(page)).toHaveValue('123')
  })

  test('un codigo que no existe: lo dice, no agrega y no cambia de etapa', async ({ page }) => {
    await lector(page, codigoInexistente())
    await expect(page.getByText('Código no registrado')).toBeVisible()
    await expect(carritoVacio(page)).toBeVisible()
    await enEtapa(page, 'productos')
  })
})

test.describe('Enter: una etapa por vez', () => {
  test('caso 17: Enter sostenido no avanza varias etapas ni confirma', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    for (let i = 0; i < 15; i++) await page.keyboard.down('Enter')
    await page.keyboard.up('Enter')
    await enEtapa(page, 'carrito')
    await expect(cobro(page)).toHaveCount(0)
    await expect(page.getByText(/Venta registrada/)).toHaveCount(0)
  })

  test('caso 19: un doble Enter rapido avanza UNA etapa, en cada paso', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)

    // Productos → carrito, y el segundo Enter no abre el cobro.
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await enEtapa(page, 'carrito')
    await expect(cobro(page)).toHaveCount(0)

    // Carrito → cobro, y el segundo Enter no elige la forma de pago.
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const efectivo = cobro(page).getByRole('radio', { name: 'Efectivo' })
    await expect(efectivo).toBeFocused()
    await page.waitForTimeout(100)
    await expect(efectivo).toBeFocused()

    // Forma de pago → Recibido, y el segundo Enter no pasa a Confirmar.
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const recibido = cobro(page).getByLabel(/^recibido/i)
    await expect(recibido).toBeFocused()
    await page.waitForTimeout(100)
    await expect(recibido).toBeFocused()
    await expect(recibido).toHaveValue('')

    // Ninguna venta.
    await expect(page.getByText(/Venta registrada/)).toHaveCount(0)
  })

  test('en el cobro, una letra elige la forma de pago y Enter avanza hasta confirmar', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.leche.codigo)
    await alCarrito(page)
    await alCobro(page)

    await page.keyboard.press('t')
    await expect(cobro(page).getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await expect(cobro(page).getByLabel(/^recibido/i)).toHaveCount(0)

    await page.keyboard.press('Enter')
    await expect(cobro(page).getByRole('button', { name: /^confirmar venta/i })).toBeFocused()
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    await expect(cobro(page)).not.toBeAttached({ timeout: 15_000 })
    await expect(page.getByText(/Venta registrada/).first()).toBeVisible()
  })
})

test.describe('La venta entera, solo con el teclado', () => {
  test('buscar, agregar, revisar, cobrar en efectivo con vuelto y empezar otra', async ({
    page,
  }) => {
    // 2-3. Escribir el nombre sin tocar el buscador; la lista se filtra.
    await buscar(page, 'gaseosa', 'Gaseosa cola')
    // 4-6. Moverse, sumar y restar.
    await page.keyboard.press('ArrowDown')
    await expect(filaElegida(page)).toContainText('Gaseosa lima limon')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(cantidad(page, 'Gaseosa lima limon 1.5 L')).toHaveValue('1')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.gaseosa.nombre)).toHaveValue('1')

    // 7. Varios productos: otra busqueda y una lectura.
    await page.keyboard.press('Escape')
    await buscar(page, 'yerba', PRODUCTOS.yerba.nombre)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await lector(page, PRODUCTOS.leche.codigo)
    await expect(carrito(page).locator('li')).toHaveCount(4)

    // 8-11. Al carrito: revisar y corregir.
    await alCarrito(page)
    await expect(lineaElegida(page)).toContainText(PRODUCTOS.leche.nombre)
    await page.keyboard.press('ArrowRight')
    await expect(cantidad(page, PRODUCTOS.leche.nombre)).toHaveValue('2')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(lineaElegida(page)).toContainText('Gaseosa lima limon')
    await page.keyboard.press('ArrowLeft')
    await expect(carrito(page).getByText('Gaseosa lima limon 1.5 L', { exact: true })).toHaveCount(0) // prettier-ignore
    const total = PRODUCTOS.gaseosa.precio + PRODUCTOS.yerba.precio + PRODUCTOS.leche.precio * 2
    expect(await totalDelTicket(page)).toBe(total)

    // 12-13. Cobro: forma de pago con las flechas, Enter la elige.
    await alCobro(page)
    await page.keyboard.press('ArrowRight')
    await expect(cobro(page).getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await page.keyboard.press('ArrowLeft')
    await expect(cobro(page).getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    await page.keyboard.press('Enter')
    const recibido = cobro(page).getByLabel(/^recibido/i)
    await expect(recibido).toBeFocused()

    // 14-15. Recibido y vuelto, ANTES de confirmar.
    await page.keyboard.type('20000')
    const vuelto = 20000 - total
    await expect(
      cobro(page).getByText(new RegExp(String(vuelto).replace(/\B(?=(\d{3})+(?!\d))/g, '\\.'))),
    ).toBeVisible()
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    const confirmar = cobro(page).getByRole('button', { name: /^confirmar venta/i })
    await expect(confirmar).toBeFocused()
    await expect(page.getByText('Venta registrada')).toHaveCount(0)

    // 16-17. Confirmar: la venta queda registrada y el vuelto se lee grande.
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
    const cifra = cobro(page).getByText(/^\$/).first()
    expect(leerMonto(await cifra.innerText())).toBe(vuelto)

    // 18. Enter: venta nueva, con el buscador listo.
    await page.waitForTimeout(PAUSA)
    await page.keyboard.press('Enter')
    await expect(campo(page)).toBeFocused()
    await expect(carritoVacio(page)).toBeVisible()
    await enEtapa(page, 'productos')
    await lector(page, PRODUCTOS.gaseosa.codigo)
    await expect(cantidad(page, PRODUCTOS.gaseosa.nombre)).toHaveValue('1')
  })
})

test.describe('Lo que no cambio', () => {
  test('los alias viejos siguen funcionando: F12 cobra, Ctrl+K enfoca, "/" lleva al campo', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)

    await carrito(page).getByRole('button', { name: 'Vaciar' }).focus()
    await page.keyboard.press('/')
    await expect(campo(page)).toBeFocused()
    await expect(campo(page)).toHaveValue('')

    await carrito(page).getByRole('button', { name: 'Vaciar' }).focus()
    await page.keyboard.press('Control+k')
    await expect(campo(page)).toBeFocused()

    await page.keyboard.press('F12')
    await expect(cobro(page)).toBeAttached()
    await expect(cobro(page).getByRole('button', { name: /^confirmar venta/i })).toBeVisible()
  })

  test('el TOTAL se ve grande y Cobrar entra sin desplazar', async ({ page }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await expect(carrito(page).getByText('TOTAL')).toBeVisible()
    expect(await totalDelTicket(page)).toBe(PRODUCTOS.yerba.precio)
    const cobrar = carrito(page).getByRole('button', { name: /^Cobrar/ })
    await expect(cobrar).not.toContainText('F12')
    await expect(cobrar).toBeInViewport()
  })

  test('la guia de etapas y teclas entra en un renglon en 1366 x 768', async ({ page }) => {
    const guia = page.locator('[data-guia-de-teclado]')
    await expect(guia).toBeVisible()
    await expect(guia).toContainText('Elegir producto')
    const alto = await guia.evaluate((el) => el.getBoundingClientRect().height)
    expect(alto, 'la ayuda de teclas se partio en dos renglones').toBeLessThan(36)
  })

  test('el cobro entero entra en 1366 x 768: "Confirmar venta" se ve sin desplazar', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await lector(page, PRODUCTOS.leche.codigo)
    await lector(page, PRODUCTOS.gaseosa.codigo)
    await alCarrito(page)
    await alCobro(page)

    const confirmar = cobro(page).getByRole('button', { name: /^confirmar venta/i })
    await expect(confirmar).toBeInViewport()
    await expect(cobro(page).getByText('VUELTO')).toBeInViewport()

    // Ni siquiera con el pago dividido, que es lo mas largo que tiene.
    await cobro(page)
      .getByRole('button', { name: /más opciones/i })
      .click()
    await cobro(page)
      .getByRole('button', { name: /dividir el pago/i })
      .click()
    await expect(confirmar).toBeInViewport()
  })

  test('hacer clic en el campo y escribir enseguida despues de cerrar un dialogo no pierde texto', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await alCarrito(page)
    await alCobro(page)
    await page.keyboard.press('Escape')

    await campo(page).click()
    await page.keyboard.type('gase')
    await page.waitForTimeout(700)
    await expect(campo(page)).toHaveValue('gase')
    await expect(page.getByRole('button', { name: /Gaseosa cola/ }).first()).toBeVisible()
  })

  test('Tab desde la cantidad de una linea sigue por el carrito, no vuelve al campo', async ({
    page,
  }) => {
    await lector(page, PRODUCTOS.yerba.codigo)
    await cantidad(page, PRODUCTOS.yerba.nombre).focus()
    await page.keyboard.press('Tab')
    await page.waitForTimeout(100)

    await expect(campo(page)).not.toBeFocused()
    const enElCarrito = await carrito(page).evaluate((el) => el.contains(document.activeElement))
    expect(enElCarrito).toBe(true)
  })
})
