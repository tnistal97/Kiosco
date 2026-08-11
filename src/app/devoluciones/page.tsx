'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Money,
  Pagination,
  Select,
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
import {
  ESTADOS_DE_DEVOLUCION,
  TONO_DE_DEVOLUCION,
  etiquetaDeEstadoDeDevolucion,
} from '@/modules/purchases/return-status'

const POR_PAGINA = 25

function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Las devoluciones de la sucursal.
 *
 * NO tiene botón de "nueva": una devolución nace SIEMPRE desde una entrega
 * concreta --de ahí salen el costo, la unidad y el tope-- y el camino es el
 * detalle de la compra. Un botón acá obligaría a empezar preguntando "¿de qué
 * entrega?", que es exactamente el paso que la pantalla de la compra ya resolvió.
 */
export default function DevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<DevolucionDTO[]>([])
  const [estado, setEstado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        ...(estado === '' ? {} : { status: estado }),
      })
      const datos = await apiRequest(`/api/devoluciones?${qs.toString()}`, {
        parse: parsePaginaDevoluciones,
      })
      setDevoluciones(datos.data)
      setTotal(datos.pagination.total)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar las devoluciones.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, estado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4">
        <CardHeader
          title="Devoluciones a proveedor"
          description="Mercadería que volvió, con el crédito que generó"
          actions={
            <Field label="Estado" labelHidden>
              <Select
                value={estado}
                aria-label="Filtrar por estado"
                onChange={(e) => {
                  setEstado(e.target.value)
                  setPagina(1)
                }}
              >
                <option value="">Todos los estados</option>
                {ESTADOS_DE_DEVOLUCION.map((s) => (
                  <option key={s} value={s}>
                    {etiquetaDeEstadoDeDevolucion(s)}
                  </option>
                ))}
              </Select>
            </Field>
          }
        />

        {cargando && devoluciones.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : error !== null ? (
          <ErrorState description={error} onRetry={() => void cargar()} />
        ) : devoluciones.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="No hay devoluciones"
            description="Se arman desde el detalle de una entrega, con el botón “Devolver mercadería”."
          />
        ) : (
          <>
            <TableWrap className="mt-3">
              <Table>
                <THead>
                  <TR>
                    <TH>Número</TH>
                    <TH>Fecha</TH>
                    <TH>Proveedor</TH>
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
                      <TD className="text-ink">{d.supplier.name}</TD>
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

            <Pagination
              className="mt-3"
              page={pagina}
              pageSize={POR_PAGINA}
              total={total}
              totalPages={Math.max(1, Math.ceil(total / POR_PAGINA))}
              onPageChange={setPagina}
            />
          </>
        )}
      </Card>
    </div>
  )
}
