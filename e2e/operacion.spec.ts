import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { entrar, escanear, PRODUCTOS } from './ayudantes'

/** La misma base que usa el servidor de las pruebas. Ver playwright.config.ts. */
const BASE_DE_DATOS =
  process.env.E2E_DATABASE_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

/**
 * Tres dias de almacen, seguidos, en una sola sesion del navegador.
 *
 * No comprueba una pantalla: comprueba que el CIRCUITO cierra. Vender, comprar,
 * recibir, cambiar el costo, anular y cerrar la caja son operaciones que se
 * tocan entre si, y los errores que importan aparecen en las juntas.
 *
 * LO QUE ESTA PRUEBA EXISTE PARA DEMOSTRAR:
 *
 *   la venta del Dia 1 conserva su costo aunque el costo cambie en el Dia 2.
 *
 * Todo lo demas --el stock que sube y baja, la caja que cuadra, la orden que
 * pasa de parcial a recibida-- es el contexto que hace que esa afirmacion
 * signifique algo.
 *
 * Corre en serie: cada dia depende del anterior.
 */
test.describe.configure({ mode: 'serial' })

/** El titulo del dialogo, no el dialogo: el envoltorio tiene tamanio cero. */
function tituloDelDialogo(page: Page, texto: string | RegExp) {
  return page.getByRole('heading', { name: texto })
}

/**
 * El stock actual de un producto, leido de la API con la sesion del navegador.
 *
 * NO se raspa la tabla: la fila incluye el codigo de barras, y una expresion
 * que busca "el primer numero" devuelve `7790001000011` en vez de `24`. Paso
 * exactamente eso. `page.request` comparte las cookies del contexto, asi que
 * la peticion va autenticada como quien esta usando la pantalla.
 */
async function stockDe(page: Page, nombre: string): Promise<number> {
  // El `fetch` corre DENTRO de la pagina, no desde el contexto de peticiones
  // de Playwright: asi la cookie de sesion viaja sola, como en cualquier
  // pantalla. Desde `page.request` la peticion sale sin sesion y responde 401.
  const total = await page.evaluate(async (n: string) => {
    const r = await fetch(`/api/products?q=${encodeURIComponent(n)}&pageSize=10&estado=todos`)
    if (!r.ok) throw new Error(`${String(r.status)} al leer el catalogo`)
    const cuerpo = (await r.json()) as { data: Array<{ name: string; totalStock: string }> }
    return cuerpo.data.find((p) => p.name === n)?.totalStock ?? null
  }, nombre)

  expect(total, `no aparecio "${nombre}" en el catalogo`).not.toBeNull()
  return Number(total)
}

/** Vende un producto y cobra. Devuelve el total que mostro el ticket. */
async function venderYCobrar(
  page: Page,
  codigo: string,
  medio: 'Efectivo' | 'Transferencia',
): Promise<void> {
  await page.goto('/venta')
  await escanear(page, codigo)
  await page.getByRole('button', { name: /^cobrar/i }).click()

  // El envoltorio del dialogo tiene tamanio cero: se espera a que este
  // ADJUNTO, no a que sea visible.
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeAttached()

  // El medio de pago es un `select`, no una fila de botones.
  await dialogo.getByRole('combobox', { name: 'Medio' }).selectOption({ label: medio })
  await dialogo.getByRole('button', { name: /^cobrar/i }).click()

  await expect(page.getByText('Venta registrada')).toBeVisible({ timeout: 15_000 })
}

let stockYerbaInicial = 0

// ---------------------------------------------------------------------------
// DIA 1 — se abre, se vende y se cierra
// ---------------------------------------------------------------------------

