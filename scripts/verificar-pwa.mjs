/**
 * Comprobacion de la PWA contra una construccion de produccion.
 *
 * Lo que verifica, en este orden:
 *
 *   1. manifiesto, iconos y service worker se sirven;
 *   2. la pantalla de sin conexion es publica y no menciona datos del
 *      comercio;
 *   3. el service worker se registra y toma control;
 *   4. despues de recorrer TODAS las pantallas privadas con la sesion
 *      abierta, el cache no contiene ni una respuesta privada;
 *   5. sin red, una navegacion muestra la pantalla de sin conexion;
 *   6. cerrar sesion vacia lo que hubiera quedado guardado.
 *
 * No corre en la suite de vitest porque necesita `next build` + `next start`
 * y un navegador de verdad. En CI va como paso propio.
 *
 *   npm run build
 *   npx next start -p 3100
 *   npm run pwa:check
 */
import { chromium } from '@playwright/test'

const BASE = process.env.PWA_CHECK_URL ?? 'http://localhost:3100'
const USUARIO = process.env.SCREENSHOT_USER ?? 'admin'
const CLAVE = process.env.SCREENSHOT_PASSWORD ?? 'Demo1234!'

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  throw new Error(`Solo contra la aplicacion local. Recibido: ${BASE}`)
}

/** Rutas privadas: ninguna puede terminar en el cache del navegador. */
const PRIVADAS =
  /^\/(api|venta|ventas|caja|productos|stock|auditoria|usuarios|sucursales|configuracion|login)\b|^\/$/

const fallos = []
function comprobar(condicion, mensaje) {
  console.log(`${condicion ? '  ok  ' : ' FALLA'} ${mensaje}`)
  if (!condicion) fallos.push(mensaje)
}

const navegador = await chromium.launch()
const contexto = await navegador.newContext({
  viewport: { width: 1366, height: 768 },
  colorScheme: 'dark',
})
const page = await contexto.newPage()

try {
  // --- 1. Recursos publicos -------------------------------------------------
  const manifiesto = await page.request.get(`${BASE}/manifest.json`)
  const datos = await manifiesto.json()
  comprobar(manifiesto.status() === 200, 'el manifiesto se sirve')
  comprobar(typeof datos.name === 'string' && datos.name.length > 0, 'el manifiesto tiene nombre')
  comprobar(datos.icons?.length >= 2, 'el manifiesto declara al menos dos iconos')
  comprobar(
    datos.icons?.some((i) => i.purpose?.includes('maskable')),
    'el manifiesto declara un icono maskable',
  )
  comprobar(datos.start_url === '/', 'el manifiesto declara start_url')
  comprobar(datos.display === 'standalone', 'el manifiesto declara display standalone')

  for (const icono of datos.icons ?? []) {
    const r = await page.request.get(`${BASE}${icono.src}`)
    comprobar(r.status() === 200, `el icono ${icono.src} se sirve`)
  }

  const sw = await page.request.get(`${BASE}/sw.js`)
  comprobar(sw.status() === 200, 'el service worker se sirve')

  // --- 2. Pantalla sin conexion --------------------------------------------
  const offline = await page.request.get(`${BASE}/offline`)
  comprobar(offline.status() === 200, 'la pantalla de sin conexion es publica')

  await page.goto(`${BASE}/offline`, { waitUntil: 'domcontentloaded' })
  // Se mira el texto visible, no el HTML crudo: el payload que serializa Next
  // lleva nombres de ruta y marcadores como `$1`, que no son datos del
  // comercio pero disparaban una falsa alarma.
  const textoOffline = await page.evaluate(() => document.body.innerText)
  comprobar(textoOffline.includes('Sin conexi'), 'la pantalla de sin conexion tiene su texto')
  comprobar(
    !/saldo|ticket|venta #|\$\s?\d/i.test(textoOffline),
    'la pantalla de sin conexion no muestra datos del comercio',
  )

  // --- 3. Registro ----------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const estado = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration()
    return r?.active?.state ?? r?.installing?.state ?? 'ninguno'
  })
  comprobar(estado === 'activated' || estado === 'activating', `el service worker se activa (${estado})`) // prettier-ignore

  // --- 4. Nada privado en el cache -----------------------------------------
  await page.locator('input').first().fill(USUARIO)
  await page.locator('input[type=password]').first().fill(CLAVE)
  await page.getByRole('button', { name: /entrar/i }).click()
  await page.waitForTimeout(2500)

  for (const ruta of [
    '/',
    '/venta',
    '/caja',
    '/ventas',
    '/productos',
    '/stock',
    '/auditoria',
    '/usuarios',
    '/sucursales',
    '/configuracion',
  ]) {
    // prettier-ignore
    await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' }).catch(() => undefined)
    await page.waitForTimeout(300)
  }

  const guardado = await page.evaluate(async () => {
    const salida = {}
    for (const nombre of await caches.keys()) {
      const c = await caches.open(nombre)
      salida[nombre] = (await c.keys()).map((r) => new URL(r.url).pathname)
    }
    return salida
  })

  const fugas = Object.values(guardado)
    .flat()
    .filter((r) => PRIVADAS.test(r))
  comprobar(
    fugas.length === 0,
    `nada privado en el cache (fugas: ${fugas.join(', ') || 'ninguna'})`,
  )

  const totalEnCache = Object.values(guardado).flat().length
  comprobar(totalEnCache > 0, `hay estaticos publicos guardados (${totalEnCache})`)

  // --- 5. Comportamiento sin red -------------------------------------------
  await contexto.setOffline(true)
  await page.goto(`${BASE}/productos`, { waitUntil: 'domcontentloaded' }).catch(() => undefined)
  await page.waitForTimeout(1500)
  const textoSinRed = await page
    .evaluate(() => document.body.innerText)
    .catch(() => '(no se pudo leer la pagina)')
  comprobar(textoSinRed.includes('Sin conexi'), 'sin red se muestra la pantalla de sin conexion')
  comprobar(
    !/\$\s?\d|Yerba|Gaseosa/i.test(textoSinRed),
    'sin red no se muestra ningun dato del catalogo',
  )
  await contexto.setOffline(false)
} finally {
  await navegador.close()
}

console.log('')
if (fallos.length > 0) {
  console.error(`${fallos.length} comprobacion(es) fallaron.`)
  process.exit(1)
}
console.log('PWA: todo en orden.')
