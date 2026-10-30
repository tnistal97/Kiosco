/**
 * Saca las ventas y cajas de prueba de un local y le deja la caja en $0. Copia
 * antes todo a un esquema de archivo: ver scripts/lib/limpiar-pruebas.ts.
 *
 * El manifiesto (docs/manual-house/limpieza-pruebas.json) lista las ventas y
 * los turnos uno por uno. Si la base tiene otra cosa, no se toca nada.
 *
 * Uso:
 *
 *   npx tsx scripts/limpiar-pruebas.ts limpieza.json --sucursal 1 --autor 1 --responsable franco --ensayo
 *   npx tsx scripts/limpiar-pruebas.ts limpieza.json --sucursal 1 --autor 1 --responsable franco --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Se aplica una sola vez por marca.
 */
import './entorno'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { ESQUEMA, limpiarPruebas } from './lib/limpiar-pruebas'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<void> {
  const archivo = process.argv[2]
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const responsable = argumento('--responsable')
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  if (
    !archivo?.endsWith('.json') ||
    !Number.isInteger(sucursal) ||
    !Number.isInteger(autor) ||
    !responsable ||
    aplicar === ensayo
  ) {
    console.error(
      'Uso: npx tsx scripts/limpiar-pruebas.ts limpieza.json --sucursal 1 --autor 1 --responsable franco (--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const m = JSON.parse(readFileSync(archivo, 'utf8')) as {
    marca?: string
    ventas?: number[]
    turnos?: number[]
  }
  if (!m.marca || !Array.isArray(m.ventas) || !Array.isArray(m.turnos)) {
    throw new Error(`${archivo}: falta la marca, las ventas o los turnos`)
  }

  const r = await limpiarPruebas(prisma, {
    sucursal,
    autor,
    responsable,
    marca: m.marca,
    ventas: m.ventas,
    turnos: m.turnos,
    aplicar,
  })

  if (r.yaAplicada) {
    console.log(
      `YA APLICADA: ${m.marca} está en la bitácora (#${String(r.yaAplicada.id)}, ${r.yaAplicada.timestamp.toISOString()}). No se hizo nada.`,
    )
    return
  }
  console.log(
    aplicar ? `APLICADA, con copia en el esquema ${ESQUEMA}` : 'ENSAYO (no se escribió nada)',
  )
  console.log(
    `  ${String(r.ventas)} ventas, ${String(r.lineas)} líneas, ${String(r.pagos)} pagos, ` +
      `${String(r.movimientosDeCaja)} movimientos de caja, ${String(r.arqueos)} arqueos, ${String(r.turnos)} turnos`,
  )
  console.log(`  Efectivo acumulado de la sucursal: ${r.efectivoAcumuladoAntes} -> 0`)
  console.log(`  Caja nueva abierta en $0: turno #${String(r.turnoNuevo)}`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
