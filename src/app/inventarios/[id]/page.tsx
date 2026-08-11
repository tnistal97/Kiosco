'use client'

import { use, useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  ErrorState,
  Input,
  MetricCard,
  Select,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest } from '@/lib/api-client'
import { etiquetaDeLinea, tonoDeEstado } from '@/modules/inventory-counts/estados'

interface Sesion {
  id: number
  number: string
  status: string
  statusLabel: string
  scopeLabel: string
  blindCount: boolean
  notes: string | null
  lineas: {
    total: number
    contadas: number
    pendientes: number
    sinResolver: number
    conDiferencia: number
  }
  /** Líneas que otro inventario ya corrigió. Sólo viene en el detalle. */
  conflictos?: Array<{
    lineId: number
    productName: string
    lotCode: string | null
    sessionNumber: string
  }>
}

interface Linea {
  id: number
  productId: number
  productName: string
  saleUnit: string
  lotId: number | null
  lotCode: string | null
  expirationDate: string | null
  status: string
  statusLabel: string
  countedQuantity: string | null
  firstCountQuantity: string | null
  expectedAtCount: string | null
  variance: string | null
  notes: string | null
}

interface Lineas {
  data: Linea[]
  pagination: { total: number; page: number; pageSize: number }
}

/**
 * Un inventario fisico: contar, revisar y aplicar.
 *
 * La pantalla cambia de forma segun el estado, y esa es la funcionalidad:
 *
 *   contando   una caja de texto por linea. Con conteo a ciegas NO se muestra
 *              lo que el sistema espera, porque verlo hace que la respuesta sea
 *              ese numero.
 *   revision   la tabla de diferencias, con sus filtros.
 *   aplicado   lo mismo, en solo lectura.
 */
