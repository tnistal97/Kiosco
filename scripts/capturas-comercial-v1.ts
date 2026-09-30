/**
 * Capturas de la V1 comercial a 375 / 390 / 768 / 1366, con comprobacion de
 * que la pagina no se desplaza en horizontal. Corre contra el servidor de
 * las e2e (puerto 3101, base kiosco_dev con el seed de demo).
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3101'
const SALIDA = process.env.SALIDA ?? 'docs/screenshots/commercial-v1'
const CLAVE = 'Demo1234!'
const ANCHOS = [375, 390, 768, 1366] as const

const PANTALLAS: Array<{ clave: string; ruta: string; usuario: string; preparar?: string }> = [
  { clave: 'inicio', ruta: '/', usuario: 'duenio' },
  { clave: 'consultar-precio', ruta: '/consultar-precio', usuario: 'cajero', preparar: 'precio' },
  { clave: 'cierre-del-dia', ruta: '/caja/cierre', usuario: 'duenio' },
  { clave: 'cobro-mercado-pago', ruta: '/venta', usuario: 'cajero', preparar: 'cobro' },
  { clave: 'menu', ruta: '/productos', usuario: 'duenio', preparar: 'menu' },
  { clave: 'configuracion-impresion', ruta: '/configuracion', usuario: 'duenio' },
]

async function main() {
  await fs.mkdir(SALIDA, { recursive: true })
  const navegador = await chromium.launch()
  const informe: string[] = []

  for (const ancho of ANCHOS) {
    const alto = ancho < 700 ? 812 : ancho < 1000 ? 1024 : 768
    const contexto = await navegador.newContext({
      viewport: { width: ancho, height: alto },
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      colorScheme: 'dark',
      hasTouch: ancho < 700,
    })
    let sesion = ''
    for (const p of PANTALLAS) {
      const page = await contexto.newPage()
      try {
        if (sesion !== p.usuario) {
          await page.goto(`${BASE}/login`)
          await page.getByRole('textbox', { name: 'Usuario' }).fill(p.usuario)
          await page.locator('input[name="password"]').fill(CLAVE)
          await page.getByRole('button', { name: 'Entrar' }).click()
          await page.getByRole('button', { name: /cuenta de/i }).waitFor()
          sesion = p.usuario
        }
        await page.goto(`${BASE}${p.ruta}`)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.waitForTimeout(800)

        if (p.preparar === 'precio') {
          const campo = page.getByRole('textbox', { name: 'Escaneá o escribí un producto' })
          await campo.fill('7790002000014')
          await campo.press('Enter')
          await page.waitForTimeout(900)
        }
        if (p.preparar === 'cobro') {
          const campo = page.locator('[data-barcode-input]')
          for (const c of ['7790001000011', '7790003000017']) {
            await campo.fill(c)
            await campo.press('Enter')
            await page.waitForTimeout(700)
          }
          await page
            .getByRole('button', { name: /^Cobrar/ })
            .first()
            .click()
          await page.getByRole('dialog').getByRole('radio', { name: 'Mercado Pago' }).click()
          await page.waitForTimeout(500)
        }
        if (p.preparar === 'menu') {
          if (ancho < 1000) {
            const boton = page.getByRole('button', { name: /men[uú]/i }).first()
            if (await boton.isVisible().catch(() => false)) {
              await boton.click()
              await page.waitForTimeout(400)
            }
          }
          const mas = page.getByRole('button', { name: 'Más' }).first()
          if (await mas.isVisible().catch(() => false)) await mas.click()
          await page.waitForTimeout(300)
        }

        const movio = await page.evaluate(() => {
          const antes = window.scrollX
          window.scrollTo(500, window.scrollY)
          const m = window.scrollX !== antes
          window.scrollTo(antes, window.scrollY)
          return m
        })
        const archivo = path.join(SALIDA, `${p.clave}-${String(ancho)}.png`)
        await page.screenshot({ path: archivo, fullPage: false })
        informe.push(`${p.clave} @ ${String(ancho)}: ${movio ? 'SCROLL HORIZONTAL' : 'ok'}`)
      } catch (err) {
        informe.push(`${p.clave} @ ${String(ancho)}: ERROR ${String(err).slice(0, 120)}`)
      }
      await page.close()
    }
    await contexto.close()
  }
  await navegador.close()
  console.log(informe.join('\n'))
  if (informe.some((l) => l.includes('SCROLL'))) process.exitCode = 1
}

void main()
