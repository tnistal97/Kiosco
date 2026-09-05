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
 */
const GRAMATICA: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['↑', '↓'], que: 'Elegir una línea del ticket, o un resultado si estás buscando' },
  { teclas: ['←', '→'], que: 'Una unidad menos o más en la línea elegida' },
  {
    teclas: ['Enter'],
    que: 'Busca el código, agrega el resultado, o abre el cobro con el campo vacío',
  },
  { teclas: ['Esc'], que: 'Vuelve un paso: vacía el campo, deselecciona, cierra' },
  { teclas: ['Supr'], que: 'Quita la línea elegida' },
  {
    teclas: ['Tab'],
    que: 'Entra a los productos (también ↓ con el ticket vacío): las flechas los recorren, Enter agrega, Esc vuelve',
  },
]

const ALIAS: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['F12'], que: 'Cobrar' },
  { teclas: ['Alt', 'N'], que: 'Producto nuevo' },
  { teclas: ['Ctrl', 'K'], que: 'Ir al campo de escaneo' },
  { teclas: ['E', 'D', 'R', 'T', 'F', 'O'], que: 'En el cobro, elegir el medio de pago' },
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
