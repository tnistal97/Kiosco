'use client'

import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from './cn'
import { montoDesdeTexto, textoLocalDeMonto, type Monto } from '@/lib/money'
import { REGLAS_DE_DINERO, filtrarTecleoNumerico, leerNumeroLocal } from '@/lib/numero-local'

/**
 * Campo de importe.
 *
 * Lo que se escribe se lee como en el mostrador y se muestra como en el
 * resto de la aplicacion: al salir del campo, `20000` queda `20.000,00`.
 *
 * El valor hacia afuera es TEXTO --lo que hay escrito-- mas el importe ya
 * interpretado, o `null` si todavia no es uno. La pantalla decide que hacer con
 * cada cosa; el campo nunca inventa un cero.
 *
 * Tres tamanios: el normal de los formularios, `lg` para "paga con" en el
 * cobro y `xl` para una cifra que se lee desde el otro lado del mostrador.
 */

export type MoneyInputSize = 'md' | 'lg' | 'xl'

const ALTURAS: Record<MoneyInputSize, string> = {
  md: 'h-control text-base',
  lg: 'h-control-lg text-2xl',
  xl: 'h-16 text-3xl',
}

export interface MoneyInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'size' | 'type' | 'inputMode'
> {
  /** El texto escrito, tal cual. */
  value: string
  /** El texto y, si ya es un importe, el importe. */
  onChange: (texto: string, monto: Monto | null) => void
  label: string
  /** Por omision la etiqueta solo la oye el lector de pantalla. */
  labelVisible?: boolean
  /** Clases extra para la etiqueta visible (p. ej. RECIBIDO en el cobro). */
  labelClassName?: string
  size?: MoneyInputSize
  /** Fuerza el estado de error; sin esto, se marca cuando hay texto que no es un importe. */
  invalid?: boolean
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    value,
    onChange,
    label,
    labelVisible = false,
    labelClassName,
    size = 'md',
    invalid,
    className,
    id,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const idPropio = useId()
  const idFinal = id ?? idPropio
  const lectura = leerNumeroLocal(value, REGLAS_DE_DINERO)
  const malo = invalid ?? lectura.estado === 'invalido'

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label
        htmlFor={idFinal}
        className={cn('text-sm font-semibold text-ink', labelClassName, !labelVisible && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint',
            size === 'md' ? 'text-base' : 'text-xl',
          )}
        >
          $
        </span>
        <input
          ref={ref}
          id={idFinal}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          data-numeric=""
          data-money-input=""
          aria-invalid={malo || undefined}
          value={value}
          onChange={(e) => {
            const texto = filtrarTecleoNumerico(e.target.value)
            onChange(texto, montoDesdeTexto(texto))
          }}
          onFocus={(e) => {
            // Todo seleccionado: tipear reemplaza, y editar a mano sigue
            // siendo posible con las flechas. Es lo mismo que hace el campo
            // numerico del resto de la aplicacion.
            e.currentTarget.select()
            onFocus?.(e)
          }}
          onBlur={(e) => {
            // Al salir se muestra como en el resto de la aplicacion. No antes:
            // formatear mientras se escribe mueve el cursor.
            if (lectura.estado === 'ok') {
              const monto = montoDesdeTexto(value)
              if (monto !== null) onChange(textoLocalDeMonto(monto), monto)
            }
            onBlur?.(e)
          }}
          className={cn(
            'w-full rounded-md border bg-field pr-3 pl-8 text-right font-semibold text-ink transition-colors',
            'placeholder:font-normal placeholder:text-ink-faint hover:border-ink-faint focus:border-primary',
            'disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-ink',
            malo ? 'border-danger' : 'border-line-strong',
            ALTURAS[size],
            className,
          )}
          {...rest}
        />
      </div>
    </div>
  )
})
