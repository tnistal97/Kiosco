'use client'

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from './cn'

/**
 * Campos de formulario.
 *
 * `Field` reparte un identificador a la etiqueta, al control, al texto de
 * ayuda y al mensaje de error, y arma el `aria-describedby`. Un campo
 * declarado con `Field` no puede quedarse sin etiqueta: es el motivo de que
 * exista.
 */

interface CtxCampo {
  id: string
  idAyuda: string
  idError: string
  tieneAyuda: boolean
  tieneError: boolean
  requerido: boolean
}

const Ctx = createContext<CtxCampo | null>(null)

function useCampo(): CtxCampo | null {
  return useContext(Ctx)
}

export interface FieldProps {
  label: string
  /** Oculta la etiqueta visualmente. Sigue existiendo para el lector de pantalla. */
  labelHidden?: boolean
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: ReactNode
}

export function Field({
  label,
  labelHidden = false,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const base = useId()
  const ctx: CtxCampo = {
    id: `${base}-control`,
    idAyuda: `${base}-hint`,
    idError: `${base}-error`,
    tieneAyuda: hint !== undefined && hint !== null,
    tieneError: Boolean(error),
    requerido: required,
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label
          htmlFor={ctx.id}
          className={cn(
            'text-sm font-medium text-ink-muted',
            labelHidden && 'sr-only', // sigue asociada, solo no se ve
          )}
        >
          {label}
          {required && (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>

        {children}

        {hint && !error && (
          <p id={ctx.idAyuda} className="text-xs text-ink-faint">
            {hint}
          </p>
        )}
        {error && (
          <p id={ctx.idError} role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </Ctx.Provider>
  )
}

const CONTROL =
  'w-full rounded-md border bg-sunken px-3 text-ink transition-colors ' +
  'placeholder:text-ink-faint disabled:opacity-50 disabled:cursor-not-allowed ' +
  'hover:border-line-strong'

/** Atributos que salen del contexto de `Field`, para no repetirlos en cada control. */
function atributosDe(ctx: CtxCampo | null, propios: { id?: string }) {
  if (!ctx) return propios
  const describe = [ctx.tieneError ? ctx.idError : null, ctx.tieneAyuda ? ctx.idAyuda : null]
    .filter(Boolean)
    .join(' ')
  return {
    id: propios.id ?? ctx.id,
    'aria-invalid': ctx.tieneError || undefined,
    'aria-describedby': describe || undefined,
    'aria-required': ctx.requerido || undefined,
  }
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  const ctx = useCampo()
  const malo = invalid ?? ctx?.tieneError ?? false
  return (
    <input
      ref={ref}
      className={cn(CONTROL, 'h-control', malo ? 'border-danger' : 'border-line', className)}
      {...atributosDe(ctx, rest)}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref) {
  const ctx = useCampo()
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        CONTROL,
        'resize-y py-2.5',
        ctx?.tieneError ? 'border-danger' : 'border-line',
        className,
      )}
      {...atributosDe(ctx, rest)}
      {...rest}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  const ctx = useCampo()
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          CONTROL,
          'h-control appearance-none pr-9',
          ctx?.tieneError ? 'border-danger' : 'border-line',
          className,
        )}
        {...atributosDe(ctx, rest)}
        {...rest}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
    </div>
  )
})

/**
 * Casilla de verificacion.
 *
 * La etiqueta envuelve al control, asi que el area sensible es toda la linea
 * y no solo el cuadradito de 16 px.
 */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: { label: ReactNode; description?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label
      className={cn(
        'flex min-h-touch cursor-pointer select-none items-start gap-3 rounded-md px-1 py-2',
        'hover:bg-raised',
        rest.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded-xs border border-line-strong bg-sunken accent-primary"
        {...rest}
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{label}</span>
        {description && <span className="text-xs text-ink-faint">{description}</span>}
      </span>
    </label>
  )
}

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

/**
 * Grupo de opciones exclusivas.
 *
 * Es un `fieldset` con `legend` de verdad, no un `div` con botones: es lo que
 * hace que un lector de pantalla anuncie "opcion 2 de 4".
 */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  columns = 1,
  className,
}: {
  legend: string
  name: string
  value: T | null
  onChange: (value: T) => void
  options: ReadonlyArray<RadioOption<T>>
  columns?: 1 | 2 | 3
  className?: string
}) {
  const grilla = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }[columns]

  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)}>
      <legend className="mb-1.5 text-sm font-medium text-ink-muted">{legend}</legend>
      <div className={cn('grid gap-2', grilla)}>
        {options.map((op) => {
          const activo = value === op.value
          return (
            <label
              key={op.value}
              className={cn(
                'flex min-h-touch cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors',
                activo
                  ? 'border-primary bg-primary-quiet text-ink'
                  : 'border-line bg-sunken text-ink-muted hover:border-line-strong hover:text-ink',
                op.disabled && 'cursor-not-allowed opacity-45',
              )}
            >
              <input
                type="radio"
                name={name}
                value={op.value}
                checked={activo}
                disabled={op.disabled}
                onChange={() => {
                  onChange(op.value)
                }}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{op.label}</span>
                {/*
                  `text-ink-muted` y no `text-ink-faint`.

                  El faint es legible sobre el fondo hundido de la opcion sin
                  elegir, pero NO sobre `bg-primary-quiet`, que es el de la
                  elegida: axe lo marca como falta seria de contraste. Se usa el
                  mismo tono en las dos para que la descripcion no cambie de
                  legibilidad segun este seleccionada o no.
                */}
                {op.description && (
                  <span className="truncate text-xs text-ink-muted">{op.description}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