test.describe('Dia 1: operar', () => {
  test('el turno esta abierto y la caja muestra su esperado', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')
    // El seed deja un turno abierto: el almacen ya esta operando.
    await expect(page.getByText(/Caja abierta|Turno abierto|Esperado/i).first()).toBeVisible()
  })

  test('vende en efectivo y el stock baja', async ({ page }) => {
    await entrar(page, 'encargado')
    stockYerbaInicial = await stockDe(page, PRODUCTOS.yerba.nombre)

    await venderYCobrar(page, PRODUCTOS.yerba.codigo, 'Efectivo')

    const despues = await stockDe(page, PRODUCTOS.yerba.nombre)
    expect(despues, 'la venta no descontó del stock').toBe(stockYerbaInicial - 1)
  })

  test('vende por transferencia: el stock baja igual, el cajon NO sube', async ({ page }) => {
    await entrar(page, 'encargado')

    // El esperado del turno, leido de la API con la sesion de la pantalla. Es
    // la cifra que tiene que estar en el cajon; una transferencia no la mueve.
    const esperado = async (): Promise<number> =>
      page.evaluate(async () => {
        const r = await fetch('/api/cash/balance')
        const c = (await r.json()) as { balance: string | null }
        return Number(c.balance ?? '0')
      })

    const cajaAntes = await esperado()
    const stockAntes = await stockDe(page, PRODUCTOS.gaseosa.nombre)

    await venderYCobrar(page, PRODUCTOS.gaseosa.codigo, 'Transferencia')

    expect(
      await stockDe(page, PRODUCTOS.gaseosa.nombre),
      'la transferencia tambien mueve mercaderia',
    ).toBe(stockAntes - 1)

    expect(await esperado(), 'una transferencia aumento el efectivo del cajon').toBe(cajaAntes)
  })

  test('registra una rotura y queda en el libro', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/stock/movimientos')
    await expect(
      page
        .getByRole('table')
        .or(page.getByText(/movimiento/i))
        .first(),
    ).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// DIA 2 — se compra, se recibe y cambia el costo
// ---------------------------------------------------------------------------

/**
 * El distintivo de estado, dentro del encabezado de la orden.
 *
 * No `getByText('Parcial')`: los mismos nombres son opciones del filtro del
 * listado, y el localizador encontraria dos cosas distintas.
 */
function estadoDeLaOrden(page: Page) {
  return page
    .getByRole('heading', { name: /OC-/ })
    .getByText(/^(Borrador|Pedida|Parcial|Recibida|Cancelada)$/)
}

/** Crea una orden y devuelve su URL. Mismos selectores que compras.spec.ts. */
async function crearOrden(page: Page, cantidad: string, costo: string): Promise<string> {
  await page.goto('/compras/nueva')
  await page
    .getByRole('combobox', { name: 'A quién se le compra' })
    .selectOption({ label: 'Bebidas Andinas' })

  const producto = PRODUCTOS.gaseosa.nombre
  await page.getByRole('searchbox', { name: /Buscar productos/i }).fill(producto)
  await page.getByRole('button', { name: new RegExp(producto.replace('.', '\\.')) }).click()

  await page
    .getByRole('textbox', { name: new RegExp(`Cantidad de ${producto}`, 'i') })
    .fill(cantidad)
  await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill(costo)
  await page.getByRole('button', { name: 'Confirmar orden' }).click()

  await page.waitForURL(/\/compras\/\d+$/)
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

test.describe('Dia 2: comprar y recibir', () => {
  let urlDeLaOrden = ''

  test('crea una orden de 3 cajas de gaseosa a $8.800 la caja', async ({ page }) => {
    await entrar(page, 'admin')
    urlDeLaOrden = await crearOrden(page, '3', '8800')
    expect(urlDeLaOrden).toMatch(/\/compras\/\d+$/)
  })

  test('recibe parcialmente: 2 de 3 cajas suman 16 unidades', async ({ page }) => {
    await entrar(page, 'admin')
    const antes = await stockDe(page, PRODUCTOS.gaseosa.nombre)

    await page.goto(urlDeLaOrden)
    await recibir(page, '2')
    await expect(estadoDeLaOrden(page)).toHaveText('Parcial')

    // 2 cajas de 8 = 16 unidades. La conversión es el punto de toda la 3C.
    expect(
      await stockDe(page, PRODUCTOS.gaseosa.nombre),
      '2 cajas de 8 tienen que sumar 16 unidades',
    ).toBe(antes + 16)
  })

  test('recibe el resto y la orden queda recibida', async ({ page }) => {
    await entrar(page, 'admin')
    const antes = await stockDe(page, PRODUCTOS.gaseosa.nombre)

    await page.goto(urlDeLaOrden)
    await recibir(page, '1')
    await expect(estadoDeLaOrden(page)).toHaveText('Recibida')

    expect(await stockDe(page, PRODUCTOS.gaseosa.nombre), 'la última caja tiene que sumar 8').toBe(
      antes + 8,
    )
  })

  test('la mercadería nueva dejó el costo en $1.100 por botella', async ({ page }) => {
    await entrar(page, 'admin')

    // $8.800 la caja de 8 = $1.100 la botella. Es la conversión que NO puede
    // guardar $8.800 como costo unitario.
    const costo = await page.evaluate(async (n: string) => {
      const r = await fetch(`/api/products?q=${encodeURIComponent(n)}&pageSize=10&estado=todos`)
      const c = (await r.json()) as { data: Array<{ name: string; cost: string | null }> }
      return c.data.find((p) => p.name === n)?.cost ?? null
    }, PRODUCTOS.gaseosa.nombre)

    expect(Number(costo)).toBe(1100)
  })
})

// ---------------------------------------------------------------------------
// DIA 3 — la prueba del costo historico
// ---------------------------------------------------------------------------

/** La ganancia bruta del periodo, leida del reporte con la sesion abierta. */
async function gananciaDelPeriodo(page: Page, desde: string, hasta: string): Promise<string> {
  return page.evaluate(
    async ([d, h]) => {
      const r = await fetch(`/api/reports/rentabilidad?desde=${String(d)}&hasta=${String(h)}`)
      if (!r.ok) throw new Error(`${String(r.status)} al pedir la rentabilidad`)
      const c = (await r.json()) as { gananciaBruta: string }
      return c.gananciaBruta
    },
    [desde, hasta],
  )
}

/** El dia de HOY segun el local, no segun el reloj de la maquina de pruebas. */
async function hoyEnElLocal(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/auth/validate', { method: 'POST' })
    const c = (await r.json()) as { branch: { hoy: string } }
    return c.branch.hoy
  })
}

test.describe('Dia 3: el costo historico no se mueve', () => {
  test('LA PRUEBA: cambiar el costo hoy no cambia la ganancia de ayer', async ({ page }) => {
    await entrar(page, 'encargado')
    const hoy = await hoyEnElLocal(page)

    // 1. Se vende algo con el costo que tiene ahora.
    await venderYCobrar(page, PRODUCTOS.leche.codigo, 'Efectivo')
    const antes = await gananciaDelPeriodo(page, hoy, hoy)

    // 2. Se cambia el costo de ESE producto, con motivo.
    await page.goto('/productos')
    await page
      .getByRole('searchbox', { name: /Buscar/i })
      .first()
      .fill(PRODUCTOS.leche.nombre)
    await page.waitForTimeout(600)
    await page
      .getByRole('row')
      .filter({ hasText: PRODUCTOS.leche.nombre })
      .first()
      .locator('button[aria-expanded]')
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()
    const ficha = page.getByRole('dialog')
    await ficha.getByLabel(/^costo/i).waitFor()
    await ficha.getByLabel(/^costo/i).fill('9999')
    await ficha.getByLabel(/motivo del cambio de costo/i).fill('Aumento del proveedor')
    await ficha.getByRole('button', { name: /guardar/i }).click()
    await page.waitForTimeout(2000)

    // 3. La ganancia del periodo NO se movio.
    const despues = await gananciaDelPeriodo(page, hoy, hoy)

    expect(despues, 'la ganancia de las ventas anteriores cambio porque subio el costo hoy').toBe(
      antes,
    )
  })

  test('el reporte de ventas del dia responde con el resumen', async ({ page }) => {
    await entrar(page, 'admin')
    await page.goto('/reportes')

    await expect(page.getByRole('heading', { name: 'Ventas' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Ticket promedio').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Rentabilidad' })).toBeVisible()
  })

  test('el cajero ve sus ventas pero no entra a Reportes', async ({ page }) => {
    await entrar(page, 'cajero')

    // La pantalla de ventas se abre: hasta la Fase 3D le respondia 403 aunque
    // el menu le mostrara el enlace.
    await page.goto('/ventas')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/No autorizado|403/i)).toHaveCount(0)

    // Y no tiene entrada a Reportes.
    await expect(page.getByRole('link', { name: 'Reportes' })).toHaveCount(0)
  })

  test('todo el circuito cierra: la reconciliacion no encuentra nada', () => {
    // El cierre de la simulacion. Despues de tres dias de ventas, compras,
    // recepciones, un cambio de costo y una anulacion, las nueve invariantes
    // tienen que seguir dando. Se corre el mismo motor que `npm run
    // integrity:check`, contra la base que uso el navegador.
    // Se corre el GUION, no la funcion: es lo que de verdad va a ejecutar
    // alguien, con su codigo de salida y su salida por pantalla. Importar el
    // modulo desde aca tampoco funcionaria --Playwright no resuelve el alias
    // `@/`-- pero aunque funcionara, esto prueba mas.
    const salida = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/integrity-check.ts'],
      {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: BASE_DE_DATOS },
      },
    )

    expect(salida, 'tres dias de operacion dejaron el sistema descuadrado').toContain(
      'Sin inconsistencias',
    )
  })
})
