/**
 * Baseline de /venta (UX V3), contra el build de produccion en :3099.
 *
 *   npx tsx scripts/medir-venta-v3.mts [antes|despues]
 *
 * Cada medicion se toma DENTRO de la pagina: el momento de la tecla o del
 * clic lo registra un escucha en fase de captura, y el momento del resultado
 * lo detecta un MutationObserver y se confirma en el siguiente cuadro
 * (requestAnimationFrame). Asi no entra la ida y vuelta de Playwright.
 * Cinco muestras por medicion; se informa la mediana.
 */
import { chromium, type Page } from '@playwright/test'
import fs from 'node:fs/promises'

const BASE = process.env.BASE_URL ?? 'http://localhost:3099'
const MUESTRAS = Number(process.env.MUESTRAS ?? 5)
const ETIQUETA = process.argv[2] ?? 'antes'
const SALIDA = `docs/metrics/venta-v3-${ETIQUETA}.json`
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) throw new Error('solo local')

const ARNES = `(() => {
  const w = window;
  w.__k = { primeraFila: null, primeraFilaPintada: null, ultimaTecla: 0, ultimoClick: 0 };
  const obs = new MutationObserver(() => {
    if (w.__k.primeraFila === null && document.querySelector('[data-fila]')) {
      w.__k.primeraFila = performance.now();
      requestAnimationFrame(() => { w.__k.primeraFilaPintada = performance.now(); });
    }
  });
  obs.observe(document, { childList: true, subtree: true });
  document.addEventListener('keydown', () => { w.__k.ultimaTecla = performance.now(); }, true);
  document.addEventListener('pointerdown', () => { w.__k.ultimoClick = performance.now(); }, true);
  document.addEventListener('click', () => { if (!w.__k.ultimoClick) w.__k.ultimoClick = performance.now(); }, true);
  w.__esperar = (fuente, timeout) => new Promise((res, rej) => {
    const fn = new Function('return (' + fuente + ')')();
    const inicio = performance.now();
    let listo = false;
    let o = null;
    const check = () => {
      if (listo) return;
      let ok = false; try { ok = !!fn(); } catch (e) { ok = false; }
      if (ok) { listo = true; if (o) o.disconnect(); requestAnimationFrame(() => res(performance.now())); return; }
      if (performance.now() - inicio > (timeout || 20000)) { listo = true; if (o) o.disconnect(); rej(new Error('timeout: ' + fuente.slice(0, 100))); }
    };
    o = new MutationObserver(check);
    o.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    const tick = () => { if (!listo) { check(); requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
    check();
  });
})();`

const HAY_FILAS = `() => document.querySelectorAll('[data-fila]').length > 0`
const LINEAS = (n: number) =>
  `() => document.querySelectorAll('[data-linea]').length >= ${String(n)}`
const SIN_LINEAS = `() => document.querySelectorAll('[data-linea]').length === 0`
const FOCO_EN_CAMPO = `() => !!document.activeElement && document.activeElement.hasAttribute('data-barcode-input')`
/**
 * En la V3 el foco NO se mueve a la lista: ↓ marca la fila elegida y el
 * cursor se queda en el campo, que es lo que mantiene vivo al lector. Se
 * espera la marca, no el foco.
 */
const HAY_ELEGIDA = `() => !!document.querySelector('[data-fila][data-elegida]')`
const REVISANDO = `() => !!document.querySelector('[data-revisando]')`
const DIALOGO = (titulo: string) =>
  `() => { const h = document.querySelector('[role="dialog"] h2'); return !!h && h.textContent.trim().startsWith(${JSON.stringify(titulo)}); }`
const DIALOGO_ESTABLE = (titulo: string) =>
  `() => { const d = document.querySelector('[role="dialog"]'); const h = d && d.querySelector('h2'); return !!h && h.textContent.trim().startsWith(${JSON.stringify(titulo)}) && !d.querySelector('[data-closed],[data-enter],[data-leave],[data-transition]') && !d.hasAttribute('data-closed'); }`
const SIN_DIALOGO = `() => !document.querySelector('[role="dialog"]')`
const FILAS_DISTINTAS = (firma: string) =>
  `() => { const f = [...document.querySelectorAll('[data-fila]')].map(b => b.getAttribute('aria-label')).join('|'); return f !== ${JSON.stringify(firma)} && f !== ''; }`
const Y = (...conds: string[]) => `() => ${conds.map((c) => `(${c})()`).join(' && ')}`

type Ventana = Window & {
  __esperar: (fuente: string) => Promise<number>
  __k: {
    ultimaTecla: number
    ultimoClick: number
    primeraFila: number | null
    primeraFilaPintada: number | null
  }
}

