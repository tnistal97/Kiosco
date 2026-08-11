'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  MetricCard,
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
import { apiRequest } from '@/lib/api-client'
import { formatearCantidadConUnidad } from '@/modules/products/units'
import {
  ESTADOS_DE_VENCIMIENTO,
  etiquetaDeVencimiento,
  tonoDeVencimiento,
  type EstadoDeVencimiento,
} from '@/modules/lots/politicas'

const POR_PAGINA = 25

interface LoteFila {
  id: number
  code: string
  expirationDate: string | null
  dias: number | null
  estado: EstadoDeVencimiento
  quantity: string
  product: { id: number; name: string; saleUnit: string }
}

interface Respuesta {
  data: LoteFila[]
  pagination: { total: number; page: number; pageSize: number }
}

interface Resumen {
  lotesVencidos: number
  unidadesVencidas: string
  lotesEnSieteDias: number
  unidadesEnSieteDias: string
  lotesEnTreintaDias: number
  unidadesEnTreintaDias: string
  productosAfectados: number
}

/** Cuantos dias faltan, en palabras. "vencido hace 3 días", "en 12 días". */
function diasEnPalabras(dias: number | null): string {
  if (dias === null) return '—'
  if (dias < 0) return `hace ${String(-dias)} día(s)`
  if (dias === 0) return 'hoy'
  return `en ${String(dias)} día(s)`
}

/**
 * Lotes de la sucursal.
 *
 * La tercera pestaña de Inventario, junto a Stock y Movimientos. Ordenada por
 * vencimiento --lo que vence antes, primero-- porque ese es el orden en que hay
 * que mirar la lista, no una casualidad.
 *
 * El estado va en LETRAS y no solo en color: quien no distingue el rojo del
 * verde --y quien mira esta pantalla en un depósito con mala luz-- lee lo mismo.
 */
export default function LotesPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState('')
  const [agotados, setAgotados] = useState(false)
  const [pagina, setPagina] = useState(1)

  const cargar = useCallback(() => {
    let vivo = true
    setCargando(true)
    const params = new URLSearchParams({
      page: String(pagina),
      pageSize: String(POR_PAGINA),
      ...(busqueda ? { q: busqueda } : {}),
      ...(estado ? { estado } : {}),
      ...(agotados ? { agotados: 'true' } : {}),
    })

    apiRequest<Respuesta>(`/api/lotes?${params.toString()}`, { parse: (d) => d as Respuesta })
      .then((r) => {
        if (vivo) {
          setDatos(r)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : 'No se pudo cargar')
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })

    return () => {
      vivo = false
    }
  }, [pagina, busqueda, estado, agotados])

  useEffect(() => cargar(), [cargar])

  useEffect(() => {
    let vivo = true
    apiRequest<Resumen>('/api/reportes/vencimientos', { parse: (d) => d as Resumen })
      .then((r) => {
        if (vivo) setResumen(r)
      })
      .catch(() => {
        // El tablero es informacion de apoyo: si falla, la lista sigue sirviendo.
      })
    return () => {
      vivo = false
    }
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Lotes</h1>
          <p className="text-sm text-ink-muted">
            Las partidas con unidades, ordenadas por vencimiento.
          </p>
        </div>
      </header>

      {resumen && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Vencidos"
            value={String(resumen.lotesVencidos)}
            detail={`${resumen.unidadesVencidas} unidades`}
            tone={resumen.lotesVencidos > 0 ? 'danger' : 'neutral'}
          />
          <MetricCard
            label="Vencen en 7 días"
            value={String(resumen.lotesEnSieteDias)}
            detail={`${resumen.unidadesEnSieteDias} unidades`}
            tone={resumen.lotesEnSieteDias > 0 ? 'warning' : 'neutral'}
          />
          <MetricCard
            label="Vencen en 30 días"
            value={String(resumen.lotesEnTreintaDias)}
            detail={`${resumen.unidadesEnTreintaDias} unidades`}
          />
          <MetricCard label="Productos afectados" value={String(resumen.productosAfectados)} />
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <SearchInput
            label="Buscar lotes"
            placeholder="Producto o código de lote…"
            value={busqueda}
            loading={cargando}
            onClear={() => {
              setBusqueda('')
              setPagina(1)
            }}
            onChange={(e) => {
              setBusqueda(e.target.value)
              setPagina(1)
            }}
          />
          <Select
            aria-label="Estado de vencimiento"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos</option>
            {ESTADOS_DE_VENCIMIENTO.map((e) => (
              <option key={e} value={e}>
                {etiquetaDeVencimiento(e)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={agotados}
              onChange={(e) => {
                setAgotados(e.target.checked)
                setPagina(1)
              }}
            />
            Incluir agotados
          </label>
        </div>

        {error !== null && (
          <ErrorState
            description={error}
            onRetry={() => {
              cargar()
            }}
          />
        )}
        {error === null && cargando && <SkeletonRows rows={6} />}
        {error === null && !cargando && datos !== null && datos.data.length === 0 && (
          <EmptyState
            title="No hay lotes"
            description="Ningún producto de esta sucursal tiene partidas con unidades."
          />
        )}

        {error === null && !cargando && datos !== null && datos.data.length > 0 && (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Lote</TH>
                    <TH>Cantidad</TH>
                    <TH>Vencimiento</TH>
                    <TH>Días</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {datos.data.map((l) => (
                    <TR key={l.id}>
                      <TD>
                        <a className="hover:underline" href={`/stock/lotes/${String(l.id)}`}>
                          {l.product.name}
                        </a>
                      </TD>
                      <TD className="font-mono text-xs">{l.code}</TD>
                      <TD>
                        {formatearCantidadConUnidad(l.quantity, l.product.saleUnit as 'UNIT')}
                      </TD>
                      <TD>{l.expirationDate ?? '—'}</TD>
                      <TD className="text-ink-muted">{diasEnPalabras(l.dias)}</TD>
                      <TD>
                        <Badge tone={tonoDeVencimiento(l.estado)}>
                          {etiquetaDeVencimiento(l.estado)}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            {/* En movil la tabla se convierte en tarjetas: seis columnas no
                entran en 375 px sin desplazamiento lateral. */}
            <CardList>
              {datos.data.map((l) => (
                <CardListItem key={l.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{l.product.name}</p>
                      <p className="font-mono text-xs text-ink-muted">{l.code}</p>
                    </div>
                    <Badge tone={tonoDeVencimiento(l.estado)}>
                      {etiquetaDeVencimiento(l.estado)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex justify-between text-sm text-ink-muted">
                    <span>
                      {formatearCantidadConUnidad(l.quantity, l.product.saleUnit as 'UNIT')}
                    </span>
                    <span>
                      {l.expirationDate ?? 'sin fecha'} · {diasEnPalabras(l.dias)}
                    </span>
                  </div>
                </CardListItem>
              ))}
            </CardList>

            <Pagination
              page={datos.pagination.page}
              pageSize={datos.pagination.pageSize}
              total={datos.pagination.total}
              totalPages={Math.max(
                1,
                Math.ceil(datos.pagination.total / datos.pagination.pageSize),
              )}
              onPageChange={setPagina}
            />
          </>
        )}
      </Card>
    </div>
  )
}
