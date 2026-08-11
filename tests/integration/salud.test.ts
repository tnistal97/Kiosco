/**
 * El endpoint de salud.
 *
 * Se prueba en tres frentes, y el tercero es el que importa: un endpoint de
 * salud es publico --lo consulta el monitor sin credenciales-- asi que todo
 * lo que devuelve hay que darlo por publicado. La prueba de fugas mira el
 * texto crudo de la respuesta contra los valores reales del entorno, no
 * contra una lista de nombres de campo: asi sigue sirviendo si mañana alguien
 * agrega un campo nuevo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { call } from '../helpers/http'
import { prisma } from '../helpers/db'
import { olvidarBuildInfo, BUILD_INFO_FILE } from '@/server/build-info'
import { join } from 'node:path'
import { REQUEST_ID_HEADER } from '@/server/http/requestId'
import type { HealthBody } from '@/app/api/health/route'

async function salud() {
  const { GET } = await import('@/app/api/health/route')
  return call<HealthBody>(GET, '/api/health')
}

beforeEach(() => {
  olvidarBuildInfo()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('GET /api/health', () => {
  it('responde 200 cuando la base contesta', async () => {
    const res = await salud()

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database.ok).toBe(true)
    expect(typeof res.body.database.latencyMs).toBe('number')
    expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('no exige sesion: el monitor no tiene credenciales', async () => {
    const res = await salud()
    // Sin cookie. Si exigiera sesion esto seria 401.
    expect(res.status).toBe(200)
  })

  it('identifica el binario: version, commit, buildTime y entorno', async () => {
    const res = await salud()

    for (const campo of ['version', 'commit', 'buildTime', 'environment'] as const) {
      expect(typeof res.body[campo]).toBe('string')
      expect(res.body[campo].length).toBeGreaterThan(0)
    }
  })

  it('sin build-info.json dice "desconocido" en vez de inventar un commit', async () => {
    // Se apunta a un directorio VACIO, no se confia en que el archivo falte en
    // el arbol: `npm run release:artifact` lo crea, y la primera version de
    // esta prueba pasaba en un clon recien hecho y fallaba despues de construir
    // un artefacto. Una prueba que depende de un archivo sin versionar mide el
    // estado del disco, no el comportamiento del codigo.
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const vacio = mkdtempSync(join(tmpdir(), 'sin-build-info-'))
    olvidarBuildInfo(vacio)

    const res = await salud()

    // Un commit inventado durante un incidente es peor que ninguno.
    expect(res.body.commit).toBe('desconocido')
    expect(res.body.version).toBe('desconocido')
    expect(res.body.buildTime).toBe('desconocido')
    // El entorno NO sale del archivo: se lee siempre, aunque el archivo falte.
    expect(res.body.environment).not.toBe('desconocido')
  })

  it('con build-info.json devuelve exactamente lo que dice el archivo', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const carpeta = mkdtempSync(join(tmpdir(), 'con-build-info-'))
    writeFileSync(
      join(carpeta, BUILD_INFO_FILE),
      JSON.stringify({ version: '9.9.9', commit: 'abc123', buildTime: '2026-01-01T00:00:00.000Z' }),
    )
    olvidarBuildInfo(carpeta)

    const res = await salud()

    expect(res.body.version).toBe('9.9.9')
    expect(res.body.commit).toBe('abc123')
    expect(res.body.buildTime).toBe('2026-01-01T00:00:00.000Z')
  })

  it('con un build-info.json roto no revienta: dice desconocido', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const carpeta = mkdtempSync(join(tmpdir(), 'build-info-roto-'))
    writeFileSync(join(carpeta, BUILD_INFO_FILE), '{ esto no es json')
    olvidarBuildInfo(carpeta)

    const res = await salud()

    // El endpoint de salud tiene que responder incluso cuando el artefacto
    // esta mal armado: justamente sirve para descubrirlo.
    expect(res.status).toBe(200)
    expect(res.body.commit).toBe('desconocido')
  })

  it('no se puede cachear', async () => {
    const res = await salud()
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('trae el identificador de peticion, para cruzarlo con el log', async () => {
    const res = await salud()
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[a-f0-9-]{8,64}$/i)
  })

  it('devuelve 503 y no revienta cuando la base no contesta', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.7:5432 user=kiosco_produccion'),
    )
    // El endpoint escribe el motivo real en el log del servidor a proposito.
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await salud()

    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.database.ok).toBe(false)
    expect(res.body.database.latencyMs).toBeUndefined()
    // El mensaje de Prisma lleva host y usuario: al log si, al cuerpo no.
    expect(res.text).not.toContain('ECONNREFUSED')
    expect(res.text).not.toContain('10.0.0.7')
    expect(res.text).not.toContain('kiosco_produccion')
    expect(consola).toHaveBeenCalled()
  })

  it('devuelve 503 si falta una variable critica, aunque la base ande', async () => {
    vi.stubEnv('JWT_SECRET', 'corto')

    const res = await salud()

    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.database.ok).toBe(true)
    expect(res.body.configuracion?.faltantes).toContain('JWT_SECRET')
    // Nombra la variable; nunca su valor.
    expect(res.text).not.toContain('corto')
  })
})

describe('El endpoint de salud no filtra nada', () => {
  it('no devuelve la cadena de conexion, ni el secreto, ni rutas del servidor', async () => {
    const res = await salud()
    const crudo = res.text

    // Contra los valores REALES del entorno, no contra nombres de campo.
    const url = process.env.DATABASE_URL ?? ''
    const secreto = process.env.JWT_SECRET ?? ''

    expect(crudo).not.toContain(url)
    expect(crudo).not.toContain(secreto)
    // Ni las piezas sueltas de la cadena de conexion: usuario, host, base.
    const piezas = url
      .replace(/^postgres(ql)?:\/\//, '')
      .split(/[:@/?]/)
      .filter((p) => p.length >= 4)
    expect(piezas.filter((p) => crudo.includes(p))).toEqual([])
    // Ni rutas del sistema de archivos.
    expect(crudo).not.toMatch(/[A-Za-z]:\\|\/home\/|\/var\/|node_modules/)
    // Ni stack traces.
    expect(crudo).not.toContain('    at ')
  })

  it('el cuerpo tiene exactamente los campos previstos, y ninguno mas', async () => {
    const res = await salud()
    expect(Object.keys(res.body).sort()).toEqual([
      'buildTime',
      'commit',
      'database',
      'environment',
      'status',
      'version',
    ])
    expect(Object.keys(res.body.database).sort()).toEqual(['latencyMs', 'ok'])
  })
})
