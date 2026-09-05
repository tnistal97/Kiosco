import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Cabecera operativa de una pantalla. UX V2, Fase 2.
 *
 * Una linea que responde "donde estoy, en que estado esta esto y que puedo
 * hacer ahora": titulo, una descripcion corta, un estado opcional al lado del
 * titulo y las acciones a la derecha. En un telefono las acciones bajan
 * debajo del titulo y ocupan el ancho entero, que es donde llega el pulgar.
 *
 * Es la misma cabecera para la caja, la apertura y el cierre: la forma se
 * aprende una sola vez. El punto de venta no la usa --ahi cada pixel vertical
 * es un producto visible-- y esa ausencia es deliberada.
 *
 * El titulo es un `h2`: el `h1` de cada pantalla lo pone el armazon con el
 * nombre de la seccion ("Caja"), y dos `h1` en la misma pagina es una falta
 * que axe ya encontro una vez.
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  /** Un distintivo al lado del titulo: "Abierta", "Cerrada". */
  status?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h2>
          {status}
        </div>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">{actions}</div>
      )}
    </header>
  )
}
