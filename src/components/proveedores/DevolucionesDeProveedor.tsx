'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Money,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaDevoluciones, type DevolucionDTO } from '@/modules/purchases/dto.returns'
import { TONO_DE_DEVOLUCION } from '@/modules/purchases/return-status'

function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Lo que se le devolvió a un proveedor. La sección del objetivo 21.
 *
 * Vive en la ficha del proveedor y no en la de compras porque la pregunta que
 * contesta es sobre EL PROVEEDOR: cuánto nos manda mal, y cuánto crédito nos
 * generó por eso.
 */
export function DevolucionesDeProveedor({ supplierId }: { supplierId: number }) {
  const [devoluciones, setDevoluciones] = useState<DevolucionDTO[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const pagina = await apiRequest(
        `/api/suppliers/${String(supplierId)}/devoluciones?pageSize=25`,
        { parse: parsePaginaDevoluciones },
      )
      setDevoluciones(pagina.data)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar las devoluciones.'))
    } finally {
      setCargando(false)
    }
  }, [supplierId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Card className="p-4">
      <CardHeader
        title="Devoluciones"
        description="Mercadería que volvió al proveedor, al costo con el que entró"
      />

      {cargando && devoluciones.length === 0 ? (
        <SkeletonRows rows={2} />
      ) : error !== null ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : devoluciones.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="Sin devoluciones"
          description="Nada de lo que entregó volvió."
        />
      ) : (
        <TableWrap className="mt-3">
          <Table>
            <THead>
              <TR>
                <TH>Número</TH>
                <TH>Fecha</TH>
                <TH>Entrega</TH>
                <TH>Motivo</TH>
                <TH className="text-right">Importe</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {devoluciones.map((d) => (
                <TR key={d.id}>
                  <TD>
                    <Link
                      href={`/devoluciones/${String(d.id)}`}
                      className="font-medium text-ink hover:text-primary"
                      data-numeric=""
                    >
                      {d.number}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted" data-numeric="">
                    {fechaCorta(d.confirmedAt ?? d.createdAt)}
                  </TD>
                  <TD className="text-ink-muted" data-numeric="">
                    {d.orderNumber}
                  </TD>
                  <TD className="text-ink-muted">{d.reasonLabel}</TD>
                  <TD className="text-right">
                    <Money amount={d.total} />
                  </TD>
                  <TD>
                    {/* Color Y palabra. Nunca solo el color. */}
                    <Badge tone={TONO_DE_DEVOLUCION[d.status]}>{d.statusLabel}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  )
}
