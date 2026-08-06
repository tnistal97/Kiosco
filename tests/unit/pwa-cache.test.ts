/**
 * Caso critico 15 — las respuestas privadas no quedan disponibles mediante el
 * service worker despues del logout.
 *
 * El service worker de next-pwa cachea por defecto las peticiones same-origin,
 * incluidas las de /api. Eso significa que despues de cerrar sesion, y sin
 * conexion, el navegador puede seguir sirviendo desde el disco la ultima
 * respuesta de /api/cash o /api/users. La politica se define una sola vez y
 * se prueba aca.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { shouldCacheRequest, PWA_EXCLUDE_PATTERNS } from '@/server/pwa/cache-policy'

const ROOT = path.resolve(__dirname, '..', '..')

describe('Politica de cache del service worker', () => {
  const NUNCA_CACHEABLES = [
    '/api/sales',
    '/api/cash',
    '/api/cash/balance',
    '/api/users',
    '/api/products',
    '/api/audit',
    '/api/stock/12',
    '/api/auth/login',
    '/api/auth/validate',
    '/api/admin/sales?start=2026-01-01&end=2026-01-31',
    '/login',
  ]

  for (const ruta of NUNCA_CACHEABLES) {
    it(`no cachea ${ruta}`, () => {
      expect(shouldCacheRequest(ruta)).toBe(false)
    })
  }

  const CACHEABLES = ['/icons/icon-192.png', '/manifest.json', '/_next/static/chunk.js']

  for (const ruta of CACHEABLES) {
    it(`si cachea ${ruta}`, () => {
      expect(shouldCacheRequest(ruta)).toBe(true)
    })
  }

  it('la lista de exclusiones no esta vacia', () => {
    expect(PWA_EXCLUDE_PATTERNS.length).toBeGreaterThan(0)
  })
})

describe('La configuracion de build aplica la politica', () => {
  it('next.config.ts usa la politica compartida', () => {
    const config = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')
    expect(
      config.includes('cache-policy') || config.includes('PWA_EXCLUDE_PATTERNS'),
      'next.config.ts no importa la politica de exclusion: el service worker cacheara /api',
    ).toBe(true)
  })

  it('el service worker generado no cachea /api', () => {
    const sw = path.join(ROOT, 'public', 'sw.js')
    if (!existsSync(sw)) return // solo existe despues de `next build`

    const contenido = readFileSync(sw, 'utf8')
    expect(
      /\/api\//.test(contenido) === false || /denylist|exclude/i.test(contenido),
      'El service worker construido no declara exclusiones para /api',
    ).toBe(true)
  })
})
