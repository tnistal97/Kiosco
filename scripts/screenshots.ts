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

/** Codigos del seed de demostracion. */
const CODIGOS = ['7790001000011', '7790002000014', '7790003000017']

/**
 * Carga el ticket de la pantalla de venta.
 *
 * Dos caminos, porque las dos versiones de la pantalla se cargan distinto y
 * las capturas tienen que ser comparables:
 *
 *  - la nueva tiene un campo de codigo de barras: se escribe y se manda Enter,
 *    que es como opera el lector;
 *  - la anterior exigia buscar y hacer clic en un boton "Agregar" por fila.
 */
async function cargarCarrito(page: Page): Promise<void> {
  const campoCodigo = page.locator('[data-barcode-input]')

  if (await campoCodigo.isVisible().catch(() => false)) {
    for (const codigo of CODIGOS) {
      await campoCodigo.fill(codigo)
      await campoCodigo.press('Enter')
      await page.waitForTimeout(900)
    }
    return
  }

  // Pantalla anterior.
  for (const termino of ['Yerba', 'Gaseosa cola', 'Leche entera']) {
    const buscador = page.locator('input[type="text"], input:not([type])').first()
    await buscador.fill(termino)
    await page.waitForTimeout(800)
    const agregar = page.getByRole('button', { name: /agregar/i }).first()
    if (await agregar.isVisible().catch(() => false)) {
      await agregar.click({ timeout: 3000 }).catch(() => undefined)
      await page.waitForTimeout(400)
    }
  }
}

/**
 * Rutas de cada version.
 *
 * La Fase 2 renombro las pantallas para que se llamen como lo que son: la
 * caja registradora era `/caja` y el libro de caja era `/ventas`, justo al
 * reves de lo que dicen esos nombres.
 */
const ANTES = process.argv[2] === 'before'
const R = ANTES
  ? {
      venta: '/caja',
      caja: '/ventas',
      arqueo: '/control/caja',
      ventas: '/admin/sales',
      auditoria: '/admin/auditoria',
      usuarios: '/admin/usuarios',
      stock: '/admin/stock',
      configuracion: '/admin/configuracion',
    }
  : {
      venta: '/venta',
      caja: '/caja',
      arqueo: '/caja',
      ventas: '/ventas',
      auditoria: '/auditoria',
      usuarios: '/usuarios',
      stock: '/stock',
      configuracion: '/configuracion',
    }

async function abrirPorTexto(page: Page, patron: RegExp): Promise<void> {
  const boton = page.getByRole('button', { name: patron }).first()
  if (await boton.isVisible().catch(() => false)) {
    await boton.click({ timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(700)
  }
}

const PANTALLAS: Pantalla[] = [
  { clave: 'login', ruta: '/login', publica: true },
  { clave: 'inicio', ruta: '/' },
  { clave: 'venta-vacia', ruta: R.venta },
  { clave: 'venta-con-productos', ruta: R.venta, preparar: cargarCarrito },
  {
    clave: 'cobro',
    ruta: R.venta,
    preparar: async (page) => {
      await cargarCarrito(page)
      await abrirPorTexto(page, /^cobrar|confirmar venta|finalizar|vender/i)
    },
  },
  { clave: 'productos', ruta: '/productos' },
  {
    clave: 'producto-edicion',
    ruta: '/productos',
    preparar: async (page) => {
      await page.waitForTimeout(1200)
      // La version nueva esconde "Editar" dentro del menu de la fila.
      await abrirPorTexto(page, /^acciones de/i)
      await abrirPorTexto(page, /^editar$/i)
    },
  },
  { clave: 'caja', ruta: R.caja },
  {
    clave: 'arqueo',
    ruta: R.arqueo,
    preparar: async (page) => {
      await abrirPorTexto(page, /hacer arqueo/i)
    },
  },
  { clave: 'ventas', ruta: R.ventas },
  { clave: 'auditoria', ruta: R.auditoria },
  { clave: 'usuarios', ruta: R.usuarios, opcional: true },
  { clave: 'stock', ruta: R.stock, opcional: true },
  { clave: 'configuracion', ruta: R.configuracion, opcional: true },
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
