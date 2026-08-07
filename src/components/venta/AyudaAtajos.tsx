'use client'

import { useState } from 'react'
import { Button, Dialog } from '@/components/ui'

/**
 * Atajos de la caja.
 *
 * Ayuda discreta: un enlace chico al pie, no un panel permanente. Quien ya
 * los sabe no necesita verlos todo el dia, y quien no, los encuentra.
 */
const ATAJOS: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['Ctrl', 'K'], que: 'Ir al buscador' },
  { teclas: ['/'], que: 'Ir al buscador (fuera de un campo)' },
  { teclas: ['↑', '↓'], que: 'Elegir un resultado' },
  { teclas: ['Enter'], que: 'Agregar el resultado elegido' },
  { teclas: ['+', '−'], que: 'Cambiar la cantidad de una línea' },
  { teclas: ['Supr'], que: 'Quitar la línea (con el foco en la cantidad)' },
  { teclas: ['F12'], que: 'Cobrar' },
  { teclas: ['Esc'], que: 'Cerrar el diálogo o vaciar la búsqueda' },
]

export function AyudaAtajos() {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <div className="flex justify-end">
        {/* `sm` y no `xs`: es un boton que se toca, y en la caja tambien se
            usa desde una tablet. `xs` mide 32 px y queda por debajo del
            minimo tactil. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAbierto(true)
          }}
        >
          Atajos de teclado
        </Button>
      </div>

      <Dialog
        open={abierto}
        onClose={() => {
          setAbierto(false)
        }}
        title="Atajos de teclado"
        description="La caja se puede usar entera sin mouse."
        size="sm"
      >
        <dl className="flex flex-col gap-2.5">
          {ATAJOS.map((a) => (
            <div key={a.que} className="flex items-center justify-between gap-4">
              <dt className="flex shrink-0 gap-1">
                {a.teclas.map((t) => (
                  <kbd
                    key={t}
                    className="rounded border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs text-ink"
                  >
                    {t}
                  </kbd>
                ))}
              </dt>
              <dd className="min-w-0 text-right text-sm text-ink-muted">{a.que}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  )
}
