/**
 * Carga una compra al stock desde un manifiesto revisado: cada linea suma a un
 * producto que ya existe o crea uno nuevo, con precio 0. La regla esta en
 * scripts/lib/compra.ts y la aplicacion en scripts/lib/incorporar-compra.ts.
 *
 * El manifiesto (por ejemplo docs/manual-house/tickets2/compra-tickets2.json):
 *
 *   { "marca": "compra-tickets2-house-2026-10",
 *     "productos": [ { "nombre": "Nueces", "cantidad": 5, "codigo": null,
 *                      "accion": "crear", "origen": "hoja 2 fila 3" } ] }
 *
 * Lo que la revision dejo afuera (ilegible, ambiguo) no va en `productos`: se
 * anota aparte en el mismo archivo, y este guion no lo mira.
 *
 * Uso:
 *
 *   npx tsx scripts/incorporar-compra.ts compra.json --sucursal 1 --autor 1 --ensayo
 *   npx tsx scripts/incorporar-compra.ts compra.json --sucursal 1 --autor 1 --aplicar
 *
 * `--ensayo` hace todo en una transaccion, muestra el resultado y la deshace.
 * Con `--salida informe.json` deja el resultado completo. Se aplica una sola
 * vez por marca: la segunda dice que ya estaba y no toca nada.
 */
import './entorno'
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '@/lib/prisma'
import type { LineaDeCompra, PasoDeCompra } from './lib/compra'
import { incorporarCompra } from './lib/incorporar-compra'
import type { Totales } from './lib/normalizar-bultos'

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

function linea(paso: PasoDeCompra): string {
  const { linea: l } = paso
  if (paso.accion === 'revisar') return `  REVISAR  ${l.nombre} (${l.origen}): ${paso.motivo}`
  if (paso.accion === 'crear') {
    return `  CREAR    ${l.nombre}: ${String(l.cantidad)} u.${l.codigo ? ` · código ${l.codigo}` : ''} (${l.origen})`
  }
  return `  SUMAR    #${String(paso.producto.id)} ${paso.producto.nombre}: +${String(l.cantidad)} u. (${l.origen})`
}

function totales(t: Totales): string {
  return (
    `${String(t.productos)} productos, ${String(t.unidades)} unidades, ${String(t.conPrecio)} con precio, ` +
    `${String(t.conFoto)} con foto, ${String(t.conCodigo)} con código`
  )
}

async function main(): Promise<boolean> {
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
      'Uso: npx tsx scripts/incorporar-compra.ts compra.json --sucursal 1 --autor 1 [--salida informe.json] ' +
        '(--ensayo | --aplicar)',
    )
    process.exit(2)
  }

  const manifiesto = JSON.parse(readFileSync(archivo, 'utf8')) as {
    marca?: string
    productos?: LineaDeCompra[]
  }
  if (
    !manifiesto.marca ||
    !Array.isArray(manifiesto.productos) ||
    manifiesto.productos.length === 0
  ) {
    throw new Error(`${archivo}: falta la marca o la lista de productos`)
  }

  const resultado = await incorporarCompra(prisma, {
    sucursal,
    autor,
    marca: manifiesto.marca,
    lineas: manifiesto.productos,
    aplicar,
  })

  if (resultado.yaAplicada) {
    console.log(
      `YA APLICADA: la compra ${manifiesto.marca} está en la bitácora (#${String(resultado.yaAplicada.id)}, ` +
        `${resultado.yaAplicada.timestamp.toISOString()}). No se hizo nada.`,
    )
  } else {
    const revisar = resultado.pasos.filter((p) => p.accion === 'revisar').length
    console.log(
      revisar > 0
        ? `NO SE CARGÓ NADA: ${String(revisar)} líneas para revisar`
        : aplicar
          ? 'APLICADA'
          : 'ENSAYO (no se escribió nada)',
    )
    for (const paso of resultado.pasos) console.log(linea(paso))
  }
  console.log(`Antes:   ${totales(resultado.antes)}`)
  console.log(`Después: ${totales(resultado.despues)}`)
  if (salida) writeFileSync(salida, `${JSON.stringify(resultado, null, 1)}\n`)
  return resultado.pasos.every((p) => p.accion !== 'revisar')
}

main()
  .then((cargable) => {
    if (!cargable) process.exitCode = 1
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
