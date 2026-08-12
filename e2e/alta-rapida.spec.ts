import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PRODUCTOS, entrar, escanear } from './ayudantes'

/**
 * Alta rapida desde la caja. Fase 5A.1.
 *
 * El recorrido completo del caso que motivo la fase:
 *
 *   escaneo -> no existe -> alta rapida -> creado -> al carrito -> sigo vendiendo
 *
 * Y sus alrededores: el codigo invalido, el producto inactivo, el que ya existe,
 * el que se vende por peso, el que nace sin stock, y quien no tiene permiso.
 *
 * Un codigo distinto por prueba, y por dos motivos: la base es la misma para
 * toda la corrida --`fullyParallel: false`, un solo worker-- asi que un codigo
 * repetido chocaria con lo que dejo la prueba anterior; y ademas asi cada fallo
 * dice exactamente cual escenario se rompio.
 */

/** Codigos nuevos, uno por prueba. Ninguno existe en el seed. */
const NUEVO = {
  basico: '7799100000018',
  alCarrito: '7799100000025',
  cancelar: '7799100000032',
  sinPermiso: '7799100000049',
  duplicado: '7799100000056',
  peso: '7799100000063',
  sinStock: '7799100000070',
  teclado: '7799100000087',
  movil: '7799100000094',
  axe: '7799100000100',
  categoria: '7799100000117',
  errorApi: '7799100000124',
  foco: '7799100000131',
} as const

const dialogo = (page: Page) => page.getByRole('dialog')

/**
 * Llena el formulario minimo. No confirma.
 *
 * Cada campo se COMPRUEBA despues de escribirlo. No es ceremonia: el dialogo
 * vive dentro de la pantalla de venta, que se vuelve a dibujar por su cuenta
 * --el escaner, el ticket, la caja--, y un `fill` que cae justo en medio de un
 * redibujado deja el valor a medias. Sin esta comprobacion el sintoma aparece
 * mucho mas lejos: el producto se crea con el nombre de otro campo pegado.
 */
async function escribir(page: Page, etiqueta: string | RegExp, valor: string): Promise<void> {
  const campo = dialogo(page).getByLabel(etiqueta)
  await campo.click()
  await campo.press('ControlOrMeta+a')
  // `pressSequentially` y no `fill`, a proposito. `fill` escribe el valor de una
  // sola vez y dispara UN evento; si React vuelve a dibujar el campo controlado
  // en esa misma ventana, el valor se pierde entero --se vio: el precio quedaba
  // vacio-- o se pega al que habia. Una persona escribe tecla por tecla, y cada
  // tecla es su propio evento. Escribir como una persona no es cosmetica: es
  // probar lo que de verdad ocurre.
  await campo.pressSequentially(valor, { delay: 10 })
  await expect(campo).toHaveValue(valor)
}

async function completar(page: Page, nombre: string, precio: string): Promise<void> {
  await escribir(page, 'Nombre', nombre)
  await escribir(page, /^Precio/, precio)
}

async function crearYAgregar(page: Page): Promise<void> {
  await dialogo(page)
    .getByRole('button', { name: /crear y agregar/i })
    .click()
}

const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })

// ---------------------------------------------------------------------------

