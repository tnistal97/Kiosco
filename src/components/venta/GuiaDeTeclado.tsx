'use client'

import { Kbd, cn } from '@/components/ui'

/**
 * En que etapa esta la venta y que hacen las teclas ahi. V6.
 *
 * Un renglon, siempre en el mismo lugar debajo del buscador:
 *
 *   ① Productos › ② Carrito › ③ Cobro          ↑↓ Elegir producto · → Agregar …
 *
 * La etapa actual va llena, en negrita y con `aria-current="step"`: se
 * distingue sin depender del color. Las teclas cambian con la etapa y nunca
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
  return (
    <div
      data-guia-de-teclado=""
      data-etapa={etapa}
      className={cn('min-h-7 items-center justify-between gap-3', className)}
    >
      <ol
        aria-label="Etapas de la venta"
        className="flex shrink-0 items-center gap-0.5 text-[0.8125rem]"
      >
        {ETAPAS.map((e, i) => {
          const actual = e.id === etapa
          return (
            <li key={e.id} className="flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden="true" className="text-ink-faint">
                  ›
                </span>
              )}
              <span
                aria-current={actual ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 leading-6',
                  actual
                    ? 'border-primary bg-primary font-semibold text-ink-on-solid'
                    : 'border-transparent text-ink-muted',
                )}
              >
                <span data-numeric="">{i + 1}.</span>
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
        className="flex min-w-0 flex-wrap items-center justify-end gap-x-2.5 text-[0.8125rem] text-ink-muted"
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
