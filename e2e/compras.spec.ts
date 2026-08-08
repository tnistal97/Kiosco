import { test, expect, type Page } from '@playwright/test'
import { entrar, PRODUCTOS } from './ayudantes'

/**
 * El circuito de compra, de punta a punta.
 *
 * Recorre el ejemplo del pedido con sus numeros: la gaseosa se compra por caja
 * de ocho y se vende por botella, se piden 5 cajas, llegan 3 y despues 2, y el
 * stock sube 24 y despues 16.
 *
 * Dos reglas que estas pruebas se imponen, y que valen para cualquiera que
 * agregue una:
 *
 *   1. **Nunca `.first()` sobre una lista compartida.** Las pruebas comparten
 *      la base y otras especificaciones tambien crean ordenes; tomar "la
 *      primera" abre una orden que no es la de esta prueba.
 *   2. **Nunca un stock absoluto.** Otras especificaciones venden y ajustan
 *      los mismos productos. Se mide la DIFERENCIA, que es lo que la compra
 *      promete.
 */

/**
 * El titulo del dialogo, no el dialogo.
 *
 * `getByRole('dialog')` resuelve al envoltorio de Headless UI, que tiene
 * tamanio cero: `toBeVisible()` falla siempre. Se afirma sobre un descendiente.
 */
function tituloDelDialogo(page: Page, texto: string | RegExp) {
  return page.getByRole('heading', { name: texto })
}

/**
 * El distintivo de estado, dentro del encabezado de la orden.
 *
 * `getByText('Pedida')` no sirve: "Pedida", "Recibida" y "Cancelada" son
 * tambien opciones del filtro del listado.
 */
function estadoDeLaOrden(page: Page) {
  return page
    .getByRole('heading', { name: /OC-/ })
    .getByText(/^(Borrador|Pedida|Parcial|Recibida|Cancelada)$/)
}

/** El stock de un producto, como numero. */
async function stockDe(page: Page, nombre: string): Promise<number> {
  await page.goto('/stock')
  await page.getByRole('searchbox').first().fill(nombre)
  await page.waitForTimeout(700)
  const fila = await page.getByRole('row').filter({ hasText: nombre }).first().innerText()
  const crudo = /([\d.,]+)\s*(?:u\.|kg|g|L|ml)\s*en stock/.exec(fila)?.[1]
  expect(crudo, `no se pudo leer el stock. La fila decia: ${fila}`).toBeDefined()
  return Number((crudo ?? '0').replace(/\./g, '').replace(',', '.'))
}

/**
 * Arma una orden confirmada y devuelve su URL.
 *
 * Devolver la URL --y no confiar en "la primera de la lista"-- es lo que hace
 * que estas pruebas no dependan de lo que hayan dejado las demas.
 */
async function ordenConfirmada(
  page: Page,
  datos: { proveedor: string; producto: string; cantidad: string; costo: string },
): Promise<string> {
  await page.goto('/compras/nueva')
  await page
    .getByRole('combobox', { name: 'A quién se le compra' })
    .selectOption({ label: datos.proveedor })

  await page.getByRole('searchbox', { name: /Buscar productos/i }).fill(datos.producto)
  await page.getByRole('button', { name: new RegExp(datos.producto.replace('.', '\\.')) }).click()

  await page
    .getByRole('textbox', { name: new RegExp(`Cantidad de ${datos.producto}`, 'i') })
    .fill(datos.cantidad)
  await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill(datos.costo)
  await page.getByRole('button', { name: 'Confirmar orden' }).click()

  await page.waitForURL(/\/compras\/\d+$/)
  await expect(estadoDeLaOrden(page)).toHaveText('Pedida')
  return page.url()
}

/** Abre el diálogo, escribe lo que llega y confirma. */
async function recibir(page: Page, cantidad?: string): Promise<void> {
  await page.getByRole('button', { name: 'Recibir mercadería' }).click()
  await tituloDelDialogo(page, /Recibir mercadería/).waitFor()
  if (cantidad !== undefined) {
    await page.getByRole('textbox', { name: /Recibir ahora/i }).fill(cantidad)
  }
  await page.getByRole('button', { name: 'Confirmar recepción' }).click()
}

