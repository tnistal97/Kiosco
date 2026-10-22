/**
 * Pasa a contarse por unidad todo producto activo cargado como bulto:
 * "Clight naranja 8g bulto x20" con 20 bultos queda "Clight naranja 8g" con
 * 400 unidades, y si ademas existia la fila de la unidad, se suman en ella y
 * la del bulto se da de baja. La regla esta en scripts/lib/bultos.ts y la
 * aplicacion en scripts/lib/normalizar-bultos.ts.
 *
 * Lo que no es inequivoco --dos unidades posibles, un producto parecido, un
 * bulto que ya tuvo ventas o ajustes-- no se toca y se lista para revisar.
 *
 * Los codigos del bulto no pasan a la unidad: quedan escritos en su
 * descripcion. El codigo de la unidad solo entra si esta en el archivo de
 * `--codigos`, donde alguien anoto como lo verifico:
 *
 *   { "codigosDeUnidad": [ { "bulto": "...", "codigoDelBulto": "37790036000320",
 *                            "codigoDeUnidad": "7790036000329", "verificacion": "..." } ] }
 *
 * Uso:
 *
 *   npx tsx scripts/normalizar-bultos.ts --sucursal 1 --autor 1 [--codigos archivo.json] --ensayo
 *   npx tsx scripts/normalizar-bultos.ts --sucursal 1 --autor 1 [--codigos archivo.json] --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Con `--salida plan.json` deja el plan y los totales. Se puede repetir: lo ya
 * normalizado no se vuelve a multiplicar.
 */
import './entorno'
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import { digitoVerificadorValido } from './lib/coincidencia-de-productos'
import { normalizarBultos, type Totales } from './lib/normalizar-bultos'
import type { Paso } from './lib/bultos'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

export interface CodigoDeUnidad {
  bulto: string
  codigoDelBulto: string
  codigoDeUnidad: string
  verificacion: string
}

function leerCodigos(archivo: string): Map<string, string> {
  const { codigosDeUnidad } = JSON.parse(readFileSync(archivo, 'utf8')) as {
    codigosDeUnidad?: CodigoDeUnidad[]
  }
  const mapa = new Map<string, string>()
  for (const c of codigosDeUnidad ?? []) {
    if (!digitoVerificadorValido(c.codigoDeUnidad)) {
      throw new Error(`${c.bulto}: el código de la unidad ${c.codigoDeUnidad} no es válido`)
    }
    if (c.verificacion.trim().length === 0) throw new Error(`${c.bulto}: falta cómo se verificó`)
    mapa.set(c.codigoDelBulto, c.codigoDeUnidad)
  }
  return mapa
}

function linea(paso: Paso): string {
  if (paso.accion === 'revisar')
    return `  REVISAR     #${String(paso.producto.id)} ${paso.producto.nombre}: ${paso.motivo}`
  const codigo = paso.codigoDeUnidad ? ` · código ${paso.codigoDeUnidad}` : ''
  const nota = paso.nota ? ` · ${paso.nota}` : ''
  if (paso.accion === 'renombrar') {
    return (
      `  RENOMBRAR   #${String(paso.bulto.id)} "${paso.bulto.nombre}" → "${paso.nombre}": ` +
      `${String(paso.bultos)} x ${String(paso.multiplicador)} = ${String(paso.unidades)} u.${codigo}${nota}`
    )
  }
  return (
    `  CONSOLIDAR  #${String(paso.bulto.id)} "${paso.bulto.nombre}" → #${String(paso.unidad.id)} "${paso.nombre}": ` +
    `${String(paso.stockPrevio)} + ${String(paso.bultos)} x ${String(paso.multiplicador)} = ${String(paso.stockFinal)} u.` +
    `${paso.foto ? ` · foto: ${paso.foto}` : ''}${codigo}${nota}`
  )
}

function totales(t: Totales): string {
  return (
    `${String(t.productos)} productos, ${String(t.unidades)} unidades, ${String(t.conBulto)} con "bulto", ` +
    `${String(t.conPrecio)} con precio, ${String(t.conFoto)} con foto, ${String(t.conCodigo)} con código`
  )
}

async function main(): Promise<void> {
  const sucursal = Number(argumento('--sucursal'))
  const autor = Number(argumento('--autor'))
  const codigos = argumento('--codigos')
  const salida = argumento('--salida')
  const aplicar = process.argv.includes('--aplicar')
  const ensayo = process.argv.includes('--ensayo')
  if (!Number.isInteger(sucursal) || !Number.isInteger(autor) || aplicar === ensayo) {
    console.error(
      'Uso: npx tsx scripts/normalizar-bultos.ts --sucursal 1 --autor 1 [--codigos archivo.json] ' +
        '[--salida plan.json] (--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const quien = await prisma.user.findFirst({
    where: { id: autor, isActive: true, role: { name: { in: ['admin', 'duenio'] } } },
    select: { id: true },
  })
  if (!quien) throw new Error(`El autor ${String(autor)} no es un administrador activo`)

  const resultado = await normalizarBultos(prisma, {
    sucursal,
    autor,
    codigosVerificados: codigos ? leerCodigos(codigos) : undefined,
    aplicar,
  })

  console.log(aplicar ? 'APLICADO' : 'ENSAYO (no se escribió nada)')
  for (const paso of resultado.pasos) console.log(linea(paso))
  if (resultado.pasos.length === 0) console.log('  No hay productos con "bulto": nada que hacer.')
  console.log(`Antes:   ${totales(resultado.antes)}`)
  console.log(`Después: ${totales(resultado.despues)}`)
  if (salida) writeFileSync(salida, `${JSON.stringify(resultado, null, 1)}\n`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
