/**
 * Caso critico 15 — las respuestas privadas no quedan disponibles mediante el
 * service worker despues del logout.
 *
 * Un service worker que cachea peticiones same-origin guarda tambien las de
 * /api. Eso significa que despues de cerrar sesion, y sin conexion, el
 * navegador puede seguir sirviendo desde disco la ultima respuesta de
 * /api/cash o /api/users.
 *
 * Desde la Fase 2 la politica es una **lista blanca**: se guarda lo que esta
 * permitido y todo lo demas va a la red. Estas pruebas comprueban las dos
 * mitades --lo que no se puede guardar y lo que si-- y ademas que el service
 * worker que se escribe de verdad aplique esa politica.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  shouldCacheRequest,
  PWA_ALLOW_PATTERNS,
  PWA_DENY_PATTERNS,
  PWA_OFFLINE_PATH,
} from '@/server/pwa/cache-policy'

const ROOT = path.resolve(__dirname, '..', '..')

describe('Politica de cache del service worker', () => {
  /**
   * Todo lo que el pedido de la Fase 2 nombra explicitamente, mas las rutas
   * de la version anterior: puede quedar un service worker viejo instalado en
   * el equipo del mostrador.
   */
  const NUNCA_CACHEABLES = [
    '/api/sales',
    '/api/cash',
    '/api/cash/balance',
    '/api/cash/count',
    '/api/users',
    '/api/users/3',
    '/api/products',
    '/api/audit',
    '/api/roles',
    '/api/stock/12',
    '/api/auth/login',
    '/api/auth/validate',
    '/api/admin/sales?start=2026-01-01&end=2026-01-31',
    '/login',
    '/venta',
    '/caja',
    '/ventas',
    '/productos',
    '/stock',
    '/auditoria',
    '/usuarios',
    '/sucursales',
    '/configuracion',
    // Rutas de la version anterior.
    '/admin/sales',
    '/admin/auditoria',
    '/control/caja',
    // El inicio: lleva saldo de caja, ventas del dia y faltantes.
    '/',
    /*
      Fase 4D. Las rutas nuevas se nombran UNA POR UNA y no se dan por cubiertas
      por el patrón general.

      La política es una lista blanca, así que en teoría una ruta nueva nace
      fuera del caché sola. Nombrarlas igual tiene un motivo concreto: el día
      que alguien agregue un patrón permisivo --"todo /api/reportes es
      público"-- estas líneas lo frenan. Y el stock por partida de un producto
      es exactamente lo que no puede quedar legible en el disco de una tablet
      después de cerrar sesión.
    */
    '/api/lotes',
    '/api/lotes/12',
    '/api/lotes/atribuir',
    '/api/productos/12/lotes',
    '/api/inventarios',
    '/api/inventarios/3',
    '/api/inventarios/3/lineas',
    '/api/inventarios/3/conteo',
    '/api/inventarios/3/revision',
    '/api/inventarios/3/aplicar',
    '/api/inventarios/3/cancelar',
    '/api/inventarios/3/lineas/9/resolver',
    '/api/reportes/vencimientos',
    '/api/reports/vencimientos',
    '/api/reports/mermas?desde=2026-08-01&hasta=2026-08-11',
    '/api/reports/inventarios?desde=2026-08-01&hasta=2026-08-11',
    // Y las pantallas de la fase.
    '/stock/lotes',
    '/stock/lotes/7',
    '/inventarios',
    '/inventarios/3',
  ]

  for (const ruta of NUNCA_CACHEABLES) {
    it(`no cachea ${ruta}`, () => {
      expect(shouldCacheRequest(ruta)).toBe(false)
    })
  }

  const CACHEABLES = [
    '/icon-192x192.png',
    '/icon-512x512.png',
    '/manifest.json',
    '/_next/static/chunks/main.js',
    '/favicon.ico',
    PWA_OFFLINE_PATH,
  ]

  for (const ruta of CACHEABLES) {
    it(`si cachea ${ruta}`, () => {
      expect(shouldCacheRequest(ruta)).toBe(true)
    })
  }

  it('una ruta nueva no cae en el cache por descuido', () => {
    // El punto de la lista blanca: lo que nadie declaro, no se guarda.
    expect(shouldCacheRequest('/pantalla-que-todavia-no-existe')).toBe(false)
    expect(shouldCacheRequest('/api/lo-que-venga')).toBe(false)
  })

  it('las dos listas tienen contenido', () => {
    expect(PWA_ALLOW_PATTERNS.length).toBeGreaterThan(0)
    expect(PWA_DENY_PATTERNS.length).toBeGreaterThan(0)
  })
})

describe('El service worker aplica la politica', () => {
  const FUENTE = path.join(ROOT, 'src', 'app', 'sw.ts')

  it('el codigo fuente del service worker existe', () => {
    expect(existsSync(FUENTE)).toBe(true)
  })

  it('usa la politica compartida y NetworkOnly para todo lo demas', () => {
    const sw = readFileSync(FUENTE, 'utf8')

    expect(sw, 'el service worker no importa la politica compartida').toContain('cache-policy')
    expect(sw, 'el service worker no consulta shouldCacheRequest').toContain('shouldCacheRequest')
    expect(sw, 'el service worker no declara NetworkOnly').toContain('NetworkOnly')
    // La regla comodin tiene que existir: sin ella el comportamiento por
    // omision de la libreria decide, y eso puede cambiar entre versiones.
    expect(sw, 'falta la regla que manda todo lo no permitido a la red').toMatch(
      /matcher:\s*\(\)\s*=>\s*true[\s\S]{0,120}NetworkOnly/,
    )
  })

  it('next.config.ts conecta el service worker', () => {
    const config = readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')
    expect(config).toContain('swSrc')
    expect(config).toContain('src/app/sw.ts')
  })
})

describe('El service worker construido', () => {
  const CONSTRUIDO = path.join(ROOT, 'public', 'sw.js')
  const hay = existsSync(CONSTRUIDO)

  // Solo existe despues de `next build`. En CI el paso de construccion corre
  // antes que esto; en local, se saltea con nombre visible en vez de pasar
  // en silencio.
  it.skipIf(!hay)('no precarga ninguna ruta privada', () => {
    const contenido = readFileSync(CONSTRUIDO, 'utf8')

    // El manifiesto de precarga es una lista de URLs. Ninguna puede ser una
    // pantalla con datos ni un endpoint. El minificador usa comillas simples
    // o dobles segun le convenga, asi que se aceptan las dos.
    const urls = [...contenido.matchAll(/['"]url['"]\s*:\s*['"]([^'"]+)['"]/g)].map(
      (m) => m[1] ?? '',
    )
    expect(urls.length, 'no se encontro el manifiesto de precarga en sw.js').toBeGreaterThan(0)

    const privadas = urls.filter((u) => !shouldCacheRequest(u.startsWith('/') ? u : `/${u}`))

    expect(privadas, `el service worker precarga rutas privadas: ${privadas.join(', ')}`).toEqual(
      [],
    )
  })

  it.skipIf(!hay)('incluye la pantalla publica de sin conexion', () => {
    const contenido = readFileSync(CONSTRUIDO, 'utf8')
    expect(contenido).toContain(PWA_OFFLINE_PATH)
  })
})