test.describe('Proveedores', () => {
  test('alcanza con el nombre para dar de alta un proveedor', async ({ page }) => {
    await entrar(page, 'compras')
    await page.goto('/proveedores')

    await page.getByRole('button', { name: 'Nuevo proveedor' }).click()
    await tituloDelDialogo(page, 'Nuevo proveedor').waitFor()

    // Ni CUIT, ni correo, ni direccion: es la decision central del modelo.
    await page.getByRole('textbox', { name: /^Nombre/ }).fill('Distribuidora Pepe')
    await page.getByRole('button', { name: 'Crear proveedor' }).click()

    await expect(page.getByRole('cell', { name: 'Distribuidora Pepe' })).toBeVisible()
  })

  test('un proveedor dado de baja no se ofrece para comprar', async ({ page }) => {
    await entrar(page, 'compras')
    await page.goto('/compras/nueva')

    const selector = page.getByRole('combobox', { name: 'A quién se le compra' })
    await selector.waitFor()
    // "Fiambres del Oeste" esta inactivo en el seed.
    await expect(selector.getByRole('option', { name: 'Fiambres del Oeste' })).toHaveCount(0)
    await expect(selector.getByRole('option', { name: 'Bebidas Andinas' })).toHaveCount(1)
  })

  test('la ficha muestra qué se le compra', async ({ page }) => {
    await entrar(page, 'compras')
    await page.goto('/proveedores')
    await page.getByRole('link', { name: 'Bebidas Andinas' }).click()

    await expect(page.getByRole('heading', { name: 'Bebidas Andinas' })).toBeVisible()
    await expect(page.getByText('Productos que se le compran')).toBeVisible()
    await expect(page.getByRole('cell', { name: PRODUCTOS.gaseosa.nombre })).toBeVisible()
    await expect(page.getByText('Compras recientes')).toBeVisible()
  })
})

