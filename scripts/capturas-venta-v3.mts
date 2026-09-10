/**
 * Capturas del estado ACTUAL de /venta (diagnostico UX V3).
 *
 *   npx tsx scripts/capturas-venta-v3.mts [antes|despues]
 *
 * Contra http://localhost:3099 (build de produccion), base de desarrollo.
 * Escribe en docs/ux-v3-venta-evidence/<modo>/.
 */
import { chromium, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs/promises'

const modo = process.argv[2] === 'despues' ? 'despues' : 'antes'
const BASE = process.env.BASE_URL ?? 'http://localhost:3099'
const CLAVE = 'Demo1234!'
const DESTINO = `docs/ux-v3-venta-evidence/${modo}`
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) throw new Error('solo local')

const VIEWPORTS = [
  { nombre: '375', width: 375, height: 667 },
  { nombre: '390', width: 390, height: 844 },
  { nombre: '430', width: 430, height: 932 },
  { nombre: '768', width: 768, height: 1024 },
  { nombre: '1024', width: 1024, height: 768 },
  { nombre: '1366', width: 1366, height: 768 },
  { nombre: '1440', width: 1440, height: 900 },
  { nombre: '1920', width: 1920, height: 1080 },
] as const
type VP = (typeof VIEWPORTS)[number]['nombre']
const TODOS: VP[] = ['375', '390', '430', '768', '1024', '1366', '1440', '1920']
const CLAVES: VP[] = ['375', '768', '1024', '1366']

interface Datos {
  codigos: string[]
  pesado: string | null
  agotado: string | null
  categoria: string
}

type Pantalla = {
  clave: string
  anchos: VP[]
  preparar?: (page: Page, vp: VP, d: Datos) => Promise<void>
}

async function reposar(page: Page, ms = 500): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(ms)
}

async function entrar(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const r = await page.context().request.post(`${BASE}/api/auth/login`, {
    data: { username: 'cajero', password: CLAVE },
  })
  if (!r.ok()) throw new Error(`login ${String(r.status())}`)
}

async function irAVenta(page: Page): Promise<void> {
  await page.goto(`${BASE}/venta`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.removeItem('kiosco:ticket')
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('kiosco:frecuentes') || k.startsWith('kiosco:favoritos'))
        localStorage.removeItem(k)
    }
  })
  await page.goto(`${BASE}/venta`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-fila]').first().waitFor()
  await reposar(page, 600)
}

async function escanear(page: Page, codigos: string[]): Promise<void> {
  const campo = page.locator('[data-barcode-input]')
  for (const c of codigos) {
    await campo.fill(c)
    await campo.press('Enter')
    await page.waitForTimeout(450)
  }
}

