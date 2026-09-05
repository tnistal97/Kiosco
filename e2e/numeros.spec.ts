import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear } from './ayudantes'

/**
 * Los numeros se escriben como los escribe una persona.
 *
 * El hallazgo: "0" no entraba donde la pantalla mostraba "0,00", y varios
 * campos solo aceptaban la forma canonica del cable --"1234.56"-- porque
 * validaban con la misma expresion regular que el servidor.
 *
 * Cada prueba de aca escribe un ENTERO PELADO donde antes hacia falta el
 * formato del sistema, y comprueba las dos mitades:
 *
 *   que el campo lo acepte --y lo muestre como se lee--
 *   que el servidor lo guarde --y guarde el numero correcto--
 *
 * La segunda mitad es la que importa: un campo que se pone verde y despues
 * manda cualquier cosa no arregla nada.
 */

/** Codigos nuevos, uno por prueba. Ninguno existe en el seed. */
const NUEVO = {
  precio: '7799300000010',
  compra: '7799300000027',
} as const

const dialogo = (page: Page) => page.getByRole('dialog')
const ticket = (page: Page) => page.getByRole('region', { name: 'Ticket en curso' })

/** Escribe tecla por tecla, como una persona. */
async function escribir(page: Page, etiqueta: string | RegExp, valor: string): Promise<void> {
  const campo = dialogo(page).getByLabel(etiqueta)
  await campo.click()
  await campo.press('ControlOrMeta+a')
  await campo.pressSequentially(valor, { delay: 10 })
  // Mientras se escribe, el texto es el que se escribio: sin reformateo por
  // tecla, que es lo que movia el cursor.
  await expect(campo).toHaveValue(valor)
}

interface ProductoAPI {
  id: number
  name: string
  price: string
  cost: string | null
  totalStock: string
}

async function buscarProducto(page: Page, nombre: string): Promise<ProductoAPI | null> {
  return page.evaluate(async (n: string) => {
    const r = await fetch(`/api/products?q=${encodeURIComponent(n)}&pageSize=10&estado=todos`)
    const c = (await r.json()) as { data: ProductoAPI[] }
    return c.data.find((p) => p.name === n) ?? null
  }, nombre)
}

// ---------------------------------------------------------------------------

