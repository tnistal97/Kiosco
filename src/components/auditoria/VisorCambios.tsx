'use client'

import { useState } from 'react'
import { Button, Money, cn } from '@/components/ui'

/**
 * Visor de cambios: campo, antes, después.
 *
 * Un bloque JSON de cuarenta lineas no informa nada. Lo que hay que poder
 * leer de un vistazo es "price pasó de 1200 a 1350", y eso es una tabla de
 * tres columnas.
 *
 * Los valores sensibles no se muestran nunca. La bitacora ya los redacta al
 * escribir --`CLAVES_PROHIBIDAS` en `audit()`-- pero esta es la segunda
 * barrera: si en algun momento entra una clave prohibida a la base, tampoco
 * se pinta.
 */
const OCULTOS = ['password', 'hash', 'token', 'secret', 'cookie', 'authorization', 'sessionversion']

function esSensible(clave: string): boolean {
  const k = clave.toLowerCase()
  return OCULTOS.some((o) => k.includes(o))
}

/** Campos que no aportan en un antes/despues: ruido de la fila. */
const IRRELEVANTES = new Set(['id', 'createdAt', 'updatedAt'])

const ETIQUETAS: Record<string, string> = {
  name: 'Nombre',
  price: 'Precio',
  barcode: 'Código de barras',
  description: 'Descripción',
  categoryId: 'Categoría',
  supplierId: 'Proveedor',
  isActive: 'En venta',
  quantity: 'Unidades',
  diferencia: 'Diferencia',
  status: 'Estado',
  motivo: 'Motivo',
  total: 'Total',
  contado: 'Contado',
  esperado: 'Esperado',
  paymentMethod: 'Medio de pago',
  rol: 'Rol',
  permiso: 'Permiso',
  branchId: 'Sucursal',
  amount: 'Importe',
  origen: 'Origen',
}

/** Campos que se leen mejor como dinero. */
const MONETARIOS = new Set(['price', 'total', 'amount', 'contado', 'esperado', 'diferencia'])

function mostrar(clave: string, valor: unknown) {
  if (valor === null || valor === undefined) return <span className="text-ink-faint">—</span>
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'number' && MONETARIOS.has(clave)) {
    return <Money amount={valor} size="sm" />
  }
  if (typeof valor === 'object') {
    // Un objeto anidado (los items de una venta, por ejemplo) no entra en una
    // celda. Se resume; el detalle esta en la pantalla del dominio.
    return (
      <span className="text-ink-faint">
        {Array.isArray(valor) ? `${valor.length} elemento(s)` : 'objeto'}
      </span>
    )
  }
  // Llegados aca solo quedan number, string y bigint. No se usa `String()`
  // sobre `unknown`: un objeto se habria convertido en "[object Object]".
  if (typeof valor === 'number' || typeof valor === 'bigint') return valor.toString()
  if (typeof valor === 'string') return valor
  return <span className="text-ink-faint">—</span>
}

export function VisorCambios({
  before,
  after,
}: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}) {
  const [verTodo, setVerTodo] = useState(false)

  const claves = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((k) => !IRRELEVANTES.has(k))
    .sort()

  if (claves.length === 0) {
    return <p className="text-sm text-ink-faint">Sin detalle registrado.</p>
  }

  // Por omision solo lo que cambio: es lo que se busca al abrir una entrada.
  const cambiadas = claves.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
  const aMostrar = verTodo ? claves : cambiadas.length > 0 ? cambiadas : claves

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-faint uppercase">
              <th className="py-1.5 pr-4 font-semibold">Campo</th>
              <th className="py-1.5 pr-4 font-semibold">Antes</th>
              <th className="py-1.5 font-semibold">Después</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {aMostrar.map((k) => {
              const cambio = JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])
              if (esSensible(k)) {
                return (
                  <tr key={k}>
                    <td className="py-1.5 pr-4 text-ink-muted">{ETIQUETAS[k] ?? k}</td>
                    <td colSpan={2} className="py-1.5 text-ink-faint italic">
                      valor oculto
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={k} className={cn(cambio && 'bg-primary-quiet/40')}>
                  <td className="py-1.5 pr-4 text-ink-muted">{ETIQUETAS[k] ?? k}</td>
                  <td className="py-1.5 pr-4 text-ink-muted">{mostrar(k, before?.[k])}</td>
                  <td className={cn('py-1.5', cambio ? 'font-medium text-ink' : 'text-ink-muted')}>
                    {mostrar(k, after?.[k])}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {cambiadas.length > 0 && cambiadas.length < claves.length && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setVerTodo((v) => !v)
          }}
        >
          {verTodo ? 'Ver solo lo que cambió' : `Ver los ${claves.length} campos`}
        </Button>
      )}
    </div>
  )
}
