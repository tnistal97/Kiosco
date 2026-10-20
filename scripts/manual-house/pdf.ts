/**
 * PDF del manual de House y de su guia rapida, desde el HTML editable.
 *
 *   npx tsx scripts/manual-house/pdf.ts
 *
 * Cada <section class="pagina"> del HTML es una hoja A4. Antes de escribir
 * nada se comprueba que ninguna hoja desborde (texto cortado), que todas las
 * imagenes hayan cargado y que cada numero naranja tenga su posicion. Si algo
 * falla, no hay PDF: se dice que hoja corregir.
 */

import { chromium } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CARPETA = path.join(process.cwd(), 'docs/manual-house')

const DOCUMENTOS = [
  { html: 'Manual_Kiosco_House.html', pdf: 'Manual_Kiosco_House.pdf' },
  { html: 'Guia_Rapida_Kiosco_House.html', pdf: 'Guia_Rapida_Kiosco_House.pdf', paginas: 1 },
] as const

interface Informe {
  paginas: number
  desbordes: Array<{ pagina: number; sobra: number }>
  rotas: string[]
  marcasFaltantes: string[]
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ args: ['--lang=es-AR'] })
  let fallas = 0
  try {
    for (const doc of DOCUMENTOS) {
      const page = await browser.newPage()
      await page.emulateMedia({ media: 'print' })
      await page.goto(pathToFileURL(path.join(CARPETA, doc.html)).href)
      await page.waitForSelector('body[data-listo="si"]', { timeout: 30_000 })
      const informe = await page.evaluate(() => (window as unknown as { INFORME: Informe }).INFORME)

      const problemas: string[] = []
      for (const d of informe.desbordes) {
        problemas.push(`la hoja ${String(d.pagina)} no entra (sobran ${String(d.sobra)} px)`)
      }
      for (const r of informe.rotas) problemas.push(`no cargo la imagen ${r}`)
      for (const m of informe.marcasFaltantes) problemas.push(`falta la posicion de la marca ${m}`)
      if ('paginas' in doc && informe.paginas !== doc.paginas) {
        problemas.push(
          `tiene ${String(informe.paginas)} hojas y tiene que tener ${String(doc.paginas)}`,
        )
      }

      if (problemas.length > 0) {
        fallas++
        console.error(`${doc.html}:\n  - ${problemas.join('\n  - ')}`)
      } else {
        await page.pdf({
          path: path.join(CARPETA, doc.pdf),
          preferCSSPageSize: true,
          printBackground: true,
        })
        console.log(`${doc.pdf}: ${String(informe.paginas)} hojas`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
  if (fallas > 0) process.exit(1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
