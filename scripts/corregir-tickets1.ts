/**
 * Corrige lo que las fotos de Tickets 1 demostraron mal cargado: el stock que
 * la normalizacion de bultos multiplico otra vez, los codigos de venta mal
 * copiados y los nombres que el ticket desmiente. La regla y las comprobaciones
 * estan en scripts/lib/corregir-tickets1.ts.
 *
 * Uso:
 *
 *   npx tsx scripts/corregir-tickets1.ts docs/manual-house/correcciones-tickets1.json --sucursal 1 --autor 1 --ensayo
 *   npx tsx scripts/corregir-tickets1.ts docs/manual-house/correcciones-tickets1.json --sucursal 1 --autor 1 --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Con `--salida informe.json` deja el resultado completo. Se aplica una sola
 * vez por marca: la segunda dice que ya estaba y no toca nada.
 */
import './entorno'
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { corregirTickets1, type Correcciones } from './lib/corregir-tickets1'
import type { Totales } from './lib/normalizar-bultos'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function totales(t: Totales): string {
  return (
    `${String(t.productos)} productos, ${String(t.unidades)} unidades, ${String(t.conPrecio)} con precio, ` +
    `${String(t.conFoto)} con foto, ${String(t.conCodigo)} con código, ${String(t.conBulto)} con "bulto"`
  )
}

async function main(): Promise<void> {
  const archivo = process.argv[2]
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const salida = argumento('--salida')
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  if (
    !archivo?.endsWith('.json') ||
    !Number.isInteger(sucursal) ||
    !Number.isInteger(autor) ||
    aplicar === ensayo
  ) {
    console.error(
      'Uso: npx tsx scripts/corregir-tickets1.ts correcciones.json --sucursal 1 --autor 1 [--salida informe.json] ' +
        '(--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const correcciones = JSON.parse(readFileSync(archivo, 'utf8')) as Correcciones
  if (!correcciones.marca || !Array.isArray(correcciones.stock)) {
    throw new Error(`${archivo}: falta la marca o la lista de stock`)
  }

  const r = await corregirTickets1(prisma, { sucursal, autor, correcciones, aplicar })
  if (r.yaAplicada) {
    console.log(
      `YA APLICADA: la corrección ${correcciones.marca} está en la bitácora (#${String(r.yaAplicada.id)}, ` +
        `${r.yaAplicada.timestamp.toISOString()}). No se hizo nada.`,
    )
  } else {
    console.log(aplicar ? 'APLICADA' : 'ENSAYO (no se escribió nada)')
    for (const s of r.stock) {
      const { cuenta: c } = s
      console.log(
        `  STOCK    #${String(s.id)} ${s.nombre}: ${String(c.actual)} -> ${String(s.stockDespues)} ` +
          `(antes de la normalización ${String(c.base)}, +${String(c.agregado)}; posterior ${String(c.posterior)})`,
      )
    }
    for (const k of r.codigos)
      console.log(`  CÓDIGO   #${String(k.id)} ${k.nombre}: ${k.antes} -> ${k.despues}`)
    for (const d of r.descripciones)
      console.log(`  DESCRIP. #${String(d.id)} ${d.nombre}: ${d.despues}`)
    for (const n of r.nombres) console.log(`  NOMBRE   #${String(n.id)} ${n.antes} -> ${n.despues}`)
  }
  console.log(`Antes:   ${totales(r.antes)}`)
  console.log(`Después: ${totales(r.despues)}`)
  if (salida) writeFileSync(salida, `${JSON.stringify(r, null, 1)}\n`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
