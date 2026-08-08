'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  ButtonLink,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
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
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaOrdenes, type OrdenDTO } from '@/modules/purchases/dto'
import { ESTADOS_DE_COMPRA, TONO_DE_ESTADO, etiquetaDeEstado } from '@/modules/purchases/status'
import { parsePaginaProveedores, type ProveedorDTO } from '@/modules/suppliers/dto'

const POR_PAGINA = 25
const ESPERA_MS = 250

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * "3 de 5" lineas completas.
 *
 * Se muestran las LINEAS y no las unidades a proposito: "24 de 40" mezcla
 * cajas con botellas segun el producto, y en una orden de diez articulos
 * distintos no significa nada. Cuantas lineas ya llegaron enteras si.
 */
function avance(o: OrdenDTO): string {
  if (o.lineas === 0) return 'Sin productos'
  return `${String(o.lineasCompletas)} de ${String(o.lineas)}`
}

export default function ComprasPage() {
  const puedeCrear = usePermiso('purchases.create')

  const [ordenes, setOrdenes] = useState<OrdenDTO[]>([])
  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [estado, setEstado] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim())
      setPagina(1)
    }, ESPERA_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [busqueda])

  useEffect(() => {
    // Para el filtro. Si falla, el filtro no aparece y la pantalla sigue.
    apiRequest('/api/suppliers?pageSize=100', { parse: parsePaginaProveedores })
      .then((r) => {
        setProveedores(r.data)
      })
      .catch(() => {
        setProveedores([])
      })
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
      })
      if (busquedaAplicada !== '') params.set('q', busquedaAplicada)
      if (estado !== '') params.set('status', estado)
      if (proveedorId !== '') params.set('supplierId', proveedorId)
      if (desde !== '') params.set('desde', desde)
      if (hasta !== '') params.set('hasta', hasta)

      const res = await apiRequest(`/api/purchases?${params.toString()}`, {
        parse: parsePaginaOrdenes,
      })
      setOrdenes(res.data)
      setTotal(res.pagination.total)
      setTotalPaginas(res.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar las compras.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, busquedaAplicada, estado, proveedorId, desde, hasta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {/* El `<h1>` lo pone la cabecera de la aplicacion. */}
        <p className="text-sm text-ink-muted">
          {total === 0 ? 'Ninguna orden todavía' : `${String(total)} órdenes`}
        </p>
        {puedeCrear && (
          <ButtonLink href="/compras/nueva" variant="primary">
            Nueva compra
          </ButtonLink>
        )}
      </header>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-52 flex-1">
            <SearchInput
              label="Buscar por número de orden"
              value={busqueda}
              placeholder="Número de orden"
              onChange={(e) => {
                setBusqueda(e.target.value)
              }}
              onClear={() => {
                setBusqueda('')
              }}
            />
          </div>

          <Select
            value={estado}
            aria-label="Filtrar por estado"
            className="w-44"
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_DE_COMPRA.map((s) => (
              <option key={s} value={s}>
                {etiquetaDeEstado(s)}
              </option>
            ))}
          </Select>

          <Select
            value={proveedorId}
            aria-label="Filtrar por proveedor"
            className="w-52"
            onChange={(e) => {
              setProveedorId(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap gap-3">
          <Field label="Desde" className="w-40">
            <Input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value)
                setPagina(1)
              }}
            />
          </Field>
          <Field label="Hasta" className="w-40">
            <Input
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value)
                setPagina(1)
              }}
            />
          </Field>
        </div>

        {error !== null && <ErrorState description={error} onRetry={() => void cargar()} />}
        {error === null && cargando && <SkeletonRows rows={5} />}

        {error === null && !cargando && ordenes.length === 0 && (
          <EmptyState
            title="No hay compras"
            description="Cargá una orden para empezar a registrar lo que entra al depósito."
          />
        )}

        {error === null && !cargando && ordenes.length > 0 && (
          <>
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Proveedor</TH>
                    <TH>Fecha</TH>
                    <TH>Estado</TH>
                    <TH className="text-right">Recibido</TH>
                    <TH className="text-right">Total</TH>
                    <TH>Cargó</TH>
                  </TR>
                </THead>
                <TBody>
                  {ordenes.map((o) => (
                    <TR key={o.id}>
                      <TD>
                        <Link
                          href={`/compras/${String(o.id)}`}
                          className="font-medium text-ink hover:text-primary"
                          data-numeric=""
                        >
                          {o.number}
                        </Link>
                      </TD>
                      <TD>
                        <Link
                          href={`/proveedores/${String(o.supplier.id)}`}
                          className="text-ink-muted hover:text-primary"
                        >
                          {o.supplier.name}
                        </Link>
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(o.createdAt)}
                      </TD>
                      <TD>
                        <Badge tone={TONO_DE_ESTADO[o.status]}>{o.statusLabel}</Badge>
                      </TD>
                      <TD className="text-right text-ink-muted" data-numeric="">
                        {avance(o)}
                      </TD>
                      <TD className="text-right">
                        {o.expectedTotal === undefined || o.expectedTotal === null ? (
                          <span className="text-ink-faint">·</span>
                        ) : (
                          <Money amount={o.expectedTotal} />
                        )}
                      </TD>
                      <TD className="text-ink-muted">{o.createdBy.name}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <CardList className="md:hidden">
              {ordenes.map((o) => (
                <CardListItem key={o.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/compras/${String(o.id)}`}
                        className="font-medium text-ink hover:text-primary"
                        data-numeric=""
                      >
                        {o.number}
                      </Link>
                      <div className="truncate text-xs text-ink-muted">{o.supplier.name}</div>
                    </div>
                    <Badge tone={TONO_DE_ESTADO[o.status]}>{o.statusLabel}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
                    <span data-numeric="">{fechaCorta(o.createdAt)}</span>
                    <span data-numeric="">{avance(o)} líneas</span>
                    {o.expectedTotal !== undefined && o.expectedTotal !== null && (
                      <Money amount={o.expectedTotal} size="sm" />
                    )}
                  </div>
                </CardListItem>
              ))}
            </CardList>

            <Pagination
              page={pagina}
              pageSize={POR_PAGINA}
              total={total}
              totalPages={totalPaginas}
              onPageChange={setPagina}
            />
          </>
        )}
      </Card>
    </div>
  )
}