test.describe('el escaneo dice qué pasó', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/venta')
  })

  test('1. un código conocido sigue siendo instantáneo y sin ruido', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerba.codigo)

    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
    // Nada de bloques ni diálogos: el camino feliz no interrumpe.
    await expect(page.getByText('Código no registrado')).toBeHidden()
    await expect(dialogo(page)).not.toBeAttached()
  })

  test('2. un código desconocido muestra el estado explícito con el código', async ({ page }) => {
    await escanear(page, NUEVO.basico)

    await expect(page.getByText('Código no registrado')).toBeVisible()
    await expect(page.locator('[data-codigo-leido]')).toHaveText(NUEVO.basico)
    await expect(page.getByRole('button', { name: 'Crear producto' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar código' })).toBeVisible()
  })

  test('3. el código escaneado llega prellenado y no se puede editar', async ({ page }) => {
    await escanear(page, NUEVO.basico)
    await page.getByRole('button', { name: 'Crear producto' }).click()

    const campo = dialogo(page).getByLabel('Código de barras')
    await expect(campo).toHaveValue(NUEVO.basico)
    await expect(campo).toHaveAttribute('readonly', '')
  })

  test('4. crea un producto por unidad y lo agrega al ticket', async ({ page }) => {
    await escanear(page, NUEVO.alCarrito)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Alfajor de prueba', '1500')
    await crearYAgregar(page)

    await expect(ticket(page).getByText('Alfajor de prueba', { exact: true })).toBeVisible()
    await expect(page.getByText('Código no registrado')).toBeHidden()
  })

  test('5. el stock inicial es visible, editable y vale 1 por omisión', async ({ page }) => {
    await escanear(page, NUEVO.foco)
    await page.getByRole('button', { name: 'Crear producto' }).click()

    const stock = dialogo(page).getByLabel(/Stock inicial/)
    await expect(stock).toBeVisible()
    await expect(stock).toHaveValue('1')

    await escribir(page, /Stock inicial/, '4')
    await completar(page, 'Con cuatro unidades', '900')
    await crearYAgregar(page)

    await expect(ticket(page).getByText('Con cuatro unidades', { exact: true })).toBeVisible()
  })

  test('6. el foco vuelve al lector y el siguiente escaneo funciona', async ({ page }) => {
    await escanear(page, NUEVO.teclado)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Sigue el escaneo', '700')
    await crearYAgregar(page)

    await expect(page.locator('[data-barcode-input]')).toBeFocused()

    // Y el siguiente entra sin tocar el mouse.
    await escanear(page, PRODUCTOS.leche.codigo)
    await expect(ticket(page).getByText(PRODUCTOS.leche.nombre, { exact: true })).toBeVisible()
  })

  test('7. Escape cancela y no crea nada', async ({ page }) => {
    await escanear(page, NUEVO.cancelar)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'No debería existir', '100')
    await page.keyboard.press('Escape')

    await expect(dialogo(page)).not.toBeAttached()
    await expect(page.locator('[data-barcode-input]')).toBeFocused()

    // Y el código sigue sin existir.
    await escanear(page, NUEVO.cancelar)
    await expect(page.getByText('Código no registrado')).toBeVisible()
  })

  test('8. un código inválido NO ofrece crear: no hay nada que crear', async ({ page }) => {
    const campo = page.locator('[data-barcode-input]')
    await campo.fill('779 12 34')
    await campo.press('Enter')

    await expect(page.getByText('Código inválido')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear producto' })).toBeHidden()
    // Y dice qué hacer.
    await expect(page.getByText(/lector otra vez/i)).toBeVisible()
  })

  test('9. un producto inactivo no se llama "no registrado"', async ({ page }) => {
    await escanear(page, PRODUCTOS.deBaja.codigo)

    await expect(page.getByText('Producto inactivo')).toBeVisible()
    await expect(page.getByText('Código no registrado')).toBeHidden()
    // El encargado puede reactivarlo sin salir de la caja.
    await expect(page.getByRole('button', { name: 'Reactivar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Crear producto' })).toBeHidden()
  })

  test('10. un código alternativo encuentra el producto y no ofrece alta', async ({ page }) => {
    await escanear(page, PRODUCTOS.yerbaAlternativo.codigo)

    await expect(ticket(page).getByText(PRODUCTOS.yerba.nombre, { exact: true })).toBeVisible()
    await expect(page.getByText('Código no registrado')).toBeHidden()
  })

  test('11. un producto por peso abre el diálogo de peso, no agrega 1 kg', async ({ page }) => {
    await escanear(page, NUEVO.peso)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Queso de prueba', '9000')
    await dialogo(page).getByLabel('Unidad de venta').selectOption('KG')

    // Con KG el precio se anuncia por kilo.
    await expect(dialogo(page).getByText(/Precio por kilogramo/i)).toBeVisible()
    await escribir(page, /Stock inicial/, '3')
    await crearYAgregar(page)

    // No se agregó solo: pide el peso.
    await expect(
      page
        .getByRole('dialog')
        .getByText(/peso|cantidad/i)
        .first(),
    ).toBeVisible()
  })

  test('12. creado con cero unidades avisa y NO lo mete en el ticket', async ({ page }) => {
    await escanear(page, NUEVO.sinStock)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Sin unidades', '400')
    await escribir(page, /Stock inicial/, '0')
    await crearYAgregar(page)

    await expect(page.getByText(/quedó sin stock/i)).toBeVisible()
    await expect(ticket(page).getByText('Sin unidades', { exact: true })).toBeHidden()
  })

  test('13. dos altas del mismo código: la segunda ofrece agregar el que ya existe', async ({
    page,
  }) => {
    // Primera: se crea.
    await escanear(page, NUEVO.duplicado)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Ganó la primera caja', '1100')
    await crearYAgregar(page)
    await expect(ticket(page).getByText('Ganó la primera caja', { exact: true })).toBeVisible()

    // Segunda: se fuerza el alta con el MISMO código desde el alta manual,
    // que es exactamente lo que le pasa a la otra caja que no se enteró.
    await page.getByRole('button', { name: '+ Producto' }).click()
    await dialogo(page).getByLabel('Código de barras').fill(NUEVO.duplicado)
    await completar(page, 'Llegó tarde', '1100')
    await crearYAgregar(page)

    await expect(page.getByText('El producto ya existe')).toBeVisible()
    await expect(page.getByText(/otro usuario acaba de registrar/i)).toBeVisible()
    await page.getByRole('button', { name: 'Agregar a la venta' }).click()

    // Se agregó el que YA existía, no un duplicado.
    await expect(ticket(page).getByText('Ganó la primera caja', { exact: true })).toBeVisible()
    await expect(ticket(page).getByText('Llegó tarde', { exact: true })).toBeHidden()
  })

  test('14. Alt+N abre el alta manual, con el código editable', async ({ page }) => {
    await page.keyboard.press('Alt+n')

    await expect(dialogo(page)).toBeAttached()
    const campo = dialogo(page).getByLabel('Código de barras')
    await expect(campo).toHaveValue('')
    await expect(campo).not.toHaveAttribute('readonly', '')
  })

  test('15. se puede crear un producto SIN código desde el alta manual', async ({ page }) => {
    await page.getByRole('button', { name: '+ Producto' }).click()
    await completar(page, 'Artesanal sin etiqueta', '2500')
    await crearYAgregar(page)

    await expect(ticket(page).getByText('Artesanal sin etiqueta', { exact: true })).toBeVisible()
  })

  test('16. una categoría nueva se crea desde el mismo diálogo', async ({ page }) => {
    await escanear(page, NUEVO.categoria)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await dialogo(page).getByRole('button', { name: '+ Nueva' }).click()

    const nombre = `Rubro ${String(Date.now()).slice(-6)}`
    await dialogo(page)
      .getByLabel(/categoría nueva/i)
      .fill(nombre)
    await dialogo(page).getByRole('button', { name: 'Crear', exact: true }).click()

    // Se espera a que el campo de la categoría nueva DESAPAREZCA, no a que el
    // selector tenga un número: ya tenía uno --el de la categoría por omisión--
    // así que esa condición se cumplía al instante y `completar` corría con los
    // dos campos "Nombre" en pantalla.
    await expect(dialogo(page).getByLabel(/categoría nueva/i)).not.toBeAttached()

    // Por ROL y no por etiqueta: `getByLabel` compara el texto del `<label>`, y
    // ahí el asterisco de campo obligatorio también cuenta.
    const categoria = dialogo(page).getByRole('combobox', { name: /^Categoría/ })
    await expect(categoria).toHaveValue(/\d+/)
    await expect(categoria.locator('option:checked')).toHaveText(nombre)

    await completar(page, 'Con rubro nuevo', '300')
    await crearYAgregar(page)
    await expect(ticket(page).getByText('Con rubro nuevo', { exact: true })).toBeVisible()
  })

  test('17. un error del servidor conserva el formulario', async ({ page }) => {
    await escanear(page, NUEVO.errorApi)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await completar(page, 'Se va a caer', '800')

    await page.route('**/api/products/quick', (ruta) => ruta.abort('failed'))
    await crearYAgregar(page)

    // Lo escrito sigue ahí: no hay que volver a tipearlo.
    await expect(dialogo(page).getByLabel('Nombre')).toHaveValue('Se va a caer')
    await expect(dialogo(page).getByLabel(/^Precio/)).toHaveValue('800')
    await expect(dialogo(page).getByText(/no se creó el producto/i)).toBeVisible()
  })

  test('18. el diálogo no tiene violaciones de accesibilidad', async ({ page }) => {
    await escanear(page, NUEVO.axe)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await expect(dialogo(page)).toBeAttached()

    // El diálogo entra con una transición de opacidad. Analizarlo antes de que
    // termine hace que axe mida los colores MEZCLADOS con lo que hay detrás y
    // marque como falta de contraste hasta el título. Es la misma espera que
    // e2e/accesibilidad.spec.ts hace con el panel de recepción.
    await expect(dialogo(page).getByRole('button', { name: /crear y agregar/i })).toBeVisible()
    await page.waitForTimeout(500)

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(violations, violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([])
  })
})

test.describe('sin permiso', () => {
  test('19. el cajero ve el código y a quién pedírselo, sin botón muerto', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')
    await escanear(page, NUEVO.sinPermiso)

    await expect(page.getByText('Código no registrado')).toBeVisible()
    await expect(page.locator('[data-codigo-leido]')).toHaveText(NUEVO.sinPermiso)
    await expect(page.getByText(/no tiene permiso para crear productos/i)).toBeVisible()
    await expect(page.getByText(/pedíselo a un encargado/i)).toBeVisible()

    // Ni el botón del bloque ni el de la barra: ausentes, no deshabilitados.
    await expect(page.getByRole('button', { name: 'Crear producto' })).toBeHidden()
    await expect(page.getByRole('button', { name: '+ Producto' })).toBeHidden()
    // Y sigue pudiendo copiar el código para dictárselo a alguien.
    await expect(page.getByRole('button', { name: 'Copiar código' })).toBeVisible()
  })

  test('20. el servidor lo rechaza aunque se llame al endpoint a mano', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')

    const estado = await page.evaluate(async () => {
      const r = await fetch('/api/products/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          barcode: '7799199999991',
          name: 'Por la puerta de atrás',
          price: '100',
          categoryId: 1,
        }),
      })
      return r.status
    })

    expect(estado, 'esconder el botón no es la defensa').toBe(403)
  })
})