async function firmaDeFilas(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-fila]')]
      .map((b) => b.getAttribute('aria-label'))
      .join('|'),
  )
}
async function esperar(page: Page, cond: string): Promise<number> {
  return page.evaluate((c) => (window as unknown as Ventana).__esperar(c), cond)
}
async function ultimaTecla(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Ventana).__k.ultimaTecla)
}
async function ultimoClick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as Ventana).__k.ultimoClick)
}
async function armarClick(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as Ventana).__k.ultimoClick = 0
  })
}
async function duracionDeApi(page: Page, contiene: string, termina = false): Promise<number> {
  return page.evaluate(
    ([c, t]) => {
      const r = performance
        .getEntriesByType('resource')
        .filter((e) => (t ? e.name.endsWith(c) : e.name.includes(c)))
      const u = r[r.length - 1]
      return u ? u.duration : -1
    },
    [contiene, termina] as const,
  )
}

/** Presiona una tecla y devuelve ms desde el keydown hasta que `cond` se cumple (y se pinta). */
async function medirTecla(page: Page, tecla: string, cond: string): Promise<number> {
  const p = esperar(page, cond)
  await page.keyboard.press(tecla)
  const t1 = await p
  const t0 = await ultimaTecla(page)
  return t1 - t0
}
async function medirClick(page: Page, selector: string, cond: string): Promise<number> {
  await armarClick(page)
  const p = esperar(page, cond)
  await page.click(selector)
  const t1 = await p
  const t0 = await ultimoClick(page)
  return t1 - t0
}

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}
const r1 = (n: number) => Math.round(n * 10) / 10

interface Muestra {
  ttfb: number
  f5_primeraFila: number
  categoria: number
  busqueda: number
  busqueda_api: number
  scan_a_ticket: number
  scan_api: number
  flecha_abajo: number
  enter_agrega: number
  revisar: number
  abrir_cobro: number
  abrir_cobro_estable: number
  cobro_volver: number
  cobrar_registrada: number
  cobrar_api: number
  registrada_lista: number
}

