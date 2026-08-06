/**
 * La matriz documentada tiene que coincidir con el codigo.
 *
 * Un documento de permisos que se desactualiza es peor que no tenerlo: da
 * una sensacion de control que no existe. Estas pruebas leen
 * docs/PERMISSIONS_MATRIX.md y lo comparan con lo que realmente exige cada
 * ruta, de modo que separarlos rompe el build.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PERMISSIONS, knownRoles, permissionsForRole } from '@/server/authz/permissions'

const ROOT = process.cwd()
const DOC = path.join(ROOT, 'docs/PERMISSIONS_MATRIX.md')
const API = path.join(ROOT, 'src/app/api')

interface Endpoint {
  metodo: string
  ruta: string
  auth: string
  permisos: string[]
  archivo: string
}

/** Rutas privadas que a proposito no exigen ningun permiso. */
const SIN_PERMISO_A_PROPOSITO = new Set(['POST /api/auth/validate'])

function rutasDeApi(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) rutasDeApi(p, acc)
    else if (e.name === 'route.ts') acc.push(p)
  }
  return acc
}

function leerEndpoints(): Endpoint[] {
  const salida: Endpoint[] = []
  for (const archivo of rutasDeApi(API)) {
    const src = readFileSync(archivo, 'utf8')
    const rel = path.relative(ROOT, archivo).split(path.sep).join('/')
    const re = /export const (GET|POST|PUT|PATCH|DELETE) = handler\(\s*\{([\s\S]*?)\n\s*\},/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const metodo = m[1] ?? ''
      const cfg = m[2] ?? ''
      const auth = /auth:\s*'(\w+)'/.exec(cfg)?.[1] ?? '?'
      const bloque = /permission:\s*(\[[^\]]*\]|'[^']*')/.exec(cfg)?.[1] ?? ''
      const permisos = [...bloque.matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '')
      const ruta = /audit:\s*'([^']+)'/.exec(cfg)?.[1] ?? `${metodo} ${rel}`
      salida.push({ metodo, ruta, auth, permisos, archivo: rel })
    }
  }
  return salida
}

const endpoints = leerEndpoints()
const doc = readFileSync(DOC, 'utf8')

/**
 * Celdas de una fila de tabla markdown, sin el relleno.
 *
 * Prettier alinea las columnas del documento, asi que las celdas vienen con
 * espacios de sobra. Leer la fila por posicion y recortar cada celda es lo
 * unico que hace que el formato del documento y su contenido sean
 * independientes.
 */
function celdas(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** Busca la fila cuya primera celda es exactamente `clave`. */
function filaDe(clave: string): string[] | null {
  for (const linea of doc.split('\n')) {
    if (!linea.trim().startsWith('|')) continue
    const c = celdas(linea)
    if (c[0] === clave) return c
  }
  return null
}

describe('El catalogo de permisos', () => {
  it('encuentra endpoints para analizar', () => {
    expect(endpoints.length).toBeGreaterThan(20)
  })

  it('no tiene permisos duplicados', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })

  it('un rol desconocido no recibe ningun permiso', () => {
    for (const inventado of ['gerente', 'ADMIN', 'Admin', '', 'root', 'superuser']) {
      expect(
        permissionsForRole(inventado).size,
        `El rol "${inventado}" recibio permisos sin estar en el catalogo`,
      ).toBe(0)
    }
  })

  it('todo permiso exigido por una ruta existe en el catalogo', () => {
    const catalogo = new Set<string>(PERMISSIONS)
    for (const e of endpoints) {
      for (const p of e.permisos) {
        expect(catalogo.has(p), `${e.ruta} exige "${p}", que no esta en PERMISSIONS`).toBe(true)
      }
    }
  })
})

describe('Cada ruta declara su autorizacion', () => {
  it('ninguna ruta queda sin declarar `auth`', () => {
    for (const e of endpoints) {
      expect(['public', 'session'], `${e.ruta} no declara auth`).toContain(e.auth)
    }
  })

  it('toda ruta con sesion exige un permiso, salvo las excepciones declaradas', () => {
    const huerfanas = endpoints
      .filter((e) => e.auth === 'session' && e.permisos.length === 0)
      .filter((e) => !SIN_PERMISO_A_PROPOSITO.has(e.ruta))
      .map((e) => e.ruta)

    expect(
      huerfanas,
      'Estas rutas exigen sesion pero ningun permiso: cualquier usuario autenticado las puede usar. ' +
        'Si es a proposito, agregarlas a SIN_PERMISO_A_PROPOSITO con su motivo.',
    ).toEqual([])
  })

  it('las unicas rutas publicas son las de autenticacion', () => {
    const publicas = endpoints
      .filter((e) => e.auth === 'public')
      .map((e) => e.ruta)
      .sort()
    expect(publicas).toEqual(['POST /api/auth/login', 'POST /api/auth/logout'])
  })
})

describe('docs/PERMISSIONS_MATRIX.md refleja el codigo', () => {
  it('documenta todos los roles y ninguno de mas', () => {
    const encabezado = filaDe('Permiso')
    expect(encabezado, 'No se encontro el encabezado de la matriz rol x permiso').not.toBeNull()

    const documentados = (encabezado ?? []).slice(1)
    expect([...documentados].sort()).toEqual([...knownRoles()].sort())
  })

  it('documenta todos los permisos del catalogo', () => {
    for (const p of PERMISSIONS) {
      expect(doc, `El permiso "${p}" no figura en la matriz documentada`).toContain('`' + p + '`')
    }
  })

  it('cada casilla de la matriz coincide con permissionsForRole', () => {
    const roles = knownRoles()
    for (const permiso of PERMISSIONS) {
      const fila = filaDe('`' + permiso + '`')
      expect(fila, `Falta la fila de "${permiso}" en la matriz rol x permiso`).not.toBeNull()
      if (!fila) continue

      const casillas = fila.slice(1)
      expect(casillas.length, `La fila de "${permiso}" no tiene una casilla por rol`).toBe(
        roles.length,
      )

      roles.forEach((rol, i) => {
        const documentado = casillas[i] === '✔'
        const real = permissionsForRole(rol).has(permiso)
        expect(
          documentado,
          `La matriz dice que ${rol} ${documentado ? 'si' : 'no'} tiene "${permiso}", ` +
            `pero el codigo dice que ${real ? 'si' : 'no'}`,
        ).toBe(real)
      })
    }
  })

  it('anota los permisos que ninguna ruta exige', () => {
    const enUso = new Set<string>(endpoints.flatMap((e) => e.permisos))
    const sinUso = PERMISSIONS.filter((p) => !enUso.has(p))

    // No es un error tenerlos, pero si tenerlos sin explicacion: un permiso
    // que nadie exige da una sensacion de control que no existe.
    for (const p of sinUso) {
      expect(
        doc.includes('### Permiso sin uso'),
        `El permiso "${p}" no lo exige ninguna ruta y el documento no tiene la seccion que lo aclare`,
      ).toBe(true)
    }
  })
})
