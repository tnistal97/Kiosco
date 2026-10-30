/**
 * Convierte a un usuario en el administrador de su local. Solo le cambia el
 * rol: ver scripts/lib/promover-admin-local.ts.
 *
 * Uso:
 *
 *   npx tsx scripts/promover-admin-local.ts franco --sucursal 1 --autor 1 --ensayo
 *   npx tsx scripts/promover-admin-local.ts franco --sucursal 1 --autor 1 --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Una segunda pasada dice que ya estaba y no toca nada.
 */
import './entorno'
import { prisma } from '@/lib/prisma'
import { promoverAdminLocal } from './lib/promover-admin-local'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main(): Promise<void> {
  const usuario = process.argv[2]
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  if (
    !usuario ||
    usuario.startsWith('--') ||
    !Number.isInteger(sucursal) ||
    !Number.isInteger(autor) ||
    aplicar === ensayo
  ) {
    console.error(
      'Uso: npx tsx scripts/promover-admin-local.ts franco --sucursal 1 --autor 1 (--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const r = await promoverAdminLocal(prisma, { usuario, sucursal, autor, aplicar })
  if (r.rolesCreados.length > 0) console.log(`Roles creados: ${r.rolesCreados.join(', ')}`)
  console.log(
    r.yaEstaba
      ? `YA ESTABA: "${r.usuario}" ya es ${r.rolDespues}. No se hizo nada.`
      : `${aplicar ? 'APLICADO' : 'ENSAYO (no se escribió nada)'}: "${r.usuario}" pasa de ${r.rolAntes} a ${r.rolDespues}`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
