'use client'

import { Money, StockBadge, cn } from '@/components/ui'
import type { Product } from '@/hooks/useProducts'

/**
 * Una fila de resultado de busqueda.
 *
 * Es un `button`, no un `div` con `onClick`: asi se llega con Tab, se
 * activa con Enter y un lector de pantalla lo anuncia como lo que es.
 *
 * `resaltada` marca el resultado seleccionado con el teclado. Se marca con
 * borde y fondo, no solo con color, porque es la fila que Enter va a agregar
 * y equivocarse ahi cuesta una linea de mas en el ticket.
 */
export function ResultadoBusqueda({
  producto,
  resaltada,
  onAgregar,
  onHover,
}: {
  producto: Product
  resaltada: boolean
  onAgregar: () => void
  onHover: () => void
}) {
  const agotado = producto.totalStock <= 0

  return (
    <li>
      <button
        type="button"
        disabled={agotado}
        onClick={onAgregar}
        onMouseEnter={onHover}
        // El foco lo maneja el buscador: mover el foco real a cada resultado
        // sacaria el cursor del campo y cortaria el escaneo.
        tabIndex={-1}
        aria-current={resaltada || undefined}
        className={cn(
          'flex w-full min-h-touch items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
          agotado && 'cursor-not-allowed opacity-55',
          resaltada
            ? 'border-primary bg-primary-quiet'
            : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{producto.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-faint">
            <span>{producto.category.name}</span>
            {producto.barcode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{producto.barcode}</span>
              </>
            )}
          </p>
        </div>

        <StockBadge quantity={producto.totalStock} />
        <Money amount={producto.price} size="lg" className="w-28 text-right" />
      </button>
    </li>
  )
}
