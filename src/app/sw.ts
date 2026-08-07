/// <reference lib="webworker" />

import { Serwist, NetworkOnly, CacheFirst, type PrecacheEntry } from 'serwist'
import { PWA_OFFLINE_PATH, shouldCacheRequest } from '@/server/pwa/cache-policy'

/**
 * Service worker.
 *
 * Reemplaza a next-pwa, que esta sin mantenimiento desde 2022 y arrastraba a
 * Workbox 6 y a un webpack propio. Ver docs/DEPENDENCY_SECURITY.md.
 *
 * Lo que hace, y nada mas:
 *
 *  1. precarga los estaticos publicos con hash en el nombre;
 *  2. manda a la red TODO lo demas --API, pantallas, navegaciones--;
 *  3. cuando no hay red y lo que se pedia era una navegacion, muestra una
 *     pantalla publica de "sin conexion" que no contiene ningun dato del
 *     comercio;
 *  4. al iniciar, borra cualquier cache que haya dejado la version anterior.
 *
 * Lo que NO hace: guardar respuestas autenticadas. La politica es una lista
 * blanca (`shouldCacheRequest`), asi que una pantalla nueva nace fuera del
 * cache y hay que permitirla a proposito.
 */

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<PrecacheEntry | string> | undefined
}

/**
 * El manifiesto que inyecta @serwist/next ya viene filtrado por
 * `additionalPrecacheEntries` y por lo que Next marca como publico, pero se
 * vuelve a filtrar aca contra la misma politica: es la unica forma de que la
 * lista blanca sea la ultima palabra.
 */
const precarga = (self.__SW_MANIFEST ?? []).filter((entrada) => {
  const url = typeof entrada === 'string' ? entrada : entrada.url
  return shouldCacheRequest(url.startsWith('/') ? url : `/${url}`)
})

const serwist = new Serwist({
  precacheEntries: precarga,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,

  runtimeCaching: [
    {
      // Estaticos con hash: el nombre cambia con el contenido, asi que
      // servirlos desde disco no puede quedar desactualizado.
      matcher: ({ url, sameOrigin }) => sameOrigin && shouldCacheRequest(url.pathname),
      handler: new CacheFirst({ cacheName: 'estaticos-publicos' }),
    },
    {
      // Todo lo demas. Explicito para que se lea en el codigo y no dependa
      // de cual sea el comportamiento por omision de la libreria.
      matcher: () => true,
      handler: new NetworkOnly(),
    },
  ],

  fallbacks: {
    entries: [
      {
        url: PWA_OFFLINE_PATH,
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
})

/**
 * Limpieza de la version anterior.
 *
 * next-pwa dejaba caches propios (`start-url`, `others`, `apis`…) que podian
 * contener respuestas privadas guardadas antes de la Fase 0. Un equipo que ya
 * tenia la aplicacion instalada las conserva hasta que alguien las borre, y
 * ese alguien es esto.
 */
const CACHES_PROPIOS = new Set(['estaticos-publicos'])

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres
          .filter((n) => !CACHES_PROPIOS.has(n) && !n.startsWith('serwist'))
          .map((n) => caches.delete(n)),
      )
    })(),
  )
})

/**
 * Vaciado al cerrar sesion.
 *
 * La aplicacion manda este mensaje desde el menu de usuario. No queda nada
 * del turno anterior en disco.
 */
self.addEventListener('message', (evento) => {
  if ((evento.data as { type?: string } | null)?.type !== 'KIOSCO_LIMPIAR_CACHE') return
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.map((n) => caches.delete(n)))
    })(),
  )
})

serwist.addEventListeners()