export default function InventarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [lineas, setLineas] = useState<Lineas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [estadoLinea, setEstadoLinea] = useState('')
  const [borradores, setBorradores] = useState<Record<number, string>>({})
  const [guardando, setGuardando] = useState(false)

  const puedeContar = usePermiso('inventoryCounts.count')
  const puedeRevisar = usePermiso('inventoryCounts.review')
  const puedeAplicar = usePermiso('inventoryCounts.apply')

  const cargar = useCallback(() => {
    let vivo = true
    setCargando(true)
    const params2 = new URLSearchParams({
      pageSize: '100',
      ...(filtro ? { diferencia: filtro } : {}),
      ...(estadoLinea ? { estado: estadoLinea } : {}),
    })
    Promise.all([
      apiRequest<Sesion>(`/api/inventarios/${id}`, { parse: (d) => d as Sesion }),
      apiRequest<Lineas>(`/api/inventarios/${id}/lineas?${params2.toString()}`, {
        parse: (d) => d as Lineas,
      }),
    ])
      .then(([s, l]) => {
        if (vivo) {
          setSesion(s)
          setLineas(l)
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
  }, [id, filtro, estadoLinea])

  useEffect(() => cargar(), [cargar])

  function guardarConteos() {
    const pendientes = Object.entries(borradores)
      .filter(([, v]) => v.trim() !== '')
      .map(([lineId, v]) => ({ lineId: Number(lineId), countedQuantity: v.trim() }))

    if (pendientes.length === 0) {
      aviso.error('No hay conteos para guardar')
      return
    }

    setGuardando(true)
    apiRequest(`/api/inventarios/${id}/conteo`, {
      method: 'POST',
      body: { lineas: pendientes },
      parse: (d) => d,
    })
      .then(() => {
        aviso.ok(`Se guardaron ${String(pendientes.length)} conteo(s)`)
        setBorradores({})
        cargar()
      })
      .catch((e: unknown) => {
        aviso.error(e instanceof Error ? e.message : 'No se pudieron guardar los conteos')
      })
      .finally(() => {
        setGuardando(false)
      })
  }

  function accion(ruta: string, exito: string, body?: unknown) {
    setGuardando(true)
    apiRequest(`/api/inventarios/${id}/${ruta}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
      parse: (d) => d,
    })
      .then(() => {
        aviso.ok(exito)
        cargar()
      })
      .catch((e: unknown) => {
        aviso.error(e instanceof Error ? e.message : 'No se pudo completar la operación')
      })
      .finally(() => {
        setGuardando(false)
      })
  }

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
  if (cargando || sesion === null || lineas === null) return <SkeletonRows rows={8} />

  const contando = sesion.status === 'DRAFT' || sesion.status === 'COUNTING'
  const enRevision = sesion.status === 'REVIEW'
  const aCiegas = sesion.blindCount && contando

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-2xl font-semibold text-ink">
            {sesion.number}
            <Badge tone={tonoDeEstado(sesion.status)}>{sesion.statusLabel}</Badge>
          </h2>
          <p className="text-sm text-ink-muted">
            {sesion.scopeLabel}
            {sesion.blindCount ? ' · conteo a ciegas' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {contando && puedeContar && (
            <Button onClick={guardarConteos} disabled={guardando}>
              Guardar conteos
            </Button>
          )}
          {sesion.status === 'COUNTING' && puedeRevisar && (
            <Button
              variant="secondary"
              disabled={guardando}
              onClick={() => {
                accion(
                  'revision',
                  'El conteo quedó cerrado: ahora se pueden revisar las diferencias',
                )
              }}
            >
              Cerrar conteo
            </Button>
          )}
          {enRevision && puedeAplicar && (
            <Button
              disabled={guardando}
              onClick={() => {
                accion('aplicar', 'Las diferencias se aplicaron al stock')
              }}
            >
              Aplicar diferencias
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Líneas" value={String(sesion.lineas.total)} />
        <MetricCard label="Contadas" value={String(sesion.lineas.contadas)} />
        <MetricCard
          label="Pendientes"
          value={String(sesion.lineas.pendientes)}
          tone={sesion.lineas.pendientes > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Con diferencia"
          value={aCiegas ? '—' : String(sesion.lineas.conDiferencia)}
          tone={!aCiegas && sesion.lineas.conDiferencia > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {sesion.lineas.sinResolver > 0 && (
        <Alert tone="warning" title="Hay unidades sin partida identificada">
          {sesion.lineas.sinResolver} línea(s) contaron unidades de un producto que se sigue por
          lote sin decir de qué partida son. El inventario no se puede aplicar hasta resolverlas: el
          sistema no inventa códigos de lote.
        </Alert>
      )}

      {/*
        Otro inventario ya corrigió estas partidas. Fase 4D.1.

        Sale ACÁ y no como motivo del rechazo: quien revisa necesita verlo antes
        de apretar Aplicar, no después. Y con todas las líneas, porque lo que
        decide es cuántas hay que volver a contar.
      */}
      {(sesion.conflictos ?? []).length > 0 && (
        <Alert tone="danger" title="Otro inventario ya corrigió parte de esto">
          <p>
            Estas líneas se contaron antes de que otra sesión corrigiera las mismas partidas.
            Aplicar ahora corregiría dos veces la misma diferencia: hay que volver a contarlas.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {(sesion.conflictos ?? []).map((c) => (
              <li key={c.lineId}>
                {c.productName}
                {c.lotCode === null ? '' : ` · partida ${c.lotCode}`} — corregida por{' '}
                {c.sessionNumber}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {aCiegas && (
        <Alert tone="info" title="Conteo a ciegas">
          Lo que el sistema espera no se muestra mientras se cuenta. Aparece al cerrar el conteo.
        </Alert>
      )}

      <Card>
        {!contando && (
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Select
              aria-label="Filtro de diferencias"
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value)
              }}
            >
              <option value="">Todas las líneas</option>
              <option value="con">Sólo con diferencia</option>
              <option value="positivas">Diferencias positivas</option>
              <option value="negativas">Diferencias negativas</option>
            </Select>

            {/*
              El filtro que faltaba. Una sesión de mil líneas con tres sin
              resolver no se puede aplicar, y encontrar esas tres a mano es el
              paso donde el mecanismo se abandona.
            */}
            <Select
              aria-label="Filtro de estado de la línea"
              value={estadoLinea}
              onChange={(e) => {
                setEstadoLinea(e.target.value)
              }}
            >
              <option value="">Todos los estados</option>
              <option value="UNRESOLVED">Sin resolver</option>
              <option value="RECOUNT">Pendientes de segundo conteo</option>
              <option value="COUNTED">Contadas</option>
              <option value="PENDING">Sin contar</option>
            </Select>

            {sesion.lineas.sinResolver > 0 && estadoLinea !== 'UNRESOLVED' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEstadoLinea('UNRESOLVED')
                }}
              >
                Ver las {sesion.lineas.sinResolver} sin resolver
              </Button>
            )}
          </div>
        )}

        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>Lote</TH>
                {!aCiegas && <TH>Esperado</TH>}
                <TH>Contado</TH>
                {!aCiegas && <TH>Diferencia</TH>}
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {lineas.data.map((l) => (
                <TR key={l.id}>
                  <TD>{l.productName}</TD>
                  <TD className="font-mono text-xs">
                    {l.lotCode ?? <span className="text-ink-muted">sin asignar</span>}
                  </TD>
                  {!aCiegas && <TD>{l.expectedAtCount ?? '—'}</TD>}
                  <TD>
                    {contando && puedeContar ? (
                      <Input
                        aria-label={`Contado de ${l.productName}${l.lotCode === null ? '' : ` lote ${l.lotCode}`}`}
                        inputMode="decimal"
                        className="w-24"
                        value={borradores[l.id] ?? l.countedQuantity ?? ''}
                        onChange={(e) => {
                          setBorradores((b) => ({ ...b, [l.id]: e.target.value }))
                        }}
                      />
                    ) : (
                      (l.countedQuantity ?? '—')
                    )}
                  </TD>
                  {!aCiegas && <TD>{l.variance ?? '—'}</TD>}
                  <TD>{etiquetaDeLinea(l.status)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>

        <CardList>
          {lineas.data.map((l) => (
            <CardListItem key={l.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{l.productName}</p>
                  <p className="font-mono text-xs text-ink-muted">{l.lotCode ?? 'sin asignar'}</p>
                </div>
                <span className="text-sm text-ink-muted">{l.statusLabel}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                {contando && puedeContar ? (
                  <Input
                    aria-label={`Contado de ${l.productName} (móvil)`}
                    inputMode="decimal"
                    className="w-28"
                    value={borradores[l.id] ?? l.countedQuantity ?? ''}
                    onChange={(e) => {
                      setBorradores((b) => ({ ...b, [l.id]: e.target.value }))
                    }}
                  />
                ) : (
                  <span>Contado: {l.countedQuantity ?? '—'}</span>
                )}
                {!aCiegas && <span className="text-ink-muted">Dif. {l.variance ?? '—'}</span>}
              </div>
            </CardListItem>
          ))}
        </CardList>
      </Card>
    </div>
  )
}
