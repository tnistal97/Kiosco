import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear, totalDelTicket } from './ayudantes'

/**
 * Lo que la Fase 3B agrega, de punta a punta y contra el navegador.
 *
 * Tres historias completas, cada una con su comprobacion:
 *
 *   1. un producto que se cuenta y uno que se pesa, desde el alta hasta la
 *      anulacion, comprobando que 0,500 kg vuelvan como 0,500 kg;
 *   2. el costo, que se cambia con motivo, queda en la actividad del producto
 *      y NO lo ve --ni le llega-- quien no tiene el permiso;
 *   3. el lector, que encuentra el mismo producto con el codigo principal y
 *      con un alternativo.
 */

/**
 * El titulo del dialogo abierto.
 *
 * `getByRole('dialog')` devuelve el envoltorio de Headless UI, que es un `div`
 * de tamano cero: Playwright lo considera oculto aunque el dialogo se vea
 * perfectamente. Para afirmar que esta abierto hay que mirar adentro.
 */
function tituloDelDialogo(page: Page) {
  return page.getByRole('dialog').getByRole('heading').first()
}

function filaCon(page: Page, texto: string) {
  return page.getByRole('row').filter({ hasText: texto }).first()
}

async function buscar(page: Page, texto: string): Promise<void> {
  await page.getByRole('searchbox').first().fill(texto)
  await page.waitForTimeout(900)
}

/** Abre la ficha de un producto desde el menu de su fila. */
async function abrirFicha(page: Page, nombre: string) {
  await page.goto('/productos')
  await buscar(page, nombre)
  await filaCon(page, nombre).locator('button[aria-expanded]').first().click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  await tituloDelDialogo(page).waitFor()
  return page.getByRole('dialog')
}

test.describe('Un producto que se cuenta', () => {
  test('se crea con su unidad y el escaneo agrega una sola unidad', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/productos')
    await page.getByRole('button', { name: /nuevo producto/i }).click()
    await tituloDelDialogo(page).waitFor()

    const ficha = page.getByRole('dialog')
    await ficha.getByLabel('Nombre').fill('Fosforos largos')
    await ficha.getByLabel(/código principal/i).fill('9001111100001')
    await ficha.getByLabel(/unidad de venta/i).selectOption('UNIT')
    await ficha.getByLabel(/^precio por/i).fill('890')
    await ficha.getByLabel(/stock inicial/i).fill('12')
    await ficha.getByRole('button', { name: 'Crear' }).click()
    await page.waitForTimeout(1500)

    await page.goto('/venta')
    await escanear(page, '9001111100001')

    // Un producto por unidad NO abre ningun dialogo: se agrega y listo.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await totalDelTicket(page)).toBe(890)
  })
})

