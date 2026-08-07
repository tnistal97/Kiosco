'use client'

import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from './cn'
import { Spinner } from './Button'

/**
 * Campo de busqueda.
 *
 * Trae etiqueta accesible, boton para vaciar y un indicador de que se esta
 * buscando. `role="searchbox"` no hace falta: `type="search"` ya lo declara.
 *
 * El boton de vaciar aparece solo cuando hay algo que vaciar, y es `tabIndex
 * -1` a proposito: llegar a el con Tab entre la busqueda y los resultados
 * molesta mas de lo que ayuda. Escape hace lo mismo y esta documentado.
 */
export interface SearchInputProps
  // `size` nativo de `<input>` es el ancho en caracteres, que aca no sirve
  // para nada y ademas choca con el tamanio del control.
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: string
  loading?: boolean
  onClear?: () => void
  /** Texto de ayuda debajo, p. ej. el atajo de teclado. */
  hint?: string
  size?: 'md' | 'lg'
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, loading = false, onClear, hint, className, value, size = 'md', ...rest },
  ref,
) {
  const id = useId()
  const hayTexto = typeof value === 'string' && value.length > 0

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>

        <input
          ref={ref}
          id={id}
          type="search"
          value={value}
          autoComplete="off"
          className={cn(
            'w-full rounded-md border border-line bg-sunken pl-11 pr-11 text-ink transition-colors',
            'placeholder:text-ink-faint hover:border-line-strong',
            // Chrome dibuja su propia cruz en `type=search`; sobra, porque ya
            // hay un boton de vaciar accesible.
            '[&::-webkit-search-cancel-button]:hidden',
            size === 'lg' ? 'h-control-lg text-lg' : 'h-control text-base',
            className,
          )}
          {...rest}
        />

        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center">
          {loading && <Spinner className="text-ink-faint" />}
          {!loading && hayTexto && onClear && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onClear}
              aria-label="Vaciar la busqueda"
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-raised hover:text-ink"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {hint && <p className="px-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  )
})
