/**
 * Medicion de la navegacion: cuanto tarda cambiar de pantalla y que se ve
 * mientras tanto. UX V2, Fase 2.1.
 *
 * Existe porque la fase arranco con una percepcion --"se traba", "el menu
 * desaparece", "parece que la sesion vencio"-- y una percepcion no se
 * arregla: se mide. Esto da los numeros de docs/UX_V2_PHASE2_1_LIST_SESSION_NAVIGATION.md.
 *
 *   npm run build
 *   npx next start -p 3099            # en otra terminal
 *   npm run nav:metrics -- despues    # o "antes", contra el commit anterior
 *
 * Que mide, por ruta y con CINCO muestras (se informa la mediana, no la mejor):
 *
 *   commit    del clic hasta que la pantalla cambia de titulo, es decir hasta
 *             que el enrutador acepta la navegacion. Es el "no pasa nada"
 *             del que se quejaba el reporte.
 *   datos     del clic hasta que no queda ningun esqueleto en el contenido:
 *             lo que la persona vino a leer, en pantalla.
 *   apis      cuantas peticiones a /api dispara la navegacion.
 *   cls       desplazamiento acumulado durante la transicion (layout-shift).
 *   armazon   si la barra lateral se fue de la pantalla en algun cuadro, y si
 *             el nodo del DOM siguio siendo EL MISMO --si se remonta, todo su
 *             estado se pierde y se ve el parpadeo--.
 *
 * Y aparte, con F5 en cada ruta: TTFB y DOMContentLoaded, leidos del propio
 * navegador (Navigation Timing), sin mezclar relojes.
 */
