/**
 * Escribe `build-info.json` antes de cada `npm run build` (hook `prebuild`).
 *
 * MOTIVO: el 24 de septiembre de 2026 el `/api/health` de produccion decia
 * `version`, `commit` y `buildTime` "desconocido". El despliegue dependia de
 * un paso MANUAL posterior al build --un `node -e` de una linea en
 * docs/DEPLOY_LUCHANDOPORMAS.md-- y bastaba con saltearlo, o con que fallara
 * en silencio, para que nadie supiera que version estaba corriendo.
 *
 * Ahora lo escribe el propio build: no hay paso que olvidar.
 *
 * De donde sale cada dato:
 *   - version: package.json.
 *   - commit: `KIOSCO_COMMIT` si viene (un build sin `.git`, como el de un
 *     contenedor, lo recibe de quien construye); si no, `git rev-parse HEAD`;
 *     si no hay git, `desconocido`. No se inventa.
 *   - buildTime: la hora de este build, en UTC.
 *   - arbolLimpio: si habia cambios sin confirmar. Un binario construido con
 *     cambios sueltos no es el commit que dice ser.
 *
 * `scripts/release-artifact.mjs` escribe el suyo y llama a `next build` sin
 * pasar por npm, asi que este hook no lo pisa.
 *
 * Nada de esto es secreto: es lo mismo que `/api/health` publica.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RAIZ = process.cwd()

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))

const declarado = (process.env.KIOSCO_COMMIT ?? '').trim()
const commit = /^[0-9a-f]{7,40}$/i.test(declarado)
  ? declarado.toLowerCase()
  : (git(['rev-parse', 'HEAD']) ?? 'desconocido')

const estado = git(['status', '--porcelain', '--untracked-files=no'])

const info = {
  version: paquete.version,
  commit,
  buildTime: new Date().toISOString(),
  arbolLimpio: estado === null ? null : estado === '',
}

writeFileSync(path.join(RAIZ, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)

console.log(
  `build-info.json  ${info.version}  ${commit.slice(0, 12)}  ${info.buildTime}` +
    (info.arbolLimpio === false ? '  (con cambios sin confirmar)' : ''),
)
