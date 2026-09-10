'use client'

import { cn } from '@/components/ui'
import type { ModoDeVenta } from './useModoDeVenta'

/**
 * Como se vende en este equipo: con el lector, o buscando por nombre.
 *
 * Dos opciones, siempre las dos a la vista y siempre en el mismo lugar. No es
 * un menu ni una configuracion escondida: es lo primero que hay que decidir
 * en una caja nueva, y se cambia en un toque.
 *
 * EL PUNTO VERDE ES LA UNICA SENIAL DE "LECTOR ACTIVO". No hay banner ni
 * cartel: en modo lector, el punto esta encendido y parpadea al leer un
 * codigo. Es el equivalente visual del pitido del lector, para el que
 * trabaja con el sonido apagado.
 *
 * El lector funciona en LOS DOS modos: esto no lo enciende ni lo apaga, dice
 * que espera la caja. Ver `useModoDeVenta`.
 */
export function SelectorDeModo({
  modo,
  onModo,
  /** Acaba de leerse un codigo: el punto se enciende un instante. */
  leyendo = false,
  className,
}: {
  modo: ModoDeVenta
  onModo: (modo: ModoDeVenta) => void
  leyendo?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Modo de venta"
      className={cn(
        'flex shrink-0 rounded-lg border border-line bg-sunken p-0.5 text-sm',
        className,
      )}
    >
      <Opcion
        activa={modo === 'lector'}
        onClick={() => {
          onModo('lector')
        }}
        etiqueta="Vender con el lector de códigos"
      >
        <span
          aria-hidden="true"
          className={cn(
            'text-[0.6rem] leading-none transition-colors',
            modo === 'lector' ? (leyendo ? 'text-success' : 'text-success/70') : 'text-ink-faint',
          )}
        >
          ●
        </span>
        Lector
      </Opcion>
      <Opcion
        activa={modo === 'nombre'}
        onClick={() => {
          onModo('nombre')
        }}
        etiqueta="Vender buscando el producto por nombre"
      >
        Nombre
      </Opcion>
    </div>
  )
}

function Opcion({
  activa,
  onClick,
  etiqueta,
  children,
}: {
  activa: boolean
  onClick: () => void
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      aria-label={etiqueta}
      onClick={onClick}
      className={cn(
        // 44 px con el dedo, 36 con el mouse: el mismo componente sirve para
        // los dos porque cada copia solo se ve en su ancho.
        'flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-md px-3 whitespace-nowrap transition-colors sm:min-h-9',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        // El activo se marca como el chip de seccion activa: mismo idioma en
        // toda la pantalla, y con borde ademas de color.
        activa
          ? 'border border-primary bg-primary-quiet font-medium text-ink'
          : 'border border-transparent text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