test.describe('Un producto que se pesa', () => {
  test('escanearlo pide el peso y cobra el subtotal exacto', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')

    await escanear(page, PRODUCTOS.queso.codigo)

    // El dialogo se abre SOLO: despues de pasar un queso por el lector, lo
    // unico que puede seguir es el peso.
    await expect(tituloDelDialogo(page)).toHaveText(PRODUCTOS.queso.nombre)

    // El foco entra en el campo: se tipea sin tocar el mouse.
    await page.keyboard.type('0,425')
    await expect(page.getByRole('dialog').getByText('$ 4.165,00')).toHaveCount(1)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // $9.800/kg x 0,425 kg. En punto flotante daria $4.164,99.
    expect(await totalDelTicket(page)).toBe(4165)
  })

  test('no deja pedir mas peso del que hay', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.queso.codigo)
    await tituloDelDialogo(page).waitFor()

    await page.keyboard.type('99')
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/solo quedan/i)
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Agregar' })).toBeDisabled()
  })

  test('vender, anular y comprobar que el libro devuelve el peso exacto', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/stock')
    await buscar(page, PRODUCTOS.queso.nombre)
    const filaAntes = await page
      .getByRole('row')
      .filter({ hasText: PRODUCTOS.queso.nombre })
      .filter({ hasText: /kg/ })
      .first()
      .innerText()
    const antes = /[\d.,]+\s*kg/.exec(filaAntes)?.[0]
    expect(antes, `el stock no se mostro en kilos. La fila decia: ${filaAntes}`).toBeDefined()

    await page.goto('/venta')
    await escanear(page, PRODUCTOS.queso.codigo)
    await tituloDelDialogo(page).waitFor()
    await page.keyboard.type('0,500')
    await page.keyboard.press('Enter')

    await page
      .getByRole('region', { name: 'Ticket en curso' })
      .getByRole('button', { name: /^cobrar/i })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cobrar/i })
      .click()
    await page.getByRole('button', { name: 'Nueva venta' }).waitFor()

    // El libro lo anoto con la fraccion exacta.
    await page.goto('/stock/movimientos')
    await buscar(page, PRODUCTOS.queso.nombre)
    await expect(filaCon(page, 'Venta')).toContainText('0,500')

    await page.goto('/ventas')
    const venta = page.getByRole('row').filter({ hasText: 'Vigente' }).first()
    await venta.getByRole('button', { name: 'Anular' }).click()
    await tituloDelDialogo(page).waitFor()
    await page.getByRole('dialog').getByRole('textbox').first().fill('El cliente lo devolvió')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /anular la venta/i })
      .click()
    await page.waitForTimeout(1500)

    // El stock vuelve EXACTAMENTE a donde estaba.
    await page.goto('/stock')
    await buscar(page, PRODUCTOS.queso.nombre)
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: PRODUCTOS.queso.nombre })
        .filter({ hasText: /kg/ })
        .first(),
    ).toContainText(antes ?? '')

    // Con los dos movimientos: el original no se edito ni se borro.
    await page.goto('/stock/movimientos')
    await buscar(page, PRODUCTOS.queso.nombre)
    await expect(filaCon(page, 'Anulación de venta')).toContainText('0,500')
  })

  test('un ajuste fraccionado deja su fila en el libro', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/stock')
    await buscar(page, PRODUCTOS.queso.nombre)

    await filaCon(page, PRODUCTOS.queso.nombre).getByRole('button', { name: 'Ajustar' }).click()
    await tituloDelDialogo(page).waitFor()

    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel(/qué pasó/i).selectOption('BREAKAGE')
    await dialogo.getByLabel(/cuánto sale/i).fill('0,750')
    await dialogo.getByLabel('Motivo').fill('Se cayó el corte al piso')
    await dialogo.getByRole('button', { name: /guardar ajuste/i }).click()
    await page.waitForTimeout(1500)

    await page.goto('/stock/movimientos')
    await buscar(page, PRODUCTOS.queso.nombre)
    const rotura = filaCon(page, 'Rotura')
    await expect(rotura).toContainText('0,750')
    await expect(rotura).toContainText('Se cayó el corte al piso')
  })
})

