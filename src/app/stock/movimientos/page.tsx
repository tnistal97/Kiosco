'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  cn,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaMovimientos, type MovimientoDTO } from '@/modules/inventory/dto'
import { TIPOS_MOVIMIENTO, etiquetaDeTipo } from '@/modules/inventory/movement-types'
import { aMilesimas, desdeMilesimas, type TextoCantidad } from '@/lib/cantidad'
import {
  formatearCantidad,
  formatearCantidadConUnidad,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { enlaceDeReferencia, textoDeReferencia } from '@/modules/inventory/referencias'
import Link from 'next/link'

const POR_PAGINA = 25
const ESPERA_MS = 250

interface Filtros {
  q: string
  tipo: string
  desde: string
  hasta: string
}

const SIN_FILTROS: Filtros = { q: '', tipo: '', desde: '', hasta: '' }

/** Hora y fecha corta. La hora primero: es lo que se busca en un historial. */
function cuando(iso: string): { hora: string; fecha: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { hora: '—', fecha: '' }
  return {
    hora: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    fecha: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
  }
}

/** El delta, con su signo y su color. Es la columna que se mira primero. */
function Variacion({ cantidad, unidad }: { cantidad: TextoCantidad; unidad: UnidadDeVenta }) {
  const entra = aMilesimas(cantidad) > 0
  const absoluta = desdeMilesimas(Math.abs(aMilesimas(cantidad)))
  return (
    <span
      data-numeric=""
      className={cn('font-semibold tabular-nums', entra ? 'text-success' : 'text-danger')}
    >
      {entra ? '+' : '−'}
      {formatearCantidadConUnidad(absoluta, unidad)}
    </span>
  )
}

function Referencia({ movimiento }: { movimiento: MovimientoDTO }) {
  const texto = textoDeReferencia(movimiento.referenceType, movimiento.referenceId)
  const href = enlaceDeReferencia(movimiento.referenceType, movimiento.referenceId)

  if (href === null) return <span className="text-ink-muted">{texto}</span>
  return (
    <Link href={href} className="text-primary underline underline-offset-2">
      {texto}
    </Link>
  )
}

/**
 * Libro de movimientos de stock.
 *
 * Solo lectura, y no por falta de tiempo: un movimiento no se edita y no se
 * borra. Los errores se corrigen con otro movimiento, igual que en un libro
 * contable, y hay un disparador en la base que lo impide de verdad.
 *
 * Cada fila cuenta la historia entera: cuándo, qué producto, qué pasó, cuánto
 * varió, de cuánto a cuánto, por qué documento y quién. Ver
 * docs/INVENTORY_LEDGER.md.
 */
export default function MovimientosPage() {
  const puedeVer = usePermiso('inventory.movements.view')

  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS)
  const [movimientos, setMovimientos] = useState<MovimientoDTO[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Identifica la petición en curso: si el usuario sigue escribiendo, la
  // respuesta vieja que llegue después no puede pisar a la nueva.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!puedeVer) return
    const mia = ++peticion.current
    setCargando(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), pageSize: String(POR_PAGINA) })
    if (filtros.q.trim()) params.set('q', filtros.q.trim())
    if (filtros.tipo) params.set('tipo', filtros.tipo)
    // Solo el DIA, en los dos extremos. Que "hasta el 5" incluya el 5 entero
    // lo resuelve el servidor con la zona de la sucursal, que es el unico que
    // sabe donde termina el dia del comercio.
    if (filtros.desde) params.set('desde', filtros.desde)
    if (filtros.hasta) params.set('hasta', filtros.hasta)

    try {
      const pagina = await apiRequest(`/api/inventory/movements?${params.toString()}`, {
        parse: parsePaginaMovimientos,
      })
      if (mia !== peticion.current) return
      setMovimientos(pagina.data)
      setTotal(pagina.pagination.total)
      setTotalPages(pagina.pagination.totalPages)
    } catch (err) {
      if (mia !== peticion.current) return
      setError(mensajeDeError(err, 'No se pudo cargar el historial.'))
    } finally {
      if (mia === peticion.current) setCargando(false)
    }
  }, [puedeVer, page, filtros])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), ESPERA_MS)
    return () => {
      clearTimeout(t)
    }
  }, [cargar])

  function aplicar(cambio: Partial<Filtros>) {
    setFiltros((f) => ({ ...f, ...cambio }))
    setPage(1)
  }

  if (!puedeVer) {
    return (
      <div className="mx-auto max-w-3xl p-3 sm:p-5">
        <Card>
          <EmptyState
            title="No tenés acceso al historial"
            description="Ver quién movió cada unidad es información de control. Pedíselo a quien administra el sistema."
          />
        </Card>
      </div>
    )
  }

  const hayFiltros = filtros.q !== '' || filtros.tipo !== '' || filtros.desde !== '' || filtros.hasta !== '' // prettier-ignore

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <Alert tone="info" title="Este libro no se edita">
        Un movimiento queda como está para siempre. Si algo se cargó mal, se corrige con otro
        movimiento y los dos quedan a la vista.
      </Alert>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="lg:max-w-md lg:flex-1">
              <SearchInput
                label="Buscar producto"
                placeholder="Nombre o código de barras…"
                value={filtros.q}
                loading={cargando}
                onClear={() => {
                  aplicar({ q: '' })
                }}
                onChange={(e) => {
                  aplicar({ q: e.target.value })
                }}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Tipo">
                <Select
                  value={filtros.tipo}
                  onChange={(e) => {
                    aplicar({ tipo: e.target.value })
                  }}
                  className="w-auto"
                >
                  <option value="">Todos los tipos</option>
                  {TIPOS_MOVIMIENTO.map((t) => (
                    <option key={t} value={t}>
                      {etiquetaDeTipo(t)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Desde">
                <Input
                  type="date"
                  value={filtros.desde}
                  onChange={(e) => {
                    aplicar({ desde: e.target.value })
                  }}
                />
              </Field>

              <Field label="Hasta">
                <Input
                  type="date"
                  value={filtros.hasta}
                  onChange={(e) => {
                    aplicar({ hasta: e.target.value })
                  }}
                />
              </Field>

              {hayFiltros && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFiltros(SIN_FILTROS)
                    setPage(1)
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={8} />
          ) : movimientos.length === 0 ? (
            <EmptyState
              title={hayFiltros ? 'Nada con esos filtros' : 'Todavía no hay movimientos'}
              description={
                hayFiltros
                  ? 'Probá con otro texto, otro tipo u otras fechas.'
                  : 'Cada venta, anulación y ajuste va a aparecer acá.'
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap className="border-0">
                  <Table caption="Movimientos de stock de la sucursal">
                    <THead>
                      <TR>
                        <TH>Fecha</TH>
                        <TH>Producto</TH>
                        <TH>Tipo</TH>
                        <TH align="right">Variación</TH>
                        <TH align="right">Anterior</TH>
                        <TH align="right">Posterior</TH>
                        <TH>Referencia</TH>
                        <TH>Usuario</TH>
                        <TH>Motivo</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {movimientos.map((m) => {
                        const t = cuando(m.createdAt)
                        return (
                          <TR key={m.id}>
                            <TD>
                              <p className="font-medium text-ink" data-numeric="">
                                {t.hora}
                              </p>
                              <p className="text-xs text-ink-faint" data-numeric="">
                                {t.fecha}
                              </p>
                            </TD>
                            <TD>
                              <p className="font-medium text-ink">{m.product.name}</p>
                              {m.product.barcode && (
                                <p className="font-mono text-xs text-ink-faint">
                                  {m.product.barcode}
                                </p>
                              )}
                            </TD>
                            <TD className="text-ink-muted">{m.typeLabel}</TD>
                            <TD align="right">
                              <Variacion cantidad={m.quantity} unidad={m.product.saleUnit} />
                            </TD>
                            <TD align="right" className="text-ink-muted tabular-nums">
                              {m.previousQuantity}
                            </TD>
                            <TD align="right" className="font-medium text-ink tabular-nums">
                              {formatearCantidad(m.resultingQuantity, m.product.saleUnit)}
                            </TD>
                            <TD>
                              <Referencia movimiento={m} />
                            </TD>
                            <TD className="text-ink-muted">{m.user.name}</TD>
                            <TD className="max-w-48 truncate text-ink-muted" title={m.reason ?? ''}>
                              {m.reason ?? '—'}
                            </TD>
                          </TR>
                        )
                      })}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              <CardList className="md:hidden">
                {movimientos.map((m) => {
                  const t = cuando(m.createdAt)
                  return (
                    <CardListItem key={m.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{m.product.name}</p>
                          <p className="mt-0.5 text-xs text-ink-faint">
                            {t.hora} · {t.fecha} · {m.typeLabel}
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            {formatearCantidad(m.previousQuantity, m.product.saleUnit)} →{' '}
                            {formatearCantidad(m.resultingQuantity, m.product.saleUnit)} ·{' '}
                            {m.user.name}
                          </p>
                          {m.reason && (
                            <p className="mt-1 truncate text-xs text-ink-faint">{m.reason}</p>
                          )}
                        </div>
                        <Variacion cantidad={m.quantity} unidad={m.product.saleUnit} />
                      </div>
                    </CardListItem>
                  )
                })}
              </CardList>

              <Pagination
                className="mt-4"
                page={page}
                pageSize={POR_PAGINA}
                total={total}
                totalPages={totalPages}
                onPageChange={setPage}
                disabled={cargando}
              />
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
