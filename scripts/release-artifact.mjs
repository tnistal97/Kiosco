/**
 * `npm run release:artifact`
 *
 * Arma UN artefacto reproducible de la release candidate y calcula su
 * SHA-256.
 *
 * POR QUE UN ARTEFACTO Y NO `git pull && npm ci && npm run build` EN EL SERVIDOR
 *
 * Porque lo que se prueba tiene que ser lo que se despliega. Construir en el
 * servidor introduce tres variables que nadie controla en el momento del
 * corte:
 *
 *   1. la red. `npm ci` baja ~700 MB de dependencias durante la ventana de
 *      mantenimiento; si el registro esta lento o caido, el corte se alarga o
 *      falla con la aplicacion ya detenida.
 *   2. el runtime. El servidor tiene Node 18.20.3 y la suite se valida con 20
 *      y 22. Un build hecho ahi NO es el build que paso las pruebas.
 *   3. la reproducibilidad. Sin un checksum no hay forma de contestar "¿esto
 *      que esta corriendo es lo que aprobamos?" durante un incidente.
 *
 * Con un artefacto, la ventana se reduce a copiar y descomprimir, y la
 * pregunta de arriba se contesta comparando un hash.
 *
 * QUE LLEVA Y QUE NO
 *
 * Lleva lo necesario para arrancar y NADA mas. En particular NO lleva `.env`,
 * ni `ecosystem.config.js`, ni `logs/`, ni volcados, ni `.git`. Los secretos
 * viven en el servidor y no viajan en el paquete: un artefacto se copia, se
 * archiva y se comparte, y todo lo que este adentro hay que darlo por
 * publicado.
 *
 * Se comprueba DESPUES de armarlo, no solo antes: la lista de exclusiones
 * puede quedar incompleta, y el que descubre eso tiene que ser este guion y no
 * alguien mirando un tar.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RAIZ = process.cwd()
const SALIDA = path.join(RAIZ, 'dist')

/**
 * Lo que entra. `.next/standalone` no se usa: el proyecto arranca con
 * `next start`, que necesita el `.next` completo y `node_modules`. Cambiar a
 * standalone es una decision de arquitectura y esta fase no cambia
 * arquitectura; queda evaluada en docs/PRODUCTION_CUTOVER.md.
 */
const INCLUIR = [
  '.next',
  'public',
  'prisma',
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'build-info.json',
]

/**
 * Lo que NO puede estar adentro, se compruebe como se compruebe.
 *
 * Se verifica sobre el contenido REAL del paquete --leyendo la lista de
 * entradas del tar-- y no sobre lo que creemos haber excluido.
 */
const PROHIBIDO = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)ecosystem\.config\.js$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)logs?\//,
  /\.(dump|pem|key|p12|pfx)$/,
  /(^|\/)coverage\//,
  /(^|\/)test-results\//,
  /(^|\/)node_modules\//,
]

/**
 * Un `.sql` es un volcado de datos, salvo dentro de `prisma/migrations/`.
 *
 * La regla nacio como `\.sql$` a secas y el propio guion se nego a empaquetar:
 * las 43 migraciones son `.sql` y TIENEN que viajar, porque `prisma migrate
 * deploy` las lee en el servidor. Es exactamente por eso que la comprobacion
 * mira el contenido real del paquete y no la lista de exclusiones.
 */
function esVolcado(entrada) {
  return entrada.endsWith('.sql') && !entrada.startsWith('prisma/migrations/')
}

function sh(cmd, args, opciones = {}) {
  return execFileSync(cmd, args, {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opciones,
  })
}

function commitActual() {
  try {
    return sh('git', ['rev-parse', 'HEAD']).trim()
  } catch {
    return 'desconocido'
  }
}

