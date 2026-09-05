import { Skeleton } from '@/components/ui'

/**
 * Lo que se ve mientras una pantalla se arma. UX V2, Fase 2.1.
 *
 * POR QUE EXISTE
 * --------------
 * Hasta la 2.1 la aplicacion no tenia NINGUN limite de carga. Con el armazon
 * pidiendo la sesion en el layout --que lo vuelve dinamico-- cada navegacion
 * es un viaje al servidor, y sin `loading.tsx` el enrutador de Next no tiene
 * nada que mostrar mientras tanto: se queda en la pantalla anterior, sin
 * ningun cambio visible, hasta que llega el HTML. Es la sensacion de "se
 * traba" que motivo la fase.
 *
 * Y hay una segunda razon, menos visible y mas importante: `<Link>` solo
 * puede precargar de una ruta dinamica su limite de carga. Sin esto no habia
 * NADA que precargar y cada navegacion empezaba de cero. Medido en la
 * construccion de produccion: el primer cambio en pantalla paso de 46 ms a
 * 19 ms (docs/UX_V2_PHASE2_1_LIST_SESSION_NAVIGATION.md).
 *
 * POR QUE NO ESTA EN LA RAIZ
 * --------------------------
 * Un `loading.tsx` en `src/app/` cubriria todo de una vez, pero un limite de
 * carga hace que la respuesta EMPIECE A VIAJAR antes de que la pagina
 * termine, y con eso se pierde el estado HTTP: `/compras/recepcion/<id>`
 * --que llama a `notFound()` para un numero que no existe-- pasaba de 404 a
 * 200. Comprobado quitando y poniendo el archivo. Asi que el limite se pone
 * por seccion, y `/compras` se queda sin el a proposito.
 *
 * QUE SE DIBUJA
 * -------------
 * La barra de progreso arriba --el mismo lugar en todas las pantallas-- y un
 * esqueleto sobrio con la forma de una cabecera y unas filas. NO se desmonta
 * la barra lateral ni la cabecera: viven en el layout, que no se vuelve a
 * dibujar.
 */
export function CargandoPantalla() {
  return (
    <div role="status" aria-busy="true" className="flex h-full flex-col">
      <span className="sr-only">Cargando la pantalla</span>

      {/* La barra de arriba: 2 px, latiendo. Da el aviso inmediato sin
          prometer un porcentaje que no sabemos. */}
      <div className="h-0.5 shrink-0 animate-pulse bg-primary" />

      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
