'use client'

import { use, useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Card,
  ErrorState,
  MetricCard,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from '@/components/ui'
import { apiRequest } from '@/lib/api-client'
import { formatearCantidadConUnidad } from '@/modules/products/units'
import {
  etiquetaDeVencimiento,
  tonoDeVencimiento,
  type EstadoDeVencimiento,
} from '@/modules/lots/politicas'

interface Detalle {
  id: number
  code: string
  expirationDate: string | null
  manufacturedAt: string | null
  notes: string | null
  dias: number | null
  estado: EstadoDeVencimiento
  quantity: string
  product: { id: number; name: string; saleUnit: string }
  porSucursal: Array<{ branchId: number; branchName: string; quantity: string }>
  entradas: string
  salidas: string
  atribuido: string
}

/**
 * Una partida: que es, cuanto queda y de donde salio ese numero.
 *
 * Los tres numeros de abajo --entradas, salidas y atribuido-- son la invariante
 * del lote escrita en pantalla: su suma es el stock. Sin ellos, la cifra del
 * lote seria un numero que hay que creer. Ver docs/LOT_TRACKING_DESIGN.md.
 */
export default function LotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [lote, setLote] = useState<Detalle | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => {
    let vivo = true
    apiRequest<Detalle>(`/api/lotes/${id}`, { parse: (d) => d as Detalle })
      .then((l) => {
        if (vivo) {
          setLote(l)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar')
      })
    return () => {
      vivo = false
    }
  }, [id])

  useEffect(() => cargar(), [cargar])

  if (error !== null) {
    return (
      <ErrorState
        description={error}
        onRetry={() => {
          cargar()
        }}
      />
    )
  }
  if (lote === null) return <SkeletonRows rows={5} />

  const unidad = lote.product.saleUnit as 'UNIT'

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-ink-muted">{lote.product.name}</p>
        <h2 className="flex items-center gap-3 text-2xl font-semibold text-ink">
          <span className="font-mono">{lote.code}</span>
          <Badge tone={tonoDeVencimiento(lote.estado)}>{etiquetaDeVencimiento(lote.estado)}</Badge>
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="En esta sucursal"
          value={formatearCantidadConUnidad(lote.quantity, unidad)}
        />
        <MetricCard label="Vence" value={lote.expirationDate ?? 'sin fecha'} />
        <MetricCard label="Entró" value={formatearCantidadConUnidad(lote.entradas, unidad)} />
        <MetricCard
          label="Salió"
          value={formatearCantidadConUnidad(lote.salidas.replace('-', ''), unidad)}
        />
      </div>

      {lote.atribuido !== '0.000' && (
        <p className="text-sm text-ink-muted">
          {formatearCantidadConUnidad(lote.atribuido, unidad)} de esta partida se{' '}
          <strong>atribuyeron</strong> a stock que ya estaba: no entraron por una recepción.
        </p>
      )}

      <Card>
        <h2 className="p-4 text-sm font-semibold text-ink">Por sucursal</h2>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Sucursal</TH>
                <TH>Cantidad</TH>
              </TR>
            </THead>
            <TBody>
              {lote.porSucursal.map((s) => (
                <TR key={s.branchId}>
                  <TD>{s.branchName}</TD>
                  <TD>{formatearCantidadConUnidad(s.quantity, unidad)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  )
}
