'use client'

import { useEffect, useId, useState } from 'react'
import { cn } from './cn'

/**
 * Cantidad de una linea del ticket.
 *
 * Reglas de la fase, y las hace cumplir este componente para que ninguna
 * pantalla tenga que acordarse:
 *
 *   - nunca cero, nunca negativo;
 *   - enteros (los productos por peso llegan en otra fase);
 *   - nunca por encima del stock disponible.
 *
 * El campo se puede vaciar mientras se escribe --si no, borrar "1" para poner
 * "12" seria imposible-- pero al salir vuelve al ultimo valor valido. El
 * estado intermedio vive aca dentro; hacia afuera solo salen cantidades
 * validas.
 */
export function QuantityInput({
  value,
  onChange,
  max,
  min = 1,
  label = 'Cantidad',
  size = 'md',
  disabled = false,
  /** Se llama al enfocar y al desenfocar: la caja lo usa para callar al escaner. */
  onEditingChange,
  className,
}: {
  value: number
  onChange: (value: number) => void
  max?: number
  min?: number
  label?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  onEditingChange?: (editing: boolean) => void
  className?: string
}) {
  const id = useId()
  const [texto, setTexto] = useState(String(value))

  // El servidor puede corregir la cantidad (stock insuficiente, restauracion
  // del carrito). Cuando eso pasa, el campo tiene que reflejarlo.
  useEffect(() => {
    setTexto(String(value))
  }, [value])

  const tope = max ?? Number.MAX_SAFE_INTEGER
  const puedeSubir = !disabled && value < tope
  const puedeBajar = !disabled && value > min

  function acotar(n: number): number {
    if (!Number.isFinite(n)) return min
    return Math.min(tope, Math.max(min, Math.trunc(n)))
  }

  function aplicar(n: number) {
    const limpio = acotar(n)
    setTexto(String(limpio))
    if (limpio !== value) onChange(limpio)
  }

  const alto = size === 'sm' ? 'h-9' : 'h-touch'
  const ancho = size === 'sm' ? 'w-9' : 'w-touch'

  const boton =
    'flex shrink-0 items-center justify-center border-line bg-raised text-ink transition-colors ' +
    'hover:bg-line disabled:opacity-40 disabled:pointer-events-none'

  return (
    <div className={cn('inline-flex items-stretch rounded-md border border-line', className)}>
      <button
        type="button"
        aria-label={`Quitar una unidad de ${label.toLowerCase()}`}
        disabled={!puedeBajar}
        onClick={() => {
          aplicar(value - 1)
        }}
        className={cn(boton, alto, ancho, 'rounded-l-md border-r')}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
        </svg>
      </button>

      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        // `pattern` mantiene el teclado numerico en movil sin heredar las
        // flechitas de `type=number`, que en un mostrador se tocan solas.
        pattern="[0-9]*"
        value={texto}
        disabled={disabled}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onFocus={(e) => {
          e.currentTarget.select()
          onEditingChange?.(true)
        }}
        onBlur={() => {
          aplicar(Number(texto))
          onEditingChange?.(false)
        }}
        onChange={(e) => {
          const crudo = e.target.value.replace(/[^0-9]/g, '')
          setTexto(crudo)
          if (crudo !== '') aplicar(Number(crudo))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            aplicar(value + 1)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            aplicar(value - 1)
          }
        }}
        className={cn(
          'w-14 border-0 bg-sunken text-center font-semibold text-ink outline-none',
          'disabled:opacity-50',
          alto,
        )}
        data-numeric=""
      />

      <button
        type="button"
        aria-label={`Agregar una unidad de ${label.toLowerCase()}`}
        disabled={!puedeSubir}
        onClick={() => {
          aplicar(value + 1)
        }}
        className={cn(boton, alto, ancho, 'rounded-r-md border-l')}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
