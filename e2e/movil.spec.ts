import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar, escanear } from './ayudantes'

/**
 * La aplicacion en un telefono de 375 px.
 *
 * Casos obligatorios de la fase:
 *
 *   - la navegacion entra en 375 px;
 *   - todos los botones principales tienen al menos 44 px.
 *
 * La medicion de referencia decia que ANTES habia scroll horizontal en 7 de 7
 * rutas y 164 objetivos tactiles por debajo de 44 px, el mas chico de 20.
 */

const RUTAS = ['/', '/venta', '/caja', '/ventas', '/productos', '/stock', '/auditoria', '/usuarios', '/compras', '/compras/nueva', '/proveedores', '/proveedores/2', '/reportes', '/clientes'] // prettier-ignore

/**
 * true si la PAGINA se desplaza al costado.
 *
 * Se comprueba intentando desplazarla de verdad, no comparando anchos.
 * `documentElement.scrollWidth` cuenta tambien el contenido que desborda pero
 * esta recortado --una tabla ancha dentro de su propio `overflow-x-auto`, que
 * es exactamente lo que se quiere-- y daria un falso positivo.
 *
 * Lo que no debe pasar es que el usuario arrastre la pantalla entera y pierda
 * de vista la navegacion o el total.
 */
async function hayScrollHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const antes = window.scrollX
    window.scrollTo(500, window.scrollY)
    const movio = window.scrollX !== antes
    window.scrollTo(antes, window.scrollY)
    return movio
  })
}

/** Objetivos tactiles visibles por debajo del minimo. */
async function objetivosChicos(page: Page): Promise<Array<{ texto: string; lado: number }>> {
  return page.evaluate(() => {
    const salida: Array<{ texto: string; lado: number }> = []
    const seleccion = 'button, a[href], [role="button"], select, input[type="checkbox"]'

    for (const el of document.querySelectorAll(seleccion)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const estilo = getComputedStyle(el)
      if (estilo.visibility === 'hidden' || estilo.display === 'none') continue

      // El enlace de "saltar al contenido" esta recortado a un pixel hasta
      // que recibe el foco, y entonces sale a tamanio completo. No es un
      // objetivo tactil: no se puede tocar, solo se llega con Tab.
      if (el.classList.contains('sr-only-focusable')) continue

      const lado = Math.min(r.width, r.height)
      // 43: un pixel de tolerancia por el redondeo del navegador.
      if (lado < 43) {
        // `||` y no `??`: un boton de solo icono tiene textContent vacio, no
        // nulo, y lo que sirve para identificarlo en el informe es su
        // `aria-label`.
        const texto = (el.textContent || '').trim()
        const etiqueta = (el.getAttribute('aria-label') || '').trim()
        salida.push({ texto: (texto || etiqueta).slice(0, 40), lado: Math.round(lado) })
      }
    }
    return salida
  })
}

test.beforeEach(async ({ page }) => {
  await entrar(page, 'admin')
})

for (const ruta of RUTAS) {
  test(`${ruta} entra en 375 px sin scroll horizontal`, async ({ page }) => {
    await page.goto(ruta)
    await page.waitForTimeout(1500)

    expect(await hayScrollHorizontal(page), `${ruta} desborda a lo ancho`).toBe(false)
  })
}

test('la navegacion es un cajon, no una barra que envuelve', async ({ page }) => {
  await page.goto('/venta')

  // En movil la barra lateral no se dibuja.
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden()

  const abrir = page.getByRole('button', { name: 'Abrir el menú' })
  await expect(abrir).toBeVisible()
  await abrir.click()

  const cajon = page.getByRole('dialog', { name: 'Menú' })
  await expect(cajon).toBeAttached()

  const ancho = await cajon.evaluate((el) => el.getBoundingClientRect().width)
  expect(ancho, 'el cajon no entra en la pantalla').toBeLessThanOrEqual(375)

  // Navegar lo cierra: si no, queda encima de la pantalla nueva.
  await cajon.getByRole('link', { name: 'Productos', exact: true }).click()
  await expect(cajon).not.toBeAttached()
})

test('los botones principales llegan a 44 px', async ({ page }) => {
  const problemas: string[] = []

  for (const ruta of ['/venta', '/caja', '/productos', '/ventas']) {
    await page.goto(ruta)
    await page.waitForTimeout(1500)

    const chicos = await objetivosChicos(page)
    for (const c of chicos) problemas.push(`${ruta}: "${c.texto}" (${c.lado} px)`)
  }

  expect(problemas, `objetivos tactiles por debajo de 44 px:\n${problemas.join('\n')}`).toEqual([])
})

test('el total y el boton de cobrar se ven sin desplazarse', async ({ page }) => {
  await page.goto('/venta')
  await escanear(page, PRODUCTOS.yerba.codigo)
  await escanear(page, PRODUCTOS.leche.codigo)

  // La barra inferior esta fija: el total y el cobro no dependen del scroll.
  const cobrar = page.getByRole('button', { name: /^cobrar$/i })
  await expect(cobrar).toBeInViewport()

  await page.getByRole('button', { name: /^ticket/i }).click()
  const ticket = page.getByRole('dialog', { name: 'Ticket' })
  await expect(ticket.getByText('Total')).toBeVisible()
})

test('las tablas se convierten en tarjetas, no en scroll lateral', async ({ page }) => {
  await page.goto('/productos')
  await page.waitForTimeout(1500)

  // En movil no hay tabla: hay una lista.
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByRole('listitem').first()).toBeVisible()
  expect(await hayScrollHorizontal(page)).toBe(false)
})

test('el login entra en 375 px', async ({ page }) => {
  await page.goto('/login')
  await page.waitForTimeout(600)

  expect(await hayScrollHorizontal(page)).toBe(false)
  await expect(page.getByRole('textbox', { name: 'Usuario' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeInViewport()
})