test.describe('El circuito completo: 5 cajas de 8, en dos entregas', () => {
  test('crear, confirmar, recibir 3 y después 2', async ({ page }) => {
    await entrar(page, 'compras')

    const antes = await stockDe(page, PRODUCTOS.gaseosa.nombre)

    const url = await ordenConfirmada(page, {
      proveedor: 'Bebidas Andinas',
      producto: PRODUCTOS.gaseosa.nombre,
      cantidad: '5',
      costo: '8800',
    })
    expect(await page.getByRole('heading', { name: /OC-/ }).innerText()).toMatch(/OC-\d{8}/)

    // ---- Primera entrega: 3 cajas -> +24 unidades ----
    await recibir(page, '3')
    await expect(estadoDeLaOrden(page)).toHaveText('Parcial')
    await expect(page.getByText('Recepción #1')).toBeVisible()
    await expect(page.getByRole('cell', { name: '+24 u.' })).toBeVisible()

    expect(await stockDe(page, PRODUCTOS.gaseosa.nombre), '3 cajas de 8 son 24').toBe(antes + 24)

    // ---- Segunda entrega: las 2 que faltaban -> +16 ----
    await page.goto(url)
    await recibir(page)
    await expect(estadoDeLaOrden(page)).toHaveText('Recibida')
    await expect(page.getByText('Recepción #2')).toBeVisible()
    await expect(page.getByRole('cell', { name: '+16 u.' })).toBeVisible()

    expect(await stockDe(page, PRODUCTOS.gaseosa.nombre), '5 cajas de 8 son 40').toBe(antes + 40)

    // ---- Dos entregas, no una con dos renglones ----
    await page.goto(url)
    await expect(page.getByRole('heading', { name: /^Recepción #\d/ })).toHaveCount(2)

    // ---- El libro las registró como recepción de compra ----
    await page.goto('/stock/movimientos?tipo=PURCHASE_RECEIPT')
    await page.getByRole('searchbox').first().fill(PRODUCTOS.gaseosa.nombre)
    await page.waitForTimeout(700)
    // Dentro de la TABLA: la pantalla dibuja además una lista de tarjetas para
    // móvil que en escritorio está oculta, y `.first()` caía sobre ella.
    const libro = page.getByRole('table')
    await expect(libro.getByText('Recepción de compra').first()).toBeVisible()
    // La referencia apunta a la RECEPCIÓN, no a la orden.
    await expect(libro.getByRole('link', { name: /Recepción #\d+/ }).first()).toBeVisible()
  })

  test('el costo del producto quedó en $1.100, no en $8.800', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/productos')
    await page.getByRole('searchbox').first().fill(PRODUCTOS.gaseosa.nombre)
    await page.waitForTimeout(900)

    // La ficha se abre desde el menú de la fila, no con un botón suelto.
    await page
      .getByRole('row')
      .filter({ hasText: PRODUCTOS.gaseosa.nombre })
      .first()
      .locator('button[aria-expanded]')
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()
    const ficha = page.getByRole('dialog')

    // $8.800 la caja de 8 = $1.100 la botella.
    await expect(ficha.getByLabel(/^Costo/i).first()).toHaveValue(/1100/)
    // Y la actividad reciente lo explica.
    await expect(ficha.getByText(/Recepción de OC-/).first()).toBeVisible()
  })
})

test.describe('Compra de un producto por peso', () => {
  test('12,500 kg entran sin conversión', async ({ page }) => {
    await entrar(page, 'compras')

    const antes = await stockDe(page, PRODUCTOS.queso.nombre)

    await ordenConfirmada(page, {
      proveedor: 'Lacteos La Pradera',
      producto: PRODUCTOS.queso.nombre,
      cantidad: '12,500',
      costo: '6200',
    })
    await recibir(page)

    await expect(estadoDeLaOrden(page)).toHaveText('Recibida')
    await expect(page.getByRole('cell', { name: '+12,500 kg' })).toBeVisible()

    expect(await stockDe(page, PRODUCTOS.queso.nombre), 'factor 1: entra lo mismo').toBeCloseTo(
      antes + 12.5,
      3,
    )
  })
})

test.describe('Diferencia de costo', () => {
  test('recibir a un costo distinto deja los dos números visibles', async ({ page }) => {
    await entrar(page, 'compras')

    await ordenConfirmada(page, {
      proveedor: 'Distribuidora del Norte',
      producto: PRODUCTOS.yerba.nombre,
      cantidad: '10',
      costo: '3200',
    })

    await page.getByRole('button', { name: 'Recibir mercadería' }).click()
    await tituloDelDialogo(page, /Recibir mercadería/).waitFor()

    // La factura vino más cara.
    await page.getByRole('textbox', { name: /Costo de factura/i }).fill('3400')
    await expect(page.getByText(/La orden decía/)).toBeVisible()

    await page.getByRole('button', { name: 'Confirmar recepción' }).click()
    await expect(estadoDeLaOrden(page)).toHaveText('Recibida')

    // La orden SIGUE diciendo lo que se pidió, y la diferencia está a la vista.
    await expect(page.getByRole('cell', { name: '$ 3.200,00' }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: '$ 3.400,00' }).first()).toBeVisible()
    await expect(page.getByText('$ 200,00').first()).toBeVisible()
  })
})

test.describe('Lo que no se puede hacer', () => {
  test('no se puede recibir más de lo pendiente', async ({ page }) => {
    await entrar(page, 'compras')

    await ordenConfirmada(page, {
      proveedor: 'Mayorista Central',
      producto: 'Arroz largo fino 1 kg',
      cantidad: '4',
      costo: '1190',
    })

    await page.getByRole('button', { name: 'Recibir mercadería' }).click()
    await tituloDelDialogo(page, /Recibir mercadería/).waitFor()
    await page.getByRole('textbox', { name: /Recibir ahora/i }).fill('9')

    // El diálogo lo dice ANTES de mandar: quien recibe tiene el camión en la
    // puerta y necesita saber el número que sí entra.
    await expect(page.getByText(/No se puede recibir más de lo pendiente/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled()
  })

  test('una orden parcial se puede cancelar y lo recibido queda', async ({ page }) => {
    await entrar(page, 'compras')

    const antes = await stockDe(page, 'Fideos guiseros 500 g')

    await ordenConfirmada(page, {
      proveedor: 'Mayorista Central',
      producto: 'Fideos guiseros 500 g',
      cantidad: '10',
      costo: '720',
    })
    await recibir(page, '4')
    await expect(estadoDeLaOrden(page)).toHaveText('Parcial')

    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.getByRole('textbox', { name: 'Motivo' }).fill('El proveedor no consigue el resto')
    await page.getByRole('button', { name: 'Cancelar orden' }).click()

    await expect(estadoDeLaOrden(page)).toHaveText('Cancelada')
    await expect(page.getByText(/no se revirtió/)).toBeVisible()

    // Lo recibido NO se revirtió: la mercadería está en el depósito.
    expect(await stockDe(page, 'Fideos guiseros 500 g')).toBe(antes + 4)
  })

  test('el cajero no ve el módulo de compras', async ({ page }) => {
    await entrar(page, 'cajero')

    // Ni en el menú.
    await expect(page.getByRole('link', { name: 'Órdenes' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Proveedores' })).toHaveCount(0)

    // Ni entrando a mano: la pantalla no muestra ni una orden.
    await page.goto('/compras')
    await page.waitForTimeout(1200)
    await expect(page.getByRole('link', { name: /OC-/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Nueva compra' })).toHaveCount(0)
  })

  test('el auditor ve las compras pero no los importes', async ({ page }) => {
    await entrar(page, 'auditor')
    await page.goto('/compras')
    await page.waitForTimeout(1200)

    // Ve las órdenes.
    await expect(page.getByRole('link', { name: /OC-/ }).first()).toBeVisible()

    // Y NO los importes. Se mira DENTRO de la tabla: la cabecera de la
    // aplicación muestra el saldo de caja, que el auditor sí puede ver.
    await expect(page.getByRole('table').getByText(/^\$/)).toHaveCount(0)
  })
})

test.describe('El panel de inicio', () => {
  test('muestra cuántas compras esperan mercadería', async ({ page }) => {
    await entrar(page, 'compras')
    await expect(page.getByText('Esperando mercadería')).toBeVisible()
  })

  test('el cajero no ve la tarjeta de compras', async ({ page }) => {
    await entrar(page, 'cajero')
    await expect(page.getByText('Esperando mercadería')).toHaveCount(0)
  })
})
