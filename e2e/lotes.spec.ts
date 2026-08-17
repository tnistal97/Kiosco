import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { entrar, escanear, salir, totalDelTicket } from './ayudantes'

/**
 * Lotes, vencimientos e inventario físico, de punta a punta.
 *
 * Los veinticinco casos de la Fase 4D, y NINGUNO comprueba "respondió 200".
 * Cada uno afirma un hecho del dominio: qué partida salió, cuánto quedó en cada
 * saldo, qué se rechazó y por qué.
 *
 * CÓMO SE VERIFICA. El flujo se maneja por la pantalla --que es lo que hay que
 * probar-- y los saldos se leen con `fetch` DENTRO de la página, que es como lo
 * hacen las pruebas de la Fase 3D: raspar una tabla devuelve el código de
 * barras cuando uno busca "el primer número", y eso ya pasó una vez. La cookie
 * de sesión viaja sola, así que la lectura sale autenticada como quien está
 * usando el sistema.
 *
 * LOS DATOS salen de `prisma/seed-demo.ts`:
 *
 *   Yogur      REQUIRED/REQUIRED  dos partidas, una vence en 7 días y otra en 25
 *   Leche      OPTIONAL/OPTIONAL  LP-2510 VENCIDA (4) y LP-2604 vence hoy (6)
 *   Lavandina  OPTIONAL/NONE      LV-A7734 sin fecha (10)
 */

const YOGUR = 'Yogur'
const LECHE = 'Leche entera 1 L'
const LAVANDINA = 'Lavandina'
const QUESO = 'Queso cremoso'
const CODIGO_LECHE = '7790003000017'

// ---------------------------------------------------------------------------
// Lecturas del dominio
// ---------------------------------------------------------------------------

interface Desglose {
  productId: number
  productName: string
  lotTracking: string
  expirationTracking: string
  total: string
  enLotes: string
  sinAsignar: string
  vendible: string
  vencido: string
  lotes: Array<{ id: number; code: string; quantity: string; estado: string }>
}

async function api<T>(page: Page, ruta: string): Promise<T> {
  return page.evaluate(async (r: string) => {
    const res = await fetch(r)
    if (!res.ok) throw new Error(`${String(res.status)} al pedir ${r}`)
    return (await res.json()) as T
  }, ruta)
}

/** El id de un producto por nombre. Los ids cambian en cada siembra. */
async function idDe(page: Page, nombre: string): Promise<number> {
  const cuerpo = await api<{ data: Array<{ id: number; name: string }> }>(
    page,
    `/api/products?q=${encodeURIComponent(nombre)}&pageSize=20&estado=todos`,
  )
  const p = cuerpo.data.find((x) => x.name.startsWith(nombre))
  expect(p, `no apareció "${nombre}" en el catálogo`).toBeDefined()
  return p?.id ?? 0
}

/** El desglose por partida: es la fuente de `BranchStock` y `BranchLotStock`. */
async function desglose(page: Page, nombre: string): Promise<Desglose> {
  return api<Desglose>(page, `/api/productos/${String(await idDe(page, nombre))}/lotes`)
}

interface MovimientoDTO {
  type: string
  quantity: string
  lotCode: string | null
  reason: string | null
}

/** El código de barras principal, para poder escanearlo. */
async function codigoDe(page: Page, nombre: string): Promise<string> {
  const cuerpo = await api<{ data: Array<{ name: string; barcode: string | null }> }>(
    page,
    `/api/products?q=${encodeURIComponent(nombre)}&pageSize=20&estado=todos`,
  )
  const codigo = cuerpo.data.find((x) => x.name.startsWith(nombre))?.barcode
  expect(codigo, `"${nombre}" tiene código de barras`).toBeTruthy()
  return codigo ?? ''
}

/** El libro de inventario de un producto. Necesita `inventory.movements.view`. */
async function movimientosDe(page: Page, nombre: string): Promise<MovimientoDTO[]> {
  const r = await api<{ data: MovimientoDTO[] }>(
    page,
    `/api/inventory/movements?productId=${String(await idDe(page, nombre))}&pageSize=20`,
  )
  return r.data
}

function cantidadDelLote(d: Desglose, code: string): number {
  return Number(d.lotes.find((l) => l.code === code)?.quantity ?? '0')
}

/** El título del diálogo abierto: el envoltorio de Headless UI tiene tamaño cero. */
function dialogo(page: Page) {
  return page.getByRole('dialog')
}

async function abrirFichaDeProducto(page: Page, nombre: string) {
  await page.goto('/productos')
  await page.getByRole('searchbox').first().fill(nombre)
  await page.waitForTimeout(900)
  await page
    .getByRole('row')
    .filter({ hasText: nombre })
    .first()
    .locator('button[aria-expanded]')
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  await dialogo(page).getByRole('heading').first().waitFor()
  return dialogo(page)
}

// ---------------------------------------------------------------------------
// 1-2. Política del producto e inicialización del stock existente
// ---------------------------------------------------------------------------

