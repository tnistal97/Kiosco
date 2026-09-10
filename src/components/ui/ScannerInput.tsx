'use client'

import { forwardRef, useId, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'
import { Spinner } from './Button'
import type { BarcodeStatus } from './BarcodeInput'

/**
 * El campo unico del punto de venta: se escanea o se escribe, en el mismo
 * lugar.
 *
 * Reemplaza al par "campo de codigo" + "buscar por nombre" (auditoria, H-07 y
 * H-18). Los digitos son un codigo; las letras, una busqueda. Nadie tiene que
 * decidir donde escribir ni saber un atajo para cambiar de campo.
 *
 * EL LECTOR SIGUE SIENDO INSTANTANEO. `data-barcode-input` es lo que hace
 * que el escucha global (`useBarcodeScanner`) no le robe las teclas: la
 * rafaga del lector cae aca y termina en Enter, y el Enter con digitos es un
 * codigo. No hay ninguna consulta mientras se escriben digitos: la busqueda
 * por nombre solo arranca con una letra.
 *
 * Las teclas de la gramatica --flechas, Enter, Escape, Supr, mas y menos-- no
 * se interpretan aca. Este componente las anuncia y la pantalla decide, con
 * `accionDeTecla`, que significan segun lo que haya escrito y lo que haya en
 * el ticket. Devolver `true` desde `onKey` cancela el comportamiento nativo.
 */
export type TeclaDelLector =
  'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Delete' | '+' | '-'

const TECLAS = new Set<string>([
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Delete',
  '+',
  '-',
])

function teclaDe(e: KeyboardEvent<HTMLInputElement>): TeclaDelLector | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  const k = e.key === '−' ? '-' : e.key
  return TECLAS.has(k) ? (k as TeclaDelLector) : null
}

export interface ScannerInputProps {
  value: string
  onValueChange: (texto: string) => void
  /** Una tecla de la gramatica y lo que habia escrito. `true` cancela lo nativo. */
  onKey: (tecla: TeclaDelLector, texto: string) => boolean
  status?: BarcodeStatus
  /** Ultimo resultado, p. ej. "Yerba mate 1 kg · agregado". */
  message?: string | null
  /** Hay una busqueda en curso. */
  loading?: boolean
  label?: string
  placeholder?: string
  disabled?: boolean
  /** Ayuda debajo, p. ej. las teclas. */
  hint?: ReactNode
  /**
   * Dibuja el renglon de abajo --resultado y ayuda-- o no.
   *
   * El punto de venta lo apaga: esos 20 px son media fila de producto, y el
   * mismo texto va en el renglon de las secciones, que ya existe y no se
   * mueve. El anuncio para el lector de pantalla se mantiene igual.
   */
  pie?: boolean
  /** Se llama al enfocar y al desenfocar: la caja lo usa para callar al escaner global. */
  onEditingChange?: (editing: boolean) => void
  className?: string
}

export const ScannerInput = forwardRef<HTMLInputElement, ScannerInputProps>(function ScannerInput(
  {
    value,
    onValueChange,
    onKey,
    status = 'idle',
    message,
    loading = false,
    label = 'Escaneá o buscá un producto',
    placeholder = 'Escaneá o buscá un producto',
    disabled = false,
    hint,
    pie = true,
    onEditingChange,
    className,
  },
  ref,
) {
  const id = useId()
  const idAyuda = `${id}-ayuda`

  const borde = {
    idle: 'border-line focus:border-primary',
    reading: 'border-primary',
    ok: 'border-success',
    error: 'border-danger',
  }[status]

  return (
    <div className={cn('flex w-full flex-col', pie && 'gap-1', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-ink-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6v12M7.5 6v12M11 6v12M14 6v12M17 6v12M20 6v12" />
        </svg>

        <input
          ref={ref}
          id={id}
          data-barcode-input=""
          type="text"
          inputMode="text"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={hint ? idAyuda : undefined}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onValueChange(e.target.value)
          }}
          onKeyDown={(e) => {
            const tecla = teclaDe(e)
            if (tecla === null) return
            if (onKey(tecla, e.currentTarget.value)) e.preventDefault()
          }}
          onFocus={() => onEditingChange?.(true)}
          onBlur={() => onEditingChange?.(false)}
          className={cn(
            // 56 px con el dedo; 48 con el mouse, donde ese renglon de mas
            // vale una fila de producto (V3).
            'h-control-lg w-full rounded-lg border bg-sunken pr-11 pl-11 text-lg text-ink transition-colors lg:h-12',
            'placeholder:text-ink-faint hover:border-line-strong disabled:opacity-50',
            borde,
          )}
        />

        <span className="absolute top-1/2 right-3.5 -translate-y-1/2" aria-hidden="true">
          {(status === 'reading' || loading) && <Spinner className="text-primary" />}
          {status === 'ok' && !loading && (
            <span className="text-lg leading-none text-success">✓</span>
          )}
          {status === 'error' && !loading && (
            <span className="text-lg leading-none text-danger">✕</span>
          )}
        </span>
      </div>

      {/* El resultado se anuncia: quien no mira la pantalla tiene que
          enterarse de que el codigo no existia. */}
      {pie ? (
        <div className="flex min-h-4 items-baseline justify-between gap-3 px-1">
          <p
            role="status"
            aria-live="polite"
            className={cn(
              'min-w-0 truncate text-xs',
              status === 'error' ? 'font-medium text-danger' : 'text-ink-faint',
            )}
          >
            {message ?? ''}
          </p>
          {hint && (
            <p id={idAyuda} className="hidden shrink-0 text-xs text-ink-faint lg:block">
              {hint}
            </p>
          )}
        </div>
      ) : (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            {message ?? ''}
          </p>
          {hint && (
            <p id={idAyuda} className="sr-only">
              {hint}
            </p>
          )}
        </>
      )}
    </div>
  )
})
