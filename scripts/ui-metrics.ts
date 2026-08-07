/**
 * Medicion de la interfaz: peticiones, tamanios tactiles y desbordes.
 *
 * Da los numeros de la tabla antes/despues. Se mide, no se estima.
 *
 *   npm run dev                    # en otra terminal
 *   npm run ui:metrics -- before
 *   npm run ui:metrics -- after
 *
 * El resultado se guarda en docs/metrics/phase2-<destino>.json y se imprime.
 */
import { chromium, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000'
const USUARIO = process.env.SCREENSHOT_USER ?? 'admin'
const CLAVE = process.env.SCREENSHOT_PASSWORD ?? 'Demo1234!'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra la aplicacion local. Recibido: ${BASE}`)
}

/**
 * Las pantallas de cada version.
 *
 * La Fase 2 renombro casi todas: la caja registradora era `/caja` y el libro
 * de caja era `/ventas`, justo al reves de lo que dicen esos nombres.
 */
const ANTES = process.argv[2] === 'before'

const RUTAS = ANTES
  ? ['/', '/caja', '/productos', '/ventas', '/control/caja', '/admin/sales', '/admin/auditoria']
  : ['/', '/venta', '/caja', '/ventas', '/productos', '/stock', '/auditoria', '/usuarios']

/** La pantalla de venta, que es la que interesa medir en peticiones. */
const RUTA_VENTA = ANTES ? '/caja' : '/venta'
const VIEWPORTS = [
  { nombre: '375x812', width: 375, height: 812 },
  { nombre: '768x1024', width: 768, height: 1024 },
  { nombre: '1366x768', width: 1366, height: 768 },
  { nombre: '1920x1080', width: 1920, height: 1080 },
] as const

interface Medicion {
  peticionesApiAlAbrirCaja: number
  peticionesApiPorBusqueda: number
  rutasConScrollHorizontal: Record<string, string[]>
  objetivosTactilesChicos: Record<string, number>
  objetivoTactilMinimoPx: Record<string, number>
  anchoNavegacionMovilPx: number | null
  divClickeables: Record<string, number>
  camposSinEtiqueta: Record<string, number>
}

async function iniciarSesion(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  await page.locator('input').first().fill(USUARIO)
  await page.locator('input[type="password"]').first().fill(CLAVE)
  await page.getByRole('button', { name: /ingresar|iniciar|entrar|acceder/i }).first().click() // prettier-ignore
  await page.waitForTimeout(2200)
}

/**
 * Botones y enlaces por debajo de 44 px.
 *
 * Se mide la caja real que puede tocar el dedo, no la fuente: un boton de
 * 24 px con mucho padding cumple y uno de 40 px con texto grande no.
 */
const MEDIR_TACTIL = `(() => {
  const sel = 'button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select'
  let chicos = 0
  let minimo = Infinity
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    // El enlace de "saltar al contenido" mide un pixel hasta que recibe el
    // foco, y entonces sale a tamanio completo. No se toca con el dedo.
    if (el.classList.contains('sr-only-focusable')) continue
    const lado = Math.min(r.width, r.height)
    if (lado < minimo) minimo = lado
    if (lado < 44) chicos++
  }
  return { chicos, minimo: minimo === Infinity ? null : Math.round(minimo) }
})()`

const MEDIR_DIVS = `document.querySelectorAll('div[onclick], div[role="button"], span[onclick], li[onclick]').length`

/** Campos de formulario sin etiqueta accesible. */
const MEDIR_LABELS = `(() => {
  let sin = 0
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden') continue
    const id = el.getAttribute('id')
    const tieneLabel = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null
    const envuelto = el.closest('label')
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
    if (!tieneLabel && !envuelto && !aria) sin++
  }
  return sin
})()`

/**
 * Desborde real: se intenta desplazar la pagina y se mira si se movio.
 *
 * Comparar `scrollWidth` con `clientWidth` cuenta tambien el contenido que
 * desborda pero esta recortado --una tabla ancha dentro de su propio
 * `overflow-x-auto`, que es exactamente lo que se busca-- y da falsos
 * positivos.
 */
const MEDIR_DESBORDE = `(() => {
  const antes = window.scrollX
  window.scrollTo(600, window.scrollY)
  const movio = window.scrollX !== antes
  window.scrollTo(antes, window.scrollY)
  return movio
})()`

/**
 * Ancho de la navegacion visible.
 *
 * Antes era una barra que envolvia en dos filas; ahora en movil es un cajon
 * que se abre con un boton. Se mide lo que ocupa en pantalla: si la barra
 * lateral esta oculta, lo que hay es la cabecera.
 */
const MEDIR_NAV = `(() => {
  const lateral = document.querySelector('aside')
  if (lateral && getComputedStyle(lateral).display !== 'none') {
    return Math.round(lateral.getBoundingClientRect().width)
  }
  const cabecera = document.querySelector('header')
  return cabecera ? Math.round(cabecera.getBoundingClientRect().width) : null
})()`

async function medir(destino: string): Promise<Medicion> {
  const browser = await chromium.launch()
  const salida: Medicion = {
    peticionesApiAlAbrirCaja: 0,
    peticionesApiPorBusqueda: 0,
    rutasConScrollHorizontal: {},
    objetivosTactilesChicos: {},
    objetivoTactilMinimoPx: {},
    anchoNavegacionMovilPx: null,
    divClickeables: {},
    camposSinEtiqueta: {},
  }

  // --- Peticiones, en escritorio ---
  {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      colorScheme: 'dark',
    })
    const page = await ctx.newPage()
    await iniciarSesion(page)

    let contador = 0
    page.on('request', (r) => {
      if (r.url().includes('/api/')) contador++
    })

    contador = 0
    await page.goto(`${BASE}${RUTA_VENTA}`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(2500)
    salida.peticionesApiAlAbrirCaja = contador

    contador = 0
    // El buscador por nombre, no el campo de codigo: en la version nueva el
    // primer `input` de la pantalla es el del lector, y escribir ahi no
    // dispara ninguna consulta hasta que se manda Enter.
    const buscador = page.locator('input[type="search"]').first()
    await buscador.fill('Yerba').catch(() => undefined)
    await page.waitForTimeout(2000)
    salida.peticionesApiPorBusqueda = contador

    await ctx.close()
  }

  // --- Accesibilidad y desbordes, en los cuatro tamanios ---
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'dark',
    })
    const page = await ctx.newPage()
    await iniciarSesion(page)

    const desbordan: string[] = []
    let chicosTotal = 0
    let minimoTotal = Infinity
    let divsTotal = 0
    let sinLabelTotal = 0

    for (const ruta of RUTAS) {
      await page.goto(`${BASE}${ruta}`, { waitUntil: 'domcontentloaded' }).catch(() => null)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      await page.waitForTimeout(1200)

      if (await page.evaluate<boolean>(MEDIR_DESBORDE)) desbordan.push(ruta)

      const tactil = await page.evaluate<{ chicos: number; minimo: number | null }>(MEDIR_TACTIL)
      chicosTotal += tactil.chicos
      if (tactil.minimo !== null && tactil.minimo < minimoTotal) minimoTotal = tactil.minimo

      divsTotal += await page.evaluate<number>(MEDIR_DIVS)
      sinLabelTotal += await page.evaluate<number>(MEDIR_LABELS)

      if (vp.width === 375 && ruta === RUTA_VENTA) {
        salida.anchoNavegacionMovilPx = await page.evaluate<number | null>(MEDIR_NAV)
      }
    }

    salida.rutasConScrollHorizontal[vp.nombre] = desbordan
    salida.objetivosTactilesChicos[vp.nombre] = chicosTotal
    salida.objetivoTactilMinimoPx[vp.nombre] = minimoTotal === Infinity ? 0 : minimoTotal
    salida.divClickeables[vp.nombre] = divsTotal
    salida.camposSinEtiqueta[vp.nombre] = sinLabelTotal

    await ctx.close()
  }

  await browser.close()

  const dir = path.join('docs', 'metrics')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `phase2-${destino}.json`),
    JSON.stringify(salida, null, 2) + '\n',
  )
  return salida
}

async function main(): Promise<void> {
  const destino = process.argv[2]
  if (destino !== 'before' && destino !== 'after') {
    throw new Error('Uso: npm run ui:metrics -- <before|after>')
  }
  const r = await medir(destino)
  console.log(JSON.stringify(r, null, 2))
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
