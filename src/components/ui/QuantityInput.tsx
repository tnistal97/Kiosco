'use client'

import { useEffect, useId, useState } from 'react'
import { cn } from './cn'
import { aMilesimas, cantidadDesdeTexto, desdeMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { formatearCantidad, politicaDe, type UnidadDeVenta } from '@/modules/products/units'

/**
 * Cantidad de una linea del ticket.
 *
 * Reglas de la fase, y las hace cumplir este componente para que ninguna
 * pantalla tenga que acordarse:
 *
 *   - nunca cero, nunca negativo;
 *   - el paso y los decimales los decide LA UNIDAD del producto: enteros en
 *     `UNIT`, `G` y `ML`; de a milesima en `KG` y `L`;
 *   - nunca por encima del stock disponible.
 *
 * La politica no vive aca: vive en `@/modules/products/units` y la comparte
 * con el servidor. Este componente solo la aplica. Si estuviera duplicada,
 * `1.235 UNIT` entraria por un lado o por el otro.
 *
 * El campo se puede vaciar mientras se escribe --si no, borrar "1" para poner
 * "12" seria imposible-- pero al salir vuelve al ultimo valor valido. El
 * estado intermedio vive aca dentro; hacia afuera solo salen cantidades
 * validas.
 */
export function QuantityInput({
  value,
  onChange,
  unit = 'UNIT',
  max,
  label = 'Cantidad',
  size = 'md',
  disabled = false,
  /** Se llama al enfocar y al desenfocar: la caja lo usa para callar al escaner. */
  onEditingChange,
  className,
}: {
  value: TextoCantidad
  onChange: (value: TextoCantidad) => void
  unit?: UnidadDeVenta
  max?: TextoCantidad
  label?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  onEditingChange?: (editing: boolean) => void
  className?: string
}) {
  const id = useId()
  const politica = politicaDe(unit)
  const [texto, setTexto] = useState(() => formatearCantidad(value, unit))

  // El servidor puede corregir la cantidad (stock insuficiente, restauracion
  // del carrito). Cuando eso pasa, el campo tiene que reflejarlo.
  useEffect(() => {
    setTexto(formatearCantidad(value, unit))
  }, [value, unit])

  const paso = aMilesimas(politica.paso)
  const minimo = aMilesimas(politica.minimo)
  const tope = max === undefined ? Number.MAX_SAFE_INTEGER : aMilesimas(max)
  const actual = aMilesimas(value)

  const puedeSubir = !disabled && actual < tope
  const puedeBajar = !disabled && actual > minimo

  /** Al multiplo de paso mas cercano, dentro del rango. */
  function acotar(milesimas: number): number {
    if (!Number.isFinite(milesimas)) return minimo
    const enPaso = Math.round(milesimas / paso) * paso
    return Math.min(tope, Math.max(minimo, enPaso))
  }

  function aplicar(milesimas: number) {
    const limpio = acotar(milesimas)
    setTexto(formatearCantidad(desdeMilesimas(limpio), unit))
    if (limpio !== actual) onChange(desdeMilesimas(limpio))
  }

  // "Agregar una unidad de cantidad" en un producto que se cuenta, "Agregar
  // 0,001 kg de cantidad" en uno que se pesa. Un lector de pantalla que diga
  // "agregar uno coma cero cero cero" no le sirve a nadie.
  const deAPaso = politica.decimales === 0 ? 'una unidad' : `${politica.paso} ${politica.simbolo}`

  const alto = size === 'sm' ? 'h-9' : 'h-touch'
  const ancho = size === 'sm' ? 'w-9' : 'w-touch'

  const boton =
    'flex shrink-0 items-center justify-center border-line bg-raised text-ink transition-colors ' +
    'hover:bg-line disabled:opacity-40 disabled:pointer-events-none'

  return (
    <div className={cn('inline-flex items-stretch rounded-md border border-line', className)}>
      <button
        type="button"
        aria-label={`Quitar ${deAPaso} de ${label.toLowerCase()}`}
        disabled={!puedeBajar}
        onClick={() => {
          aplicar(actual - paso)
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
        inputMode="decimal"
        // `pattern` mantiene el teclado numerico en movil sin heredar las
        // flechitas de `type=number`, que en un mostrador se tocan solas. Con
        // decimales entran tambien la coma y el punto.
        pattern={politica.decimales === 0 ? '[0-9]*' : '[0-9.,]*'}
        value={texto}
        disabled={disabled}
        /**
         * `spinbutton` es el rol que corresponde: un numero que se sube y se
         * baja de a un paso, con un minimo y un maximo.
         *
         * Sin el, `aria-valuenow` y compania eran atributos ilegales sobre un
         * `textbox` --axe lo marcaba como falta critica-- y encima no se
         * anunciaban. El campo diria "1" y no "1, minimo 1, maximo 23".
         *
         * El rol se declara a mano en vez de usar `type="number"` porque las
         * flechitas nativas, en una pantalla tactil de mostrador, se tocan
         * solas. Las flechas del teclado si funcionan, mas abajo.
         *
         * `aria-valuetext` lleva la unidad: sin el, un lector de pantalla
         * anuncia "cero coma cuatro dos cinco" y no "0,425 kilogramos".
         */
        role="spinbutton"
        aria-valuenow={aMilesimas(value) / 1000}
        aria-valuemin={minimo / 1000}
        aria-valuemax={max === undefined ? undefined : tope / 1000}
        aria-valuetext={`${formatearCantidad(value, unit)} ${politica.simbolo}`}
        onFocus={(e) => {
          e.currentTarget.select()
          onEditingChange?.(true)
        }}
        onBlur={() => {
          const parseada = cantidadDesdeTexto(texto)
          aplicar(parseada === null ? actual : aMilesimas(parseada))
          onEditingChange?.(false)
        }}
        onChange={(e) => {
          // Se filtra lo que no puede formar parte de un numero, y la coma o
          // el punto solo cuando la unidad admite decimales. Asi, en un
          // producto por unidad, tipear una coma simplemente no hace nada en
          // vez de dejar escribir algo que despues se va a rechazar.
          const permitido = politica.decimales === 0 ? /[^0-9]/g : /[^0-9.,]/g
          const crudo = e.target.value.replace(permitido, '')
          setTexto(crudo)

          const parseada = cantidadDesdeTexto(crudo)
          if (parseada !== null) {
            const milesimas = acotar(aMilesimas(parseada))
            if (milesimas !== actual) onChange(desdeMilesimas(milesimas))
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            aplicar(actual + paso)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            aplicar(actual - paso)
          }
        }}
        className={cn(
          'border-0 bg-sunken text-center font-semibold text-ink outline-none',
          politica.decimales === 0 ? 'w-14' : 'w-20',
          'disabled:opacity-50',
          alto,
        )}
        data-numeric=""
      />

      <button
        type="button"
        aria-label={`Agregar ${deAPaso} de ${label.toLowerCase()}`}
        disabled={!puedeSubir}
        onClick={() => {
          aplicar(actual + paso)
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
