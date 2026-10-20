/**
 * Capturas del manual de House, contra la aplicacion REAL compilada.
 *
 * Recorre el dia de un operador sobre una instancia NUEVA y LOCAL (nunca la de
 * produccion): primer ingreso con la clave temporal, abrir la caja, cargar
 * productos, vender, revisar las ventas, mover y contar la caja, inventariar,
 * cerrar y mirar los reportes. Cada paso deja su captura en
 * docs/manual-house/capturas/ y la posicion de los elementos que el manual
 * senala con un numero (marcas.js).
 *
 *   MANUAL_URL=http://localhost:3102 MANUAL_USUARIO=Franco \
 *   MANUAL_CLAVE=<clave temporal de esa instancia local> \
 *     npx tsx scripts/manual-house/capturas.ts
 *
 * La clave temporal no esta en el codigo: llega por el entorno. La nueva que
 * pide el primer ingreso se genera aca y no se guarda en ningun lado.
 */

import { chromium, type Locator, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.MANUAL_URL ?? 'http://localhost:3102'
const USUARIO = process.env.MANUAL_USUARIO ?? 'Franco'
const CLAVE = process.env.MANUAL_CLAVE ?? ''

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra una instancia local. Recibido: ${BASE}`)
}
if (CLAVE === '') throw new Error('Falta MANUAL_CLAVE (la clave temporal de la instancia local).')

const SALIDA = path.join(process.cwd(), 'docs/manual-house/capturas')
const ANCHO = 1366
const ALTO = 768

type Marcas = Record<string, Record<string, [number, number, number, number]>>
const marcas: Marcas = {}

/** Productos de ejemplo de un almacen. Codigos inventados, de uso local. */
const PRODUCTOS = [
  { nombre: 'Coca Cola 2.25 L', categoria: 'Bebidas', precio: 3500, stock: 12, minimo: 4, codigo: '7790000000011' }, // prettier-ignore
  { nombre: 'Agua mineral 1.5 L', categoria: 'Bebidas', precio: 1300, stock: 20, minimo: 6, codigo: '7790000000028' }, // prettier-ignore
  { nombre: 'Fernet Branca 750 ml', categoria: 'Bebidas', precio: 14500, stock: 6, minimo: 2, codigo: '7790000000035' }, // prettier-ignore
  { nombre: 'Cerveza Quilmes 1 L', categoria: 'Bebidas', precio: 2600, stock: 24, minimo: 6, codigo: '7790000000042' }, // prettier-ignore
  { nombre: 'Hielo 2 kg', categoria: 'Bebidas', precio: 2000, stock: 8, minimo: 3, codigo: '7790000000059' }, // prettier-ignore
  { nombre: 'Yerba mate 1 kg', categoria: 'Almacén', precio: 5200, stock: 10, minimo: 3, codigo: '7790000000066' }, // prettier-ignore
  { nombre: 'Aceite de girasol 1.5 L', categoria: 'Almacén', precio: 4300, stock: 8, minimo: 2, codigo: '7790000000073' }, // prettier-ignore
  { nombre: 'Arroz largo fino 1 kg', categoria: 'Almacén', precio: 1900, stock: 10, minimo: 3, codigo: '7790000000080' }, // prettier-ignore
  { nombre: 'Fideos spaghetti 500 g', categoria: 'Almacén', precio: 1400, stock: 15, minimo: 4, codigo: '7790000000097' }, // prettier-ignore
  { nombre: 'Azúcar 1 kg', categoria: 'Almacén', precio: 1500, stock: 3, minimo: 5, codigo: '7790000000103' }, // prettier-ignore
  { nombre: 'Galletitas de agua', categoria: 'Almacén', precio: 1200, stock: 0, minimo: 4, codigo: '' }, // prettier-ignore
  { nombre: 'Leche entera 1 L', categoria: 'Lácteos', precio: 1800, stock: 12, minimo: 6, codigo: '7790000000127' }, // prettier-ignore
  { nombre: 'Papas fritas 250 g', categoria: 'Snacks', precio: 5000, stock: 10, minimo: 3, codigo: '7790000000134' }, // prettier-ignore
  { nombre: 'Detergente 500 ml', categoria: 'Limpieza', precio: 2900, stock: 6, minimo: 2, codigo: '7790000000141' }, // prettier-ignore
  { nombre: 'Lavandina 1 L', categoria: 'Limpieza', precio: 1600, stock: 0, minimo: 3, codigo: '7790000000158' }, // prettier-ignore
] as const

/** El panel que se ve. `role=dialog` es el contenedor de Headless UI, sin tamaño propio. */
const panelDe = (d: Locator): Locator => d.locator('[id^="headlessui-dialog-panel"]')

const codigo = (nombre: string): string => PRODUCTOS.find((p) => p.nombre === nombre)?.codigo ?? ''

async function foto(page: Page, nombre: string, recorte?: Locator): Promise<void> {
  await page.waitForTimeout(350)
  const archivo = path.join(SALIDA, `${nombre}.png`)
  if (recorte) await recorte.screenshot({ path: archivo, animations: 'disabled' })
  else await page.screenshot({ path: archivo, animations: 'disabled' })
  console.log(`  ${nombre}`)
}

/** Donde esta un elemento, en fracciones de la captura entera (para el numero del manual). */
async function marcar(nombre: string, clave: string, l: Locator, dentro?: Locator): Promise<void> {
  const b = await l.boundingBox()
  if (!b) throw new Error(`No se ve "${clave}" en ${nombre}`)
  let ox = 0
  let oy = 0
  let w = ANCHO
  let h = ALTO
  if (dentro) {
    const d = await dentro.boundingBox()
    if (!d) throw new Error(`No se ve el recorte de ${nombre}`)
    ox = d.x
    oy = d.y
    w = d.width
    h = d.height
  }
  marcas[nombre] ??= {}
  marcas[nombre][clave] = [(b.x - ox) / w, (b.y - oy) / h, b.width / w, b.height / h].map(
    (n) => Math.round(n * 10000) / 10000,
  ) as [number, number, number, number]
}

async function api<T>(page: Page, ruta: string, metodo: string, cuerpo?: unknown): Promise<T> {
  const r = await page.evaluate(
    async ([u, m, c]) => {
      const res = await fetch(u, {
        method: m,
        headers: { 'content-type': 'application/json' },
        body: c === undefined ? undefined : JSON.stringify(c),
      })
      return { status: res.status, texto: await res.text() }
    },
    [ruta, metodo, cuerpo] as const,
  )
  if (r.status >= 400) throw new Error(`${metodo} ${ruta}: ${String(r.status)} ${r.texto}`)
  return JSON.parse(r.texto) as T
}

async function escanear(page: Page, cod: string): Promise<void> {
  const campo = page.locator('[data-barcode-input]')
  await campo.click()
  await page.keyboard.type(cod, { delay: 8 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

async function buscarYAgregar(page: Page, texto: string, veces = 1): Promise<void> {
  const campo = page.locator('[data-barcode-input]')
  await campo.click()
  await campo.fill('')
  await page.keyboard.type(texto, { delay: 30 })
  await page.waitForTimeout(700)
  await page.keyboard.press('ArrowDown')
  for (let i = 0; i < veces; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
  }
}

async function cobrar(
  page: Page,
  medio: 'Efectivo' | 'Mercado Pago' | 'Transferencia',
  recibido?: string,
  capturas?: { cobro: string; vuelto?: string },
): Promise<void> {
  await page
    .getByRole('region', { name: 'Carrito' })
    .getByRole('button', { name: /^Cobrar/ })
    .click()
  const dialogo = page.getByRole('dialog')
  if (medio !== 'Efectivo') await dialogo.getByRole('radio', { name: medio }).click()
  if (recibido !== undefined) {
    const campo = dialogo.getByLabel(/^recibido/i)
    await campo.click()
    await page.keyboard.type(recibido, { delay: 30 })
  }
  await page.waitForTimeout(500)
  if (capturas) {
    await marcar(
      capturas.cobro,
      'medios',
      dialogo.getByRole('radiogroup').first(),
      panelDe(dialogo),
    )
    if (recibido !== undefined) {
      await marcar(capturas.cobro, 'recibido', dialogo.getByLabel(/^recibido/i), panelDe(dialogo))
    }
    await marcar(capturas.cobro, 'confirmar', dialogo.getByRole('button', { name: /^Confirmar venta/ }), panelDe(dialogo)) // prettier-ignore
    await foto(page, capturas.cobro, panelDe(dialogo))
  }
  await dialogo.getByRole('button', { name: /^Confirmar venta/ }).click()
  const nueva = page.getByRole('dialog').getByRole('button', { name: 'Nueva venta' })
  await nueva
    .or(page.getByText(/Venta registrada/).first())
    .first()
    .waitFor({ timeout: 15_000 })
  if (await nueva.isVisible().catch(() => false)) {
    if (capturas?.vuelto) await foto(page, capturas.vuelto, panelDe(page.getByRole('dialog')))
    await nueva.click()
  }
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15_000 })
}

async function main(): Promise<void> {
  await fs.mkdir(SALIDA, { recursive: true })
  // En castellano tambien lo que dibuja el navegador (los campos de fecha).
  const browser = await chromium.launch({ args: ['--lang=es-AR'] })
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 2,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    colorScheme: 'light',
  })
  const page = await context.newPage()

  // 1 · Entrar por primera vez.
  console.log('Entrar')
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Usuario' }).waitFor()
  await foto(page, '01-login')
  await page.getByRole('textbox', { name: 'Usuario' }).fill(USUARIO)
  await page.locator('input[name="password"]').fill(CLAVE)
  await marcar('01b-login-completo', 'usuario', page.getByRole('textbox', { name: 'Usuario' }))
  await marcar('01b-login-completo', 'clave', page.locator('input[name="password"]'))
  await marcar('01b-login-completo', 'entrar', page.getByRole('button', { name: 'Entrar' }))
  await foto(page, '01b-login-completo')
  await page.getByRole('button', { name: 'Entrar' }).click()

  const obligatorio = page.locator('[data-cambio-de-clave-obligatorio]')
  await obligatorio.waitFor({ timeout: 20_000 })
  const nueva = `Manual-${randomBytes(6).toString('hex')}`
  await page.getByRole('textbox', { name: 'Contraseña temporal' }).fill(CLAVE)
  await page.getByRole('textbox', { name: 'Contraseña nueva', exact: true }).fill(nueva)
  await page.getByRole('textbox', { name: 'Repetí la contraseña nueva' }).fill(nueva)
  await foto(page, '02-primer-ingreso')
  await page.getByRole('button', { name: 'Guardar y entrar' }).click()
  await page.getByRole('button', { name: /cuenta de/i }).waitFor({ timeout: 20_000 })

  // 2 · La pantalla principal y la caja cerrada.
  console.log('Inicio')
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await marcar('03-inicio', 'menu', page.getByRole('navigation').first())
  await foto(page, '03-inicio')
  await foto(page, '03b-menu', page.getByRole('navigation').first())

  await page.goto('/caja')
  await page.locator('[data-estado-caja]').waitFor()
  await page.waitForLoadState('networkidle')
  await foto(page, '04-caja-cerrada')

  console.log('Abrir caja')
  await page.goto('/caja/abrir')
  const inicial = page.getByLabel('Efectivo inicial')
  await inicial.fill('10000')
  await marcar('05-abrir-caja', 'inicial', inicial)
  await foto(page, '05-abrir-caja')
  await inicial.press('Enter')
  await page.waitForURL(/\/(caja|venta)$/, { timeout: 15_000 })

  // 3 · Cargar productos: el primero a mano, el resto por la misma API.
  console.log('Productos')
  await page.goto('/productos')
  await page.waitForLoadState('networkidle')
  await foto(page, '06-productos-vacio')
  await page.getByRole('button', { name: '+ Nuevo producto' }).first().click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Coca Cola 2.25 L')
  await dialogo.getByRole('button', { name: '+ Nueva' }).click()
  await dialogo.getByRole('textbox', { name: 'Nombre de la categoría nueva' }).fill('Bebidas')
  await dialogo.getByRole('button', { name: 'Crear', exact: true }).click()
  await page.waitForTimeout(800)
  await dialogo.getByRole('textbox', { name: 'Precio de venta' }).fill('3500')
  await dialogo.getByRole('textbox', { name: 'Unidades que tenés ahora' }).fill('12')
  const campoCodigo = dialogo.getByPlaceholder('Escaneá o escribí el código')
  await campoCodigo.click()
  await page.keyboard.type(codigo('Coca Cola 2.25 L'), { delay: 8 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  for (const [clave, l] of [
    ['nombre', dialogo.getByRole('textbox', { name: 'Nombre', exact: true })],
    ['categoria', dialogo.getByRole('combobox').first()],
    ['precio', dialogo.getByRole('textbox', { name: 'Precio de venta' })],
    ['stock', dialogo.getByRole('textbox', { name: 'Unidades que tenés ahora' })],
    ['codigo', campoCodigo],
    ['guardar', dialogo.getByRole('button', { name: 'Guardar producto' })],
  ] as const) {
    await marcar('07-nuevo-producto', clave, l, panelDe(dialogo))
  }
  await foto(page, '07-nuevo-producto', panelDe(dialogo))
  await dialogo.getByRole('button', { name: 'Guardar producto' }).click()
  await dialogo.waitFor({ state: 'detached', timeout: 15_000 })

  const categorias = new Map<string, number>()
  for (const c of await api<Array<{ id: number; name: string }>>(page, '/api/categories', 'GET')) {
    categorias.set(c.name, c.id)
  }
  for (const p of PRODUCTOS) {
    if (p.nombre === 'Coca Cola 2.25 L') continue
    if (!categorias.has(p.categoria)) {
      const c = await api<{ id: number }>(page, '/api/categories', 'POST', { name: p.categoria })
      categorias.set(p.categoria, c.id)
    }
    await api(page, '/api/products', 'POST', {
      name: p.nombre,
      barcode: p.codigo,
      alternateBarcodes: [],
      description: '',
      price: `${String(p.precio)}.00`,
      categoryId: categorias.get(p.categoria),
      supplierId: null,
      saleUnit: 'UNIT',
      purchaseUnit: 'UNIT',
      unitsPerPurchaseUnit: '1',
      totalStock: String(p.stock),
      minimumStock: String(p.minimo),
    })
  }

  // 4 · Vender: con el teclado, y con el lector.
  console.log('Vender')
  await page.goto('/venta')
  const campo = page.locator('[data-barcode-input]')
  await campo.waitFor()
  await page.waitForLoadState('networkidle')
  await campo.click()
  await page.keyboard.type('co', { delay: 60 })
  await page.waitForTimeout(800)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(300)
  await marcar('08-vender', 'buscar', campo)
  await marcar('08-vender', 'pasos', page.locator('[data-guia-de-teclado]'))
  await marcar('08-vender', 'ventas-de-hoy', page.locator('[data-ventas-de-hoy]'))
  await foto(page, '08-vender')

  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  await buscarYAgregar(page, 'yerba')
  await buscarYAgregar(page, 'aceite')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await marcar('09-carrito', 'carrito', page.getByRole('region', { name: 'Carrito' }))
  await marcar('09-carrito', 'cobrar', page.getByRole('region', { name: 'Carrito' }).getByRole('button', { name: /^Cobrar/ })) // prettier-ignore
  await foto(page, '09-carrito')
  await cobrar(page, 'Efectivo', '20000', { cobro: '10-cobro', vuelto: '11-vuelto' })

  // Con el lector: codigo + Enter, una unidad por pasada.
  await escanear(page, codigo('Fernet Branca 750 ml'))
  await escanear(page, codigo('Coca Cola 2.25 L'))
  await escanear(page, codigo('Coca Cola 2.25 L'))
  await escanear(page, codigo('Hielo 2 kg'))
  await escanear(page, codigo('Papas fritas 250 g'))
  await escanear(page, codigo('Papas fritas 250 g'))
  await cobrar(page, 'Efectivo', '35000')

  await escanear(page, codigo('Yerba mate 1 kg'))
  await escanear(page, codigo('Leche entera 1 L'))
  await cobrar(page, 'Mercado Pago')

  await escanear(page, codigo('Detergente 500 ml'))
  await cobrar(page, 'Transferencia')

  // 5 · Ventas de hoy.
  console.log('Ventas de hoy')
  await page.locator('[data-ventas-de-hoy]').click()
  const panel = page.getByRole('dialog', { name: 'Ventas de hoy' })
  const lista = panel.getByRole('list', { name: 'Ventas de hoy' })
  await lista.getByRole('button').first().waitFor()
  await page.waitForTimeout(500)
  await foto(page, '12-ventas-de-hoy', panelDe(panel))
  await lista.getByRole('button').last().click()
  await panel.getByRole('article').waitFor()
  await page.waitForTimeout(400)
  await foto(page, '13-detalle-venta', panelDe(panel))
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })

  // 6 · Caja: ingreso, egreso, la cuenta y el conteo.
  console.log('Caja')
  await page.goto('/caja')
  await page.getByText('CAJA ABIERTA').waitFor()
  await page.getByRole('button', { name: 'Registrar ingreso' }).click()
  let d = page.getByRole('dialog')
  await d.getByLabel('Importe').fill('5000')
  await d.getByLabel('Motivo').fill('Cambio que trajo el dueño')
  await foto(page, '14-ingreso', panelDe(d))
  await d.getByRole('button', { name: 'Registrar ingreso' }).click()
  await page.getByText('Ingreso registrado.').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Registrar egreso' }).click()
  d = page.getByRole('dialog')
  await d.getByLabel('Importe').fill('2000')
  await d.getByLabel('Motivo').fill('Pago al panadero')
  await foto(page, '15-egreso', panelDe(d))
  await d.getByRole('button', { name: 'Registrar egreso' }).click()
  await page.getByText('Egreso registrado.').waitFor({ timeout: 15_000 })
  await page.goto('/caja')
  await page.getByText('CAJA ABIERTA').waitFor()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await marcar(
    '16-caja-abierta',
    'tiene-que-haber',
    page.getByText('Tiene que haber en el cajón').locator('..'),
  )
  await marcar('16-caja-abierta', 'cuenta', page.locator('[data-cuenta-caja]').first())
  await marcar(
    '16-caja-abierta',
    'ingreso',
    page.getByRole('button', { name: 'Registrar ingreso' }),
  )
  await marcar('16-caja-abierta', 'egreso', page.getByRole('button', { name: 'Registrar egreso' }))
  await marcar('16-caja-abierta', 'contar', page.getByRole('button', { name: 'Contar caja' }))
  await marcar('16-caja-abierta', 'cerrar', page.getByRole('link', { name: 'Cerrar caja' }))
  await foto(page, '16-caja-abierta')
  await foto(page, '16b-cuenta', page.locator('[data-cuenta-caja]').first())

  await page.getByRole('button', { name: 'Contar caja' }).click()
  d = page.getByRole('dialog')
  await d.getByLabel('Efectivo contado').fill('63000')
  await page.waitForTimeout(400)
  await foto(page, '17-contar-caja', panelDe(d))
  await d.getByRole('button', { name: 'Guardar conteo' }).click()
  await d.waitFor({ state: 'hidden', timeout: 15_000 })

  // 7 · Stock y productos, ya con mercaderia.
  console.log('Stock')
  await page.goto('/stock')
  await page.waitForLoadState('networkidle')
  // Llego mercaderia: 12 Coca Cola mas. El dialogo es alto: para que entre
  // entero en la captura, la ventana crece solo para esta.
  await page.setViewportSize({ width: ANCHO, height: 1150 })
  await page.getByRole('button', { name: 'Ajustar el stock de Coca Cola 2.25 L' }).click()
  d = page.getByRole('dialog')
  await d.getByRole('textbox', { name: /Cantidad en/ }).fill('12')
  await d.getByRole('button', { name: 'Entrada de mercadería' }).click()
  await page.waitForTimeout(500)
  await foto(page, '18b-entrada-mercaderia', panelDe(d))
  await d.getByRole('button', { name: 'Guardar ajuste' }).click()
  await d.waitFor({ state: 'detached', timeout: 15_000 })
  await page.setViewportSize({ width: ANCHO, height: ALTO })
  // Sin el aviso de "ajuste guardado", que tapaba una fila.
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await foto(page, '18-stock')
  await page.goto('/productos')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await foto(page, '19-productos')

  // 8 · Inventario: Almacen, el arroz con dos menos.
  console.log('Inventario')
  await page.goto('/inventarios')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Nuevo inventario' }).click()
  d = page.getByRole('dialog')
  await d.getByRole('radio', { name: /una categoría/i }).check()
  await d.getByRole('combobox', { name: /categoría/i }).selectOption({ label: 'Almacén' })
  await page.waitForTimeout(300)
  await foto(page, '20-nuevo-inventario', panelDe(d))
  await d.getByRole('button', { name: /empezar a contar/i }).click()
  await page.waitForURL(/\/inventarios\/\d+/)
  const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)
  await page.getByRole('list', { name: 'Pasos del inventario' }).waitFor()
  const lector = page.getByLabel(/escaneá o escribí el producto/i)
  await lector.click()
  await page.keyboard.type(codigo('Arroz largo fino 1 kg'), { delay: 8 })
  await page.keyboard.press('Enter')
  const contadoArroz = page.getByRole('textbox', { name: 'Contado de Arroz largo fino 1 kg' })
  await contadoArroz.waitFor()
  await contadoArroz.click()
  await contadoArroz.fill('8')
  await contadoArroz.press('Enter')
  const filaArroz = page.getByRole('row').filter({ hasText: 'Arroz largo fino 1 kg' }).first()
  await filaArroz.getByLabel('Guardado').waitFor({ timeout: 15_000 })
  // Solo lo contado: que se vea el renglon con su diferencia.
  await page.getByRole('button', { name: /^Contados/ }).click()
  await page.waitForTimeout(600)
  await marcar('21-inventario-contar', 'lector', lector)
  await marcar('21-inventario-contar', 'fila', filaArroz)
  await foto(page, '21-inventario-contar')

  // El resto se cuenta por lo que ya decia el sistema: la diferencia es una.
  interface Linea {
    id: number
    status: string
    snapshotQuantity: string
  }
  const lineas = await api<{ data: Linea[] }>(page, `/api/inventarios/${String(id)}/lineas?pageSize=100&page=1`, 'GET') // prettier-ignore
  await api(page, `/api/inventarios/${String(id)}/conteo`, 'POST', {
    lineas: lineas.data
      .filter((l) => l.status === 'PENDING')
      .map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
  })
  await page.reload()
  await page.getByText(/¡Contaste todo!/).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Terminé de contar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, terminé' }).click()
  await page.getByText('Encontramos diferencias en 1 producto.').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(500)
  await marcar(
    '22-inventario-revisar',
    'aplicar',
    page.getByRole('button', { name: 'APLICAR INVENTARIO' }),
  )
  await foto(page, '22-inventario-revisar')
  await page.getByRole('button', { name: 'APLICAR INVENTARIO' }).click()
  d = page.getByRole('dialog')
  await d.getByText(/esto no se puede deshacer/i).waitFor()
  await foto(page, '23-inventario-aplicar', panelDe(d))
  await d.getByRole('button', { name: 'Aplicar inventario' }).click()
  await page.getByRole('link', { name: 'Ver movimientos' }).waitFor({ timeout: 15_000 })

  // 9 · Cerrar la caja: primero con un faltante, despues justo.
  console.log('Cerrar caja')
  await page.goto('/caja/cerrar')
  const contado = page.getByLabel('Efectivo contado')
  await contado.waitFor()
  await contado.fill('62000')
  await page.getByRole('status').filter({ hasText: 'Falta' }).waitFor()
  await page.waitForTimeout(300)
  await foto(page, '24-cerrar-falta')
  await contado.fill('63000')
  await page.getByRole('status').filter({ hasText: 'Cuadra' }).waitFor()
  // Que se vean juntos el monto, el resultado y el boton de cerrar.
  await page.getByRole('button', { name: 'Cerrar caja' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await marcar('25-cerrar-cuadra', 'contado', contado)
  await marcar(
    '25-cerrar-cuadra',
    'resultado',
    page.getByRole('status').filter({ hasText: 'Cuadra' }),
  )
  await marcar('25-cerrar-cuadra', 'cerrar', page.getByRole('button', { name: 'Cerrar caja' }))
  await foto(page, '25-cerrar-cuadra')
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  await page.getByRole('heading', { name: 'Caja cerrada' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(400)
  await foto(page, '26-caja-cerrada-ok')

  await page.goto('/venta')
  await page.locator('[data-barcode-input]').waitFor()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await foto(page, '27-venta-sin-caja')

  // 10 · Reportes.
  console.log('Reportes')
  await page.goto('/reportes')
  await page.locator('[data-resumen-hoy]').waitFor({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await marcar('28-reportes', 'resumen', page.locator('[data-resumen-hoy]'))
  await foto(page, '28-reportes')
  for (const [nombre, archivo] of [
    ['Ventas por medio de pago', '29-reporte-medio'],
    ['Ventas por producto', '30-reporte-producto'],
    ['Cierres de caja', '31-reporte-cierres'],
  ] as const) {
    await page.getByRole('button', { name: new RegExp(`^${nombre}`) }).click()
    const reporte = page.getByRole('region', { name: nombre })
    await reporte.getByRole('table').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await reporte.scrollIntoViewIfNeeded()
    await foto(page, archivo, reporte)
  }

  // 11 · Configuracion.
  await page.goto('/configuracion')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await foto(page, '32-configuracion')

  // Para el HTML del manual, que se abre como archivo y no puede pedir un JSON.
  await fs.writeFile(
    path.join(SALIDA, 'marcas.js'),
    `// Generado por scripts/manual-house/capturas.ts\nwindow.MARCAS = ${JSON.stringify(marcas, null, 2)}\n`,
  )
  await browser.close()
  console.log('Listo.')
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
