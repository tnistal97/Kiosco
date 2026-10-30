/**
 * Carga precios de venta desde un manifiesto ya revisado. La regla esta en
 * scripts/lib/cargar-precios.ts.
 *
 * El manifiesto lleva precios: queda fuera del repositorio, que es publico.
 *
 *   { "marca": "precios-san-patricio-2026-10", "origen": "lista.xlsx",
 *     "precios": [ { "nombre": "Nueces", "precio": "2950.00", "fila": 267 } ] }
 *
 * Uso:
 *
 *   npx tsx scripts/cargar-precios.ts precios.json --sucursal 1 --autor 1 --ensayo
 *   npx tsx scripts/cargar-precios.ts precios.json --sucursal 1 --autor 1 --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Se aplica una sola vez por marca.
 */
import './entorno'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { cargarPrecios, type PrecioDeLista } from './lib/cargar-precios'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<void> {
  const archivo = process.argv[2]
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  if (
    !archivo?.endsWith('.json') ||
    !Number.isInteger(sucursal) ||
    !Number.isInteger(autor) ||
    aplicar === ensayo
  ) {
    console.error(
      'Uso: npx tsx scripts/cargar-precios.ts precios.json --sucursal 1 --autor 1 (--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const m = JSON.parse(readFileSync(archivo, 'utf8')) as {
    marca?: string
    origen?: string
    precios?: PrecioDeLista[]
  }
  if (!m.marca || !m.origen || !Array.isArray(m.precios) || m.precios.length === 0) {
    throw new Error(`${archivo}: falta la marca, el origen o la lista de precios`)
  }

  const r = await cargarPrecios(prisma, {
    sucursal,
    autor,
    marca: m.marca,
    origen: m.origen,
    precios: m.precios,
    aplicar,
  })

  if (r.yaAplicada) {
    console.log(
      `YA APLICADA: ${m.marca} está en la bitácora (#${String(r.yaAplicada.id)}, ${r.yaAplicada.timestamp.toISOString()}). No se hizo nada.`,
    )
    return
  }
  console.log(aplicar ? 'APLICADA' : 'ENSAYO (no se escribió nada)')
  console.log(`  ${String(r.cargados)} precios cargados`)
  if (r.conPrecio.length > 0) {
    console.log(`  Ya tenían precio, se respetan: ${r.conPrecio.join(', ')}`)
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
