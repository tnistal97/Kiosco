/**
 * Tipos de `next-pwa`, declarados aca en lugar de instalar `@types/next-pwa`.
 *
 * Motivo: `@types/next-pwa@5.6.9` declara `next@13.5.11` como dependencia
 * REAL, no como peer. Instalarlo baja un arbol completo de Next 13 a
 * node_modules (con su propio postcss vulnerable) solo para tipar una
 * funcion. Estas veinte lineas hacen lo mismo sin ese arbol.
 *
 * Solo se declaran las opciones que el proyecto usa. Si hace falta otra, se
 * agrega aca.
 */
declare module 'next-pwa' {
  import type { NextConfig } from 'next'

  interface RuntimeCachingRule {
    urlPattern: RegExp | string | ((context: { url: URL; sameOrigin: boolean }) => boolean)
    handler:
      | 'CacheFirst'
      | 'CacheOnly'
      | 'NetworkFirst'
      | 'NetworkOnly'
      | 'StaleWhileRevalidate'
    method?: string
    options?: {
      cacheName?: string
      expiration?: { maxEntries?: number; maxAgeSeconds?: number }
      networkTimeoutSeconds?: number
      cacheableResponse?: { statuses?: number[]; headers?: Record<string, string> }
    }
  }

  interface PWAConfig {
    dest?: string
    disable?: boolean
    register?: boolean
    skipWaiting?: boolean
    scope?: string
    sw?: string
    runtimeCaching?: RuntimeCachingRule[]
    publicExcludes?: string[]
    buildExcludes?: Array<string | RegExp>
    cacheStartUrl?: boolean
    dynamicStartUrl?: boolean
  }

  export default function withPWA(pwaConfig: PWAConfig): (nextConfig: NextConfig) => NextConfig
}
