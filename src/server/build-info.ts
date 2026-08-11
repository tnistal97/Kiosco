/**
 * Identidad del binario que esta corriendo.
 *
 * MOTIVO: en produccion el checkout no es un repositorio git --se copio sin
 * `.git`--, asi que `git rev-parse` ahi no responde nada. Y `package.json`
 * solo, durante un incidente, contesta la pregunta equivocada: dice que
 * version pretende ser el codigo, no cual se construyo ni cuando. Dos
 * despliegues seguidos de `1.0.0-rc.1` son indistinguibles mirando
 * `package.json`.
 *
 * Por eso el artefacto de release lleva un `build-info.json` en su raiz,
 * escrito por `scripts/release-artifact.mjs` en el momento de construir, con
 * el commit exacto y la hora. Este modulo lo lee UNA vez y lo deja en
 * memoria.
 *
 * Si el archivo no esta --desarrollo, o un despliegue hecho a mano sin el
 * script-- no se inventa nada: `commit` queda en `desconocido`. Un dato falso
 * en esta pregunta es peor que ninguno.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BuildInfo {
  /** Version del release. Sale de package.json en el momento de construir. */
  version: string
  /** SHA completo del commit construido, o `desconocido`. */
  commit: string
  /** ISO 8601 en UTC del momento de la construccion, o `desconocido`. */
  buildTime: string
  /** `production`, `development`, `test`. Se lee en cada llamada, no se fija. */
  environment: string
}

/** Lo que devuelve el archivo si existe. `environment` no viaja en el archivo. */
type ArchivoDeConstruccion = Omit<BuildInfo, 'environment'>

const DESCONOCIDO = 'desconocido'

/** Nombre del archivo en la raiz del artefacto. Lo escribe el script de release. */
export const BUILD_INFO_FILE = 'build-info.json'

let cache: ArchivoDeConstruccion | null = null

/**
 * Lee el archivo si esta. Cualquier fallo --no existe, no es JSON, le faltan
 * campos-- se resuelve con `desconocido`, nunca lanzando: el endpoint de salud
 * tiene que responder incluso cuando el artefacto esta mal armado, porque
 * justamente sirve para descubrirlo.
 */
function leerArchivo(): ArchivoDeConstruccion {
  if (cache) return cache

  const vacio: ArchivoDeConstruccion = {
    version: DESCONOCIDO,
    commit: DESCONOCIDO,
    buildTime: DESCONOCIDO,
  }

  try {
    const crudo = readFileSync(join(process.cwd(), BUILD_INFO_FILE), 'utf8')
    const dato = JSON.parse(crudo) as Partial<ArchivoDeConstruccion>
    cache = {
      version: typeof dato.version === 'string' ? dato.version : DESCONOCIDO,
      commit: typeof dato.commit === 'string' ? dato.commit : DESCONOCIDO,
      buildTime: typeof dato.buildTime === 'string' ? dato.buildTime : DESCONOCIDO,
    }
  } catch {
    cache = vacio
  }

  return cache
}

export function buildInfo(): BuildInfo {
  const archivo = leerArchivo()
  // El tipo de `NODE_ENV` promete que siempre viene; en un proceso arrancado a
  // mano puede no venir, y `desconocido` es mas util que la cadena vacia.
  const entorno: string = process.env.NODE_ENV
  return {
    ...archivo,
    environment: entorno === '' ? DESCONOCIDO : entorno,
  }
}

/** Solo para las pruebas: obliga a releer el archivo. */
export function olvidarBuildInfo(): void {
  cache = null
}