function arbolLimpio() {
  try {
    return sh('git', ['status', '--porcelain']).trim() === ''
  } catch {
    return false
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function main() {
  const paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
  const version = paquete.version
  const commit = commitActual()
  const limpio = arbolLimpio()

  console.log(`\nARTEFACTO DE RELEASE  ${version}\n`)

  if (!limpio) {
    // Aviso y no error: hace falta poder armar un artefacto de prueba con
    // cambios sin confirmar. Pero queda escrito en el propio build-info, para
    // que nadie despliegue uno de estos creyendo que es la RC.
    console.warn('AVISO: el arbol tiene cambios sin confirmar. El artefacto NO es reproducible.\n')
  }

  // 1 ─ la identidad, ANTES de construir: el build la copia adentro
  const info = {
    version,
    commit,
    // La hora la pone quien construye. No hay reloj en el build de Next.
    buildTime: new Date().toISOString(),
    arbolLimpio: limpio,
  }
  writeFileSync(path.join(RAIZ, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)
  console.log(`1. build-info.json  commit ${commit.slice(0, 12)}  ${info.buildTime}`)

  // 2 ─ construir
  console.log('2. next build…')
  // Se invoca el binario de Next con el MISMO Node que corre este guion, sin
  // pasar por npm. Dos motivos: Node 20+ se niega a lanzar un `.cmd` sin
  // `shell: true`, y con shell los argumentos se concatenan sin escapar --y la
  // ruta de este proyecto tiene espacios--. De paso queda registrado en el
  // manifiesto con que version de Node se construyo.
  sh(process.execPath, [path.join(RAIZ, 'node_modules/next/dist/bin/next'), 'build'], {
    stdio: 'inherit',
  })

  // 3 ─ empaquetar
  mkdirSync(SALIDA, { recursive: true })
  const nombre = `kiosco-${version}-${commit.slice(0, 12)}.tar.gz`
  const destino = path.join(SALIDA, nombre)
  // RELATIVA a proposito: GNU tar lee `C:\...` como `host:ruta` e intenta
  // conectarse a una maquina llamada C. Con una ruta relativa no hay dos
  // puntos que confundan a nadie.
  const destinoRelativo = path.posix.join('dist', nombre)
  rmSync(destino, { force: true })

  const faltan = INCLUIR.filter((f) => !existsSync(path.join(RAIZ, f)))
  if (faltan.length > 0) throw new Error(`Falta empaquetar: ${faltan.join(', ')}`)

  console.log('3. empaquetando…')
  sh('tar', [
    '--create',
    '--gzip',
    '--file',
    destinoRelativo,
    // `.next/cache` es el cache de compilacion: cientos de megas que no sirven
    // en el servidor y que cambian en cada build, asi que ademas romperian la
    // reproducibilidad del checksum.
    '--exclude',
    '.next/cache',
    // Las migraciones de mayo de 2025, archivadas. Prisma NO las lee --no
    // estan en `prisma/migrations`-- y son historia, no despliegue. Que un
    // `.sql` que nadie ejecuta viaje al servidor solo invita a ejecutarlo.
    '--exclude',
    'prisma/migrations-legacy',
    ...INCLUIR,
  ])

  // 4 ─ comprobar QUE QUEDO ADENTRO, no que creemos haber excluido
  const entradas = sh('tar', ['--list', '--file', destinoRelativo]).split('\n').filter(Boolean)
  const filtradas = entradas.map((e) => e.replace(/^\.\//, ''))
  const fugas = filtradas.filter((e) => esVolcado(e) || PROHIBIDO.some((p) => p.test(e)))
  if (fugas.length > 0) {
    rmSync(destino, { force: true })
    throw new Error(
      `El artefacto contenia ${String(fugas.length)} archivo(s) prohibido(s). ` +
        `Se borro. Primero: ${fugas[0]}`,
    )
  }
  console.log(`4. ${String(filtradas.length)} archivos, nada prohibido adentro.`)

  // 5 ─ el checksum
  const bytes = readFileSync(destino)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const manifiesto = {
    artefacto: nombre,
    version,
    commit,
    buildTime: info.buildTime,
    arbolLimpio: limpio,
    bytes: statSync(destino).size,
    sha256: sha,
    archivos: filtradas.length,
    node: process.version,
  }
  writeFileSync(path.join(SALIDA, `${nombre}.json`), `${JSON.stringify(manifiesto, null, 2)}\n`)
  writeFileSync(path.join(SALIDA, `${nombre}.sha256`), `${sha}  ${nombre}\n`)

  console.log(`\n   archivo   dist/${nombre}`)
  console.log(`   tamaño    ${mb(manifiesto.bytes)}`)
  console.log(`   sha256    ${sha}`)
  console.log(`   commit    ${commit}`)
  console.log(`   version   ${version}`)
  console.log('\n   Verificar en el servidor:')
  console.log(`   sha256sum -c ${nombre}.sha256\n`)
}

try {
  main()
} catch (e) {
  console.error(`\nNO SE ARMO EL ARTEFACTO: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
}
