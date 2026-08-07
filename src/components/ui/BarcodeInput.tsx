'use client'

import { forwardRef, useId, useState, type KeyboardEvent } from 'react'
import { cn } from './cn'
import { Spinner } from './Button'

/**
 * Campo de codigo de barras.
 *
 * El lector escribe aca y manda Enter. Tambien sirve para tipear o pegar un
 * codigo a mano cuando la etiqueta esta rota.
 *
 * `data-barcode-input` no es decorativo: es lo que hace que el escucha global
 * (`useBarcodeScanner`) sepa que este campo se maneja solo y no le robe las
 * teclas.
 *
 * El estado se muestra ademas del color: un tilde, una cruz, un texto. En un
 * mostrador la caja puede estar de costado y con reflejo.
 */
export type BarcodeStatus = 'idle' | 'reading' | 'ok' | 'error'

export interface BarcodeInputProps {
  onSubmit: (code: string) => void
  status?: BarcodeStatus
  /** Ultimo resultado, p. ej. "Yerba mate 1 kg agregada" o "Codigo desconocido". */
  message?: string | null
  label?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  onEditingChange?: (editing: boolean) => void
}

export const BarcodeInput = forwardRef<HTMLInputElement, BarcodeInputProps>(function BarcodeInput(
  {
    onSubmit,
    status = 'idle',
    message,
    label = 'Codigo de barras',
    placeholder = 'Escanea o escribe un codigo',
    disabled = false,
    autoFocus = false,
    className,
    onEditingChange,
  },
  ref,
) {
  const id = useId()
  const [texto, setTexto] = useState('')

  function enviar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = texto.trim()
    if (codigo === '') return
    setTexto('')
    onSubmit(codigo)
  }

  const borde = {
    idle: 'border-line',
    reading: 'border-primary',
    ok: 'border-success',
    error: 'border-danger',
  }[status]

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
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
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // En la caja el foco arranca aca a proposito: es la unica forma de
          // que el lector funcione sin un click previo, que es el requisito.
          autoFocus={autoFocus}
          value={texto}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setTexto(e.target.value)
          }}
          onKeyDown={enviar}
          onFocus={() => onEditingChange?.(true)}
          onBlur={() => onEditingChange?.(false)}
          className={cn(
            'h-control w-full rounded-md border bg-sunken pl-11 pr-11 font-mono text-base tracking-wide text-ink',
            'transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint',
            'disabled:opacity-50',
            borde,
          )}
        />

        <span className="absolute right-3.5 top-1/2 -translate-y-1/2" aria-hidden="true">
          {status === 'reading' && <Spinner className="text-primary" />}
          {status === 'ok' && <span className="text-lg leading-none text-success">✓</span>}
          {status === 'error' && <span className="text-lg leading-none text-danger">✕</span>}
        </span>
      </div>

      {/* El resultado se anuncia: quien no mira la pantalla tiene que
          enterarse de que el codigo no existia. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-4 px-1 text-xs',
          status === 'error' ? 'font-medium text-danger' : 'text-ink-faint',
        )}
      >
        {message ?? ''}
      </p>
    </div>
  )
})
