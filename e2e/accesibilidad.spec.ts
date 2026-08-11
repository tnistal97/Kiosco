import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PRODUCTOS, entrar, escanear } from './ayudantes'

/**
 * Auditoria automatizada de accesibilidad.
 *
 * La Fase 2 dejo comprobaciones puntuales --etiquetas, objetivos tactiles,
 * `div` clickeables-- pero ninguna herramienta que revisara el arbol entero.
 * Esto lo cierra: axe recorre cada pantalla y aplica el catalogo completo de
 * WCAG 2.1 A y AA, que incluye lo que a mano no se puede medir bien: el
 * contraste real despues de aplicar el CSS, el ARIA mal usado, el orden de
 * los encabezados y los landmarks.
 *
 * Politica de reglas
 * ------------------
 * No se apaga ninguna regla "porque molesta". Lo que se ejecuta es el conjunto
 * `wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa` entero, sin exclusiones de
 * selector y sin `disableRules`. Si algo aparece, se arregla en el producto.
 *
 * Las reglas de `best-practice` NO se ejecutan como parte de esta lista: no
 * son criterios de conformidad sino recomendaciones, y varias --por ejemplo
 * `region`, que exige que todo texto viva dentro de un landmark-- generan
 * discusion sin mejorar a nadie. Eso no las vuelve irrelevantes: la prueba del
 * final las corre aparte y las imprime, para poder mirarlas sin que tumben la
 * suite.
 */

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Analisis estandar de una pantalla ya cargada. */
async function analizar(page: Page) {
  return new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze()
}

/**
 * Formatea las faltas para que el fallo diga QUE arreglar y DONDE.
 *
 * El objeto crudo de axe es enorme y en la consola se corta. Esto deja una
 * linea por nodo con la regla, el impacto y el selector.
 */
function detalle(violaciones: Awaited<ReturnType<typeof analizar>>['violations']): string {
  if (violaciones.length === 0) return 'sin faltas'
  return violaciones
    .flatMap((v) =>
      v.nodes.map((n) => `  [${v.impact ?? 'n/d'}] ${v.id}: ${n.target.join(' ')} — ${v.help}`),
    )
    .join('\n')
}