test.describe('Un entero pelado entra en todos lados', () => {
  test('1. alta rápida: precio 1500, stock 5 y costo 0, sin escribir ",00"', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/venta')
    await escanear(page, NUEVO.precio)
    await page.getByRole('button', { name: 'Crear producto' }).click()

    await escribir(page, 'Nombre', 'Numérico de prueba')
    await escribir(page, /^Precio/, '1500')
    await escribir(page, /Stock inicial/, '5')
    // CERO. Es el caso que motivo todo: un costo de cero es una respuesta
    // valida, y escribirlo asi tiene que alcanzar.
    await escribir(page, 'Costo', '0')

    await dialogo(page)
      .getByRole('button', { name: /crear y agregar/i })
      .click()
    await expect(ticket(page).getByText('Numérico de prueba', { exact: true })).toBeVisible()

    const creado = await buscarProducto(page, 'Numérico de prueba')
    expect(creado, 'el producto se creó').not.toBeNull()
    expect(Number(creado?.price), 'mil quinientos, no uno y medio').toBe(1500)
    expect(Number(creado?.cost), 'el cero se guardó como cero').toBe(0)
    expect(Number(creado?.totalStock), 'cinco unidades').toBe(5)
  })

  test('2. la ficha muestra el precio ya escrito como se escribe', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/productos')
    await page.getByRole('searchbox').first().fill('Numérico de prueba')
    await page
      .getByRole('button', { name: /Numérico de prueba/ })
      .first()
      .click()

    const precio = dialogo(page).getByLabel(/^Precio/)
    // Antes traia "1500.00", el texto del cable, y habia que tipear en ese
    // formato para que lo aceptara.
    await expect(precio).toHaveValue('1.500,00')

    // Y lo que muestra, lo vuelve a leer: se sale y se entra sin cambiar nada.
    await precio.click()
    await dialogo(page).getByLabel('Nombre').click()
    await expect(precio).toHaveValue('1.500,00')
  })

  test('3. peso 1,5 en la balanza y pago de 20000 en el cobro', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/venta')

    // El queso se vende por kilo: el escaneo abre el diálogo del peso.
    await escanear(page, PRODUCTOS.queso.codigo)
    const peso = page.getByLabel(/^Peso$/)
    await peso.fill('1,5')
    await page.getByRole('button', { name: 'Agregar' }).click()

    // Kilo y medio: 1,5 × $9.800 = $14.700.
    await expect(ticket(page).getByText('1,500 kg', { exact: true })).toBeVisible()

    await ticket(page).getByRole('button', { name: 'Cobrar' }).click()

    const cobro = dialogo(page)
    const pagaCon = cobro.getByLabel(/^paga con/i)
    await pagaCon.fill('20000')
    // Veinte mil, no veinte: el vuelto de $14.700 es $5.300.
    await expect(cobro.getByText('5.300', { exact: false }).first()).toBeVisible()
    await pagaCon.blur()
    await expect(pagaCon).toHaveValue('20.000,00')

    await page.waitForTimeout(400)
    await cobro.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/vuelto/i).first()).toBeVisible()
  })

  test('4. caja: un ingreso de 10000 entra y queda escrito como se lee', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')
    await page
      .getByRole('button', { name: /movimiento/i })
      .first()
      .click()

    const monto = dialogo(page).getByLabel('Monto')
    await monto.fill('10000')
    await monto.blur()
    await expect(monto, 'diez mil, no diez').toHaveValue('10.000,00')

    await dialogo(page).getByLabel('Detalle').fill('Prueba de números')
    await dialogo(page).getByRole('button', { name: 'Registrar' }).click()

    await expect(page.getByText('Prueba de números').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('$ 10.000,00').first()).toBeVisible()
  })

  test('5. compra y recepción: 10 unidades a 1000 pesos', async ({ page }) => {
    await entrar(page, 'admin')

    // Un producto propio de esta prueba: recibir mercadería mueve stock y
    // costo, y hacerlo sobre uno del seed le cambiaría el suelo a otras.
    await page.goto('/venta')
    await escanear(page, NUEVO.compra)
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await escribir(page, 'Nombre', 'Comprable de prueba')
    await escribir(page, /^Precio/, '2000')
    await escribir(page, /Stock inicial/, '0')
    await dialogo(page)
      .getByRole('button', { name: /crear y agregar/i })
      .click()
    await expect(page.getByText(/no tiene stock|sin stock/i).first()).toBeVisible()

    await page.goto('/compras/nueva')
    await page
      .getByRole('combobox', { name: 'A quién se le compra' })
      .selectOption({ label: 'Bebidas Andinas' })
    await page.getByRole('searchbox', { name: /Buscar productos/i }).fill('Comprable de prueba')
    await page.getByRole('button', { name: /Comprable de prueba/ }).click()

    await page.getByRole('textbox', { name: /Cantidad de Comprable de prueba/i }).fill('10')
    await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill('1000')
    await page.getByRole('button', { name: 'Confirmar orden' }).click()
    await page.waitForURL(/\/compras\/\d+$/)

    await page.getByRole('button', { name: 'Recibir mercadería' }).click()
    const recibir = page.getByRole('textbox', { name: /Recibir ahora/i })
    // Lo pendiente llega escrito para leer: "10", no "10.000".
    await expect(recibir, 'lo pendiente no se muestra con tres decimales').toHaveValue('10')
    await recibir.fill('10')
    await page.getByRole('button', { name: 'Confirmar recepción' }).click()

    await expect(page.getByText(/Recibida/).first()).toBeVisible({ timeout: 15_000 })

    const producto = await buscarProducto(page, 'Comprable de prueba')
    expect(Number(producto?.totalStock), 'diez unidades, no diez mil').toBe(10)
    expect(Number(producto?.cost), 'mil pesos por unidad').toBe(1000)
  })

  test('6. inventario: contar 0 se acepta', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/inventarios')
    await page.getByRole('button', { name: /nuevo inventario/i }).click()

    // Sin conteo a ciegas: hay que ver lo esperado para saber qué se cuenta.
    await dialogo(page)
      .getByRole('checkbox', { name: /conteo a ciegas/i })
      .uncheck()
    await dialogo(page)
      .getByRole('button', { name: /crear inventario/i })
      .click()
    await page.waitForURL(/\/inventarios\/\d+/)
    const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)

    const fila = page.getByRole('row').filter({ hasText: 'Numérico de prueba' }).first()
    const campo = fila.getByRole('textbox').first()
    // CERO: "no hay ninguno" es un conteo legítimo, y es distinto de no contar.
    await campo.fill('0')
    await campo.blur()
    await expect(campo).toHaveValue('0')

    await page.getByRole('button', { name: /guardar conteos/i }).click()
    await expect(page.getByText(/se guardaron/i).first()).toBeVisible({ timeout: 15_000 })

    const contado = await page.evaluate(async (sesion: number) => {
      const r = await fetch(`/api/inventarios/${String(sesion)}/lineas?pageSize=200`)
      const c = (await r.json()) as {
        data: Array<{ productName: string; countedQuantity: string | null }>
      }
      return c.data.find((l) => l.productName === 'Numérico de prueba')?.countedQuantity ?? null
    }, id)

    expect(contado, 'el cero llegó al servidor como cero').toBe('0.000')
  })
})

test.describe('El "1.500" de cada campo', () => {
  test('7. en un importe es mil quinientos', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/productos')
    await page.getByRole('searchbox').first().fill('Numérico de prueba')
    await page
      .getByRole('button', { name: /Numérico de prueba/ })
      .first()
      .click()

    const precio = dialogo(page).getByLabel(/^Precio/)
    await precio.click()
    await precio.press('ControlOrMeta+a')
    await precio.pressSequentially('1.500')
    await dialogo(page).getByLabel('Nombre').click()
    // Con punto de miles, que es como se lee en pantalla y como se teclea.
    await expect(precio).toHaveValue('1.500,00')
  })

  test('8. en un peso es kilo y medio', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.queso.codigo)

    const peso = page.getByLabel(/^Peso$/)
    await peso.fill('1.500')
    await page.getByRole('button', { name: 'Agregar' }).click()

    // La balanza escribe "1.500" para kilo y medio. Un almacén que venda mil
    // quinientos kilos de queso en una línea no existe.
    await expect(ticket(page).getByText('1,500 kg', { exact: true })).toBeVisible()
  })
})
