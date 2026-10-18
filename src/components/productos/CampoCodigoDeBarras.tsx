'use client'

import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/components/ui'
import { apiRequest, ApiError } from '@/lib/api-client'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'
import { parseProducto } from '@/modules/products/dto'

/**
 * El codigo de barras de un producto. UX V5.
 *
 * Se puede escribir a mano o escanear con un lector USB, que para la
 * computadora es un teclado: escribe el codigo muy rapido y manda Enter. Por
 * eso:
 *
 *  - Enter en este campo NO guarda el formulario: confirma el codigo,
 *    muestra "✓ Código detectado" y pasa el foco a lo que sigue (Guardar).
 *  - Un codigo que entro de golpe --una rafaga de teclas, aunque el lector no
 *    mande Enter-- tambien se confirma solo.
 *  - Si el codigo ya es de otro producto se avisa ANTES de guardar, con el
 *    nombre de ese producto. El servidor lo rechazaria igual (409), pero
 *    enterarse al final, con el producto en la mano, es peor.
 *
 * No hace falta configurar nada en el lector: cualquier lector que funcione
 * como teclado sirve.
 */

type Estado =
  | { tipo: 'nada' }
  | { tipo: 'detectado' }
  | { tipo: 'repetido'; nombre: string }
  | { tipo: 'invalido'; motivo: string }

/** Teclas que llegan mas juntas que esto son de un lector, no de una persona. */
const PAUSA_DE_LECTOR_MS = 40
const LARGO_MINIMO_DE_RAFAGA = 6

export const CampoCodigoDeBarras = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (codigo: string) => void
    /** El producto que se esta editando: su propio codigo no es "repetido". */
    productoId?: number | null
    deshabilitado?: boolean
    /** El codigo quedo confirmado (Enter o escaneo): se pasa al paso siguiente. */
    onConfirmado?: () => void
  }
>(function CampoCodigoDeBarras(
  { value, onChange, productoId = null, deshabilitado = false, onConfirmado },
  ref,
) {
  const id = useId()
  const idAyuda = `${id}-ayuda`
  const idEstado = `${id}-estado`
  const [estado, setEstado] = useState<Estado>({ tipo: 'nada' })
  const teclas = useRef<number[]>([])
  const consulta = useRef(0)
  /**
   * UN solo reloj para la rafaga sin Enter, que se reinicia con cada tecla, y
   * el texto al dia. Con un reloj por tecla, el primero que vencia confirmaba
   * el codigo como estaba en ESE momento: le faltaban los ultimos digitos.
   */
  const reloj = useRef<number | null>(null)
  const ultimoTexto = useRef('')

  useEffect(
    () => () => {
      if (reloj.current !== null) window.clearTimeout(reloj.current)
    },
    [],
  )

  // Si el codigo cambia desde afuera (se abre otro producto), el aviso viejo
  // no sigue en pantalla.
  useEffect(() => {
    if (value === '') setEstado({ tipo: 'nada' })
  }, [value])

  async function confirmar(crudo: string, avanzar: boolean) {
    const codigo = normalizarCodigo(crudo)
    if (codigo === '') {
      setEstado({ tipo: 'nada' })
      return
    }
    if (codigo !== crudo) onChange(codigo)
    const roto = motivoDeCodigoInvalido(codigo)
    if (roto !== null) {
      setEstado({ tipo: 'invalido', motivo: roto })
      return
    }
    setEstado({ tipo: 'detectado' })
    if (avanzar) onConfirmado?.()

    const esta = ++consulta.current
    try {
      const otro = await apiRequest(
        `/api/products/barcode/${encodeURIComponent(codigo)}?estado=todos`,
        { parse: parseProducto },
      )
      if (esta !== consulta.current) return
      if (otro.id !== productoId) setEstado({ tipo: 'repetido', nombre: otro.name })
    } catch (err) {
      // 404: nadie lo tiene, que es lo esperable. Cualquier otro error no
      // cambia nada: al guardar, el servidor vuelve a comprobarlo.
      if (!(err instanceof ApiError)) return
    }
  }

  const borde = {
    nada: 'border-line-strong',
    detectado: 'border-success',
    repetido: 'border-warning',
    invalido: 'border-danger',
  }[estado.tipo]

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        Código de barras
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
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-campo-codigo=""
          value={value}
          disabled={deshabilitado}
          placeholder="Escaneá o escribí el código"
          aria-describedby={`${idAyuda} ${idEstado}`}
          aria-invalid={estado.tipo === 'invalido' || undefined}
          onChange={(e) => {
            const nuevo = e.target.value
            ultimoTexto.current = nuevo
            onChange(nuevo)
            if (estado.tipo !== 'nada') setEstado({ tipo: 'nada' })
            // Una rafaga sin Enter: algunos lectores no lo mandan.
            const t = teclas.current
            const rafaga =
              t.length >= LARGO_MINIMO_DE_RAFAGA &&
              t.slice(1).every((ms, i) => ms - (t[i] ?? ms) <= PAUSA_DE_LECTOR_MS)
            if (rafaga && nuevo.length >= LARGO_MINIMO_DE_RAFAGA) {
              if (reloj.current !== null) window.clearTimeout(reloj.current)
              reloj.current = window.setTimeout(() => {
                // 150 ms sin teclas: la rafaga termino. Si mientras tanto
                // llego el Enter, ya se confirmo por ahi.
                reloj.current = null
                if (teclas.current.length === 0) return
                teclas.current = []
                void confirmar(ultimoTexto.current, false)
              }, 150)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter es el final del codigo, no "guardar el formulario".
              e.preventDefault()
              teclas.current = []
              if (reloj.current !== null) window.clearTimeout(reloj.current)
              reloj.current = null
              void confirmar(e.currentTarget.value, true)
              return
            }
            if (e.key.length === 1) {
              const ahora = performance.now()
              const ultima = teclas.current.at(-1)
              teclas.current =
                ultima !== undefined && ahora - ultima <= PAUSA_DE_LECTOR_MS
                  ? [...teclas.current, ahora]
                  : [ahora]
            }
          }}
          onBlur={(e) => {
            if (e.currentTarget.value.trim() !== '' && estado.tipo === 'nada') {
              void confirmar(e.currentTarget.value, false)
            }
          }}
          className={cn(
            'h-control w-full rounded-md border bg-field pr-3 pl-11 font-mono text-base tracking-wide text-ink transition-colors',
            'placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint hover:border-ink-faint',
            'disabled:bg-disabled-bg disabled:text-disabled-ink',
            borde,
          )}
        />
      </div>
      <p id={idAyuda} className="text-sm text-ink-muted">
        Escaneá el producto o escribí el código. Si no tiene, dejalo vacío.
      </p>
      <p id={idEstado} role="status" aria-live="polite" className="min-h-5 text-sm font-semibold">
        {estado.tipo === 'detectado' && <span className="text-success">✓ Código detectado</span>}
        {estado.tipo === 'repetido' && (
          <span className="text-warning">
            ▲ Ese código ya lo tiene «{estado.nombre}». Usá otro o editá ese producto.
          </span>
        )}
        {estado.tipo === 'invalido' && <span className="text-danger">✕ {estado.motivo}</span>}
      </p>
    </div>
  )
})
