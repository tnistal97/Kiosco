import type { ReactNode } from 'react'

/**
 * Iconos de la navegacion.
 *
 * Trazo propio, un solo grosor, una sola caja de 24. Se dibujan aca en vez de
 * traer un paquete entero para nueve simbolos: el peso que se ahorra es el de
 * la ruta mas usada del sistema.
 *
 * Todos son decorativos: el texto de al lado es el que nombra la entrada.
 */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const ICONOS: Record<string, () => ReactNode> = {
  '/': () => (
    <Svg>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </Svg>
  ),
  '/venta': () => (
    <Svg>
      <path d="M4 5h2l1.6 9.2a2 2 0 0 0 2 1.7h6.9a2 2 0 0 0 2-1.6L20 8H7" />
      <circle cx="10" cy="19.5" r="1.2" />
      <circle cx="17" cy="19.5" r="1.2" />
    </Svg>
  ),
  '/caja': () => (
    <Svg>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <circle cx="12" cy="12.5" r="2.2" />
      <path d="M6.5 7V5.5A1.5 1.5 0 0 1 8 4h8a1.5 1.5 0 0 1 1.5 1.5V7" />
    </Svg>
  ),
  '/ventas': () => (
    <Svg>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 7.5h3" />
    </Svg>
  ),
  '/productos': () => (
    <Svg>
      <path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2z" />
      <path d="m4 7.2 8 4.3 8-4.3M12 11.5V21" />
    </Svg>
  ),
  '/stock': () => (
    <Svg>
      <path d="M3 8h18M3 8l1.5 11h15L21 8M3 8l2.5-4h13L21 8" />
      <path d="M10 12h4" />
    </Svg>
  ),
  '/auditoria': () => (
    <Svg>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
      <path d="M11 8.2v3.2l2 1.3" />
    </Svg>
  ),
  '/usuarios': () => (
    <Svg>
      <circle cx="9.5" cy="9" r="3.2" />
      <path d="M3.8 19.2a5.8 5.8 0 0 1 11.4 0" />
      <path d="M16.5 7.6a3 3 0 0 1 0 5.6M17.6 19.2a5.6 5.6 0 0 0-1.4-3.6" />
    </Svg>
  ),
  '/sucursales': () => (
    <Svg>
      <path d="M4 20V9.5L12 4l8 5.5V20" />
      <path d="M4 20h16M9.5 20v-5h5v5" />
    </Svg>
  ),
  '/configuracion': () => (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
    </Svg>
  ),
}

export function IconoDe({ href }: { href: string }) {
  const dibujar = ICONOS[href]
  if (!dibujar) {
    return (
      <Svg>
        <circle cx="12" cy="12" r="7" />
      </Svg>
    )
  }
  return <>{dibujar()}</>
}