test.describe('El costo', () => {
  test('se cambia con motivo y queda en la actividad del producto', async ({ page }) => {
    await entrar(page, 'encargado')

    const ficha = await abrirFicha(page, PRODUCTOS.leche.nombre)
    await expect(ficha.getByLabel(/^costo/i)).toHaveCount(1)
    await expect(ficha.getByText('Margen', { exact: true })).toHaveCount(1)
    await expect(ficha.getByText('Markup', { exact: true })).toHaveCount(1)

    await ficha.getByLabel(/^costo/i).fill('1300')
    // El campo de motivo aparece solo cuando el costo cambia de verdad.
    await ficha.getByLabel(/motivo del cambio de costo/i).fill('Aumento del proveedor')
    await ficha.getByRole('button', { name: /guardar/i }).click()
    await page.waitForTimeout(2000)

    const otraVez = await abrirFicha(page, PRODUCTOS.leche.nombre)
    await expect(otraVez.getByText('Actividad reciente')).toHaveCount(1)
    await expect(otraVez.getByText(/^Costo:/)).toHaveCount(1)
    await expect(otraVez.getByText('Aumento del proveedor')).toHaveCount(1)
  })

  test('el cajero no ve el costo ni el margen en ninguna pantalla', async ({ page }) => {
    await entrar(page, 'cajero')

    await page.goto('/productos')
    await buscar(page, PRODUCTOS.leche.nombre)

    await expect(page.getByText('Markup')).toHaveCount(0)
    await expect(page.getByText('Margen', { exact: true })).toHaveCount(0)
  })

  test('el costo NO viaja en la respuesta que usa la caja', async ({ page }) => {
    // No alcanza con esconderlo en la pantalla: se comprueba sobre el JSON,
    // que es lo que cualquiera puede leer con las herramientas del navegador.
    await entrar(page, 'cajero')

    // Se pide DESDE la pagina, no con el cliente HTTP de Playwright: asi la
    // peticion lleva exactamente las mismas cookies que llevaria el navegador
    // del cajero, que es el escenario que importa.
    await page.goto('/venta')
    const crudo = await page.evaluate(async (codigo: string) => {
      const r = await fetch(`/api/products/barcode/${codigo}`)
      return { estado: r.status, cuerpo: await r.text() }
    }, PRODUCTOS.leche.codigo)

    expect(crudo.estado, `la peticion devolvio ${crudo.cuerpo}`).toBe(200)
    const cuerpo = JSON.parse(crudo.cuerpo) as Record<string, unknown>

    expect('cost' in cuerpo, `el costo llego: ${crudo.cuerpo}`).toBe(false)
    expect(crudo.cuerpo).not.toContain('rentabilidad')
  })
})

test.describe('El lector encuentra por cualquiera de los codigos', () => {
  test('el principal y un alternativo dan el MISMO producto', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')

    await escanear(page, PRODUCTOS.yerba.codigo)
    expect(await totalDelTicket(page)).toBe(PRODUCTOS.yerba.precio)

    // El mismo producto, con el codigo que el proveedor manda en el pack.
    await escanear(page, PRODUCTOS.yerbaAlternativo.codigo)

    const ticket = page.getByRole('region', { name: 'Ticket en curso' })
    await expect(ticket, 'el alternativo abrio una segunda linea').toContainText('1 artículo')
    expect(await totalDelTicket(page), 'no sumo a la misma linea').toBe(PRODUCTOS.yerba.precio * 2)
  })

  test('los codigos alternativos se cargan desde la ficha', async ({ page }) => {
    await entrar(page, 'encargado')

    const ficha = await abrirFicha(page, PRODUCTOS.gaseosa.nombre)
    await ficha.getByPlaceholder(/escaneá o escribí/i).fill('9002222200002')
    await ficha.getByRole('button', { name: 'Agregar' }).click()
    await expect(ficha.getByText('9002222200002')).toHaveCount(1)
    await ficha.getByRole('button', { name: /guardar/i }).click()
    await page.waitForTimeout(2000)

    await page.goto('/venta')
    await escanear(page, '9002222200002')
    expect(await totalDelTicket(page)).toBe(PRODUCTOS.gaseosa.precio)
  })
})

test.describe('El stock ya no se edita desde la ficha', () => {
  test('la ficha lo muestra y remite al ajuste', async ({ page }) => {
    await entrar(page, 'encargado')

    const ficha = await abrirFicha(page, PRODUCTOS.yerba.nombre)
    await expect(ficha.getByText('Stock actual')).toHaveCount(1)
    await expect(ficha.getByText(/se mueve con el botón/i)).toHaveCount(1)

    // Y no hay ningun campo para escribirlo.
    await expect(ficha.getByLabel(/^stock actual/i)).toHaveCount(0)
    await expect(ficha.getByLabel(/^unidades$/i)).toHaveCount(0)
  })

  test('la unidad de venta no se cambia en un producto con historial', async ({ page }) => {
    await entrar(page, 'encargado')

    const ficha = await abrirFicha(page, PRODUCTOS.yerba.nombre)
    await ficha.getByLabel(/unidad de venta/i).selectOption('KG')
    await ficha.getByRole('button', { name: /guardar/i }).click()

    await expect(ficha.getByText(/no se puede cambiar la unidad de venta/i)).toHaveCount(1)
  })
})
