'use client'

import { useState } from 'react'
import { Dialog, IconButton } from '@/components/ui'

/**
 * Las teclas de la caja, en un solo lugar.
 *
 * La gramatica principal va primero y se explica sola: flechas, Enter,
 * Escape, Supr. Los atajos viejos --F12, Alt+N, Ctrl+K-- siguen funcionando
 * para quien ya los tenia en los dedos, pero van al final y no se muestran en
 * ningun boton (auditoria, H-07).
 *
 * Esto es un recordatorio, no el manual: lo que hacen las teclas AHORA lo
 * dice la linea debajo del campo, que cambia sola. Ver `teclado.ts`.
 */
const GRAMATICA: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['↓'], que: 'Elegir un producto de la lista. Después ↑ ↓ la recorren' },
  { teclas: ['←', '→'], que: 'Una unidad menos o más del producto elegido. Escribiendo, mueven el cursor' }, // prettier-ignore
  {
    teclas: ['Enter'],
    que: 'Busca el código, agrega el producto elegido, o —con el campo vacío— pasa a revisar el ticket',
  },
  { teclas: ['Enter'], que: 'Revisando, abre el cobro. Cobrar pide además decir cómo se paga' },
  { teclas: ['Esc'], que: 'Vuelve un paso: suelta lo elegido, vacía el campo, cierra' },
  { teclas: ['Supr'], que: 'Revisando, quita la línea elegida. Se puede deshacer' },
  {
    teclas: ['Tab'],
    que: 'Entra a los productos con el foco: las flechas los recorren, Enter agrega, Esc vuelve',
  },
]

const ALIAS: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['F12'], que: 'Cobrar' },
  { teclas: ['Alt', 'N'], que: 'Producto nuevo' },
  { teclas: ['Ctrl', 'K'], que: 'Ir al campo de escaneo' },
  { teclas: ['E', 'D', 'R', 'T', 'M', 'F', 'O'], que: 'En el cobro, elegir el medio de pago' },
]

function Fila({ teclas, que }: { teclas: string[]; que: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex shrink-0 gap-1">
        {teclas.map((t) => (
          <kbd
            key={t}
            className="rounded border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs text-ink"
          >
            {t}
          </kbd>
        ))}
      </dt>
      <dd className="min-w-0 text-right text-sm text-ink-muted">{que}</dd>
    </div>
  )
}

export function AyudaAtajos({ className }: { className?: string }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <IconButton
        label="Atajos de teclado"
        variant="ghost"
        className={className}
        onClick={() => {
          setAbierto(true)
        }}
      >
        <span aria-hidden="true" className="text-base font-semibold">
          ?
        </span>
      </IconButton>

      <Dialog
        open={abierto}
        onClose={() => {
          setAbierto(false)
        }}
        title="Atajos de teclado"
        description="La caja se usa entera sin mouse."
        size="sm"
      >
        <dl className="flex flex-col gap-2.5">
          {GRAMATICA.map((a) => (
            <Fila key={a.que} {...a} />
          ))}
        </dl>
        <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
          También funcionan
        </p>
        <dl className="flex flex-col gap-2.5">
          {ALIAS.map((a) => (
            <Fila key={a.que} {...a} />
          ))}
        </dl>
      </Dialog>
    </>
  )
}
