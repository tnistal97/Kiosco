/**
 * Carga `.env.local` para los guiones que corren fuera de Next.
 *
 * POR QUE EXISTE. Next.js lee `.env.local` solo; el CLI de Prisma lee `.env` y
 * no `.env.local`; y un guion suelto ejecutado con `tsx` no lee ninguno de los
 * dos. Resultado: la aplicacion funciona, los tests funcionan, y
 *
 *   npm run integrity:check
 *   npm run rehearsal
 *
 * fallan con "Environment variable not found: DATABASE_URL" en una terminal
 * recien abierta. Es la fuente de confusion que `docs/DEV_ENVIRONMENT.md` ya
 * documentaba como una molestia a la que hay que acostumbrarse; esto la
 * elimina en vez de explicarla.
 *
 * NO PISA NADA. Una variable que ya este en el entorno gana siempre: asi
 * `DATABASE_URL=... npm run integrity:check` sigue apuntando a donde uno dijo,
 * y el archivo solo completa lo que falta. Es la misma precedencia que usa
 * Next.
 *
 * Y no lee secretos de ningun otro lado: si el archivo no existe, no pasa nada.
 * En el servidor las variables vienen del entorno de verdad.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Los archivos que se miran, del mas especifico al mas general. */
const ARCHIVOS = ['.env.local', '.env'] as const

/**
 * Una linea de un archivo de entorno.
 *
 * Deliberadamente simple: `CLAVE=valor`, comillas opcionales, `#` comienza un
 * comentario solo al principio de la linea. No se soporta interpolacion ni
 * valores multilinea, y es a proposito: un formato con reglas es un formato en
 * el que alguien se equivoca. Si algun dia hace falta algo mas, se usa una
 * biblioteca; hoy esto cubre los tres valores que el proyecto necesita.
 */
function parsear(contenido: string): Map<string, string> {
  const salida = new Map<string, string>()

  for (const linea of contenido.split('\n')) {
    const limpia = linea.trim()
    if (limpia === '' || limpia.startsWith('#')) continue

    const igual = limpia.indexOf('=')
    if (igual <= 0) continue

    const clave = limpia.slice(0, igual).trim()
    let valor = limpia.slice(igual + 1).trim()

    // Comillas envolventes, de cualquiera de los dos tipos.
    if (
      (valor.startsWith('"') && valor.endsWith('"') && valor.length >= 2) ||
      (valor.startsWith("'") && valor.endsWith("'") && valor.length >= 2)
    ) {
      valor = valor.slice(1, -1)
    }

    salida.set(clave, valor)
  }

  return salida
}

/**
 * Completa `process.env` con lo que falte, leyendo desde la raiz del proyecto.
 *
 * Devuelve cuantas variables agrego, para que un guion pueda decirlo si quiere.
 */
function cargar(raiz: string = process.cwd()): number {
  let agregadas = 0

  for (const nombre of ARCHIVOS) {
    const archivo = path.join(raiz, nombre)
    if (!existsSync(archivo)) continue

    for (const [clave, valor] of parsear(readFileSync(archivo, 'utf8'))) {
      // Lo que ya esta en el entorno GANA. Ver la nota de arriba.
      if (process.env[clave] !== undefined) continue
      process.env[clave] = valor
      agregadas++
    }
  }

  return agregadas
}

/**
 * Se carga AL IMPORTAR, no llamando a una funcion.
 *
 * Es la unica forma que funciona: los `import` de un modulo ES se evaluan todos
 * antes que cualquier sentencia del archivo que los escribe. Una llamada a
 * `cargarEntorno()` puesta entre dos imports correria DESPUES de los dos, y
 * `@/lib/prisma` --que crea el cliente al importarse-- ya habria fallado.
 *
 * Por eso los guiones lo usan asi, y en la primera linea:
 *
 *   import './entorno'
 */
cargar()

/** Se exporta para poder probarla. El efecto util es el de arriba. */
export { cargar as cargarEntorno }
