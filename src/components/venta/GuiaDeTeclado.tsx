'use client'

import { Kbd, cn } from '@/components/ui'

/**
 * En que etapa esta la venta y que hacen las teclas ahi. V6.
 *
 * Un renglon, siempre en el mismo lugar debajo del buscador:
 *
 *   (✓) Productos ── (2) Carrito ── (3) Cobro       ↑↓ Revisar · → +1 …
 *
 * La etapa actual va llena, en negrita y con `aria-current="step"`; las ya
 * hechas llevan tilde. Se distingue sin depender del color. Las teclas cambian con la etapa y nunca
 * mienten: son las mismas que decide `accionDeTecla`.
 *
 * Solo desde 768 px: en un telefono no hay teclado fisico, y ese renglon vale
 * mas como una fila de producto.
 */

export type EtapaVisible = 'productos' | 'carrito' | 'cobro'

const ETAPAS: ReadonlyArray<{ id: EtapaVisible; nombre: string }> = [
  { id: 'productos', nombre: 'Productos' },
  { id: 'carrito', nombre: 'Carrito' },
  { id: 'cobro', nombre: 'Cobro' },
]

interface Atajo {
  teclas: string[]
  que: string
  /** Como se dice en voz alta, para el lector de pantalla. */
  dicho: string
}

const ATAJOS: Record<EtapaVisible, readonly Atajo[]> = {
  productos: [
    { teclas: ['↑', '↓'], que: 'Elegir producto', dicho: 'flechas arriba y abajo eligen producto' },
    { teclas: ['→'], que: 'Agregar', dicho: 'derecha agrega una unidad' },
    { teclas: ['←'], que: 'Quitar', dicho: 'izquierda quita una' },
    { teclas: ['Enter'], que: 'Continuar', dicho: 'Enter pasa al carrito' },
    { teclas: ['Esc'], que: 'Volver', dicho: 'Escape limpia la búsqueda' },
  ],
  carrito: [
    { teclas: ['↑', '↓'], que: 'Revisar', dicho: 'flechas arriba y abajo eligen línea' },
    { teclas: ['→'], que: '+1', dicho: 'derecha suma una unidad' },
    { teclas: ['←'], que: '−1', dicho: 'izquierda resta una' },
    { teclas: ['Enter'], que: 'Cobrar', dicho: 'Enter abre el cobro' },
    { teclas: ['Esc'], que: 'Volver', dicho: 'Escape vuelve a los productos' },
  ],
  cobro: [
    { teclas: ['←', '→'], que: 'Forma de pago', dicho: 'flechas eligen la forma de pago' },
    { teclas: ['Enter'], que: 'Continuar', dicho: 'Enter avanza' },
    { teclas: ['Esc'], que: 'Volver', dicho: 'Escape vuelve al carrito' },
  ],
}

/** La misma ayuda, en una frase: la descripcion accesible del buscador. */
export function ayudaEnTexto(etapa: EtapaVisible): string {
  return ATAJOS[etapa].map((a) => a.dicho).join('; ')
}

export function GuiaDeTeclado({ etapa, className }: { etapa: EtapaVisible; className?: string }) {
  const actual = ETAPAS.findIndex((e) => e.id === etapa)
  return (
    <div
      data-guia-de-teclado=""
      data-etapa={etapa}
      className={cn(
        'min-h-8 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-1.5 py-0.5',
        className,
      )}
    >
      {/* Tres pasos unidos por una linea: lo hecho lleva tilde, el paso
          actual va lleno y en negrita, lo que falta queda en gris. Se lee de
          un vistazo donde esta la venta, sin depender del color. */}
      <ol
        aria-label="Etapas de la venta"
        className="flex shrink-0 items-center gap-0.5 text-[0.8125rem]"
      >
        {ETAPAS.map((e, i) => {
          const esActual = i === actual
          const hecha = i < actual
          return (
            <li key={e.id} className="flex items-center gap-0.5">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 w-3 rounded-full',
                    i <= actual ? 'bg-primary' : 'bg-line-strong/50',
                  )}
                />
              )}
              <span
                aria-current={esActual ? 'step' : undefined}
                data-paso={hecha ? 'hecho' : esActual ? 'actual' : 'pendiente'}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 leading-5',
                  esActual
                    ? 'bg-primary-quiet font-semibold text-ink'
                    : hecha
                      ? 'text-ink'
                      : 'text-ink-muted',
                )}
              >
                <span
                  aria-hidden="true"
                  data-numeric=""
                  className={cn(
                    'inline-flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold',
                    esActual
                      ? 'bg-primary text-ink-on-solid'
                      : hecha
                        ? 'border border-primary text-primary'
                        : 'border border-line-strong text-ink-muted',
                  )}
                >
                  {hecha ? '✓' : i + 1}
                </span>
                <span className="sr-only">Paso {i + 1}: </span>
                {e.nombre}
              </span>
            </li>
          )
        })}
      </ol>
      {/* Las teclas, en chiquito. El lector de pantalla las recibe una sola
          vez y en palabras, como descripcion del buscador. */}
      <p
        aria-hidden="true"
        className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 text-[0.8125rem] text-ink-muted"
      >
        {ATAJOS[etapa].map((a) => (
          <span key={a.que} className="inline-flex items-center gap-0.5 whitespace-nowrap">
            {a.teclas.map((t) => (
              <Kbd key={t} className="text-ink">
                {t}
              </Kbd>
            ))}
            {a.que}
          </span>
        ))}
      </p>
    </div>
  )
}