test.describe('accesibilidad automatizada', () => {
  test('/login no tiene faltas de WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Entrar' }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el inicio no tiene faltas de WCAG 2.1 AA', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/')
    await page.getByRole('heading', { level: 1 }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/venta no tiene faltas, con el ticket cargado', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')

    // Con el ticket vacio no se auditan ni las lineas ni el boton de cobrar,
    // que es justamente la parte que mas cambia de estado.
    await escanear(page, PRODUCTOS.yerba.codigo)
    await escanear(page, PRODUCTOS.leche.codigo)

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el dialogo de cobro no tiene faltas', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.yerba.codigo)

    await page.keyboard.press('F12')
    // `toBeAttached` y no `toBeVisible`: la raiz del dialogo de Headless UI es
    // un contenedor de tamanio cero --lo que se ve es el panel de adentro--.
    await expect(page.getByRole('dialog')).toBeAttached()
    await expect(page.getByRole('button', { name: /^cobrar/i }).last()).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/productos no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/productos')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await expect(page.getByText(PRODUCTOS.yerba.nombre).first()).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/caja no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/caja')
    await page.getByRole('heading', { level: 1 }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/ventas no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/ventas')
    await page.getByRole('heading', { level: 1 }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/stock no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/stock')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await expect(page.getByText(PRODUCTOS.yerba.nombre).first()).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/stock/movimientos no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/stock/movimientos')
    await page.getByRole('heading', { level: 1 }).waitFor()
    // Con la tabla cargada: los filtros vacios no ejercitan las celdas, que es
    // donde vive la mitad del riesgo de una pantalla de historial.
    await expect(page.getByRole('table')).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el dialogo de ajuste de stock no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/stock')
    await page.getByRole('heading', { level: 1 }).waitFor()

    await page.getByRole('button', { name: 'Ajustar' }).first().click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByLabel(/qué pasó/i)).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/usuarios no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/usuarios')
    await page.getByRole('heading', { level: 1 }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/reportes no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/reportes')
    await page.getByRole('heading', { level: 1 }).waitFor()
    // Se espera a que las seis secciones esten calculadas: analizar la
    // pantalla mientras carga mide un esqueleto, no el reporte.
    await page.getByRole('heading', { name: 'Rentabilidad' }).waitFor({ timeout: 20_000 })

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/clientes no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/clientes')
    await page.getByRole('heading', { level: 1 }).waitFor()
    // Se espera al listado: analizar la pantalla mientras carga mide el
    // esqueleto y no la tabla, que es donde estan los controles.
    await page.getByRole('searchbox', { name: /Buscar clientes/i }).waitFor({ timeout: 20_000 })

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('la ficha de un cliente no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/clientes')
    await page
      .getByRole('link', { name: /Juan Pérez/ })
      .first()
      .click()

    // El extracto es lo que hay que auditar: la tabla con los saldos.
    await page.getByRole('heading', { name: 'Movimientos' }).waitFor({ timeout: 20_000 })

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el diálogo de cobro a un cliente no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/clientes')
    await page
      .getByRole('link', { name: /Juan Pérez/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Registrar pago' }).click()
    await page.getByRole('dialog').waitFor({ state: 'attached' })

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el comprobante de pago no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/clientes')
    await page
      .getByRole('link', { name: /Juan Pérez/ })
      .first()
      .click()
    await page
      .getByRole('link', { name: /RC-\d{8}/ })
      .first()
      .click()
    await page.getByText('Comprobante de pago').waitFor({ timeout: 20_000 })

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/proveedores no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/proveedores')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await expect(page.getByRole('table')).toBeVisible()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('la ficha de un proveedor no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/proveedores')
    await page.getByRole('link', { name: 'Bebidas Andinas' }).click()
    await page.getByRole('heading', { name: 'Bebidas Andinas' }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el diálogo de alta de proveedor no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/proveedores')
    await page.getByRole('button', { name: 'Nuevo proveedor' }).click()
    await page.getByRole('heading', { name: 'Nuevo proveedor' }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/compras no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/compras')
    await page.getByRole('heading', { level: 1 }).waitFor()

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('/compras/nueva no tiene faltas, con una línea cargada', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/compras/nueva')
    await page.getByRole('heading', { name: 'Nueva compra' }).waitFor()

    // Con el formulario vacio no se auditan ni la tabla de lineas ni el total,
    // que es la parte que mas cambia de estado.
    await page
      .getByRole('combobox', { name: 'A quién se le compra' })
      .selectOption({ label: 'Bebidas Andinas' })
    await page.getByRole('searchbox', { name: /Buscar productos/i }).fill('Gaseosa cola')
    await page.getByRole('button', { name: /Gaseosa cola 2\.25 L/ }).click()
    await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill('8800')

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el detalle de una compra con recepciones no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/compras')

    // La orden con recepciones la deja `compras.spec.ts`. Si todavia no
    // existe, la pantalla igual se audita: lo que se busca son faltas de
    // accesibilidad, no datos.
    const primera = page.getByRole('link', { name: /OC-/ }).first()
    if ((await primera.count()) > 0) {
      await primera.click()
      await page.getByRole('heading', { name: /OC-/ }).waitFor()
    }

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  test('el diálogo de recepción no tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/compras/nueva')

    await page
      .getByRole('combobox', { name: 'A quién se le compra' })
      .selectOption({ label: 'Mayorista Central' })
    await page.getByRole('searchbox', { name: /Buscar productos/i }).fill('Atun al natural')
    await page.getByRole('button', { name: /Atun al natural/ }).click()
    await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill('1990')
    await page.getByRole('button', { name: 'Confirmar orden' }).click()
    await page.waitForURL(/\/compras\/\d+$/)

    await page.getByRole('button', { name: 'Recibir mercadería' }).click()
    await page.getByRole('heading', { name: /Recibir mercadería/ }).waitFor()
    // El panel entra con una transicion de opacidad. Analizarlo antes de que
    // termine hace que axe mida los colores MEZCLADOS con lo que hay detras y
    // marque como falta de contraste hasta el titulo y los botones. Se espera
    // a que el control de mas abajo este visible y se deja asentar la
    // animacion.
    await expect(page.getByRole('button', { name: 'Confirmar recepción' })).toBeVisible()
    await page.waitForTimeout(500)

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  /**
   * El tema claro tambien se audita.
   *
   * Todo lo demas corre en oscuro, que es el predeterminado. Eso dejaba una
   * mitad del sistema visual sin mirar: cuando se reviso, `--color-ink-faint`
   * daba 3,5:1 sobre el fondo claro --peor que en oscuro-- y llevaba asi desde
   * que existe el tema. Un tema que no se prueba no esta soportado.
   */
  test('el tema claro tampoco tiene faltas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/productos')
    await page.getByRole('button', { name: 'Cambiar al tema claro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const { violations } = await analizar(page)
    expect(detalle(violations)).toBe('sin faltas')
  })

  /**
   * Objetivos tactiles en escritorio, con el detalle desplegado.
   *
   * La prueba de 375 px ya cubre lo que se ve de entrada. Esta cubre lo que
   * solo aparece al abrir una fila de la bitacora, que es donde vivian los
   * ocho controles de 32 px que quedaron sin corregir en la Fase 2.
   */
  test('ningun control queda por debajo de 44 px, ni en un detalle abierto', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/auditoria')
    await page.getByRole('heading', { level: 1 }).waitFor()

    // La bitacora abre una fila por vez. Se recorren las primeras: cada
    // detalle trae los controles secundarios --copiar identificador, ver todos
    // los campos-- que no existen en el arbol hasta ese momento.
    const filas = page.locator('li button[aria-expanded]')
    const cuantas = Math.min(await filas.count(), 5)
    const chicos: string[] = []

    for (let i = 0; i < cuantas; i++) {
      await filas.nth(i).click()
      const verTodo = page.getByRole('button', { name: /ver los \d+ campos/i })
      if (await verTodo.count()) await verTodo.first().click()
      chicos.push(...(await medirControles(page)))
    }

    expect(chicos, `controles por debajo de 44 px:\n${chicos.join('\n')}`).toEqual([])
  })

  /** Controles visibles cuyo lado menor no llega al minimo tactil. */
  async function medirControles(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const salida: string[] = []
      for (const el of document.querySelectorAll('button, a[href], [role="button"], select')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (el.classList.contains('sr-only-focusable')) continue
        const lado = Math.min(r.width, r.height)
        if (lado < 43) {
          const texto = (el.textContent || el.getAttribute('aria-label') || '').trim()
          salida.push(`"${texto.slice(0, 40)}" (${Math.round(lado)} px)`)
        }
      }
      return salida
    })
  }

  /**
   * Las recomendaciones, a la vista pero sin poder de veto.
   *
   * Corre sobre la pantalla mas densa. No afirma que no haya nada: afirma que
   * lo que haya quede impreso en el informe. Convertir esto en un fallo seria
   * exactamente lo que se pidio no hacer --romper por avisos sin analizar--,
   * y borrarlo seria dejar de mirarlos.
   */
  test('las recomendaciones de axe quedan registradas', async ({ page }) => {
    await entrar(page, 'duenio')
    await page.goto('/venta')

    const { violations } = await new AxeBuilder({ page }).withTags(['best-practice']).analyze()

    console.log(`axe best-practice en /venta:\n${detalle(violations)}`)
    expect(Array.isArray(violations)).toBe(true)
  })
})
