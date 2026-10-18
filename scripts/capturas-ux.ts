/**
 * Capturas de las pantallas principales del almacen, en computadora de caja
 * (1366x768) y en telefono (375x812), para revisar el aspecto antes y despues
 * de un cambio de interfaz.
 *
 * Corre contra la aplicacion local con la base de desarrollo. Se niega a
 * arrancar si la URL no es localhost.
 *
 *   CAPTURAS_URL=http://localhost:3100 npx tsx scripts/capturas-ux.ts antes
 *   CAPTURAS_URL=http://localhost:3100 npx tsx scripts/capturas-ux.ts despues
 *
 * Las imagenes van a docs/ux-v5-evidence/<destino>/<pantalla>-<ancho>.png
 *
 * Las capturas de la entrega, con los nombres del documento de entrega:
 *
 *   CAPTURAS_URL=http://localhost:3102 npx tsx scripts/capturas-ux.ts final
 *
 * van a docs/entrega-almacen/capturas/ (01-inicio.png ... 15-mobile-inventario.png).
 */
import { chromium, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.CAPTURAS_URL ?? 'http://localhost:3000'
const USUARIO = process.env.SCREENSHOT_USER ?? 'admin'
const CLAVE = process.env.SCREENSHOT_PASSWORD ?? 'Demo1234!'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra la aplicacion local. Recibido: ${BASE}`)
}

const VIEWPORTS = [
  { nombre: '1366', width: 1366, height: 768 },
  { nombre: '375', width: 375, height: 812 },
] as const

interface Pantalla {
  clave: string
  ruta: string
  /** Lo que hay que hacer antes de capturar (abrir un dialogo, cargar el ticket). */
  preparar?: (page: Page) => Promise<void>
  /** Solo si la pantalla ya existia antes del cambio; las nuevas se saltean en "antes". */
  soloDespues?: boolean
}

/** Codigos del seed de demostracion. */
const YERBA = '7790001000011'
const LECHE = '7790003000017'

async function escanear(page: Page, codigo: string): Promise<void> {
  const campo = page.locator('[data-barcode-input]')
  await campo.click()
  await page.keyboard.type(codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

const PANTALLAS: Pantalla[] = [
  { clave: 'inicio', ruta: '/' },
  { clave: 'venta', ruta: '/venta' },
  {
    clave: 'venta-ticket',
    ruta: '/venta',
    soloDespues: true,
    preparar: async (page) => {
      await escanear(page, YERBA)
      await escanear(page, YERBA)
      await escanear(page, LECHE)
    },
  },
  {
    clave: 'venta-cobro',
    ruta: '/venta',
    soloDespues: true,
    preparar: async (page) => {
      // El ticket guardado de la captura anterior ya esta; si no, se arma.
      if ((await page.locator('[data-linea]').count()) === 0) {
        await escanear(page, YERBA)
        await escanear(page, LECHE)
      }
      await page.keyboard.press('F12')
      await page.getByRole('dialog').getByRole('radio', { name: 'Efectivo' }).waitFor()
      await page.getByLabel(/^recibido/i).fill('20000')
    },
  },
  { clave: 'caja', ruta: '/caja' },
  { clave: 'productos', ruta: '/productos' },
  {
    clave: 'producto-nuevo',
    ruta: '/productos',
    soloDespues: true,
    preparar: async (page) => {
      await page.getByRole('button', { name: /nuevo producto/i }).click()
      await page.getByRole('dialog').getByLabel('Nombre').waitFor()
    },
  },
  { clave: 'stock', ruta: '/stock' },
  { clave: 'movimientos', ruta: '/stock/movimientos' },
  { clave: 'inventarios', ruta: '/inventarios' },
  {
    clave: 'inventario-conteo',
    ruta: '/inventarios',
    soloDespues: true,
    preparar: async (page) => {
      await page
        .getByRole('link', { name: /abrir|seguir contando|revisar/i })
        .first()
        .click()
      await page.waitForURL(/\/inventarios\/\d+/)
    },
  },
  { clave: 'configuracion', ruta: '/configuracion' },
  { clave: 'lotes', ruta: '/stock/lotes' },
]

/**
 * Las capturas de la entrega, con nombre fijo (modo `final`).
 *
 * El punto de venta y el cobro se capturan SOLO lo que entra en la pantalla:
 * lo que se prueba es que en 1366 x 768 la operacion se hace sin desplazarse.
 */
interface Final {
  archivo: string
  ruta: string
  movil?: boolean
  /** Solo lo visible, sin desplazar. */
  visible?: boolean
  /** No volver arriba antes de capturar: `preparar` ya dejo a la vista lo que importa. */
  quedarse?: boolean
  preparar?: (page: Page) => Promise<void>
}

async function armarTicket(page: Page): Promise<void> {
  if ((await page.locator('[data-linea]').count()) > 0) return
  await escanear(page, YERBA)
  await escanear(page, YERBA)
  await escanear(page, LECHE)
}

/**
 * El inventario sin terminar; si no hay, uno de Bebidas con dos productos
 * contados: uno cuadra y al otro le faltan dos.
 */
async function abrirInventario(page: Page): Promise<void> {
  const abierto = page.getByRole('link', { name: /seguir contando/i })
  if ((await abierto.count()) > 0) {
    await abierto.first().click()
    await page.waitForURL(/\/inventarios\/\d+/)
  } else {
    await page.getByRole('button', { name: 'Nuevo inventario' }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByRole('radio', { name: /una categoría/i }).check()
    await dialogo.getByRole('combobox', { name: /categoría/i }).selectOption({ label: 'Bebidas' })
    await dialogo.getByRole('button', { name: /empezar a contar/i }).click()
    await page.waitForURL(/\/inventarios\/\d+/)
    const cantidades = page.getByRole('textbox', { name: /^Contado de / })
    await cantidades.first().waitFor()
    const filas = page.getByRole('row').filter({ has: cantidades })
    for (const [i, menos] of [
      [0, 0],
      [1, 2],
    ] as const) {
      const sistema = Number(/(\d+)/.exec(await filas.nth(i).locator('td').nth(1).innerText())?.[1])
      const campo = filas.nth(i).getByRole('textbox')
      await campo.fill(String(Math.max(0, sistema - menos)))
      await campo.press('Enter')
      await filas.nth(i).getByLabel('Guardado').waitFor({ timeout: 15_000 })
    }
  }
  // Lo contado, con su marca de guardado y su diferencia, a la vista.
  await page.getByRole('button', { name: /^Contados/ }).click()
  const primera = page.getByRole('textbox', { name: /^Contado de / }).first()
  await primera.waitFor()
  await page.waitForTimeout(600)
  // Se desplaza el contenido, no la ventana: la barra de arriba queda entera.
  await primera.evaluate((el) => {
    const main = el.closest('main')
    if (main) {
      const arriba = el.getBoundingClientRect().top - main.getBoundingClientRect().top
      main.scrollBy(0, arriba - main.clientHeight / 3)
    }
    window.scrollTo(0, 0)
  })
}

const FINALES: Final[] = [
  { archivo: '01-inicio', ruta: '/' },
  { archivo: '02-venta', ruta: '/venta', visible: true, preparar: armarTicket },
  {
    archivo: '03-venta-cobro',
    ruta: '/venta',
    visible: true,
    preparar: async (page) => {
      await armarTicket(page)
      await page.keyboard.press('F12')
      await page.getByRole('dialog').getByRole('radio', { name: 'Efectivo' }).waitFor()
      await page.getByRole('dialog').getByRole('radio', { name: 'Efectivo' }).press('Enter')
      await page.getByLabel(/^recibido/i).fill('20000')
    },
  },
  { archivo: '04-caja', ruta: '/caja' },
  { archivo: '05-productos', ruta: '/productos' },
  {
    archivo: '06-nuevo-producto',
    ruta: '/productos',
    visible: true,
    preparar: async (page) => {
      await page.getByRole('button', { name: /nuevo producto/i }).click()
      await page.getByRole('textbox', { name: /^nombre/i }).waitFor()
    },
  },
  { archivo: '07-stock', ruta: '/stock' },
  { archivo: '08-movimientos', ruta: '/stock/movimientos' },
  { archivo: '09-inventarios', ruta: '/inventarios' },
  {
    archivo: '10-inventario-conteo',
    ruta: '/inventarios',
    quedarse: true,
    preparar: abrirInventario,
  },
  { archivo: '11-configuracion', ruta: '/configuracion' },
  { archivo: '12-mobile-inicio', ruta: '/', movil: true },
  { archivo: '13-mobile-venta', ruta: '/venta', movil: true, preparar: armarTicket },
  { archivo: '14-mobile-productos', ruta: '/productos', movil: true },
  {
    archivo: '15-mobile-inventario',
    ruta: '/inventarios',
    movil: true,
    quedarse: true,
    visible: true,
    preparar: abrirInventario,
  },
]

async function capturasFinales(dir: string): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const movil of [false, true]) {
      const context = await browser.newContext({
        viewport: movil ? { width: 375, height: 812 } : { width: 1366, height: 768 },
        deviceScaleFactor: 1,
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        colorScheme: 'light',
      })
      const page = await context.newPage()
      await iniciarSesion(page)
      for (const f of FINALES.filter((x) => (x.movil ?? false) === movil)) {
        await page.goto(`${BASE}${f.ruta}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(1000)
        if (f.preparar) await f.preparar(page)
        await page.waitForTimeout(800)
        // Desde arriba: guardar una cantidad o elegir un producto desplaza
        // la pantalla, y la captura tiene que mostrar el encabezado.
        if (f.quedarse !== true) {
          await page
            .locator('main')
            .evaluate((m) => {
              m.scrollTo(0, 0)
            })
            .catch(() => undefined)
        }
        const archivo = path.join(dir, `${f.archivo}.png`)
        await page.screenshot({ path: archivo, fullPage: f.visible !== true })
        process.stdout.write(`  ${archivo}  (${new URL(page.url()).pathname})\n`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

async function iniciarSesion(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  await page.locator('input').nth(0).fill(USUARIO)
  await page.locator('input[type="password"]').first().fill(CLAVE)
  await page
    .getByRole('button', { name: /ingresar|iniciar|entrar|acceder/i })
    .first()
    .click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function main(): Promise<void> {
  const destino = process.argv[2]
  if (!destino || !/^[a-z0-9-]+$/.test(destino)) {
    throw new Error('Uso: npx tsx scripts/capturas-ux.ts <destino>')
  }
  if (destino === 'final') {
    const dirFinal = path.join('docs', 'entrega-almacen', 'capturas')
    await fs.mkdir(dirFinal, { recursive: true })
    await capturasFinales(dirFinal)
    return
  }
  const dir = path.join('docs', 'ux-v5-evidence', destino)
  await fs.mkdir(dir, { recursive: true })

  const browser = await chromium.launch()
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
      })
      const page = await context.newPage()
      page.on('pageerror', () => undefined)
      await iniciarSesion(page)

      const despues = destino !== 'antes'
      for (const p of PANTALLAS) {
        if (p.soloDespues && !despues) continue
        await page.goto(`${BASE}${p.ruta}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(1200)
        if (p.preparar) {
          await p.preparar(page).catch((e: unknown) => {
            process.stdout.write(`  (no se pudo preparar ${p.clave}: ${String(e)})\n`)
          })
          await page.waitForTimeout(800)
        }
        const archivo = path.join(dir, `${p.clave}-${vp.nombre}.png`)
        await page.screenshot({ path: archivo, fullPage: true })
        process.stdout.write(`  ${archivo}  (${new URL(page.url()).pathname})\n`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