interface ProductoApi {
  id: number
  name: string
  barcode: string | null
  price: string
  saleUnit: string
  sellableStock: string
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    colorScheme: 'dark',
    locale: 'es-AR',
  })
  await context.addInitScript(ARNES)
  const page = await context.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { username: 'cajero', password: 'Demo1234!' },
  })
  if (!login.ok()) throw new Error(`login ${String(login.status())}`)

  // Producto de prueba: por unidad, con stock de sobra, el mas barato.
  const catalogo = (await (
    await context.request.get(
      `${BASE}/api/products?pageSize=100&estado=activos&sortBy=price&sortDir=asc`,
    )
  ).json()) as { data: ProductoApi[] }
  const producto = catalogo.data.find(
    (p) => p.saleUnit === 'UNIT' && p.barcode && Number(p.sellableStock) >= 20,
  )
  if (!producto) throw new Error('no hay producto de prueba')
  const categorias = (await (await context.request.get(`${BASE}/api/categories`)).json()) as Array<{
    id: number
    name: string
  }>
  const categoria = categorias.find((c) => c.name === 'Bebidas') ?? categorias[0]
  if (!categoria) throw new Error('no hay categorias')
  console.log(
    `producto: ${producto.name} (${producto.barcode ?? ''}) $${producto.price} · categoria: ${categoria.name}`,
  )

  const muestras: Muestra[] = []
  for (let i = 0; i < MUESTRAS; i++) {
    await page.goto(`${BASE}/venta`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('kiosco:ticket')
    })
    // F5 limpio, con el arnes puesto desde el arranque del documento.
    await page.goto(`${BASE}/venta`, { waitUntil: 'domcontentloaded' })
    await esperar(page, HAY_FILAS)
    await esperar(page, FOCO_EN_CAMPO)
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      const k = (window as unknown as Ventana).__k
      return { ttfb: n.responseStart, primeraFila: k.primeraFilaPintada ?? k.primeraFila ?? -1 }
    })

    // Categoria: clic en el chip, hasta que las filas cambien.
    let firma = await firmaDeFilas(page)
    const categoriaMs = await medirClick(
      page,
      `[data-seccion="${String(categoria.id)}"]`,
      FILAS_DISTINTAS(firma),
    )
    firma = await firmaDeFilas(page)
    await medirClick(page, `[data-seccion="todos"]`, FILAS_DISTINTAS(firma))

    // Busqueda: se escribe "le"; se mide desde la ULTIMA tecla (incluye el debounce de 250 ms).
    await page.focus('[data-barcode-input]')
    firma = await firmaDeFilas(page)
    const pBusqueda = esperar(page, FILAS_DISTINTAS(firma))
    await page.keyboard.type('le')
    const t1b = await pBusqueda
    const t0b = await ultimaTecla(page)
    const busquedaApi = await duracionDeApi(page, 'q=le')
    firma = await firmaDeFilas(page)
    await medirTecla(page, 'Escape', FILAS_DISTINTAS(firma))

    // Scan: digitos + Enter en el campo, hasta que aparece la linea en el ticket.
    await page.focus('[data-barcode-input]')
    await page.keyboard.type(producto.barcode ?? '')
    const scanMs = await medirTecla(page, 'Enter', LINEAS(1))
    const scanApi = await duracionDeApi(page, '/api/products/barcode/')
    // Vaciar el ticket para medir la flecha con el ticket vacio.
    await page.getByRole('button', { name: 'Vaciar' }).click()
    await esperar(page, SIN_LINEAS)
    await page.focus('[data-barcode-input]')
    await page.keyboard.press('Escape')

    // ↓ elige una fila de la lista; Enter la agrega y limpia.
    const flechaMs = await medirTecla(page, 'ArrowDown', HAY_ELEGIDA)
    const enterMs = await medirTecla(page, 'Enter', LINEAS(1))

    // Enter con el campo vacio pasa a REVISAR --no cobra--; el siguiente
    // abre el cobro. Se miden los dos: el camino entero es lo que cuenta.
    const revisarMs = await medirTecla(page, 'Enter', REVISANDO)
    const abrirMs = await medirTecla(page, 'Enter', DIALOGO('Cobrar'))
    const abrirEstableMs =
      (await esperar(page, DIALOGO_ESTABLE('Cobrar'))) - (await ultimaTecla(page))
    // Escape: vuelve, y el foco tiene que estar otra vez en el campo.
    const volverMs = await medirTecla(page, 'Escape', Y(SIN_DIALOGO, FOCO_EN_CAMPO))
    // Escape vuelve UN paso: la pantalla queda revisando. Otro Escape deja la
    // medicion siguiente arrancando desde el mismo lugar que la anterior.
    await page.keyboard.press('Escape')

    // Cobrar de verdad: revisar, abrir, esperar la guarda de 300 ms, J
    // (que ademas DECLARA el pago, sin lo cual Enter no vende) y Enter.
    await page.keyboard.press('Enter')
    await medirTecla(page, 'Enter', DIALOGO_ESTABLE('Cobrar'))
    await page.waitForTimeout(400)
    await page.keyboard.press('j')
    const registradaMs = await medirTecla(page, 'Enter', DIALOGO('Venta registrada'))
    const cobrarApi = await duracionDeApi(page, '/api/sales', true)
    // Nueva venta: Enter sobre el boton enfocado; listo = sin dialogo, ticket vacio, foco en el campo, filas presentes.
    const listaMs = await medirTecla(
      page,
      'Enter',
      Y(SIN_DIALOGO, SIN_LINEAS, FOCO_EN_CAMPO, HAY_FILAS),
    )

    const m: Muestra = {
      ttfb: r1(nav.ttfb),
      f5_primeraFila: r1(nav.primeraFila),
      categoria: r1(categoriaMs),
      busqueda: r1(t1b - t0b),
      busqueda_api: r1(busquedaApi),
      scan_a_ticket: r1(scanMs),
      scan_api: r1(scanApi),
      flecha_abajo: r1(flechaMs),
      enter_agrega: r1(enterMs),
      revisar: r1(revisarMs),
      abrir_cobro: r1(abrirMs),
      abrir_cobro_estable: r1(abrirEstableMs),
      cobro_volver: r1(volverMs),
      cobrar_registrada: r1(registradaMs),
      cobrar_api: r1(cobrarApi),
      registrada_lista: r1(listaMs),
    }
    muestras.push(m)
    console.log(`muestra ${String(i + 1)}: ${JSON.stringify(m)}`)
  }

  const primera = muestras[0]
  if (!primera) throw new Error('sin muestras')
  const claves = Object.keys(primera) as Array<keyof Muestra>
  const medianas = Object.fromEntries(
    claves.map((k) => [k, r1(mediana(muestras.map((m) => m[k])))]),
  )
  await fs.mkdir(SALIDA.slice(0, SALIDA.lastIndexOf('/')), { recursive: true })
  await fs.writeFile(
    SALIDA,
    JSON.stringify(
      {
        etiqueta: ETIQUETA,
        base: BASE,
        fecha: new Date().toISOString(),
        viewport: '1366x768',
        producto: { nombre: producto.name, precio: producto.price },
        categoria: categoria.name,
        muestras,
        medianas,
        nota: 'ms; medido dentro de la pagina (keydown/click en captura -> MutationObserver + rAF). busqueda incluye el debounce de texto del hook. Desde la V3: "flecha_abajo" espera la fila marcada (el foco no se mueve), y "revisar" es el paso previo al cobro que agrego Enter seguro.',
      },
      null,
      2,
    ),
  )
  console.log('\nMEDIANAS (ms):')
  for (const k of claves) console.log(`  ${k.padEnd(22)} ${String(medianas[k]).padStart(8)}`)
  console.log(`\n-> ${SALIDA}`)
  await browser.close()
}

await main()
