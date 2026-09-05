/**
 * El servidor de desarrollo no puede pisar la construccion de produccion.
 *
 * Esto no es una preferencia de estilo: es el hallazgo que costo dos tardes en
 * las fases 1 y 2. `next dev --turbopack` y `next build` escribian los dos en
 * `.next`. Con un servidor de desarrollo olvidado en el 3000, la construccion
 * quedaba mezclada y `next start` levantaba roto --"Cannot find module
 * '../chunks/ssr/[turbopack]_runtime.js'"--, con lo cual TODAS las pruebas de
 * extremo a extremo fallaban despues de un login que respondia 200. El
 * sintoma no se parecia en nada a la causa.
 *
 * La correccion vive en la configuracion, no en la disciplina de acordarse de
 * apagar cosas. Estas pruebas comprueban que siga ahi: son de texto porque
 * `next.config.ts` no se puede importar sin arrastrar el complemento del
 * service worker, y porque lo que hay que proteger es justamente la linea.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = process.cwd()
const leer = (archivo: string) => readFileSync(join(raiz, archivo), 'utf8')

describe('Desarrollo y construccion escriben en carpetas distintas', () => {
  const config = leer('next.config.ts')

  it('next.config.ts manda el desarrollo a .next-dev', () => {
    expect(config).toMatch(/distDir:\s*process\.env\.NODE_ENV === 'development'/)
    expect(config).toContain("'.next-dev'")
  })

  it('la construccion sigue en .next: el despliegue y el artefacto lo esperan ahi', () => {
    expect(config).toMatch(/distDir:.*:\s*'\.next'/)
    expect(leer('scripts/release-artifact.mjs')).toContain("'.next'")
  })

  it('.next-dev no se versiona', () => {
    expect(leer('.gitignore')).toMatch(/^\/\.next-dev\/$/m)
  })

  it('las herramientas no revisan lo que genera el servidor de desarrollo', () => {
    expect(leer('eslint.config.mjs')).toContain("'.next-dev/**'")
    expect(leer('.prettierignore')).toMatch(/^\.next-dev\/$/m)
  })
})

describe('Las pruebas de extremo a extremo no reutilizan un servidor ajeno', () => {
  const config = leer('playwright.config.ts')

  it('no se reutiliza lo que ya estuviera escuchando en el puerto', () => {
    // Un `next start` huerfano de una corrida anterior sirve una construccion
    // vieja Y conserva en memoria el bloqueo por intentos de login fallidos.
    // Reutilizarlo es como una corrida entera falla en la primera pantalla.
    expect(config).toContain("reuseExistingServer: process.env.E2E_REUSE === '1'")
  })

  it('el servidor de las pruebas se levanta con la construccion, no con el modo desarrollo', () => {
    expect(config).toMatch(/command:\s*`npx next start -p \$\{PUERTO\}`/)
  })
})
