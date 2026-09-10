/**
 * Densidad real de /venta por ancho: cuantas filas entran a la vista, alto de
 * fila, ancho del nombre, ancho del ticket y de la barra lateral.
 *
 *   npx tsx scripts/densidad-venta-v3.mts
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL ?? 'http://localhost:3099'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) throw new Error('solo local')

const VIEWPORTS = [
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
] as const

const browser = await chromium.launch()
const filas: string[] = []
for (const [width, height] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: 'dark',
    locale: 'es-AR',
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'cajero', password: 'Demo1234!' },
  })
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
  await page.waitForTimeout(400)
  const d = await page.evaluate(() => {
    const filas = [...document.querySelectorAll<HTMLElement>('[data-fila]')]
    const primera = filas[0]
    if (!primera) return null
    let cont: HTMLElement | null = primera.parentElement
    while (
      cont &&
      getComputedStyle(cont).overflowY !== 'auto' &&
      getComputedStyle(cont).overflowY !== 'scroll'
    )
      cont = cont.parentElement
    const rc = cont
      ? cont.getBoundingClientRect()
      : { top: 0, bottom: innerHeight, left: 0, right: innerWidth }
    const barra = document.querySelector<HTMLElement>('.fixed.inset-x-0.bottom-0')
    const barraTop =
      barra && getComputedStyle(barra).display !== 'none'
        ? barra.getBoundingClientRect().top
        : innerHeight
    const limite = Math.min(rc.bottom, barraTop)
    const visibles = filas.filter((f) => {
      const r = f.getBoundingClientRect()
      return r.top >= rc.top - 1 && r.bottom <= limite + 1
    }).length
    const r0 = primera.getBoundingClientRect()
    const nombre = primera.querySelector<HTMLElement>('[data-nombre]')
    const ticket = document.querySelector<HTMLElement>('section[aria-label="Ticket en curso"]')
    const tr = ticket ? ticket.getBoundingClientRect() : null
    const aside = document.querySelector<HTMLElement>('aside')
    const ar =
      aside && getComputedStyle(aside).display !== 'none' ? aside.getBoundingClientRect().width : 0
    const chips = document.querySelector<HTMLElement>('[aria-label="Secciones del catálogo"]')
    const campo = document.querySelector<HTMLElement>('[data-barcode-input]')
    return {
      visibles,
      total: filas.length,
      altoFila: Math.round(r0.height),
      anchoFila: Math.round(r0.width),
      anchoNombre: nombre ? Math.round(nombre.getBoundingClientRect().width) : -1,
      listaTop: Math.round(rc.top),
      listaAlto: Math.round(limite - rc.top),
      ticketAncho: tr && tr.width > 0 ? Math.round(tr.width) : 0,
      aside: Math.round(ar),
      chipsAlto: chips ? Math.round(chips.getBoundingClientRect().height) : -1,
      campoAlto: campo ? Math.round(campo.getBoundingClientRect().height) : -1,
    }
  })
  await ctx.close()
  if (!d) continue
  filas.push(
    `${String(width).padStart(4)}x${String(height).padEnd(5)} filas visibles ${String(d.visibles).padStart(2)}/${String(d.total)} · fila ${String(d.altoFila)}px alto × ${String(d.anchoFila)}px · nombre ${String(d.anchoNombre)}px · lista desde y=${String(d.listaTop)} alto ${String(d.listaAlto)} · ticket ${String(d.ticketAncho)}px · sidebar ${String(d.aside)}px · chips ${String(d.chipsAlto)}px · campo ${String(d.campoAlto)}px`,
  )
}
await browser.close()
console.log(filas.join('\n'))