test.describe('Política de trazabilidad', () => {
  test('1. el producto muestra sus dos políticas y la regla entre ellas', async ({ page }) => {
    await entrar(page, 'encargado')
    const ficha = await abrirFichaDeProducto(page, YOGUR)

    // Las DOS banderas, cada una con su grupo de opciones.
    await expect(ficha.getByRole('group', { name: 'Lotes' })).toBeVisible()
    await expect(ficha.getByRole('group', { name: 'Vencimiento' })).toBeVisible()

    // El yogur llega del seed con las dos obligatorias.
    await expect(ficha.getByRole('radio', { name: /lotes obligatorios/i })).toBeChecked()
    await expect(ficha.getByRole('radio', { name: /vencimiento obligatorio/i })).toBeChecked()

    // Y el desglose dice que no queda nada sin explicar: es lo que REQUIRED
    // promete.
    const d = await desglose(page, YOGUR)
    expect(Number(d.sinAsignar), 'un producto REQUIRED no tiene stock sin partida').toBe(0)
    expect(Number(d.enLotes)).toBe(Number(d.total))
  })

  test('2. sin lotes no se puede exigir vencimiento', async ({ page }) => {
    await entrar(page, 'encargado')
    const ficha = await abrirFichaDeProducto(page, QUESO)

    // El queso no lleva lotes: las opciones de vencimiento están deshabilitadas.
    await expect(ficha.getByRole('radio', { name: /^sin lotes/i })).toBeChecked()
    await expect(ficha.getByRole('radio', { name: /vencimiento obligatorio/i })).toBeDisabled()
    await expect(ficha.getByText(/una fecha necesita una partida/i)).toBeVisible()
  })

  test('3. exigir lotes con stock sin asignar abre la inicialización y no deja guardar', async ({
    page,
  }) => {
    await entrar(page, 'encargado')
    const ficha = await abrirFichaDeProducto(page, QUESO)

    await ficha.getByRole('radio', { name: /lotes obligatorios/i }).click()

    // No se guarda: primero hay que decir de qué partidas son las unidades.
    await expect(ficha.getByText(/falta decir de qué partidas/i)).toBeVisible()
    await expect(ficha.getByRole('button', { name: /guardar trazabilidad/i })).toBeDisabled()
    await expect(ficha.getByRole('button', { name: /asignar el stock existente/i })).toBeEnabled()

    const antes = await desglose(page, QUESO)

    // La inicialización: todo el stock a una partida.
    await ficha.getByRole('button', { name: /asignar el stock existente/i }).click()
    await expect(ficha.getByText(/no cambia el stock total/i).first()).toBeVisible()
    await ficha.getByPlaceholder('Código de la partida').fill('QS-INICIAL')
    await ficha.getByRole('textbox', { name: /cantidad de la partida 1/i }).fill(antes.total)
    await ficha.getByRole('button', { name: /^asignar$/i }).click()
    await page.waitForTimeout(1200)

    const despues = await desglose(page, QUESO)

    // LO QUE IMPORTA: el stock total NO cambió. Lo que cambió es que ahora se
    // sabe de qué partida es cada unidad.
    expect(Number(despues.total), 'inicializar no mueve stock').toBe(Number(antes.total))
    expect(Number(despues.sinAsignar)).toBe(0)
    expect(cantidadDelLote(despues, 'QS-INICIAL')).toBe(Number(antes.total))

    // Y recién ahora se puede exigir lotes.
    await expect(ficha.getByRole('button', { name: /guardar trazabilidad/i })).toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// 4-6. Recepción por partidas
// ---------------------------------------------------------------------------

/**
 * Crea una orden de compra y la deja PEDIDA, lista para recibir.
 *
 * Los selectores son los mismos que usa `compras.spec.ts` desde la Fase 3C: si
 * la pantalla de compras cambia, las dos pruebas fallan juntas y queda claro
 * que cambió la pantalla y no los lotes.
 */
async function ordenConfirmada(page: Page, producto: string, cantidad: string): Promise<string> {
  await page.goto('/compras/nueva')
  await page.getByRole('combobox', { name: 'A quién se le compra' }).selectOption({ index: 1 })

  await page.getByRole('searchbox', { name: /Buscar productos/i }).fill(producto)
  await page.waitForTimeout(900)
  await page
    .getByRole('button', { name: new RegExp(producto.replace('.', '\\.'), 'i') })
    .first()
    .click()

  await page
    .getByRole('textbox', { name: new RegExp(`Cantidad de ${producto}`, 'i') })
    .fill(cantidad)
  await page.getByRole('textbox', { name: /Costo por unidad de compra/i }).fill('100')
  await page.getByRole('button', { name: 'Confirmar orden' }).click()

  await page.waitForURL(/\/compras\/\d+$/)
  return page.url()
}

test.describe('Recepción por partidas', () => {
  test('4-6. una partida y dos partidas, con BranchStock y BranchLotStock correctos', async ({
    page,
  }) => {
    await entrar(page, 'compras')
    const antes = await desglose(page, YOGUR)

    await ordenConfirmada(page, YOGUR, '10')
    await page.getByRole('button', { name: /recibir mercader/i }).click()
    await expect(dialogo(page).getByText('Partidas').first()).toBeVisible()

    // Un producto REQUIRED arranca con UNA fila puesta, con todo lo pendiente.
    const d = dialogo(page)
    await d.getByPlaceholder('Código del lote').first().fill('YG-E2E-A')
    await d.getByRole('textbox', { name: /cantidad de la partida 1/i }).fill('6')
    await d.getByRole('textbox', { name: /vencimiento de la partida 1/i }).fill('2027-01-15')

    // Con 6 de 10 asignadas, la recepción todavía no cierra.
    await expect(d.getByText(/las partidas tienen que sumar/i)).toBeVisible()
    await expect(d.getByRole('button', { name: /confirmar recepción/i })).toBeDisabled()

    // La segunda partida: lo que falta.
    await d.getByRole('button', { name: /agregar partida/i }).click()
    await d.getByPlaceholder('Código del lote').nth(1).fill('YG-E2E-B')
    await d.getByRole('textbox', { name: /cantidad de la partida 2/i }).fill('4')
    await d.getByRole('textbox', { name: /vencimiento de la partida 2/i }).fill('2027-03-20')

    await expect(d.getByRole('button', { name: /confirmar recepción/i })).toBeEnabled()
    await d.getByRole('button', { name: /confirmar recepción/i }).click()
    await page.waitForTimeout(2000)

    const despues = await desglose(page, YOGUR)

    // 5. BranchStock: subió exactamente lo recibido.
    expect(Number(despues.total) - Number(antes.total)).toBe(10)

    // 6. BranchLotStock: cada partida con lo suyo, y la suma cerrando.
    expect(cantidadDelLote(despues, 'YG-E2E-A')).toBe(6)
    expect(cantidadDelLote(despues, 'YG-E2E-B')).toBe(4)
    expect(Number(despues.sinAsignar), 'un REQUIRED no deja nada sin explicar').toBe(0)
  })

  test('7. un producto OPTIONAL puede recibirse SIN partida, explícitamente', async ({ page }) => {
    await entrar(page, 'compras')
    const antes = await desglose(page, LAVANDINA)

    await ordenConfirmada(page, LAVANDINA, '5')
    await page.getByRole('button', { name: /recibir mercader/i }).click()

    const d = dialogo(page)
    // Sin partidas puestas: el bloque lo dice con todas las letras.
    await expect(d.getByText(/sin partida\./i)).toBeVisible()
    await d.getByRole('button', { name: /confirmar recepción/i }).click()
    await page.waitForTimeout(2000)

    const despues = await desglose(page, LAVANDINA)
    expect(Number(despues.total) - Number(antes.total)).toBe(5)
    // Las cinco entraron SIN partida: el stock sin asignar creció.
    expect(Number(despues.sinAsignar) - Number(antes.sinAsignar)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 8-13. Venta: FEFO, allocations, anulación, vencidos
// ---------------------------------------------------------------------------

async function venderYCobrar(page: Page, codigo: string, veces = 1): Promise<void> {
  await page.goto('/venta')
  for (let i = 0; i < veces; i++) await escanear(page, codigo)
  await page.getByRole('button', { name: /^cobrar/i }).click()
  const d = dialogo(page)
  await expect(d).toBeAttached()
  await d.getByRole('combobox', { name: 'Medio' }).selectOption({ label: 'Efectivo' })
  await d.getByRole('button', { name: /^cobrar/i }).click()
  await page.waitForTimeout(1500)
}

test.describe('Venta por FEFO', () => {
  test('8-9. FEFO saca de la partida que vence antes, y cruza al siguiente lote', async ({
    page,
  }) => {
    // Con `encargado` y no con `cajero`: el cajero NO tiene `lots.view`, y
    // estas pruebas necesitan leer el desglose por partida. Que el cajero no
    // pueda es lo correcto, y lo comprueba el caso 27.
    await entrar(page, 'encargado')

    // La leche tiene LP-2510 VENCIDA (4) y LP-2604 que vence hoy (6). Lo
    // vencido NO es vendible, así que FEFO tiene que ir a LP-2604.
    const antes = await desglose(page, LECHE)
    expect(cantidadDelLote(antes, 'LP-2510'), 'la vencida sigue en el depósito').toBe(4)

    await venderYCobrar(page, CODIGO_LECHE, 2)

    const despues = await desglose(page, LECHE)
    expect(cantidadDelLote(despues, 'LP-2510'), 'lo vencido NO se vende').toBe(4)
    expect(cantidadDelLote(despues, 'LP-2604'), 'salió de la que vence primero').toBe(
      cantidadDelLote(antes, 'LP-2604') - 2,
    )
  })

  test('10. la venta deja escrito de qué partida salió cada unidad', async ({ page }) => {
    // Con `encargado`, que puede leer el libro de movimientos: el cajero no.
    await entrar(page, 'encargado')
    await venderYCobrar(page, CODIGO_LECHE, 1)

    const movs = await movimientosDe(page, LECHE)
    const venta = movs.find((m) => m.type === 'SALE')

    expect(venta, 'la venta dejó su movimiento').toBeDefined()
    expect(venta?.lotCode, 'y dice de qué partida salió').toBe('LP-2604')
    expect(Number(venta?.quantity)).toBe(-1)
  })

  test('11. anular devuelve a la MISMA partida, no la elige de nuevo', async ({ page }) => {
    await entrar(page, 'supervisor')

    const antes = await desglose(page, LECHE)
    await venderYCobrar(page, CODIGO_LECHE, 1)
    const vendida = await desglose(page, LECHE)
    expect(cantidadDelLote(vendida, 'LP-2604')).toBe(cantidadDelLote(antes, 'LP-2604') - 1)

    // Se anula la última venta. El supervisor --que ya está adentro-- puede.
    await page.goto('/ventas')
    const fila = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Anular' }) })
    await fila.first().getByRole('button', { name: 'Anular' }).click()

    const d = dialogo(page)
    await d.getByLabel(/motivo/i).fill('Prueba de anulación por lote')
    await d.getByRole('button', { name: /anular la venta/i }).click()
    await expect(page.getByText(/venta anulada/i)).toBeVisible()
    await page.waitForTimeout(1500)

    const anulada = await desglose(page, LECHE)
    expect(cantidadDelLote(anulada, 'LP-2604'), 'volvió a la partida de la que salió').toBe(
      cantidadDelLote(antes, 'LP-2604'),
    )
    expect(cantidadDelLote(anulada, 'LP-2510'), 'y NO a otra').toBe(
      cantidadDelLote(antes, 'LP-2510'),
    )
  })

  test('12-13. lo vencido no es vendible y el POS lo rechaza con los tres números', async ({
    page,
  }) => {
    // Con `encargado` y no con `cajero`: el cajero NO tiene `lots.view`, y
    // estas pruebas necesitan leer el desglose por partida. Que el cajero no
    // pueda es lo correcto, y lo comprueba el caso 27.
    await entrar(page, 'encargado')

    const d = await desglose(page, LECHE)
    const total = Number(d.total)
    const vendible = Number(d.vendible)
    const vencido = Number(d.vencido)

    // El sistema distingue las tres cifras: hay `total`, se puede vender
    // `vendible`, y `vencido` es la diferencia.
    expect(vencido, 'hay stock vencido').toBeGreaterThan(0)
    expect(total - vendible).toBe(vencido)

    // Pedir MÁS que lo vendible no se puede, y el tope es lo VENDIBLE y no el
    // stock: es la diferencia que importa.
    //
    // Cambió en la Fase 5A.2. Antes la caja dejaba cargar hasta el stock total
    // y el rechazo llegaba recién al cobrar, desde el servidor. Ahora el tope
    // es lo vendible, así que el operario se entera al escanear --con las
    // unidades vencidas dichas por su nombre-- y no después de anunciarle un
    // total al cliente.
    //
    // Que el SERVIDOR siga siendo la autoridad no se comprueba acá sino en
    // `tests/integration/stock-vendible.test.ts`, que pega en la API sin
    // pantalla de por medio: vender exactamente lo vendible sale 200 y una
    // unidad más sale 409. Es el nivel correcto para esa pregunta, porque lo
    // que hay que probar es justamente que no depende del cliente.
    await page.goto('/venta')
    for (let i = 0; i < vendible; i++) await escanear(page, CODIGO_LECHE)
    const conTodoLoVendible = await totalDelTicket(page)

    await escanear(page, CODIGO_LECHE)
    await expect(page.getByText(/vendible|vencid/i).first()).toBeVisible({ timeout: 15_000 })
    expect(await totalDelTicket(page), 'el ticket no pasó de lo vendible').toBe(conTodoLoVendible)

    // Y no se vendió nada: el ticket quedó sin cobrar.
    const despues = await desglose(page, LECHE)
    expect(Number(despues.total), 'no se vendió nada').toBe(total)
    expect(Number(despues.vencido), 'lo vencido sigue ahí').toBe(vencido)
  })

  test('14. la alerta de vencimiento aparece en el tablero y en el listado', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/')
    await expect(page.getByText('Vencidos').first()).toBeVisible()

    await page.goto('/stock/lotes')
    // El estado se dice con TEXTO, no sólo con color.
    await expect(page.getByText('Vencido').first()).toBeVisible()
    await expect(page.getByText('LP-2510').first()).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 15-16. Elección manual (FEFO es política, no lectura física) y auditoría
// ---------------------------------------------------------------------------

test.describe('FEFO es política, no lectura física', () => {
  test('15-16. con permiso se elige otra partida, y queda auditado', async ({ page }) => {
    await entrar(page, 'encargado')

    const antes = await desglose(page, LAVANDINA)
    const lote = antes.lotes.find((l) => l.code === 'LV-A7734')
    expect(lote, 'la lavandina tiene su partida sin fecha').toBeDefined()

    // Una merma cargada CONTRA UNA PARTIDA elegida a mano. El sistema no
    // adivina de cuál se rompió: lo dice quien la vio.
    await page.goto('/stock')
    await page.getByRole('searchbox').first().fill(LAVANDINA)
    await page.waitForTimeout(900)
    await page
      .getByRole('button', { name: /ajustar/i })
      .first()
      .click()

    const d = dialogo(page)
    await d.getByRole('combobox', { name: /qué pasó/i }).selectOption('BREAKAGE')
    await d.getByRole('combobox', { name: /de qué partida/i }).selectOption(String(lote?.id ?? 0))
    await d.getByRole('textbox', { name: /cuánto sale/i }).fill('2')
    await d.getByRole('textbox', { name: 'Motivo' }).fill('Se cayó el bidón')
    await d.getByRole('button', { name: /guardar ajuste/i }).click()
    await page.waitForTimeout(1500)

    const despues = await desglose(page, LAVANDINA)
    expect(cantidadDelLote(despues, 'LV-A7734'), 'salió de la partida elegida').toBe(
      cantidadDelLote(antes, 'LV-A7734') - 2,
    )

    // Y el libro guarda de qué partida fue: la elección quedó registrada, con
    // su motivo. Es lo que hace auditable que FEFO se haya salteado a propósito.
    const rotura = (await movimientosDe(page, LAVANDINA)).find((m) => m.type === 'BREAKAGE')
    expect(rotura?.lotCode, 'el movimiento dice de qué partida salió').toBe('LV-A7734')
    expect(rotura?.reason).toContain('bidón')
  })

  test('17. un producto REQUIRED no deja cargar una merma sin partida', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/stock')
    await page.getByRole('searchbox').first().fill(YOGUR)
    await page.waitForTimeout(900)
    await page
      .getByRole('button', { name: /ajustar/i })
      .first()
      .click()

    const d = dialogo(page)
    await d.getByRole('combobox', { name: /qué pasó/i }).selectOption('LOSS')
    await d.getByRole('textbox', { name: /cuánto sale/i }).fill('1')
    await d.getByRole('textbox', { name: 'Motivo' }).fill('Prueba sin partida')

    // El selector de partida es obligatorio y el botón no se habilita.
    await expect(d.getByText(/exige decir de qué partida/i)).toBeVisible()
    await expect(d.getByRole('button', { name: /guardar ajuste/i })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// 18-19. Devolución al proveedor, por partida
// ---------------------------------------------------------------------------

test.describe('Devolución por partida', () => {
  test('18-19. se devuelve de la partida con la que llegó, al costo histórico', async ({
    page,
  }) => {
    await entrar(page, 'compras')

    // Se recibe una partida nueva para tener algo que devolver.
    await ordenConfirmada(page, LAVANDINA, '6')
    await page.getByRole('button', { name: /recibir mercader/i }).click()
    const rec = dialogo(page)
    await rec.getByRole('button', { name: /agregar partida/i }).click()
    await rec.getByPlaceholder('Código del lote').first().fill('LV-DEVOL')
    await rec.getByRole('textbox', { name: /cantidad de la partida 1/i }).fill('6')
    await rec.getByRole('button', { name: /confirmar recepción/i }).click()
    await page.waitForTimeout(2000)

    const antes = await desglose(page, LAVANDINA)
    expect(cantidadDelLote(antes, 'LV-DEVOL')).toBe(6)

    // La devolución: la pantalla ofrece una casilla POR PARTIDA.
    await page
      .getByRole('button', { name: /devolver/i })
      .first()
      .click()
    const dev = dialogo(page)
    await expect(dev.getByTestId('renglon-partida').first()).toBeVisible()
    await dev.getByRole('textbox', { name: /partida LV-DEVOL/i }).fill('2')
    await dev.getByRole('button', { name: /crear borrador/i }).click()
    await page.waitForURL(/\/devoluciones\/\d+/)

    // Confirmarla es lo que saca la mercadería.
    await page
      .getByRole('button', { name: /confirmar/i })
      .first()
      .click()
    await page
      .getByRole('button', { name: /^confirmar/i })
      .last()
      .click()
    await page.waitForTimeout(2000)

    const despues = await desglose(page, LAVANDINA)
    expect(cantidadDelLote(despues, 'LV-DEVOL'), 'salió de SU partida').toBe(4)
    expect(cantidadDelLote(despues, 'LV-A7734'), 'y no de otra').toBe(
      cantidadDelLote(antes, 'LV-A7734'),
    )
  })
})

// ---------------------------------------------------------------------------
// 20-25. Inventario físico
// ---------------------------------------------------------------------------

interface SesionDTO {
  id: number
  number: string
  status: string
  blindCount: boolean
  lineas: { total: number; contadas: number; sinResolver: number; conDiferencia: number }
}

interface LineaDTO {
  id: number
  productId: number
  productName: string
  lotId: number | null
  lotCode: string | null
  status: string
  snapshotQuantity: string
  expectedAtCount: string | null
  countedQuantity: string | null
  variance: string | null
}

async function lineasDe(page: Page, id: number): Promise<LineaDTO[]> {
  const r = await api<{ data: LineaDTO[] }>(
    page,
    `/api/inventarios/${String(id)}/lineas?pageSize=100`,
  )
  return r.data
}

test.describe('Inventario físico', () => {
  test('20-21. se crea con su configuración, y el conteo es a ciegas de verdad', async ({
    page,
  }) => {
    await entrar(page, 'encargado')

    await page.goto('/inventarios')
    await page.getByRole('button', { name: /nuevo inventario/i }).click()

    const d = dialogo(page)
    // La configuración que pedía el objetivo: alcance, conteo a ciegas y recuento.
    await expect(d.getByRole('group', { name: /qué se cuenta/i })).toBeVisible()
    await expect(d.getByRole('checkbox', { name: /conteo a ciegas/i })).toBeChecked()
    await d.getByRole('checkbox', { name: /segundo conteo/i }).check()
    await expect(d.getByRole('textbox', { name: /a partir de qué diferencia/i })).toBeVisible()
    await d.getByRole('button', { name: /crear inventario/i }).click()
    await page.waitForURL(/\/inventarios\/\d+/)

    const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)
    const sesion = await api<SesionDTO>(page, `/api/inventarios/${String(id)}`)
    expect(sesion.blindCount).toBe(true)
    expect(sesion.lineas.total, 'las líneas se generan al crear la sesión').toBeGreaterThan(0)

    // A CIEGAS DE VERDAD: lo esperado NO sale del servidor mientras se cuenta.
    const lineas = await lineasDe(page, id)
    expect(
      lineas.every((l) => l.expectedAtCount === null),
      'no viaja lo esperado',
    ).toBe(true)
    await expect(page.getByText(/no se muestra mientras se cuenta/i)).toBeVisible()

    // Y una línea POR PARTIDA: el yogur tiene dos.
    const delYogur = lineas.filter((l) => l.productName.startsWith('Yogur'))
    expect(delYogur.length, 'una línea por partida con unidades').toBeGreaterThan(1)
    expect(delYogur.some((l) => l.lotCode !== null)).toBe(true)
  })

  test('22-24. venta durante el conteo, expectedAtCount y aplicación por DELTA', async ({
    page,
  }) => {
    await entrar(page, 'encargado')

    /*
      El escenario exacto del objetivo 17, SOBRE EL YOGUR.

      Y no sobre la leche: los casos anteriores de este archivo la venden hasta
      agotar sus partidas, y una partida en cero no genera línea de inventario.
      El yogur llega acá con las dos partidas del seed más las dos que recibió
      el caso 4-6, así que tiene con qué. Es el mismo error que esta fase ya
      corrigió en el fixture de rendimiento: una prueba que depende de lo que
      dejaron las anteriores mide el orden de ejecución, no el sistema.
    */
    const producto = YOGUR
    const codigo = await codigoDe(page, producto)
    const inicial = await desglose(page, producto)
    const stockInicial = Number(inicial.total)

    /*
      SIN conteo a ciegas, y a propósito.

      Cerrar el conteo exige que TODAS las líneas estén contadas, y esta sesión
      abarca el catálogo entero. Para poder contarlas hay que ver lo que el
      sistema espera, que es justamente lo que el conteo a ciegas oculta. Es una
      configuración legítima --el diálogo la ofrece-- y el caso 20-21 ya
      comprueba que a ciegas los números no viajan.
    */
    await page.goto('/inventarios')
    await page.getByRole('button', { name: /nuevo inventario/i }).click()
    await dialogo(page)
      .getByRole('checkbox', { name: /conteo a ciegas/i })
      .uncheck()
    await dialogo(page)
      .getByRole('button', { name: /crear inventario/i })
      .click()
    await page.waitForURL(/\/inventarios\/\d+/)
    const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)
    /*
      LA PARTIDA QUE FEFO VA A ELEGIR, no la que más unidades tiene.

      La venta de más abajo sale por FEFO, o sea de la que vence primero. Si la
      prueba contara otra, esa venta no tocaría la línea contada y el
      `expectedAtCount` sería idéntico al snapshot: la prueba fallaría diciendo
      que lo esperado no descuenta la venta, cuando lo que pasó es que la venta
      salió de otro lado.

      El desglose ya viene en orden de vencimiento, que es el orden de FEFO.
    */
    const partidaConStock = inicial.lotes.find((l) => Number(l.quantity) >= 3)
    expect(partidaConStock, 'hay una partida con unidades suficientes').toBeDefined()

    const snapshot = Number(partidaConStock?.quantity ?? '0')
    expect(snapshot, 'con stock suficiente para el escenario').toBeGreaterThanOrEqual(3)
    const partida = partidaConStock?.code ?? ''

    const antes = await lineasDe(page, id)
    const linea = antes.find((l) => l.lotCode === partida)
    expect(linea, 'y su línea en el inventario').toBeDefined()

    // UNA VENTA MIENTRAS SE CUENTA. Sin esto habría que cerrar el local.
    await venderYCobrar(page, codigo, 1)

    // Se cuenta DOS menos de lo que el snapshot decía: una es la venta, la
    // otra es la diferencia de verdad.
    await page.goto(`/inventarios/${String(id)}`)
    const fila = page.getByRole('row').filter({ hasText: partida }).first()
    await fila.getByRole('textbox').fill(String(snapshot - 2))
    await page.getByRole('button', { name: /guardar conteos/i }).click()
    await page.waitForTimeout(1500)

    // El resto del catálogo se cuenta por lo que el sistema ya tenía: la
    // sesión no cierra con líneas pendientes, y lo que se está probando es UNA
    // diferencia, no un inventario a medio hacer.
    const pendientes = (await lineasDe(page, id)).filter((l) => l.status === 'PENDING')
    await page.evaluate(
      async ([ruta, lineas]) => {
        for (let i = 0; i < (lineas as unknown[]).length; i += 100) {
          await fetch(ruta, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lineas: (lineas as unknown[]).slice(i, i + 100) }),
          })
        }
      },
      [
        `/api/inventarios/${String(id)}/conteo`,
        pendientes.map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
      ] as const,
    )

    // Cerrar el conteo: recién ahí se decide.
    await page.reload()
    await page.getByRole('button', { name: /cerrar conteo/i }).click()
    await page.waitForTimeout(1500)
    const enRevision = await api<SesionDTO>(page, `/api/inventarios/${String(id)}`)
    expect(enRevision.status).toBe('REVIEW')

    const contada = (await lineasDe(page, id)).find((l) => l.id === linea?.id)

    // expectedAtCount es lo que había AL CONTAR, no al empezar: descuenta la
    // venta. Es lo que hace que la diferencia sea 1 y no 2.
    expect(Number(contada?.expectedAtCount), 'lo esperado descuenta la venta').toBe(snapshot - 1)
    expect(Number(contada?.variance), 'la diferencia real es de UNA unidad').toBe(-1)

    // OTRA VENTA, ya cerrado el conteo y antes de aplicar. Es la que decide
    // todo: si al aplicar se escribiera el número contado, esta venta
    // desaparecería.
    await venderYCobrar(page, codigo, 1)
    const antesDeAplicar = Number((await desglose(page, producto)).total)
    const contadoEnLaLinea = Number(contada?.countedQuantity ?? '0')

    expect(antesDeAplicar, 'las dos ventas bajaron el stock').toBeLessThan(stockInicial)

    // APLICAR. Se aplica el DELTA (-1), nunca el número contado: escribir el
    // contado borraría la segunda venta.
    await page.goto(`/inventarios/${String(id)}`)
    await page.getByRole('button', { name: /aplicar diferencias/i }).click()
    await page.waitForTimeout(2000)

    const despues = await desglose(page, producto)
    const final = Number(despues.total)

    // LA COMPROBACIÓN QUE DA SENTIDO A TODO: bajó UNA unidad, que es el delta.
    // Si se hubiera escrito el número contado, el stock habría subido de nuevo
    // hasta él y la segunda venta habría desaparecido.
    expect(final, 'se aplicó el delta, no el contado').toBe(antesDeAplicar - 1)
    expect(final, 'y NO quedó en lo contado').not.toBe(contadoEnLaLinea)

    const aplicada = await api<SesionDTO>(page, `/api/inventarios/${String(id)}`)
    expect(aplicada.status).toBe('APPLIED')
  })

  test('25. un producto POR PESO se cuenta con decimales', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/inventarios')
    await page.getByRole('button', { name: /nuevo inventario/i }).click()
    await dialogo(page)
      .getByRole('button', { name: /crear inventario/i })
      .click()
    await page.waitForURL(/\/inventarios\/\d+/)
    const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)

    const linea = (await lineasDe(page, id)).find((l) => l.productName.startsWith(QUESO))
    expect(linea, 'el queso entra al inventario').toBeDefined()

    const fila = page.getByRole('row').filter({ hasText: QUESO }).first()
    await fila.getByRole('textbox').fill('3.250')
    await page.getByRole('button', { name: /guardar conteos/i }).click()
    await page.waitForTimeout(1500)

    const contada = (await lineasDe(page, id)).find((l) => l.id === linea?.id)
    expect(contada?.countedQuantity, 'los gramos no se pierden').toBe('3.250')
  })

  test('26. una línea UNRESOLVED bloquea la aplicación', async ({ page }) => {
    await entrar(page, 'encargado')

    await page.goto('/inventarios')
    await page.getByRole('button', { name: /nuevo inventario/i }).click()
    await dialogo(page)
      .getByRole('button', { name: /crear inventario/i })
      .click()
    await page.waitForURL(/\/inventarios\/\d+/)
    const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)

    // La línea SIN partida del yogur, que es REQUIRED: contar unidades ahí
    // significa "aparecieron y nadie sabe de qué partida son".
    const sinLote = (await lineasDe(page, id)).find(
      (l) => l.productName.startsWith('Yogur') && l.lotId === null,
    )
    expect(sinLote, 'existe la línea sin partida').toBeDefined()

    await page.evaluate(
      async ([ruta, lineId]) => {
        await fetch(ruta, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lineas: [{ lineId, countedQuantity: '3' }] }),
        })
      },
      [`/api/inventarios/${String(id)}/conteo`, sinLote?.id ?? 0] as const,
    )

    // El resto de las líneas se cuentan por lo que el sistema ya tenía: lo que
    // se prueba es la línea sin resolver, no un inventario a medio contar.
    const resto = (await lineasDe(page, id)).filter((l) => l.id !== sinLote?.id)
    await page.evaluate(
      async ([ruta, lineas]) => {
        // De a cien: el endpoint acepta hasta doscientas por petición.
        for (let i = 0; i < (lineas as unknown[]).length; i += 100) {
          await fetch(ruta, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lineas: (lineas as unknown[]).slice(i, i + 100) }),
          })
        }
      },
      [
        `/api/inventarios/${String(id)}/conteo`,
        resto.map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
      ] as const,
    )

    // Se cierra el conteo: el rechazo que importa es el de APLICAR, y para
    // llegar ahí la sesión tiene que estar en revisión.
    await page.evaluate(
      async (ruta: string) => {
        await fetch(ruta, { method: 'POST' })
      },
      `/api/inventarios/${String(id)}/revision`,
    )

    await page.goto(`/inventarios/${String(id)}`)

    const sesion = await api<SesionDTO>(page, `/api/inventarios/${String(id)}`)
    expect(sesion.lineas.sinResolver, 'quedó sin resolver').toBeGreaterThan(0)

    // La pantalla lo dice y ofrece el filtro.
    await expect(page.getByText(/unidades sin partida identificada/i)).toBeVisible()

    // Y aplicar se rechaza: el sistema no inventa códigos de lote.
    const respuesta = await page.evaluate(
      async (ruta: string) => {
        const r = await fetch(ruta, { method: 'POST' })
        return { status: r.status, cuerpo: await r.text() }
      },
      `/api/inventarios/${String(id)}/aplicar`,
    )

    expect(respuesta.status).toBe(409)
    expect(respuesta.cuerpo).toContain('COUNT_HAS_UNRESOLVED')
  })
})

// ---------------------------------------------------------------------------
// 27-28. Permisos y reconciliación
// ---------------------------------------------------------------------------

test.describe('Permisos y cierre', () => {
  test('27. el cajero no ve lotes ni inventarios; el repositor cuenta pero no aplica', async ({
    page,
  }) => {
    // ACÁ SÍ el cajero: es el caso que comprueba que no pueda.
    await entrar(page, 'cajero')

    const cajero = await page.evaluate(async () => {
      const rutas = ['/api/lotes', '/api/inventarios', '/api/reportes/vencimientos']
      return Promise.all(rutas.map(async (r) => ({ ruta: r, status: (await fetch(r)).status })))
    })
    for (const r of cajero) {
      expect(r.status, `el cajero no puede ${r.ruta}`).toBe(403)
    }

    // El repositor: cuenta, pero no aplica. Hay que SALIR primero: `entrar`
    // sobre una sesión abierta no cambia de usuario y las peticiones seguirían
    // saliendo como el anterior.
    await salir(page)
    await entrar(page, 'repositor')
    const repositor = await page.evaluate(async () => {
      const ver = await fetch('/api/inventarios')
      const crear = await fetch('/api/inventarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'ALL', blindCount: true }),
      })
      const id = crear.ok ? ((await crear.json()) as { id: number }).id : 0
      const aplicar = await fetch(`/api/inventarios/${String(id)}/aplicar`, { method: 'POST' })
      return { ver: ver.status, crear: crear.status, aplicar: aplicar.status }
    })

    expect(repositor.ver, 'el repositor ve los inventarios').toBe(200)
    expect(repositor.crear, 'y puede armar uno').toBe(201)
    expect(repositor.aplicar, 'pero NO puede aplicarlo').toBe(403)
  })

  test('28. después de todo, el sistema sigue cuadrando', () => {
    /*
      La reconciliación completa, sobre la base que estas pruebas acabaron de
      mover de verdad: ventas, anulaciones, recepciones por partida, mermas,
      devoluciones y un inventario aplicado.

      Se corre el script y no un endpoint, porque no hay endpoint: la
      reconciliación es una herramienta de operación que se ejecuta contra la
      base, igual que la siembra de `seed.setup.ts`. Si sale con código distinto
      de cero, algo de todo lo anterior dejó el libro sin explicar el saldo.
    */
    const url =
      process.env.E2E_DATABASE_URL ??
      'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_dev?schema=public'

    const salida = execFileSync('npm', ['run', 'integrity:check'], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })

    expect(salida, 'la reconciliación no encontró nada').toContain('Sin inconsistencias')
  })
})
