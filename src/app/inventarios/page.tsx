'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
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
import { DialogoNuevoInventario } from '@/components/inventarios/DialogoNuevoInventario'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest } from '@/lib/api-client'
import {
  ESTADOS_DE_INVENTARIO,
  etiquetaDeEstado,
  tonoDeEstado,
} from '@/modules/inventory-counts/estados'

const POR_PAGINA = 25

interface Sesion {
  id: number
  number: string
  status: string
  statusLabel: string
  scopeLabel: string
  categoryName: string | null
  blindCount: boolean
  startedAt: string
  startedByName: string
  lineas: {
    total: number
    contadas: number
    pendientes: number
    sinResolver: number
    conDiferencia: number
  }
}

interface Respuesta {
  data: Sesion[]
  pagination: { total: number; page: number; pageSize: number }
}

/**
 * Inventarios fisicos de la sucursal.
 *
 * Muestra el avance de cada sesion en numeros --contadas, pendientes, sin
 * resolver, con diferencia-- porque eso es lo que decide que hacer con ella, y
 * mirar el estado solo no alcanza: una sesion "contando" con cero pendientes
 * esta lista para cerrar y una con doscientas no.
 */
export default function InventariosPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [creando, setCreando] = useState(false)
  const puedeCrear = usePermiso('inventoryCounts.create')

  const cargar = useCallback(() => {
    let vivo = true
    setCargando(true)
    const params = new URLSearchParams({
      page: String(pagina),
      pageSize: String(POR_PAGINA),
      ...(estado ? { estado } : {}),
    })
    apiRequest<Respuesta>(`/api/inventarios?${params.toString()}`, { parse: (d) => d as Respuesta })
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
  }, [pagina, estado])

  useEffect(() => cargar(), [cargar])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-ink">Inventarios físicos</h2>
          <p className="text-sm text-ink-muted">
            Contar el depósito y corregir lo que no coincide, sin cerrar el local.
          </p>
        </div>
        {puedeCrear && (
          <Button
            onClick={() => {
              setCreando(true)
            }}
          >
            Nuevo inventario
          </Button>
        )}
      </header>

      <DialogoNuevoInventario
        abierto={creando}
        onCerrar={() => {
          setCreando(false)
        }}
        onCreado={(id) => {
          window.location.href = `/inventarios/${String(id)}`
        }}
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Select
            aria-label="Estado del inventario"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_DE_INVENTARIO.map((e) => (
              <option key={e} value={e}>
                {etiquetaDeEstado(e)}
              </option>
            ))}
          </Select>
        </div>

        {error !== null && (
          <ErrorState
            description={error}
            onRetry={() => {
              cargar()
            }}
          />
        )}
        {error === null && cargando && <SkeletonRows rows={5} />}
        {error === null && !cargando && datos !== null && datos.data.length === 0 && (
          <EmptyState
            title="Todavía no hay inventarios"
            description="Un inventario físico cuenta el depósito y convierte las diferencias en movimientos de stock."
          />
        )}

        {error === null && !cargando && datos !== null && datos.data.length > 0 && (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Número</TH>
                    <TH>Alcance</TH>
                    <TH>Estado</TH>
                    <TH>Líneas</TH>
                    <TH>Diferencias</TH>
                    <TH>Inició</TH>
                  </TR>
                </THead>
                <TBody>
                  {datos.data.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        <a className="hover:underline" href={`/inventarios/${String(s.id)}`}>
                          {s.number}
                        </a>
                      </TD>
                      <TD>
                        {s.scopeLabel}
                        {s.categoryName === null ? '' : ` · ${s.categoryName}`}
                        {s.blindCount ? ' · a ciegas' : ''}
                      </TD>
                      <TD>
                        <Badge tone={tonoDeEstado(s.status)}>{s.statusLabel}</Badge>
                      </TD>
                      <TD>
                        {s.lineas.contadas} de {s.lineas.total}
                        {s.lineas.sinResolver > 0 ? ` · ${s.lineas.sinResolver} sin resolver` : ''}
                      </TD>
                      <TD>{s.lineas.conDiferencia}</TD>
                      <TD className="text-ink-muted">{s.startedByName}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            <CardList>
              {datos.data.map((s) => (
                <CardListItem key={s.id}>
                  <div className="flex items-start justify-between gap-2">
                    <a className="font-medium text-ink" href={`/inventarios/${String(s.id)}`}>
                      {s.number}
                    </a>
                    <Badge tone={tonoDeEstado(s.status)}>{s.statusLabel}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {s.lineas.contadas} de {s.lineas.total} líneas · {s.lineas.conDiferencia}{' '}
                    diferencia(s)
                  </p>
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
