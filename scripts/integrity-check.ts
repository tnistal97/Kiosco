/**
 * `npm run integrity:check`
 *
 * Comprueba que el sistema cierre. SOLO LEE: no hay un UPDATE en todo el
 * camino, no corrige nada y no toca la bitacora.
 *
 * Codigo de salida 0 si todo cierra, 1 si hay una sola diferencia. Sirve para
 * colgarlo de una tarea programada sin tener que leer la salida.
 *
 * Ver docs/INTEGRITY_CHECK.md.
 */

import { comprobarIntegridad } from '../src/modules/integrity/service'
import { prisma } from '../src/lib/prisma'

/** Ancho de la columna de etiquetas. El nombre mas largo entra con holgura. */
const ANCHO = 25

/** `Ventas ............... ` */
function etiqueta(nombre: string): string {
  const puntos = '.'.repeat(Math.max(1, ANCHO - nombre.length - 1))
  return `${nombre} ${puntos}`
}

function plural(n: number, singular: string, plural_: string): string {
  return `${String(n)} ${n === 1 ? singular : plural_}`
}

async function main(): Promise<void> {
  const informe = await comprobarIntegridad()

  console.log('')
  console.log('COMPROBACION DE INTEGRIDAD')
  console.log('')

  for (const c of informe.comprobaciones) {
    const estado = c.inconsistencias.length === 0 ? 'OK  ' : 'FALLA'
    const cuantas = String(c.revisadas).padStart(5)
    console.log(`  ${etiqueta(c.nombre)} ${estado} ${cuantas}`)
  }

  console.log('')

  if (informe.total === 0) {
    console.log(`  Sin inconsistencias.  (${String(informe.duracionMs)} ms)`)
    console.log('')
    return
  }

  console.log(`  ${plural(informe.total, 'INCONSISTENCIA', 'INCONSISTENCIAS')}`)
  console.log('')

  for (const c of informe.comprobaciones) {
    if (c.inconsistencias.length === 0) continue

    console.log(`  ── ${c.nombre} ──`)
    for (const i of c.inconsistencias) {
      console.log(`     ${i.entidad}`)
      console.log(`       regla:     ${i.regla}`)
      console.log(`       esperado:  ${i.esperado}`)
      console.log(`       encontrado:${i.encontrado.padStart(i.encontrado.length + 1)}`)
      if (i.diferencia !== null)
        console.log(`       diferencia:${i.diferencia.padStart(i.diferencia.length + 1)}`)
      if (i.detalle !== undefined) console.log(`       ${i.detalle}`)
      console.log('')
    }
  }

  console.log('  Esta herramienta NO corrige nada, y es deliberado: arreglar')
  console.log('  una diferencia sola tapa el sintoma y borra la evidencia.')
  console.log('')

  process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    console.error('')
    console.error('La comprobacion no pudo terminar:')
    console.error(err instanceof Error ? err.message : String(err))
    console.error('')
    process.exitCode = 2
  })
  .finally(() => {
    void prisma.$disconnect()
  })
