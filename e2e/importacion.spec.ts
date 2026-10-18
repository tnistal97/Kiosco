import { test, expect, type Page } from '@playwright/test'
import { entrar } from './ayudantes'

/**
 * Importacion de productos y cambio masivo de precios (P0-B), de punta a
 * punta y en un navegador de verdad.
 *
 * Cada prueba usa datos PROPIOS con un sufijo unico: el seed tiene precios de
 * los que dependen las pruebas de venta, y cambiarlos aca las romperia.
 *
 * Las llamadas a la API van con `fetch` DESDE LA PAGINA y no con
 * `page.request`: la cookie de sesion es `Secure` y el cliente HTTP de
 * Playwright no la manda a `http://127.0.0.1`. Ver e2e/claves.spec.ts.
 */

const sufijo = (): string => Date.now().toString().slice(-7)

async function subirCsv(page: Page, nombre: string, contenido: string): Promise<void> {
  await page
    .getByLabel('Archivo de productos')
    .setInputFiles({ name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido, 'utf8') })
}

async function sinScrollHorizontal(page: Page): Promise<void> {
  const [ancho, visible] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(ancho, 'la pagina no se sale de la pantalla').toBeLessThanOrEqual(visible)
}

test('importa un CSV: columnas solas, vista previa, stock elegido y confirmacion', async ({
  page,
}) => {
  const s = sufijo()
  await entrar(page, 'admin')
  await page.goto('/productos')
  // V5: importar y cambiar precios estan en "Más acciones".
  await page.getByRole('button', { name: /más acciones/i }).click()
  await page.getByRole('menuitem', { name: /importar desde excel/i }).click()
  await expect(page).toHaveURL(/\/productos\/importar/)

  // Como lo guarda Excel en castellano: punto y coma y "1.500" de miles. La
  // yerba ya existe en el seed: con "solo los nuevos" no se toca.
  await subirCsv(
    page,
    'lista.csv',
    'Código;Descripción;Rubro;Precio venta;Stock\n' +
      `7799${s}1;Arroz E2E ${s};Almacen;1.500;12\n` +
      '7790001000011;Yerba mate 1 kg;Almacen;9.999;99\n',
  )
  await expect(page.getByRole('combobox', { name: 'Nombre' })).toHaveValue('1')

  await page.getByRole('button', { name: 'Revisar' }).click()
  await expect(page.getByText('3. Mirá qué va a pasar')).toBeVisible()

  // Con columna de stock, elegir que hacer es obligatorio.
  const importar = page.getByRole('button', { name: 'Importar 1 productos' })
  await expect(importar).toBeDisabled()
  await page.getByRole('radio', { name: /Dejar el stock que dice el archivo/ }).check()
  await expect(importar).toBeEnabled()

  await importar.click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toContainText('si algo falla, no se guarda nada')
  await dialogo.getByRole('button', { name: 'Sí, importar' }).click()
  await expect(page.getByRole('heading', { name: 'Importación terminada' })).toBeVisible()

  const [nuevo, yerba] = await page.evaluate(async (codigo) => {
    const leer = async (c: string): Promise<unknown> =>
      (await fetch(`/api/products/barcode/${c}`)).json()
    return [await leer(codigo), await leer('7790001000011')]
  }, `7799${s}1`)
  expect(nuevo).toMatchObject({ name: `Arroz E2E ${s}`, price: '1500.00', totalStock: '12.000' })
  expect(yerba, 'el existente no se toco').toMatchObject({ price: '4850.00' })
})

test('cambia precios de una categoria con vista previa, confirmacion y deshacer', async ({
  page,
}) => {
  const s = sufijo()
  await entrar(page, 'admin')

  // Una categoria y dos productos propios.
  const categoria = `Precios E2E ${s}`
  await page.evaluate(
    async ({ categoria, s }) => {
      const post = (url: string, body: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      const c = (await (await post('/api/categories', { name: categoria })).json()) as {
        id: number
      }
      await post('/api/products', {
        name: `Mate E2E ${s}`,
        price: '1234',
        categoryId: c.id,
        barcode: `7798${s}1`,
      })
      await post('/api/products', {
        name: `Bombilla E2E ${s}`,
        price: '1000',
        categoryId: c.id,
        barcode: `7798${s}2`,
      })
    },
    { categoria, s },
  )

  await page.goto('/productos')
  await page.getByRole('button', { name: /más acciones/i }).click()
  await page.getByRole('menuitem', { name: 'Cambiar precios' }).click()
  await expect(page).toHaveURL(/\/productos\/precios/)

  await page.getByLabel('Categoría').selectOption({ label: categoria })
  await page.getByLabel('Porcentaje (%)').fill('10')
  await page.getByLabel('Redondeo').selectOption('termina-90')
  await page.getByRole('button', { name: 'Ver cómo quedan' }).click()

  await expect(page.getByText('3. Así quedan')).toBeVisible()
  // 1234 + 10 % = 1357,40 → 1390. 1000 + 10 % = 1100 → 1190. En la lista cada
  // precio nuevo va en negrita; el resumen repite el minimo y el maximo.
  await expect(page.locator('strong', { hasText: /^\$\s?1\.390,00$/ })).toBeVisible()
  await expect(page.locator('strong', { hasText: /^\$\s?1\.190,00$/ })).toBeVisible()

  await page.getByRole('button', { name: 'Aplicar a 2 productos' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, cambiar' }).click()
  await expect(page.getByText(/se cambió el precio de 2 productos/)).toBeVisible()

  const precio = (codigo: string) =>
    page.evaluate(
      async (c) =>
        ((await (await fetch(`/api/products/barcode/${c}`)).json()) as { price: string }).price,
      codigo,
    )
  expect(await precio(`7798${s}1`)).toBe('1390.00')

  await page.getByRole('button', { name: 'Deshacer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, deshacer' }).click()
  await expect(page.getByText(/Se devolvieron 2 precios/)).toBeVisible()
  expect(await precio(`7798${s}1`)).toBe('1234.00')
  expect(await precio(`7798${s}2`)).toBe('1000.00')
})

test('en el telefono las dos pantallas entran en el ancho', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await entrar(page, 'admin')

  await page.goto('/productos/importar')
  await subirCsv(
    page,
    'lista.csv',
    'Código;Descripción;Precio venta;Stock mínimo\n7790001000011;Yerba mate 1 kg;4.850;2\nx;;abc;\n',
  )
  await page.getByRole('button', { name: 'Revisar' }).click()
  await expect(page.getByText('3. Mirá qué va a pasar')).toBeVisible()
  await sinScrollHorizontal(page)
  await page.screenshot({ path: 'test-results/p0b-importar-movil.png', fullPage: true })

  await page.goto('/productos/precios')
  await page.getByLabel('Porcentaje (%)').fill('5')
  await page.getByRole('button', { name: 'Ver cómo quedan' }).click()
  await expect(page.getByText('3. Así quedan')).toBeVisible()
  await sinScrollHorizontal(page)
  await page.screenshot({ path: 'test-results/p0b-precios-movil.png', fullPage: true })
})
