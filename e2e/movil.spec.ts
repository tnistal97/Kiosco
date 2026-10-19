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

const RUTAS = ['/', '/venta', '/caja', '/caja/abrir', '/caja/cerrar', '/ventas', '/productos', '/stock', '/auditoria', '/usuarios', '/compras', '/compras/nueva', '/proveedores', '/proveedores/2', '/reportes', '/clientes', '/devoluciones', '/stock/lotes', '/stock/lotes/1', '/stock/movimientos', '/inventarios', '/inventarios/1'] // prettier-ignore

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

test('con el dedo: tocar una fila de la lista la manda al carrito', async ({ page }) => {
  await page.goto('/venta')
  await page.evaluate(() => {
    localStorage.removeItem('kiosco:ticket')
  })
  await page.goto('/venta')

  // La lista se ve sin escribir nada, tambien en 375 px.
  const filas = page.locator('[data-fila]')
  await expect(filas.first()).toBeVisible()

  // Un toque, no un clic con el raton: es lo que hace el dedo en el mostrador.
  const primera = filas.first()
  const nombre = ((await primera.getAttribute('aria-label')) ?? '').split(', ')[0] ?? ''
  await primera.tap()

  await expect(page.getByRole('button', { name: /^carrito/i })).toContainText('1 artículo')
  await page.getByRole('button', { name: /^carrito/i }).click()
  await expect(
    page.getByRole('dialog', { name: /carrito/i }).getByText(nombre, { exact: true }),
  ).toBeVisible()
})

test('el total y el boton de cobrar se ven sin desplazarse', async ({ page }) => {
  await page.goto('/venta')
  await escanear(page, PRODUCTOS.yerba.codigo)
  await escanear(page, PRODUCTOS.leche.codigo)

  // La barra inferior esta fija: el total y el cobro no dependen del scroll.
  const cobrar = page.getByRole('button', { name: /^cobrar$/i })
  await expect(cobrar).toBeInViewport()
  // Y el total entra entero en su boton: no se corta contra Cobrar.
  const boton = page.getByRole('button', { name: /^carrito/i })
  const entra = await boton.evaluate((b) => {
    const monto = b.querySelector('.money')
    return monto !== null && monto.getBoundingClientRect().right <= b.getBoundingClientRect().right
  })
  expect(entra).toBe(true)

  await page.getByRole('button', { name: /^carrito/i }).click()
  const ticket = page.getByRole('dialog', { name: /carrito/i })
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

test('el alta rápida entra en 375 px y se puede completar', async ({ page }) => {
  // Fase 5A.1. El diálogo tiene siete campos: es el formulario más largo que
  // aparece en la caja, y la caja también se usa desde un teléfono.
  await page.goto('/venta')
  await escanear(page, '7799200000015')

  await expect(page.getByText('Código no registrado')).toBeVisible()
  expect(await hayScrollHorizontal(page)).toBe(false)

  await page.getByRole('button', { name: 'Crear producto' }).click()
  const dialogo = page.getByRole('dialog')
  // `toBeAttached` y no `toBeVisible`: el nodo con `role="dialog"` de Headless
  // UI es un envoltorio sin tamaño; lo que se ve es el panel de adentro.
  await expect(dialogo).toBeAttached()
  await expect(dialogo.getByRole('heading', { level: 2 })).toBeVisible()

  // Nada se sale de la pantalla, ni con el diálogo abierto.
  expect(await hayScrollHorizontal(page)).toBe(false)

  // La categoría por omisión tiene que estar puesta antes de escribir: es lo
  // que habilita el botón, y sin esperarla la prueba mide una carrera.
  await expect(dialogo.getByRole('combobox', { name: /^Categoría/ })).toHaveValue(/\d+/)

  const nombre = dialogo.getByLabel('Nombre')
  await nombre.fill('Creado desde el teléfono')
  await expect(nombre).toHaveValue('Creado desde el teléfono')
  const precio = dialogo.getByLabel(/^Precio/)
  await precio.fill('650')
  await expect(precio).toHaveValue('650')

  // Siete campos no entran en 812 px de alto: el diálogo scrollea POR DENTRO,
  // que es lo correcto. Lo que no debe pasar --y se comprueba arriba-- es que
  // scrollee la página entera.
  const confirmar = dialogo.getByRole('button', { name: /crear y agregar/i })
  await confirmar.scrollIntoViewIfNeeded()
  await expect(confirmar).toBeInViewport()
  await expect(confirmar).toBeEnabled()
  await confirmar.click()

  await page.getByRole('button', { name: /^carrito/i }).click()
  await expect(
    page
      .getByRole('dialog', { name: /carrito/i })
      .getByText('Creado desde el teléfono', { exact: true }),
  ).toBeVisible()
})

/**
 * Escribir "10,5" desde el telefono, en los tres anchos que se pidieron.
 *
 * Lo que decide el teclado que aparece es `inputMode`: con `decimal` el
 * telefono ofrece la coma; con `numeric` no hay forma de escribir medio kilo.
 * Y lo escrito tiene que llegar al servidor como diez kilos y medio, no como
 * diez mil quinientos ni como un error de formato.
 */
for (const [ancho, codigo] of [
  [375, '7799300000034'],
  [390, '7799300000041'],
  [430, '7799300000058'],
] as const) {
  test(`en ${String(ancho)} px se escribe 10,5 kg con el teclado decimal`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 })
    await page.goto('/venta')
    await escanear(page, codigo)
    await page.getByRole('button', { name: 'Crear producto' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()
    await expect(dialogo.getByRole('combobox', { name: /^Categoría/ })).toHaveValue(/\d+/)

    const nombre = `Peso desde ${String(ancho)} px`
    await dialogo.getByLabel('Nombre').fill(nombre)
    await dialogo.getByRole('combobox', { name: /Unidad de venta/ }).selectOption('KG')
    await dialogo.getByLabel(/^Precio/).fill('9000')

    const stock = dialogo.getByLabel(/Stock inicial/)
    await expect(stock, 'el teclado del telefono tiene que ofrecer la coma').toHaveAttribute(
      'inputmode',
      'decimal',
    )
    await stock.click()
    await stock.pressSequentially('10,5', { delay: 20 })
    await expect(stock).toHaveValue('10,5')

    expect(await hayScrollHorizontal(page)).toBe(false)

    const confirmar = dialogo.getByRole('button', { name: /crear y agregar/i })
    await confirmar.scrollIntoViewIfNeeded()
    await confirmar.click()

    // Se vende por kilo: recien creado, pide el peso. Tambien con la coma.
    const peso = page.getByLabel(/^Peso$/)
    await expect(peso).toHaveAttribute('inputmode', 'decimal')
    await peso.fill('1,5')
    await page.getByRole('button', { name: 'Agregar' }).click()

    await page.getByRole('button', { name: /^carrito/i }).click()
    await expect(
      page.getByRole('dialog', { name: /carrito/i }).getByText(nombre, { exact: true }),
    ).toBeVisible()

    // Diez kilos y medio en el servidor: ni 10.500 ni un 400.
    const stockGuardado = await page.evaluate(async (n: string) => {
      const r = await fetch(`/api/products?q=${encodeURIComponent(n)}&pageSize=10&estado=todos`)
      const c = (await r.json()) as { data: Array<{ name: string; totalStock: string }> }
      return c.data.find((p) => p.name === n)?.totalStock ?? null
    }, nombre)
    expect(stockGuardado).toBe('10.500')
  })
}
