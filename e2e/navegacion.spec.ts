import { test, expect } from '@playwright/test'
import { entrar } from './ayudantes'

/**
 * Navegacion, armazon y sesion. UX V2, Fase 2.1.
 *
 * La fase arranco con una percepcion: "al ir de una pantalla a otra la
 * aplicacion se traba, el menu desaparece, queda rara, parece que la sesion
 * vencio". Lo que se prueba aca es cada una de esas frases, convertida en algo
 * que se pueda comprobar:
 *
 *   - ir y volver entre pantallas no deja nunca la aplicacion sin armazon;
 *   - la barra lateral no se desmonta al navegar (el mismo nodo del DOM sigue
 *     ahi: si se remontara, se perderia su estado y se veria el parpadeo);
 *   - sin sesion, la aplicacion lo DICE y ofrece volver al mismo lugar;
 *   - un 401 en cualquier consulta se lee como sesion vencida, no como un
 *     error de la pantalla;
 *   - un 403 NO es una sesion vencida, y se sigue distinguiendo.
 */

/** Marca el nodo actual de la barra lateral para reconocerlo despues. */
async function marcarArmazon(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const aside = document.querySelector('aside')
    if (aside) aside.setAttribute('data-marca-de-prueba', '1')
  })
}

test.describe('Ir y volver entre pantallas', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, 'encargado')
  })

  test('1. venta → inicio → venta: el armazon nunca se va', async ({ page }) => {
    await page.goto('/venta')
    await expect(page.locator('[data-barcode-input]')).toBeVisible()
    await marcarArmazon(page)

    const menu = page.locator('aside')
    await menu.getByRole('link', { name: 'Inicio', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible()
    // Mismo nodo: la barra lateral no se volvio a montar en el camino.
    await expect(menu).toHaveAttribute('data-marca-de-prueba', '1')

    await menu.getByRole('link', { name: 'Venta', exact: true }).click()
    await expect(page.locator('[data-barcode-input]')).toBeVisible()
    await expect(menu).toHaveAttribute('data-marca-de-prueba', '1')
  })

  test('2. la barra lateral está en todas las pantallas de la ronda', async ({ page }) => {
    const menu = page.locator('aside')
    for (const ruta of ['/', '/venta', '/caja', '/ventas', '/clientes', '/productos', '/stock']) {
      await page.goto(ruta)
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible()
      // Y el contenido, dentro del armazon: nunca una pantalla suelta.
      await expect(page.locator('main')).toBeVisible()
    }
  })

  test('3. volver con el botón del navegador no rompe nada', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside').getByRole('link', { name: 'Productos', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible()

    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Inicio' })).toBeVisible()
    await expect(page.locator('aside')).toBeVisible()
  })
})

test.describe('Cuando la sesión ya no vale', () => {
  // Sin service worker: en la construccion de produccion, Serwist intercepta
  // las peticiones antes que el navegador, y entonces `page.route` --que
  // trabaja del lado de la pagina-- no las ve. Las dos pruebas que simulan un
  // 401 y un 403 necesitan poder responder ellas.
  test.use({ serviceWorkers: 'block' })

  test('4. sin sesión, el middleware manda al ingreso y guarda a dónde iba', async ({ page }) => {
    await page.context().clearCookies()
    const respuesta = await page.goto('/caja')
    expect(respuesta?.status()).toBe(200)
    await expect(page).toHaveURL(/\/login\?next=%2Fcaja/)
    // Y despues de entrar, vuelve al lugar, no a la portada.
    await page.getByRole('textbox', { name: 'Usuario' }).fill('encargado')
    await page.locator('input[name="password"]').fill('Demo1234!')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/caja$/)
  })

  test('5. un token inservible no deja la pantalla a medias: manda al ingreso', async ({
    page,
  }) => {
    await entrar(page, 'encargado')
    await page.context().addCookies([
      {
        name: 'token',
        value: 'esto.no.es.un.token',
        domain: '127.0.0.1',
        path: '/',
      },
    ])

    await page.goto('/venta')
    await expect(page).toHaveURL(/\/login\?next=%2Fventa/)
    // La cookie rota se limpia: si no, se entra en un bucle de redirecciones.
    const cookies = await page.context().cookies()
    expect(cookies.find((c) => c.name === 'token')?.value ?? '').toBe('')
  })

  test('6. un 401 mientras se trabaja se lee como sesión vencida, no como error', async ({
    page,
  }) => {
    await entrar(page, 'encargado')
    await page.goto('/productos')
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible()

    // El servidor deja de reconocer la sesion en medio del trabajo.
    await page.route(/\/api\/products/, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'SESSION_EXPIRED', message: 'La sesion expiro.', requestId: 'prueba' },
        }),
      })
    })
    await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('yerba')

    // `toBeAttached` y no `toBeVisible`: el nodo con `role="dialog"` es un
    // envoltorio sin caja propia --sus hijos van con `position: fixed`--, asi
    // que Playwright lo da por invisible. Es el mismo criterio que usa el
    // resto de la suite para los dialogos.
    const aviso = page.getByRole('dialog', { name: 'Tu sesión venció' })
    await expect(aviso).toBeAttached()
    await expect(aviso.getByText('Tu sesión venció')).toBeVisible()
    await expect(aviso.getByRole('link', { name: 'Volver a ingresar' })).toHaveAttribute(
      'href',
      '/login?next=%2Fproductos',
    )
    // El armazon sigue entero detras del aviso.
    await expect(page.locator('aside')).toBeVisible()
  })

  test('7. un 403 NO dice que la sesión venció: es un permiso que falta', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/productos')
    await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible()

    await page.route(/\/api\/products/, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FORBIDDEN', message: 'No tiene permiso.', requestId: 'prueba' },
        }),
      })
    })
    await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('yerba')

    await expect(page.getByRole('dialog', { name: 'Tu sesión venció' })).not.toBeAttached()
  })
})
