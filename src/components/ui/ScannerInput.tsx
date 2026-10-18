'use client'

import { forwardRef, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
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

/**
 * Teclas que NO se repiten al dejarlas apretadas (UX V5).
 *
 * Un Enter o un + sostenido disparaba la accion treinta veces por segundo:
 * treinta unidades de mas, o un cobro abierto y confirmado sin querer. Un
 * lector nunca manda una tecla repetida --cada caracter es una pulsacion
 * nueva--, asi que ignorar la repeticion no lo afecta. Las flechas si se
 * repiten: recorrer una lista larga dejando la flecha apretada es normal.
 */
const SIN_REPETICION = new Set<TeclaDelLector>(['Enter', '+', '-', 'Delete'])

/**
 * Un lector que escribe ENCIMA de lo que habia.
 *
 * Si alguien tenia "coc" escrito y pasa un producto por el lector, el campo
 * queda "coc7790001000011" y eso, para la gramatica, es una busqueda por
 * nombre: el codigo se perdia. Los lectores USB escriben cada caracter con
 * pocos milisegundos de diferencia; una persona, no. Si los ultimos digitos
 * llegaron en rafaga, son un codigo leido.
 */
const DIGITOS_MINIMOS_DE_RAFAGA = 6
const PAUSA_MAXIMA_DE_RAFAGA_MS = 40
/**
 * Entre un digito escrito a mano y el primero del lector pasa, como minimo,
 * el tiempo de agarrar el lector. Un lector que se traba en medio de una
 * lectura tarda bastante menos.
 */
const PAUSA_DE_PERSONA_MS = 250
/** Cuantas teclas recientes se recuerdan para separar lo escrito de lo leido. */
const TECLAS_RECORDADAS = 64

/** Un EAN-8, UPC-A, EAN-13 o GTIN-14 con su digito verificador correcto. */
function esGtin(digitos: string): boolean {
  if (![8, 12, 13, 14].includes(digitos.length) || !/^[0-9]+$/.test(digitos)) return false
  let suma = 0
  for (let i = digitos.length - 2, peso = 3; i >= 0; i--, peso = 4 - peso) {
    suma += Number(digitos[i]) * peso
  }
  return (10 - (suma % 10)) % 10 === Number(digitos[digitos.length - 1])
}

interface Tecla {
  t: number
  c: string
}

/**
 * Que parte de los digitos del final paso el lector.
 *
 * `digitos` son todos los digitos con que termina el campo; los ultimos
 * `enRafaga` llegaron a velocidad de lector. Si hay digitos ANTES de la
 * rafaga, pueden ser dos cosas:
 *
 *   - la misma lectura, cortada porque la computadora se trabo unos
 *     milisegundos: el codigo es todo;
 *   - numeros que la persona escribio antes de pasar el producto ("500",
 *     "agua 500"): el codigo es solo la rafaga.
 *
 * Se decide por como se escribieron esos digitos (a ritmo de persona, o
 * pegados al lector) y, si no alcanza, por cual de las dos opciones es un
 * codigo de barras valido. Solo se separan si esos digitos se escribieron
 * en este campo y se sabe cuando: ante la duda, el codigo es todo, como
 * siempre.
 */
function codigoLeido(digitos: string, enRafaga: number, teclas: readonly Tecla[]): string {
  const antes = digitos.length - enRafaga
  if (antes <= 0 || enRafaga <= 0) return digitos
  const previas = teclas.slice(-(enRafaga + antes), -enRafaga)
  const primera = teclas[teclas.length - enRafaga]
  const sabidas =
    primera !== undefined &&
    previas.length === antes &&
    previas.map((t) => t.c).join('') === digitos.slice(0, antes)
  if (!sabidas) return digitos

  const ultimaPrevia = previas[previas.length - 1]
  const aMano =
    ultimaPrevia !== undefined &&
    primera.t - ultimaPrevia.t > PAUSA_DE_PERSONA_MS &&
    previas.every((t, i) => {
      const anterior = previas[i - 1]
      return anterior === undefined || t.t - anterior.t > PAUSA_MAXIMA_DE_RAFAGA_MS
    })
  const rafaga = digitos.slice(-enRafaga)
  const porElVerificador = !esGtin(digitos) && esGtin(rafaga)
  return aMano || porElVerificador ? rafaga : digitos
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
  /** Pulsaciones imprimibles recientes y seguidas, para reconocer un lector. */
  const rafagaRef = useRef<Tecla[]>([])
  /** Las ultimas pulsaciones imprimibles, seguidas o no. */
  const teclasRef = useRef<Tecla[]>([])
  const idAyuda = `${id}-ayuda`

  const borde = {
    idle: 'border-line-strong focus:border-primary',
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
            const ahora = performance.now()
            const rafaga = rafagaRef.current
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
              const anterior = rafaga[rafaga.length - 1]
              const seguido =
                anterior !== undefined && ahora - anterior.t <= PAUSA_MAXIMA_DE_RAFAGA_MS
              rafagaRef.current = seguido ? [...rafaga, { t: ahora, c: e.key }] : [{ t: ahora, c: e.key }] // prettier-ignore
              teclasRef.current = [...teclasRef.current, { t: ahora, c: e.key }].slice(
                -TECLAS_RECORDADAS,
              )
            } else if (e.key !== 'Enter' && e.key !== 'Shift') {
              // Borrar o mover el cursor: lo recordado ya no coincide con el
              // texto del campo.
              rafagaRef.current = []
              teclasRef.current = []
            }

            const tecla = teclaDe(e)
            if (tecla === null) return
            if (e.repeat && SIN_REPETICION.has(tecla)) {
              e.preventDefault()
              return
            }

            const valor = e.currentTarget.value
            if (tecla === 'Enter') {
              // La rafaga es la PRUEBA de que paso un lector: los ultimos
              // digitos llegaron juntos, como solo los manda un lector.
              const caracteres = rafagaRef.current.map((r) => r.c)
              let desde = caracteres.length
              while (desde > 0 && /[0-9]/.test(caracteres[desde - 1] ?? '')) desde--
              const enRafaga = caracteres.length - desde
              const teclas = teclasRef.current
              rafagaRef.current = []
              teclasRef.current = []
              const paseUnLector = enRafaga >= DIGITOS_MINIMOS_DE_RAFAGA
              // El CODIGO son los digitos del final del campo, no solo los de
              // la ultima rafaga: si la computadora se trabo unos milisegundos
              // en medio de la lectura, la rafaga se corta pero el codigo sigue
              // entero en el campo. Salvo que esos digitos de mas los haya
              // escrito la persona antes de pasar el producto.
              const digitos = /[0-9]+$/.exec(valor)?.[0] ?? ''
              const leido = paseUnLector ? codigoLeido(digitos, enRafaga, teclas) : digitos
              const antes = valor.slice(0, valor.length - leido.length)
              // Habia algo escrito antes de la lectura: TEXTO ("coc") o
              // numeros escritos a mano ("500"). Si no habia nada, es una
              // lectura comun y va por el camino de siempre.
              const habiaAlgo = /[^0-9\s]/.test(antes) || leido !== digitos
              if (paseUnLector && habiaAlgo && leido.length >= enRafaga) {
                // Se procesa el codigo y se devuelve lo que la persona habia
                // escrito antes, como estaba.
                e.preventDefault()
                onKey('Enter', leido)
                onValueChange(antes)
                return
              }
            }
            if (onKey(tecla, valor)) e.preventDefault()
          }}
          onFocus={() => onEditingChange?.(true)}
          onBlur={() => {
            // Las teclas recordadas NO se olvidan al salir: tocar una
            // categoria saca el foco un instante y lo devuelve, y lo escrito
            // sigue en el campo. Si mientras tanto el texto cambio por otro
            // lado, ya no coinciden con el y `codigoLeido` no las usa.
            rafagaRef.current = []
            onEditingChange?.(false)
          }}
          className={cn(
            // 56 px con el dedo; 48 con el mouse, donde ese renglon de mas
            // vale una fila de producto (V3).
            'h-control-lg w-full rounded-lg border bg-field pr-11 pl-11 text-lg text-ink transition-colors',
            'placeholder:text-ink-faint hover:border-ink-faint disabled:bg-disabled-bg disabled:text-disabled-ink',
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
