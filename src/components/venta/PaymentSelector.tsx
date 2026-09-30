'use client'

import { Kbd, cn } from '@/components/ui'
import {
  MEDIOS_COBRABLES,
  etiquetaDeMedio,
  type MedioCobrable,
} from '@/modules/sales/payment-methods'

/**
 * Los medios de pago como botones grandes, no como un `select`.
 *
 * Es lo que la auditoria pedia en H-16: un toque o una letra por medio, sin
 * abrir un desplegable. Cada boton muestra su tecla; la letra la interpreta el
 * dialogo de cobro, no este componente, porque tambien tiene que funcionar
 * mientras se escribe con cuanto paga.
 *
 * Es un `radiogroup` de verdad: un lector de pantalla anuncia "Efectivo,
 * seleccionado, 1 de 6", y las flechas recorren el grupo como en cualquier
 * grupo de opciones.
 */
export const TECLA_DE_MEDIO: Record<MedioCobrable, string> = {
  CASH: 'E',
  DEBIT_CARD: 'D',
  CREDIT_CARD: 'R',
  TRANSFER: 'T',
  MERCADO_PAGO: 'M',
  ACCOUNT: 'F',
  OTHER: 'O',
}

/** El medio que corresponde a una letra, o null. */
export function medioDeTecla(tecla: string): MedioCobrable | null {
  const letra = tecla.toUpperCase()
  for (const medio of MEDIOS_COBRABLES) {
    if (TECLA_DE_MEDIO[medio] === letra) return medio
  }
  return null
}

/** "Fiado" en el boton --que es como se dice en el mostrador-- y "A cuenta" en el libro. */
function etiquetaCorta(medio: MedioCobrable): string {
  return medio === 'ACCOUNT' ? 'Fiado' : etiquetaDeMedio(medio)
}

export function PaymentSelector({
  value,
  onChange,
  disabled = false,
  label = 'Cómo paga',
  compacto = false,
  className,
}: {
  value: MedioCobrable
  onChange: (medio: MedioCobrable) => void
  disabled?: boolean
  label?: string
  /** Botones mas bajos, para un renglon de pago dividido. */
  compacto?: boolean
  className?: string
}) {
  function alPresionar(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (delta === 0) return
    e.preventDefault()
    const i = MEDIOS_COBRABLES.indexOf(value)
    const siguiente =
      MEDIOS_COBRABLES[(i + delta + MEDIOS_COBRABLES.length) % MEDIOS_COBRABLES.length]
    if (siguiente) {
      onChange(siguiente)
      const boton = e.currentTarget.querySelector<HTMLButtonElement>(`[data-medio="${siguiente}"]`)
      boton?.focus()
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={alPresionar}
      className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7', className)}
    >
      {MEDIOS_COBRABLES.map((medio) => {
        const activo = medio === value
        return (
          <button
            key={medio}
            type="button"
            role="radio"
            aria-checked={activo}
            data-medio={medio}
            tabIndex={activo ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              onChange(medio)
            }}
            className={cn(
              'flex min-h-touch flex-col items-center justify-center gap-0.5 rounded-lg border px-2 text-sm font-medium transition-colors',
              compacto ? 'py-1.5' : 'py-2.5',
              activo
                ? 'border-primary bg-primary-quiet text-ink'
                : 'border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink',
              'disabled:pointer-events-none disabled:opacity-45',
            )}
          >
            <span>{etiquetaCorta(medio)}</span>
            {!compacto && <Kbd>{TECLA_DE_MEDIO[medio]}</Kbd>}
          </button>
        )
      })}
    </div>
  )
}