const PANTALLAS: Pantalla[] = [
  { clave: 'lista-inicial', anchos: TODOS },
  {
    clave: 'busqueda',
    anchos: CLAVES,
    preparar: async (page) => {
      await page.locator('[data-barcode-input]').fill('le')
      await page.waitForTimeout(900)
    },
  },
  {
    clave: 'categoria',
    anchos: CLAVES,
    preparar: async (page, _vp, d) => {
      await page.getByRole('button', { name: d.categoria, exact: true }).click()
      await page.waitForTimeout(900)
    },
  },
  {
    clave: 'ticket-con-productos',
    anchos: TODOS,
    preparar: async (page, _vp, d) => {
      await escanear(page, d.codigos.slice(0, 3))
    },
  },
  {
    clave: 'ticket-largo',
    anchos: CLAVES,
    preparar: async (page, vp, d) => {
      await escanear(page, d.codigos.slice(0, 12))
      if (vp === '375' || vp === '768') {
        await page.getByRole('button', { name: /^ticket/i }).click()
        await page.waitForTimeout(700)
      }
    },
  },
  {
    clave: 'fila-seleccionada',
    anchos: CLAVES,
    preparar: async (page) => {
      await page.locator('[data-barcode-input]').focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(300)
    },
  },
  {
    clave: 'producto-pesado',
    anchos: ['375', '1366'],
    preparar: async (page, _vp, d) => {
      if (!d.pesado) return
      await escanear(page, [d.pesado])
      await page.waitForTimeout(500)
    },
  },
  {
    clave: 'agotado',
    anchos: ['375', '1366'],
    preparar: async (page, _vp, d) => {
      if (!d.agotado) return
      await page.locator('[data-barcode-input]').fill(d.agotado)
      await page.waitForTimeout(900)
    },
  },
  {
    // El paso que agrego la V3: Enter con el campo vacio NO cobra, revisa.
    clave: 'revisar',
    anchos: CLAVES,
    preparar: async (page, _vp, d) => {
      await escanear(page, d.codigos.slice(0, 3))
      await page.locator('[data-barcode-input]').focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
    },
  },
  {
    clave: 'checkout',
    anchos: CLAVES,
    preparar: async (page, _vp, d) => {
      await escanear(page, d.codigos.slice(0, 3))
      await page.locator('[data-barcode-input]').focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(700)
    },
  },
  {
    clave: 'modo-lector',
    anchos: ['375', '1366'],
    preparar: async (page) => {
      await page.evaluate(() => {
        localStorage.setItem('kiosco:venta:modo', 'lector')
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-fila]').first().waitFor()
      await page.waitForTimeout(400)
    },
  },
  {
    clave: 'modo-nombre',
    anchos: ['375', '1366'],
    preparar: async (page) => {
      await page.evaluate(() => {
        localStorage.setItem('kiosco:venta:modo', 'nombre')
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-fila]').first().waitFor()
      await page.locator('[data-barcode-input]').fill('a')
      await page.waitForTimeout(600)
    },
  },
  {
    clave: 'ticket-mobile-abierto',
    anchos: ['375', '430', '768'],
    preparar: async (page, _vp, d) => {
      await escanear(page, d.codigos.slice(0, 3))
      await page.getByRole('button', { name: /^ticket/i }).click()
      await page.waitForTimeout(700)
    },
  },
]

interface ProductoApi {
  id: number
  name: string
  barcode: string | null
  saleUnit: string
  sellableStock: string
}

async function datos(browser: Browser): Promise<Datos> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await entrar(page)
  const todos = (await (
    await ctx.request.get(
      `${BASE}/api/products?pageSize=100&estado=activos&sortBy=name&sortDir=asc`,
    )
  ).json()) as { data: ProductoApi[] }
  const unidad = todos.data.filter(
    (p) => p.saleUnit === 'UNIT' && p.barcode && Number(p.sellableStock) >= 5,
  )
  const pesado = todos.data.find(
    (p) => (p.saleUnit === 'KG' || p.saleUnit === 'L') && p.barcode && Number(p.sellableStock) > 0,
  )
  const agotado = todos.data.find((p) => Number(p.sellableStock) <= 0)
  const categorias = (await (await ctx.request.get(`${BASE}/api/categories`)).json()) as Array<{
    name: string
  }>
  await ctx.close()
  return {
    codigos: unidad.map((p) => p.barcode ?? '').filter(Boolean),
    pesado: pesado?.barcode ?? null,
    agotado: agotado ? agotado.name.split(' ').slice(0, 2).join(' ') : null,
    categoria: categorias.find((c) => c.name === 'Bebidas')?.name ?? categorias[0]?.name ?? 'Todos',
  }
}

async function capturar(browser: Browser): Promise<void> {
  await fs.mkdir(DESTINO, { recursive: true })
  const d = await datos(browser)
  console.log(
    `codigos: ${String(d.codigos.length)} · pesado: ${d.pesado ?? '-'} · agotado: ${d.agotado ?? '-'} · categoria: ${d.categoria}`,
  )
  const solo = process.env.SOLO
  for (const pantalla of PANTALLAS) {
    if (solo && pantalla.clave !== solo) continue
    for (const vp of VIEWPORTS) {
      if (!pantalla.anchos.includes(vp.nombre)) continue
      const contexto = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: 'dark',
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
        hasTouch: vp.width < 768,
      })
      const page = await contexto.newPage()
      try {
        await entrar(page)
        await irAVenta(page)
        if (pantalla.preparar) await pantalla.preparar(page, vp.nombre, d)
        await page.screenshot({ path: `${DESTINO}/${pantalla.clave}-${vp.nombre}.png` })
        console.log(`${modo}/${pantalla.clave}-${vp.nombre}.png`)
      } catch (e) {
        console.log(`FALLO ${pantalla.clave}-${vp.nombre}: ${String(e).slice(0, 160)}`)
      } finally {
        await contexto.close()
      }
    }
  }
}

const browser = await chromium.launch()
await capturar(browser)
await browser.close()
