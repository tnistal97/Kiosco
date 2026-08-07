import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sin conexión',
}

/**
 * Pantalla que se muestra cuando no hay red.
 *
 * **Pública y vacía de datos.** No dice el nombre del comercio, ni el saldo,
 * ni el ultimo ticket, ni nada que se hubiera guardado antes: es la unica
 * pagina que el service worker tiene en disco y cualquiera con el equipo
 * puede llegar a ella sin sesion.
 *
 * Tampoco ofrece "seguir trabajando sin conexion": la venta sin red llega en
 * otra fase, y un boton que no funciona es peor que la ausencia del boton.
 *
 * Sin `use client` a proposito: es HTML estatico. Si dependiera de JavaScript,
 * fallaria justo en el momento en que hace falta.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-6 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface"
      >
        <svg
          className="h-8 w-8 text-ink-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M3 3l18 18" />
          <path d="M5.6 9.6a10 10 0 0 1 3.2-2M2.5 6.5a15 15 0 0 1 4-2.6M17.6 12.4a10 10 0 0 0-2.2-1.6M21.5 6.5a15 15 0 0 0-8.4-3.4" />
          <path d="M8.5 13.5a5.5 5.5 0 0 1 2-1.2M12 18.5v.2" />
        </svg>
      </span>

      <div className="max-w-sm">
        <h1 className="text-xl font-semibold text-ink">Sin conexión</h1>
        <p className="mt-2 text-sm text-ink-muted">
          No hay conexión con el servidor. Revisá la red y volvé a intentar.
        </p>
        <p className="mt-4 text-xs text-ink-faint">
          Por seguridad no se guarda información del comercio en este dispositivo, así que no hay
          nada para mostrar mientras tanto.
        </p>
      </div>
    </div>
  )
}
