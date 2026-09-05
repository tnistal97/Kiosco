import { Skeleton } from '@/components/ui'

/**
 * Lo que se ve mientras una pantalla se arma. UX V2, Fase 2.1.
 *
 * POR QUE EXISTE
 * --------------
 * Hasta ahora la aplicacion no tenia NINGUN `loading.tsx`. Con el armazon
 * pidiendo la sesion en el layout --que lo vuelve dinamico-- cada navegacion
 * es un viaje al servidor, y sin este archivo el enrutador de Next no tiene
 * nada que mostrar mientras tanto: se queda en la pantalla anterior, sin
 * ningun cambio visible, hasta que el HTML llega. Medido en la construccion
 * de produccion de este equipo, eso son entre 120 y 400 ms en los que hacer
 * clic no produce absolutamente nada. Es exactamente la sensacion de "se
 * traba" que motivo la fase.
 *
 * Ademas habilita la precarga: `<Link>` solo puede precargar de una ruta
 * dinamica su limite de carga. Sin `loading.tsx` no hay nada que precargar y
 * cada navegacion empieza de cero.
 *
 * QUE SE DIBUJA
 * -------------
 * La barra de progreso arriba --el mismo lugar en todas las pantallas-- y un
 * esqueleto sobrio con la forma de una cabecera y unas filas. NO se desmonta
 * la barra lateral ni la cabecera: viven en el layout, que no se vuelve a
 * dibujar. Es lo que pedia la fase: el armazon queda, cambia el contenido.
 */
export default function Cargando() {
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
