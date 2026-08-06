/**
 * Capturas automatizadas de todas las pantallas, en los cuatro tamanios que
 * hay que soportar.
 *
 * Corre contra la aplicacion local y la base de desarrollo con datos
 * ficticios. Nunca contra produccion: se niega a arrancar si la URL no es
 * localhost.
 *
 *   npm run dev                       # en otra terminal
 *   npm run screenshots -- before     # antes de tocar la interfaz
 *   npm run screenshots -- after      # al terminar
 *
 * Las imagenes van a docs/screenshots/phase2-<destino>/<pantalla>-<ancho>.png
 */
import { chromium, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const USUARIO = process.env.SCREENSHOT_USER ?? 'admin'
const CLAVE = process.env.SCREENSHOT_PASSWORD ?? 'Demo1234!'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra la aplicacion local. Recibido: ${BASE}`)
}

const VIEWPORTS = [
  { nombre: '375', width: 375, height: 812 },
  { nombre: '768', width: 768, height: 1024 },
  { nombre: '1366', width: 1366, height: 768 },
  { nombre: '1920', width: 1920, height: 1080 },
] as const

type Pantalla = {
  clave: string
  ruta: string
  /** Sin sesion iniciada. */
  publica?: boolean
  /** Acciones previas a la captura (abrir un modal, cargar el carrito). */
  preparar?: (page: Page) => Promise<void>
  /** Rutas que esta fase todavia no tiene. Se saltean sin fallar. */
  opcional?: boolean
}

/** Espera corta para que terminen las animaciones y el fetch inicial. */
async function reposar(page: Page, ms = 900): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(ms)
}

/**
 * Agrega productos al carrito de la pantalla de venta.
 *
 * Busca por nombre y hace clic en el primer resultado. Se escribe contra el
 * texto visible y no contra clases CSS, para que siga funcionando despues del
 * rediseno y las capturas "antes" y "despues" sean comparables.
 */
async function cargarCarrito(page: Page): Promise<void> {
  for (const termino of ['Yerba', 'Gaseosa cola', 'Leche entera']) {
    const buscador = page
      .locator('input[type="text"], input[type="search"], input:not([type])')
      .first()
    await buscador.fill(termino)
    await page.waitForTimeout(700)
    const fila = page.getByText(termino, { exact: false }).first()
    if (await fila.isVisible().catch(() => false)) {
      await fila.click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(400)
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined)
}

const PANTALLAS: Pantalla[] = [
  { clave: 'login', ruta: '/login', publica: true },
  { clave: 'inicio', ruta: '/' },
  { clave: 'venta-vacia', ruta: '/caja' },
  { clave: 'venta-con-productos', ruta: '/caja', preparar: cargarCarrito },
  {
    clave: 'cobro',
    ruta: '/caja',
    preparar: async (page) => {
      await cargarCarrito(page)
      const cobrar = page
        .getByRole('button', { name: /cobrar|confirmar venta|finalizar|vender/i })
        .first()
      if (await cobrar.isVisible().catch(() => false)) {
        await cobrar.click().catch(() => undefined)
        await page.waitForTimeout(600)
      }
    },
  },
  { clave: 'productos', ruta: '/productos' },
  {
    clave: 'producto-edicion',
    ruta: '/productos',
    preparar: async (page) => {
      await page.waitForTimeout(1200)
      const editar = page.getByRole('button', { name: /editar/i }).first()
      if (await editar.isVisible().catch(() => false)) {
        await editar.click().catch(() => undefined)
        await page.waitForTimeout(600)
      }
    },
  },
  { clave: 'caja', ruta: '/ventas' },
  { clave: 'arqueo', ruta: '/control/caja' },
  { clave: 'ventas', ruta: '/admin/sales' },
  { clave: 'auditoria', ruta: '/admin/auditoria' },
  { clave: 'usuarios', ruta: '/admin/usuarios', opcional: true },
  { clave: 'administracion', ruta: '/admin', opcional: true },
]

async function iniciarSesion(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  const campos = page.locator('input')
  await campos.nth(0).fill(USUARIO)
  await page.locator('input[type="password"]').first().fill(CLAVE)
  await page.getByRole('button', { name: /ingresar|iniciar|entrar|acceder/i }).first().click() // prettier-ignore
  await page.waitForTimeout(2500)
}

async function capturar(browser: Browser, destino: string): Promise<void> {
  const dir = path.join('docs', 'screenshots', `phase2-${destino}`)
  await fs.mkdir(dir, { recursive: true })

  const saltadas: string[] = []

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      colorScheme: 'dark',
    })
    const page = await context.newPage()
    // Silencia el ruido de consola: no aporta a la captura.
    page.on('pageerror', () => undefined)

    let conSesion = false

    for (const pantalla of PANTALLAS) {
      if (!pantalla.publica && !conSesion) {
        await iniciarSesion(page)
        conSesion = true
      }
      if (pantalla.publica && conSesion) continue // el login ya se capturo primero

      const respuesta = await page
        .goto(`${BASE}${pantalla.ruta}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        .catch(() => null)

      if (pantalla.opcional && (!respuesta || respuesta.status() >= 400)) {
        if (!saltadas.includes(pantalla.clave)) saltadas.push(pantalla.clave)
        continue
      }
      await reposar(page)
      if (pantalla.preparar) {
        await pantalla.preparar(page).catch(() => undefined)
        await page.waitForTimeout(500)
      }

      const archivo = path.join(dir, `${pantalla.clave}-${vp.nombre}.png`)
      await page.screenshot({ path: archivo, fullPage: false })
      process.stdout.write(`  ${archivo}\n`)
    }

    await context.close()
  }

  if (saltadas.length > 0) {
    console.log(`\n  Pantallas todavia inexistentes, salteadas: ${saltadas.join(', ')}`)
  }
}

async function main(): Promise<void> {
  const destino = process.argv[2]
  if (destino !== 'before' && destino !== 'after') {
    throw new Error('Uso: npm run screenshots -- <before|after>')
  }
  console.log(`Capturando "${destino}" desde ${BASE} como "${USUARIO}"...`)
  const browser = await chromium.launch()
  try {
    await capturar(browser, destino)
  } finally {
    await browser.close()
  }
  console.log('Listo.')
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
