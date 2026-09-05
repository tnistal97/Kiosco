'use client'

import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from './cn'
import { formatearMonto, montoDesdeTexto, type Monto } from '@/lib/money'

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

/**
 * Lo que alguien escribe, convertido a importe.
 *
 * Acepta todo lo que acepta `montoDesdeTexto` y ademas `"15.000"` --punto de
 * miles sin decimales--, que es como se escribe quince mil en Argentina y que
 * aquella funcion rechaza porque no puede distinguirlo de tres decimales. Aca
 * se puede: un importe de tres decimales no existe en una caja.
 */
export function montoDesdeTextoLocal(entrada: string): Monto | null {
  const limpio = entrada.trim()
  if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) return montoDesdeTexto(limpio.replace(/\./g, ''))
  return montoDesdeTexto(limpio)
}

/** `"1234.56"` → `"1.234,56"`: como se ve, sin el simbolo. */
export function textoLocalDeMonto(m: Monto): string {
  return formatearMonto(m)
    .replace(/^-?\$\s?/, '')
    .trim()
}

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
    size = 'md',
    invalid,
    className,
    id,
    onBlur,
    ...rest
  },
  ref,
) {
  const idPropio = useId()
  const idFinal = id ?? idPropio
  const malo = invalid ?? (value.trim() !== '' && montoDesdeTextoLocal(value) === null)

  return (
    <div className="flex w-full flex-col gap-1.5">
      <label
        htmlFor={idFinal}
        className={cn('text-sm font-medium text-ink-muted', !labelVisible && 'sr-only')}
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
            const texto = e.target.value.replace(/[^0-9.,]/g, '')
            onChange(texto, montoDesdeTextoLocal(texto))
          }}
          onBlur={(e) => {
            // Al salir se muestra como en el resto de la aplicacion. No antes:
            // formatear mientras se escribe mueve el cursor.
            const monto = montoDesdeTextoLocal(value)
            if (monto !== null && value.trim() !== '') onChange(textoLocalDeMonto(monto), monto)
            onBlur?.(e)
          }}
          className={cn(
            'w-full rounded-md border bg-sunken pr-3 pl-8 text-right font-semibold text-ink transition-colors',
            'placeholder:font-normal placeholder:text-ink-faint hover:border-line-strong focus:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            malo ? 'border-danger' : 'border-line',
            ALTURAS[size],
            className,
          )}
          {...rest}
        />
      </div>
    </div>
  )
})
