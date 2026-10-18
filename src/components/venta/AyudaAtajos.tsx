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
  { teclas: ['Lector'], que: 'Pasá el producto: se agrega solo. Dos lecturas, dos unidades' },
  { teclas: ['↑', '↓'], que: 'Recorren la lista de productos o las líneas del ticket' },
  { teclas: ['Enter'], que: 'Elige el producto marcado. Si ya está en el ticket, no suma otro' },
  { teclas: ['+', '−'], que: 'Una unidad más o menos (la última línea, o la elegida)' },
  { teclas: ['Enter'], que: 'Con el campo vacío: pasa al ticket. Otra vez: abre el cobro' },
  { teclas: ['Enter'], que: 'En el cobro: elige la forma de pago y después confirma la venta' },
  { teclas: ['Supr'], que: 'Quita la línea elegida del ticket. Se puede deshacer' },
  { teclas: ['Esc'], que: 'Vuelve un paso: suelta lo elegido, vacía el campo, cierra' },
]

const ALIAS: Array<{ teclas: string[]; que: string }> = [
  { teclas: ['F12'], que: 'Cobrar' },
  { teclas: ['Alt', 'N'], que: 'Producto nuevo' },
  { teclas: ['Ctrl', 'K'], que: 'Ir al campo de búsqueda' },
  { teclas: ['E', 'T', 'M', 'D', 'C', 'F'], que: 'En el cobro, elegir la forma de pago' },
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
      <dd className="min-w-0 text-right text-sm text-ink">{que}</dd>
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
        description="Se puede vender sin tocar el mouse."
        size="sm"
      >
        <dl className="flex flex-col gap-2.5">
          {GRAMATICA.map((a) => (
            <Fila key={a.que} {...a} />
          ))}
        </dl>
        <p className="mt-5 mb-2 text-sm font-semibold text-ink">También funcionan</p>
        <dl className="flex flex-col gap-2.5">
          {ALIAS.map((a) => (
            <Fila key={a.que} {...a} />
          ))}
        </dl>
      </Dialog>
    </>
  )
}
