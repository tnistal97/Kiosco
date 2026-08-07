'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  Select,
  SkeletonRows,
  Tooltip,
  aviso,
  cn,
} from '@/components/ui'
import { VisorCambios } from '@/components/auditoria/VisorCambios'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaAuditoria, type EntradaAuditoriaDTO } from '@/modules/audit/dto'
import { ACCIONES_AUDITADAS, TABLAS_AUDITADAS } from '@/modules/audit/schemas'

const POR_PAGINA = 25

const NOMBRE_TABLA: Record<string, string> = {
  User: 'Usuarios',
  Product: 'Productos',
  BranchStock: 'Stock',
  Sale: 'Ventas',
  CashRegisterMovement: 'Movimientos de caja',
  CashCount: 'Arqueos',
  Branch: 'Sucursales',
  Category: 'Categorías',
  Supplier: 'Proveedores',
  Authorization: 'Permisos',
}

const NOMBRE_ACCION: Record<
  string,
  { texto: string; glifo: string; tono: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' }
> = {
  create: { texto: 'Alta', glifo: '+', tono: 'success' },
  update: { texto: 'Cambio', glifo: '~', tono: 'primary' },
  delete: { texto: 'Baja', glifo: '−', tono: 'danger' },
  cancel: { texto: 'Anulación', glifo: '✕', tono: 'danger' },
  login: { texto: 'Ingreso', glifo: '→', tono: 'neutral' },
  login_failed: { texto: 'Ingreso fallido', glifo: '⚠', tono: 'warning' },
  logout: { texto: 'Salida', glifo: '←', tono: 'neutral' },
  deny: { texto: 'Permiso denegado', glifo: '⊘', tono: 'warning' },
}

function accionDe(a: string) {
  return NOMBRE_ACCION[a] ?? { texto: a, glifo: '•', tono: 'neutral' as const }
}

/**
 * Identificador de peticion, con boton para copiarlo.
 *
 * Componente aparte para que el `requestId` quede acotado por el tipo: dentro
 * ya no es `string | null`, y no hace falta afirmarlo con `!`.
 */
function PeticionCopiable({
  requestId,
  onCopiar,
}: {
  requestId: string | null
  onCopiar: (id: string) => Promise<void>
}) {
  if (!requestId) return null

  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-ink-faint">Petición:</dt>
      <dd className="flex items-center gap-1">
        <code className="font-mono text-ink-muted">{requestId}</code>
        <Tooltip label="Copiar el identificador">
          <Button size="xs" variant="ghost" onClick={() => void onCopiar(requestId)}>
            Copiar
          </Button>
        </Tooltip>
      </dd>
    </div>
  )
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function AuditoriaPage() {
  const [tabla, setTabla] = useState('')
  const [accion, setAccion] = useState('')
  const [resultado, setResultado] = useState('todos')
  const [requestId, setRequestId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)

  const [entradas, setEntradas] = useState<EntradaAuditoriaDTO[]>([])
  const [total, setTotal] = useState(0)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        resultado,
      })
      if (tabla !== '') params.set('tabla', tabla)
      if (accion !== '') params.set('accion', accion)
      if (desde !== '') params.set('desde', `${desde}T00:00:00.000Z`)
      if (hasta !== '') params.set('hasta', `${hasta}T23:59:59.999Z`)
      // Solo se manda si tiene forma de identificador: si no, el servidor
      // responde 400 y la pantalla parece rota mientras se escribe.
      if (/^[a-fA-F0-9-]{8,64}$/.test(requestId.trim())) {
        params.set('requestId', requestId.trim())
      }

      const r = await apiRequest(`/api/audit?${params.toString()}`, {
        parse: parsePaginaAuditoria,
      })
      setEntradas(r.data)
      setTotal(r.pagination.total)
      setPaginas(r.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la bitácora.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, tabla, accion, resultado, desde, hasta, requestId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  function limpiar() {
    setTabla('')
    setAccion('')
    setResultado('todos')
    setRequestId('')
    setDesde('')
    setHasta('')
    setPagina(1)
  }

  async function copiar(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      aviso.ok('Identificador copiado.')
    } catch {
      aviso.atencion('El navegador no permitió copiar. Seleccionalo a mano.')
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <Card padded={false}>
        <div className="grid grid-cols-2 gap-3 border-b border-line p-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Desde">
            <Input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value)
                setPagina(1)
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value)
                setPagina(1)
              }}
            />
          </Field>
          <Field label="Entidad">
            <Select
              value={tabla}
              onChange={(e) => {
                setTabla(e.target.value)
                setPagina(1)
              }}
            >
              <option value="">Todas</option>
              {TABLAS_AUDITADAS.map((t) => (
                <option key={t} value={t}>
                  {NOMBRE_TABLA[t] ?? t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Acción">
            <Select
              value={accion}
              onChange={(e) => {
                setAccion(e.target.value)
                setPagina(1)
              }}
            >
              <option value="">Todas</option>
              {ACCIONES_AUDITADAS.map((a) => (
                <option key={a} value={a}>
                  {accionDe(a).texto}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Resultado">
            <Select
              value={resultado}
              onChange={(e) => {
                setResultado(e.target.value)
                setPagina(1)
              }}
            >
              <option value="todos">Todos</option>
              <option value="success">Correcto</option>
              <option value="failure">Rechazado</option>
            </Select>
          </Field>
          <Field label="N° de petición" hint="El código que aparece en un error.">
            <Input
              value={requestId}
              placeholder="a1b2c3d4-…"
              className="font-mono text-xs"
              onChange={(e) => {
                setRequestId(e.target.value)
                setPagina(1)
              }}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <p className="text-sm text-ink-muted">
            <span data-numeric="">{total}</span> {total === 1 ? 'entrada' : 'entradas'}
          </p>
          <Button size="sm" variant="ghost" onClick={limpiar}>
            Limpiar filtros
          </Button>
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={8} />
          ) : entradas.length === 0 ? (
            <EmptyState
              title="No hay actividad con esos filtros"
              description="Probá con otro rango de fechas o quitá algún filtro."
            />
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {entradas.map((e) => {
                  const a = accionDe(e.actionType)
                  const abiertaEsta = abierta === e.id
                  const fallo = e.result === 'failure'

                  return (
                    <li
                      key={e.id}
                      className={cn(
                        'rounded-lg border bg-surface transition-colors',
                        fallo ? 'border-warning/40' : 'border-line',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAbierta(abiertaEsta ? null : e.id)
                        }}
                        aria-expanded={abiertaEsta}
                        className="flex min-h-touch w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-raised"
                      >
                        <Badge tone={a.tono}>
                          <span aria-hidden="true">{a.glifo}</span>
                          {a.texto}
                        </Badge>
                        <span className="text-sm font-medium text-ink">
                          {NOMBRE_TABLA[e.tableName] ?? e.tableName}
                          {e.recordId > 0 && (
                            <span className="ml-1 text-ink-faint" data-numeric="">
                              #{e.recordId}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-ink-muted">{e.user.name}</span>
                        {fallo && (
                          <Badge tone="warning">
                            <span aria-hidden="true">⚠</span> Rechazado
                          </Badge>
                        )}
                        <span className="ml-auto text-xs text-ink-faint">{fecha(e.timestamp)}</span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'text-ink-faint transition-transform',
                            abiertaEsta && 'rotate-180',
                          )}
                        >
                          ▾
                        </span>
                      </button>

                      {abiertaEsta && (
                        <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            {e.reason && (
                              <div className="flex gap-1.5">
                                <dt className="text-ink-faint">Motivo:</dt>
                                <dd className="text-ink">{e.reason}</dd>
                              </div>
                            )}
                            {e.origin && (
                              <div className="flex gap-1.5">
                                <dt className="text-ink-faint">Origen:</dt>
                                <dd className="font-mono text-ink-muted">{e.origin}</dd>
                              </div>
                            )}
                            {e.branchId !== null && (
                              <div className="flex gap-1.5">
                                <dt className="text-ink-faint">Sucursal:</dt>
                                <dd className="text-ink-muted" data-numeric="">
                                  #{e.branchId}
                                </dd>
                              </div>
                            )}
                            <PeticionCopiable requestId={e.requestId} onCopiar={copiar} />
                          </dl>

                          <VisorCambios before={e.changes.before} after={e.changes.after} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>

              <Pagination
                className="mt-4"
                page={pagina}
                pageSize={POR_PAGINA}
                total={total}
                totalPages={paginas}
                onPageChange={setPagina}
                disabled={cargando}
              />
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