import { chromium, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.NAV_BASE_URL ?? 'http://127.0.0.1:3099'
const USUARIO = process.env.NAV_USER ?? 'admin'
const CLAVE = process.env.NAV_PASSWORD ?? 'Demo1234!'
const MUESTRAS = Number(process.env.NAV_MUESTRAS ?? 5)
const DESTINO = process.argv[2] ?? 'despues'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra la aplicacion local. Recibido: ${BASE}`)
}

/** Las rutas que pidio la fase, con el titulo que pone el armazon. */
const RUTAS = [
  { href: '/', titulo: 'Inicio' },
  { href: '/venta', titulo: 'Venta' },
  { href: '/caja', titulo: 'Caja' },
  { href: '/ventas', titulo: 'Historial de ventas' },
  { href: '/clientes', titulo: 'Clientes y fiado' },
  { href: '/productos', titulo: 'Productos' },
  { href: '/stock', titulo: 'Stock' },
] as const

/**
 * "Ya se ve el contenido" = no queda ningun esqueleto dentro de <main> y hay
 * texto de verdad. Sirve igual en todas las pantallas porque todas usan el
 * mismo componente de esqueleto (`animate-pulse`), incluida la de carga.
 */
const HAY_DATOS = `(() => {
  const main = document.querySelector('main')
  if (!main) return false
  if (main.querySelector('.animate-pulse, [aria-busy="true"]')) return false
  return (main.innerText ?? '').trim().length > 80
})()`

/**
 * Todo el compas de la medicion ocurre DENTRO de la pagina.
 *
 * La primera version tomaba los tiempos desde el proceso de pruebas, con
 * `Date.now()` alrededor de `locator.click()`, y daba 100 ms clavados en las
 * siete rutas: lo que medía era el ida y vuelta del protocolo y las
 * comprobaciones de Playwright antes de tocar el enlace, no la aplicacion.
 * Aca el reloj es `performance.now()` del navegador, el clic lo dispara la
 * propia pagina y cada marca se anota en el primer cuadro en que se cumple.
 *
 *   visual  primer cambio en pantalla: aparece el esqueleto, o ya cambio el
 *           titulo. Es el "hacer clic no produce nada" del reporte.
 *   commit  el enrutador acepto la navegacion (el titulo es el del destino).
 *   datos   no queda ningun esqueleto en el contenido.
 */
const MEDIR = `((titulo) => {
  const w = { t0: 0, visual: null, commit: null, datos: null, falto: false, remontado: false, cls: 0 }
  window.__vigia = w
  const aside = document.querySelector('aside')
  const main = document.querySelector('main')
  const textoInicial = (main?.innerText ?? '').trim()

  const obs = new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (!e.hadRecentInput) w.cls += e.value
    }
  })
  obs.observe({ type: 'layout-shift', buffered: false })

  const hayDatos = () => {
    const m = document.querySelector('main')
    if (!m) return false
    if (m.querySelector('.animate-pulse, [aria-busy="true"]')) return false
    return (m.innerText ?? '').trim().length > 80
  }
  const tituloActual = () => document.querySelector('header h1')?.textContent?.trim()

  const tick = () => {
    const ahora = performance.now() - w.t0
    const actual = document.querySelector('aside')
    if (!actual) w.falto = true
    else if (aside && actual !== aside) w.remontado = true

    if (w.visual === null) {
      const m = document.querySelector('main')
      const cambio =
        !!m?.querySelector('[aria-busy="true"]') ||
        tituloActual() === titulo ||
        (m?.innerText ?? '').trim() !== textoInicial
      if (cambio) w.visual = ahora
    }
    if (w.commit === null && tituloActual() === titulo) w.commit = ahora
    if (w.commit !== null && w.datos === null && hayDatos()) {
      w.datos = ahora
      obs.disconnect()
      return
    }
    requestAnimationFrame(tick)
  }

  const enlace = [...document.querySelectorAll('aside a')].find(
    (a) => (a.textContent ?? '').trim() === titulo,
  )
  if (!enlace) throw new Error('No esta el enlace de ' + titulo)
  w.t0 = performance.now()
  enlace.click()
  requestAnimationFrame(tick)
})`

interface Muestra {
  visual: number
  commit: number
  datos: number
  apis: number
  cls: number
  faltoArmazon: boolean
  armazonRemontado: boolean
}

interface Resumen {
  ruta: string
  desde: string
  visual: number
  commit: number
  datos: number
  apis: number
  cls: number
  faltoArmazon: boolean
  armazonRemontado: boolean
  muestras: Muestra[]
}

interface CargaDirecta {
  ruta: string
  ttfb: number
  domContentLoaded: number
  datos: number
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  const v =
    orden.length % 2 === 0
      ? ((orden[medio - 1] ?? 0) + (orden[medio] ?? 0)) / 2
      : (orden[medio] ?? 0)
  return Math.round(v * 10) / 10
}

async function iniciarSesion(page: Page): Promise<void> {
  // Por la API, no por el formulario: lo que se mide es la navegacion y el
  // formulario mete su propia redireccion en el medio. La peticion comparte
  // el frasco de cookies del contexto, asi que la sesion queda puesta.
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const r = await page.context().request.post(`${BASE}/api/auth/login`, {
    data: { username: USUARIO, password: CLAVE },
  })
  if (!r.ok()) throw new Error(`El ingreso respondio ${String(r.status())}`)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(HAY_DATOS, null, { timeout: 20_000 })
}

/** Deja la pantalla de origen cargada y quieta. */
async function ir(page: Page, href: string): Promise<void> {
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(HAY_DATOS, null, { timeout: 20_000 })
  // Los enlaces se precargan solos al entrar en pantalla; darles su tiempo es
  // medir lo que de verdad va a pasar en el mostrador, no una carrera.
  await page.waitForTimeout(600)
}

async function medirNavegacion(
  page: Page,
  desde: { href: string; titulo: string },
  hasta: { href: string; titulo: string },
): Promise<Muestra> {
  await ir(page, desde.href)

  let apis = 0
  const escucha = (r: { url: () => string }) => {
    if (r.url().includes('/api/')) apis += 1
  }
  page.on('request', escucha)

  // El clic lo dispara la pagina y el reloj es el suyo: asi no se cuela en la
  // medicion el ida y vuelta del protocolo de automatizacion.
  await page.evaluate(`${MEDIR}(${JSON.stringify(hasta.titulo)})`)
  await page.waitForFunction(
    () => (window as unknown as { __vigia: { datos: number | null } }).__vigia.datos !== null,
    null,
    { timeout: 20_000 },
  )

  const vigia = await page.evaluate(() => {
    const w = window as unknown as {
      __vigia: {
        visual: number
        commit: number
        datos: number
        falto: boolean
        remontado: boolean
        cls: number
      }
    }
    return { ...w.__vigia }
  })
  page.off('request', escucha)

  const redondear = (n: number) => Math.round(n * 10) / 10
  return {
    visual: redondear(vigia.visual),
    commit: redondear(vigia.commit),
    datos: redondear(vigia.datos),
    apis,
    cls: Math.round(vigia.cls * 10000) / 10000,
    faltoArmazon: vigia.falto,
    armazonRemontado: vigia.remontado,
  }
}

async function medirCargaDirecta(page: Page, ruta: { href: string }): Promise<CargaDirecta> {
  await page.goto(`${BASE}${ruta.href}`, { waitUntil: 'domcontentloaded' })
  const t0 = Date.now()
  await page.waitForFunction(HAY_DATOS, null, { timeout: 20_000 })
  const datos = Date.now() - t0

  const tiempos = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    return {
      ttfb: n ? n.responseStart - n.requestStart : 0,
      dcl: n ? n.domContentLoadedEventEnd - n.startTime : 0,
    }
  })

  return {
    ruta: ruta.href,
    ttfb: Math.round(tiempos.ttfb * 10) / 10,
    domContentLoaded: Math.round(tiempos.dcl * 10) / 10,
    datos,
  }
}

async function main(): Promise<void> {
  const navegador = await chromium.launch()
  const contexto = await navegador.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  })
  const page = await contexto.newPage()

  await iniciarSesion(page)

  const navegaciones: Resumen[] = []

  for (const hasta of RUTAS) {
    // Inicio se mide viniendo de la caja, que es el camino real: se vende y se
    // vuelve. El resto se mide desde Inicio.
    const desde = hasta.href === '/' ? { href: '/venta', titulo: 'Venta' } : RUTAS[0]

    const muestras: Muestra[] = []
    for (let i = 0; i < MUESTRAS; i++) {
      muestras.push(await medirNavegacion(page, desde, hasta))
    }

    const u: Resumen = {
      ruta: hasta.href,
      desde: desde.href,
      visual: mediana(muestras.map((m) => m.visual)),
      commit: mediana(muestras.map((m) => m.commit)),
      datos: mediana(muestras.map((m) => m.datos)),
      apis: mediana(muestras.map((m) => m.apis)),
      cls: mediana(muestras.map((m) => m.cls)),
      faltoArmazon: muestras.some((m) => m.faltoArmazon),
      armazonRemontado: muestras.some((m) => m.armazonRemontado),
      muestras,
    }

    navegaciones.push(u)
    console.log(
      `${u.desde} → ${u.ruta}`.padEnd(26) +
        `visual ${String(u.visual).padStart(6)} ms · commit ${String(u.commit).padStart(6)} ms · datos ${String(u.datos).padStart(6)} ms · ` +
        `${String(u.apis)} api · cls ${String(u.cls)} · ` +
        `armazon ${u.faltoArmazon ? 'DESAPARECIO' : 'siempre'}${u.armazonRemontado ? ' (remontado)' : ''}`,
    )
  }

  const directas: CargaDirecta[] = []
  for (const ruta of RUTAS) {
    const medidas: CargaDirecta[] = []
    for (let i = 0; i < MUESTRAS; i++) medidas.push(await medirCargaDirecta(page, ruta))
    const u: CargaDirecta = {
      ruta: ruta.href,
      ttfb: mediana(medidas.map((m) => m.ttfb)),
      domContentLoaded: mediana(medidas.map((m) => m.domContentLoaded)),
      datos: mediana(medidas.map((m) => m.datos)),
    }

    directas.push(u)
    console.log(
      `F5 ${u.ruta}`.padEnd(26) +
        `ttfb ${String(u.ttfb).padStart(6)} ms · dcl ${String(u.domContentLoaded).padStart(6)} ms · datos ${String(u.datos)} ms`,
    )
  }

  await navegador.close()

  const salida = {
    generado: new Date().toISOString(),
    base: BASE,
    usuario: USUARIO,
    muestrasPorRuta: MUESTRAS,
    navegaciones,
    cargasDirectas: directas,
  }
  const destino = path.join('docs', 'metrics', `phase2_1-navegacion-${DESTINO}.json`)
  await fs.writeFile(destino, JSON.stringify(salida, null, 2) + '\n', 'utf8')
  console.log(`\nGuardado en ${destino}`)
}

void main()
