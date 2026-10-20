'use client'

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  formatQuantity,
  PageContainer,
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Money,
  Skeleton,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  cn,
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { absMonto, esCero, esNegativo, type Monto } from '@/lib/money'
import { cantidadDeDias, sumarDias, type FechaLocal } from '@/lib/tiempo'
import type { FuncionOpcional } from '@/lib/funciones'
import type { Permission } from '@/server/authz/permissions'
import { MEDIO_EFECTIVO, MEDIO_MERCADO_PAGO } from '@/modules/sales/payment-methods'
import {
  parseReporteCaja,
  parseReporteClientes,
  parseReporteProveedores,
  parseReporteCompras,
  parseReporteInventario,
  parseReporteProductos,
  parseReporteRentabilidad,
  parseReporteVentas,
  type ReporteCajaDTO,
  type ReporteClientesDTO,
  type ReporteProveedoresDTO,
  type ReporteComprasDTO,
  type ReporteInventarioDTO,
  type ReporteProductosDTO,
  type ReporteRentabilidadDTO,
  type ReporteVentasDTO,
} from '@/modules/reports/dto'
import type {
  ReporteDeInventarios,
  ReporteDeMermas,
  ReporteDeVencimientos,
} from '@/modules/reports/service.lots'

/**
 * Reportes. UX V5, segunda vuelta.
 *
 * Antes eran diez tarjetas apiladas --ventas, rentabilidad, productos,
 * clientes, proveedores, inventario, mermas, vencimientos, compras, caja-- con
 * cuarenta numeros a la vista. Para alguien que no es contador eso no es un
 * reporte: es una pared. Ahora la pantalla tiene tres pisos:
 *
 *   1. HOY, en seis tarjetas: total vendido, cantidad de ventas, efectivo,
 *      transferencia, Mercado Pago y ticket promedio. Es lo que el dueño
 *      quiere saber al llegar.
 *   2. LOS REPORTES, como accesos con nombre de pregunta: ventas por dia, por
 *      medio de pago, por producto, por usuario y cierres de caja. Debajo, mas
 *      chicos, los que se miran de vez en cuando (ganancia, clientes, stock…).
 *   3. EL REPORTE ELEGIDO, uno solo, con su periodo.
 *
 * Cada acceso tiene su permiso: quien no lo tiene no lo ve y la pantalla no lo
 * pide --una peticion que va a responder 403 llena la bitacora de rechazos que
 * no significan nada--. El reporte elegido queda en la direccion (`?ver=caja`)
 * para poder llegar directo desde otra pantalla.
 *
 * El dia de "hoy" lo dice la sucursal, no el reloj del dispositivo. Ver
 * docs/TIMEZONE_POLICY.md.
 */

type Vista =
  | 'dia'
  | 'medio'
  | 'producto'
  | 'usuario'
  | 'caja'
  | 'ganancia'
  | 'clientes'
  | 'stock'
  | 'mermas'
  | 'inventarios'
  | 'vencimientos'
  | 'compras'
  | 'proveedores'

interface Acceso {
  id: Vista
  titulo: string
  descripcion: string
  permiso: Permission
  /** Solo si la instalacion tiene esa funcion encendida (lotes, compras). */
  funcion?: FuncionOpcional
  /** El reporte es del estado de HOY y no de un periodo. */
  sinPeriodo?: boolean
  icono?: ReactNode
}

const PRINCIPALES: readonly Acceso[] = [
  {
    id: 'dia',
    titulo: 'Ventas por día',
    descripcion: 'Cuánto se vendió cada día',
    permiso: 'reports.sales.view',
    icono: <IconoCalendario />,
  },
  {
    id: 'medio',
    titulo: 'Ventas por medio de pago',
    descripcion: 'Efectivo, transferencia, Mercado Pago…',
    permiso: 'reports.sales.view',
    icono: <IconoBilletera />,
  },
  {
    id: 'producto',
    titulo: 'Ventas por producto',
    descripcion: 'Lo que más y lo que menos se vende',
    permiso: 'reports.sales.view',
    icono: <IconoCaja />,
  },
  {
    id: 'usuario',
    titulo: 'Ventas por usuario',
    descripcion: 'Cuánto vendió cada persona',
    permiso: 'reports.sales.view',
    icono: <IconoPersona />,
  },
  {
    id: 'caja',
    titulo: 'Cierres de caja',
    descripcion: 'Cada cierre, con lo contado y la diferencia',
    permiso: 'reports.cash.view',
    icono: <IconoCajon />,
  },
]

const OTROS: readonly Acceso[] = [
  {
    id: 'ganancia',
    titulo: 'Ganancia',
    descripcion: 'Lo vendido menos lo que costó',
    permiso: 'reports.costs.view',
  },
  {
    id: 'clientes',
    titulo: 'Clientes y fiado',
    descripcion: 'Lo que deben y lo cobrado',
    permiso: 'reports.clients.view',
  },
  {
    id: 'stock',
    titulo: 'Stock',
    descripcion: 'Agotados y bajo mínimo',
    permiso: 'reports.inventory.view',
    sinPeriodo: true,
  },
  {
    id: 'mermas',
    titulo: 'Mermas',
    descripcion: 'Lo que se perdió sin venderse',
    permiso: 'reports.inventory.view',
  },
  {
    id: 'inventarios',
    titulo: 'Inventarios',
    descripcion: 'Los recuentos y sus diferencias',
    permiso: 'reports.inventory.view',
  },
  {
    id: 'vencimientos',
    titulo: 'Vencimientos',
    descripcion: 'Lo que está por vencer',
    permiso: 'lots.view',
    funcion: 'lotes',
    sinPeriodo: true,
  },
  {
    id: 'compras',
    titulo: 'Compras',
    descripcion: 'Lo que llegó de los proveedores',
    permiso: 'reports.purchases.view',
    funcion: 'compras',
  },
  {
    id: 'proveedores',
    titulo: 'Proveedores',
    descripcion: 'Lo que se les debe y lo pagado',
    permiso: 'reports.purchases.view',
    funcion: 'compras',
  },
]

const TODOS = [...PRINCIPALES, ...OTROS]

function esVista(v: string | null): v is Vista {
  return TODOS.some((a) => a.id === v)
}

/**
 * `useSearchParams` obliga a un limite de Suspense: sin el, el build de Next
 * falla al prerenderizar la pagina.
 */
export default function ReportesPage() {
  return (
    <Suspense fallback={null}>
      <Reportes />
    </Suspense>
  )
}

function Reportes() {
  const { puede, tiene, hoy } = useSession()
  const params = useSearchParams()

  const disponibles = useMemo(
    () => TODOS.filter((a) => puede(a.permiso) && (a.funcion === undefined || tiene(a.funcion))),
    [puede, tiene],
  )
  const principales = disponibles.filter((a) => PRINCIPALES.includes(a))
  const otros = disponibles.filter((a) => OTROS.includes(a))
  const verVentas = puede('reports.sales.view')

  const pedida = params.get('ver')
  const [elegida, setElegida] = useState<Vista | null>(() => (esVista(pedida) ? pedida : null))
  const vista = disponibles.find((a) => a.id === elegida) ?? disponibles[0] ?? null

  const [desde, setDesde] = useState(() => sumarDias(hoy(), -6))
  const [hasta, setHasta] = useState(() => hoy())

  function elegir(id: Vista) {
    setElegida(id)
    // La direccion acompaña, para volver o compartir el reporte elegido.
    window.history.replaceState(null, '', `?ver=${id}`)
  }

  if (disponibles.length === 0) {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            title="No tenés reportes asignados"
            description="Tu rol no incluye ninguna de las materias de esta pantalla."
          />
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer width="wide" className="gap-8">
      {verVentas && <ResumenDeHoy dia={hoy()} />}

      <section aria-labelledby="titulo-accesos" className="flex flex-col gap-4">
        <div>
          <h2 id="titulo-accesos" className="text-lg font-semibold text-ink">
            Reportes
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">Elegí qué querés mirar.</p>
        </div>

        {principales.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {principales.map((a) => (
              <AccesoGrande
                key={a.id}
                acceso={a}
                activo={vista?.id === a.id}
                onElegir={() => {
                  elegir(a.id)
                }}
              />
            ))}
          </div>
        )}

        {otros.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-muted">Más reportes</h3>
            <div className="flex flex-wrap gap-2">
              {otros.map((a) => (
                <AccesoChico
                  key={a.id}
                  acceso={a}
                  activo={vista?.id === a.id}
                  onElegir={() => {
                    elegir(a.id)
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {vista && (
        <section
          aria-labelledby="titulo-reporte"
          data-reporte={vista.id}
          className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 id="titulo-reporte" className="text-xl font-semibold text-ink">
                {vista.titulo}
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {vista.sinPeriodo ? 'Estado de hoy, no de un período.' : vista.descripcion}
              </p>
            </div>
            {!vista.sinPeriodo && (
              <Periodo
                desde={desde}
                hasta={hasta}
                hoy={hoy()}
                onCambiar={(d, h) => {
                  setDesde(d)
                  setHasta(h)
                }}
              />
            )}
          </div>

          <ContenidoDelReporte vista={vista.id} desde={desde} hasta={hasta} />
        </section>
      )}
    </PageContainer>
  )
}

// ------------------------------------------------------------------ datos

interface EstadoDeReporte<T> {
  datos: T | null
  cargando: boolean
  error: string | null
  recargar: () => void
}

/** Pide un reporte cuando cambia su direccion. `null` no pide nada. */
function useReporte<T>(url: string | null, parse: (raw: unknown) => T): EstadoDeReporte<T> {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(url !== null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (url === null) return
    let vivo = true
    setCargando(true)
    setError(null)
    apiRequest(url, { parse })
      .then((d) => {
        if (vivo) setDatos(d)
      })
      .catch((e: unknown) => {
        if (vivo) setError(mensajeDeError(e, 'No se pudo calcular el reporte.'))
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
    // `parse` es una funcion de modulo: no cambia entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, vuelta])

  const recargar = useCallback(() => {
    setVuelta((n) => n + 1)
  }, [])

  return { datos, cargando, error, recargar }
}

function Cargando({ estado, children }: { estado: EstadoDeReporte<unknown>; children: ReactNode }) {
  if (estado.error !== null) {
    return (
      <ErrorState
        title="No se pudo calcular"
        description={estado.error}
        onRetry={estado.recargar}
      />
    )
  }
  if (estado.cargando || estado.datos === null) return <Skeleton className="h-48" />
  return <>{children}</>
}

// ------------------------------------------------------------------ hoy

function fechaLarga(dia: FechaLocal): string {
  // Mediodia: la fecha sola, sin que la zona del dispositivo la corra de dia.
  return new Date(`${dia}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function porcentaje(parte: Monto, total: Monto): string | null {
  const t = Number(total)
  if (!(t > 0)) return null
  return `${String(Math.round((Number(parte) / t) * 100))}% del total`
}

/** Las seis tarjetas del dia. Es lo primero que se mira al entrar. */
function ResumenDeHoy({ dia }: { dia: FechaLocal }) {
  const estado = useReporte(`/api/reports/ventas?desde=${dia}&hasta=${dia}`, parseReporteVentas)
  const d = estado.datos

  const cobrado = (medio: string): Monto =>
    d?.porMedio.find((m) => m.medio === medio)?.cobrado ?? '0.00'
  const otros =
    d?.porMedio.filter(
      (m) => m.medio !== MEDIO_EFECTIVO && m.medio !== 'TRANSFER' && m.medio !== MEDIO_MERCADO_PAGO,
    ) ?? []

  return (
    <section aria-labelledby="titulo-hoy" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titulo-hoy" className="text-lg font-semibold text-ink">
            Resumen de hoy
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted first-letter:uppercase">
            {fechaLarga(dia)} · sin contar las ventas anuladas
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={estado.recargar} disabled={estado.cargando}>
          {estado.cargando ? 'Actualizando…' : 'Actualizar'}
        </Button>
      </div>

      {estado.error !== null ? (
        <ErrorState
          title="No se pudo calcular"
          description={estado.error}
          onRetry={estado.recargar}
        />
      ) : d === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={`esqueleto-${String(i)}`} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          {/* Tres por fila como mucho: con seis, un total de siete cifras no
              entraba en su tarjeta. */}
          <div data-resumen-hoy="" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TarjetaDelDia
              titulo="Total vendido hoy"
              destacada
              valor={<Money amount={d.totales.facturado} size="xl" />}
              detalle={
                d.totales.anuladas > 0
                  ? `${String(d.totales.anuladas)} anulada${d.totales.anuladas === 1 ? '' : 's'}, no suman`
                  : 'Todas las formas de pago'
              }
            />
            <TarjetaDelDia
              titulo="Cantidad de ventas"
              valor={<span data-numeric="">{d.totales.operaciones}</span>}
              detalle={d.totales.operaciones === 1 ? 'venta' : 'ventas'}
            />
            <TarjetaDelDia
              titulo="Efectivo"
              valor={<Money amount={cobrado(MEDIO_EFECTIVO)} size="xl" />}
              detalle={porcentaje(cobrado(MEDIO_EFECTIVO), d.totales.facturado) ?? 'Sin cobros'}
            />
            <TarjetaDelDia
              titulo="Transferencia"
              valor={<Money amount={cobrado('TRANSFER')} size="xl" />}
              detalle={porcentaje(cobrado('TRANSFER'), d.totales.facturado) ?? 'Sin cobros'}
            />
            <TarjetaDelDia
              titulo="Mercado Pago"
              valor={<Money amount={cobrado(MEDIO_MERCADO_PAGO)} size="xl" />}
              detalle={porcentaje(cobrado(MEDIO_MERCADO_PAGO), d.totales.facturado) ?? 'Sin cobros'}
            />
            <TarjetaDelDia
              titulo="Ticket promedio"
              valor={<Money amount={d.totales.ticketPromedio} size="xl" />}
              detalle="Lo que gasta cada cliente"
            />
          </div>
          {otros.length > 0 && (
            <p className="text-sm text-ink-muted">
              <span className="font-medium text-ink">Otros medios hoy:</span>{' '}
              {otros.map((m, i) => (
                <span key={m.medio}>
                  {i > 0 && ' · '}
                  {m.etiqueta} <Money amount={m.cobrado} size="sm" />
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function TarjetaDelDia({
  titulo,
  valor,
  detalle,
  destacada = false,
}: {
  titulo: string
  valor: ReactNode
  detalle: string
  destacada?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-lg border px-4 py-3 sm:gap-1 sm:py-4',
        destacada ? 'border-primary/40 bg-primary-quiet' : 'border-line bg-surface',
      )}
    >
      <span className="text-sm font-medium text-ink-muted">{titulo}</span>
      {/* En el telefono, un punto menos: la cifra entra entera en su renglon. */}
      <span className="text-2xl font-semibold text-ink sm:text-3xl [&_.money]:text-2xl sm:[&_.money]:text-3xl">
        {valor}
      </span>
      <span className="text-sm text-ink-muted">{detalle}</span>
    </div>
  )
}

// ------------------------------------------------------------------ accesos

function AccesoGrande({
  acceso,
  activo,
  onElegir,
}: {
  acceso: Acceso
  activo: boolean
  onElegir: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      data-acceso={acceso.id}
      onClick={onElegir}
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        activo
          ? 'border-primary bg-primary-quiet ring-1 ring-primary'
          : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
          activo ? 'bg-primary text-ink-on-solid' : 'bg-raised text-ink-muted',
        )}
      >
        {acceso.icono}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-ink">{acceso.titulo}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{acceso.descripcion}</span>
      </span>
    </button>
  )
}

function AccesoChico({
  acceso,
  activo,
  onElegir,
}: {
  acceso: Acceso
  activo: boolean
  onElegir: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      data-acceso={acceso.id}
      title={acceso.descripcion}
      onClick={onElegir}
      className={cn(
        'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        activo
          ? 'border-primary bg-primary-quiet text-ink'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {acceso.titulo}
    </button>
  )
}

// ------------------------------------------------------------------ periodo

function Periodo({
  desde,
  hasta,
  hoy,
  onCambiar,
}: {
  desde: FechaLocal
  hasta: FechaLocal
  hoy: FechaLocal
  onCambiar: (desde: FechaLocal, hasta: FechaLocal) => void
}) {
  const inicioDeMes = `${hoy.slice(0, 8)}01`
  const rapidos: Array<{ id: string; texto: string; desde: FechaLocal; hasta: FechaLocal }> = [
    { id: 'hoy', texto: 'Hoy', desde: hoy, hasta: hoy },
    { id: 'semana', texto: 'Últimos 7 días', desde: sumarDias(hoy, -6), hasta: hoy },
    { id: 'mes', texto: 'Este mes', desde: inicioDeMes, hasta: hoy },
  ]

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div role="group" aria-label="Período rápido" className="flex flex-wrap gap-1">
        {rapidos.map((r) => {
          const activo = r.desde === desde && r.hasta === hasta
          return (
            <Button
              key={r.id}
              size="sm"
              variant={activo ? 'primary' : 'secondary'}
              aria-pressed={activo}
              onClick={() => {
                onCambiar(r.desde, r.hasta)
              }}
            >
              {r.texto}
            </Button>
          )
        })}
      </div>
      <Field label="Desde" className="w-40">
        {/* Sin `id` propio: `Field` genera el suyo y lo asocia a la etiqueta. */}
        <Input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => {
            if (e.target.value) onCambiar(e.target.value, hasta)
          }}
        />
      </Field>
      <Field label="Hasta" className="w-40">
        <Input
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => {
            if (e.target.value) onCambiar(desde, e.target.value)
          }}
        />
      </Field>
    </div>
  )
}

// ------------------------------------------------------------------ reportes

function ContenidoDelReporte({
  vista,
  desde,
  hasta,
}: {
  vista: Vista
  desde: FechaLocal
  hasta: FechaLocal
}) {
  const q = `desde=${desde}&hasta=${hasta}`
  const deVentas = vista === 'dia' || vista === 'medio' || vista === 'usuario'

  const ventas = useReporte(deVentas ? `/api/reports/ventas?${q}` : null, parseReporteVentas)
  const productos = useReporte(
    vista === 'producto' ? `/api/reports/productos?${q}` : null,
    parseReporteProductos,
  )
  const caja = useReporte(vista === 'caja' ? `/api/reports/caja?${q}` : null, parseReporteCaja)
  const rent = useReporte(
    vista === 'ganancia' ? `/api/reports/rentabilidad?${q}` : null,
    parseReporteRentabilidad,
  )
  const clientes = useReporte(
    vista === 'clientes' ? `/api/reports/clientes?${q}` : null,
    parseReporteClientes,
  )
  const inv = useReporte(
    vista === 'stock' ? `/api/reports/inventario?${q}` : null,
    parseReporteInventario,
  )
  const mermas = useReporte(
    vista === 'mermas' ? `/api/reports/mermas?${q}` : null,
    (r) => r as ReporteDeMermas,
  )
  const inventarios = useReporte(
    vista === 'inventarios' ? `/api/reports/inventarios?${q}` : null,
    (r) => r as ReporteDeInventarios,
  )
  const vencimientos = useReporte(
    vista === 'vencimientos' ? '/api/reports/vencimientos' : null,
    (r) => r as ReporteDeVencimientos,
  )
  const compras = useReporte(
    vista === 'compras' ? `/api/reports/compras?${q}` : null,
    parseReporteCompras,
  )
  const proveedores = useReporte(
    vista === 'proveedores' ? `/api/reports/proveedores?${q}` : null,
    parseReporteProveedores,
  )

  switch (vista) {
    case 'dia':
      return (
        <Cargando estado={ventas}>
          {ventas.datos && <VentasPorDia datos={ventas.datos} desde={desde} hasta={hasta} />}
        </Cargando>
      )
    case 'medio':
      return (
        <Cargando estado={ventas}>
          {ventas.datos && <VentasPorMedio datos={ventas.datos} />}
        </Cargando>
      )
    case 'usuario':
      return (
        <Cargando estado={ventas}>
          {ventas.datos && <VentasPorUsuario datos={ventas.datos} />}
        </Cargando>
      )
    case 'producto':
      return (
        <Cargando estado={productos}>
          {productos.datos && <VentasPorProducto datos={productos.datos} />}
        </Cargando>
      )
    case 'caja':
      return <Cargando estado={caja}>{caja.datos && <CierresDeCaja datos={caja.datos} />}</Cargando>
    case 'ganancia':
      return <Cargando estado={rent}>{rent.datos && <Ganancia datos={rent.datos} />}</Cargando>
    case 'clientes':
      return (
        <Cargando estado={clientes}>
          {clientes.datos && <Clientes datos={clientes.datos} />}
        </Cargando>
      )
    case 'stock':
      return <Cargando estado={inv}>{inv.datos && <Stock datos={inv.datos} />}</Cargando>
    case 'mermas':
      return <Cargando estado={mermas}>{mermas.datos && <Mermas datos={mermas.datos} />}</Cargando>
    case 'inventarios':
      return (
        <Cargando estado={inventarios}>
          {inventarios.datos && <Inventarios datos={inventarios.datos} />}
        </Cargando>
      )
    case 'vencimientos':
      return (
        <Cargando estado={vencimientos}>
          {vencimientos.datos && <Vencimientos datos={vencimientos.datos} />}
        </Cargando>
      )
    case 'compras':
      return (
        <Cargando estado={compras}>{compras.datos && <Compras datos={compras.datos} />}</Cargando>
      )
    case 'proveedores':
      return (
        <Cargando estado={proveedores}>
          {proveedores.datos && <Proveedores datos={proveedores.datos} />}
        </Cargando>
      )
  }
}

// ---- ventas

/** "mar 20/10". Armado a mano: cada navegador separa distinto el dia y el mes. */
function diaCorto(dia: string): string {
  const semana = new Date(`${dia}T12:00:00`)
    .toLocaleDateString('es-AR', { weekday: 'short' })
    .replace('.', '')
  return `${semana} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

function promedio(total: Monto, cuantas: number): Monto {
  return cuantas === 0 ? '0.00' : (Number(total) / cuantas).toFixed(2)
}

/**
 * Los dias del rango, con los que no tuvieron ventas en cero. Un dia sin
 * ventas que no aparece se lee como "me olvide de mirar ese dia". El mas
 * reciente arriba: es el que se busca.
 */
function completarDias(
  porDia: ReporteVentasDTO['porDia'],
  desde: FechaLocal,
  hasta: FechaLocal,
): ReporteVentasDTO['porDia'] {
  if (cantidadDeDias(desde, hasta) > 93) return [...porDia].reverse()
  const mapa = new Map(porDia.map((d) => [d.dia, d]))
  const filas: ReporteVentasDTO['porDia'] = []
  for (let d = hasta; d >= desde; d = sumarDias(d, -1)) {
    filas.push(mapa.get(d) ?? { dia: d, facturado: '0.00', operaciones: 0 })
  }
  return filas
}

function TotalesDeVentas({ datos }: { datos: ReporteVentasDTO }) {
  return (
    <Cifras>
      <Cifra titulo="Total vendido" valor={<Money amount={datos.totales.facturado} size="lg" />} />
      <Cifra titulo="Ventas" valor={String(datos.totales.operaciones)} />
      <Cifra
        titulo="Ticket promedio"
        valor={<Money amount={datos.totales.ticketPromedio} size="lg" />}
      />
      <Cifra
        titulo="Anuladas"
        valor={String(datos.totales.anuladas)}
        detalle={
          datos.totales.anuladas > 0 ? (
            <>
              <Money amount={datos.totales.facturadoAnulado} size="sm" tone="muted" /> que no suman
            </>
          ) : undefined
        }
      />
    </Cifras>
  )
}

function VentasPorDia({
  datos,
  desde,
  hasta,
}: {
  datos: ReporteVentasDTO
  desde: FechaLocal
  hasta: FechaLocal
}) {
  const filas = completarDias(datos.porDia, desde, hasta)
  const maximo = Math.max(0, ...filas.map((f) => Number(f.facturado)))
  return (
    <>
      <TotalesDeVentas datos={datos} />
      {datos.totales.operaciones === 0 ? (
        <SinDatos />
      ) : (
        <Tabla
          titulo="Ventas por día"
          cabeceras={['Día', 'Ventas', 'Ticket promedio', 'Total vendido', '']}
          filas={filas.map((f) => [
            <span key="d" className="capitalize">
              {diaCorto(f.dia)}
            </span>,
            String(f.operaciones),
            <Money key="p" amount={promedio(f.facturado, f.operaciones)} size="sm" tone="muted" />,
            <Money key="t" amount={f.facturado} className="font-semibold" />,
            <Barra key="b" valor={Number(f.facturado)} maximo={maximo} />,
          ])}
        />
      )}
    </>
  )
}

function VentasPorMedio({ datos }: { datos: ReporteVentasDTO }) {
  const maximo = Math.max(0, ...datos.porMedio.map((m) => Number(m.cobrado)))
  return (
    <>
      <TotalesDeVentas datos={datos} />
      {datos.porMedio.length === 0 ? (
        <SinDatos />
      ) : (
        <>
          <Tabla
            titulo="Ventas por medio de pago"
            cabeceras={['Medio de pago', 'Cobros', '% del total', 'Cobrado', '']}
            filas={datos.porMedio.map((m) => [
              <span key="m" className="font-medium">
                {m.etiqueta}
              </span>,
              String(m.operaciones),
              porcentaje(m.cobrado, datos.totales.facturado)?.replace(' del total', '') ?? '—',
              <Money key="c" amount={m.cobrado} className="font-semibold" />,
              <Barra key="b" valor={Number(m.cobrado)} maximo={maximo} />,
            ])}
          />
          <p className="text-sm text-ink-muted">
            Una venta pagada en partes (por ejemplo, efectivo y transferencia) suma un cobro en cada
            medio. Solo el efectivo entra al cajón.
          </p>
        </>
      )}
    </>
  )
}

function VentasPorUsuario({ datos }: { datos: ReporteVentasDTO }) {
  const maximo = Math.max(0, ...datos.porCajero.map((c) => Number(c.facturado)))
  return (
    <>
      <TotalesDeVentas datos={datos} />
      {datos.porCajero.length === 0 ? (
        <SinDatos />
      ) : (
        <Tabla
          titulo="Ventas por usuario"
          cabeceras={['Usuario', 'Ventas', 'Ticket promedio', 'Total vendido', '']}
          filas={datos.porCajero.map((c) => [
            <span key="u" className="font-medium">
              {c.usuario}
            </span>,
            String(c.operaciones),
            <Money key="p" amount={promedio(c.facturado, c.operaciones)} size="sm" tone="muted" />,
            <Money key="f" amount={c.facturado} className="font-semibold" />,
            <Barra key="b" valor={Number(c.facturado)} maximo={maximo} />,
          ])}
        />
      )}
    </>
  )
}

function VentasPorProducto({ datos }: { datos: ReporteProductosDTO }) {
  const maximo = Math.max(0, ...datos.masVendidos.map((p) => Number(p.facturado)))
  if (datos.masVendidos.length === 0) return <SinDatos />
  return (
    <>
      <Tabla
        titulo="Lo más vendido"
        cabeceras={['Producto', 'Unidades', 'Total vendido', '']}
        filas={datos.masVendidos.map((p) => [
          <span key="p" className="font-medium">
            {p.producto}
          </span>,
          formatQuantity(p.unidades, null),
          <Money key="f" amount={p.facturado} className="font-semibold" />,
          <Barra key="b" valor={Number(p.facturado)} maximo={maximo} />,
        ])}
      />
      <Tabla
        titulo="Lo menos vendido"
        cabeceras={['Producto', 'Unidades', 'Total vendido']}
        filas={datos.menosVendidos.map((p) => [
          p.producto,
          formatQuantity(p.unidades, null),
          <Money key="f" amount={p.facturado} />,
        ])}
      />
      {datos.sinVentas > 0 && (
        <p className="text-sm text-ink-muted">
          Además, {datos.sinVentas} producto{datos.sinVentas === 1 ? '' : 's'} activo
          {datos.sinVentas === 1 ? '' : 's'} no se vendi{datos.sinVentas === 1 ? 'ó' : 'eron'} en el
          período.
        </p>
      )}
    </>
  )
}

// ---- caja

function fechaYHora(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function Diferencia({ monto }: { monto: Monto | null }) {
  if (monto === null) return <span className="text-ink-muted">—</span>
  if (esCero(monto)) return <span className="font-semibold text-success">✓ Cuadró</span>
  return (
    <span className="font-semibold whitespace-nowrap text-warning">
      ▲ {esNegativo(monto) ? 'Faltó' : 'Sobró'} <Money amount={absMonto(monto)} size="sm" />
    </span>
  )
}

function CierresDeCaja({ datos }: { datos: ReporteCajaDTO }) {
  return (
    <>
      {/* Sobrantes y faltantes por separado: un cierre que sobro y otro que
          falto no son un cero. */}
      <Cifras>
        <Cifra titulo="Cajas cerradas" valor={String(datos.turnos)} />
        <Cifra
          titulo="Con diferencia"
          valor={String(datos.turnosConDiferencia)}
          detalle={
            datos.turnos > 0 && datos.turnosConDiferencia === 0 ? 'Todas cuadraron' : undefined
          }
        />
        <Cifra titulo="Sobrantes" valor={<Money amount={datos.sobrantes} size="lg" />} />
        <Cifra titulo="Faltantes" valor={<Money amount={absMonto(datos.faltantes)} size="lg" />} />
      </Cifras>

      {datos.detalle.length === 0 ? (
        <SinDatos texto="No se abrió ninguna caja en el período." />
      ) : (
        <Tabla
          titulo="Cierres"
          textos={3}
          cabeceras={['Caja', 'Abrió', 'Cerró', 'Tenía que haber', 'Contado', 'Diferencia']}
          filas={datos.detalle.map((t) => [
            <span key="n" data-numeric="">
              #{t.turno}
            </span>,
            <span key="a">
              {t.abrio ?? '—'}
              <span className="block text-xs text-ink-muted">{fechaYHora(t.abierto)}</span>
            </span>,
            t.cerrado === null ? (
              <span key="c" className="text-ink-muted">
                Sigue abierta
              </span>
            ) : (
              <span key="c">
                {t.cerradoPor ?? '—'}
                <span className="block text-xs text-ink-muted">{fechaYHora(t.cerrado)}</span>
              </span>
            ),
            t.esperado === null ? '—' : <Money key="e" amount={t.esperado} size="sm" />,
            t.contado === null ? '—' : <Money key="k" amount={t.contado} size="sm" />,
            <Diferencia key="d" monto={t.diferencia} />,
          ])}
        />
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">Efectivo del período</h3>
        <Cifras>
          <Cifra
            titulo="Ventas en efectivo"
            valor={<Money amount={datos.ventasEnEfectivo} size="lg" />}
          />
          <Cifra titulo="Ingresos" valor={<Money amount={datos.ingresos} size="lg" />} />
          <Cifra titulo="Egresos" valor={<Money amount={datos.egresos} size="lg" />} />
          <Cifra titulo="Retiros" valor={<Money amount={datos.retiros} size="lg" />} />
        </Cifras>
      </div>
    </>
  )
}

// ---- otros

function Ganancia({ datos: rent }: { datos: ReporteRentabilidadDTO }) {
  return (
    <>
      <p className="text-sm text-ink-muted">
        Con el costo que tenía cada producto AL VENDERSE, no con el de hoy.
      </p>
      <Cifras>
        <Cifra titulo="Vendido" valor={<Money amount={rent.facturado} size="lg" />} />
        <Cifra
          titulo="Costo de lo vendido"
          valor={<Money amount={rent.costoVendido} size="lg" />}
        />
        <Cifra titulo="Ganancia bruta" valor={<Money amount={rent.gananciaBruta} size="lg" />} />
        <Cifra
          titulo="Margen"
          valor={rent.margenBruto === null ? 'sin ventas' : `${rent.margenBruto}%`}
        />
      </Cifras>

      {rent.lineasSinCosto > 0 && (
        <Alert tone="warning">
          {rent.lineasSinCosto} de {rent.lineasTotales} líneas no tenían costo cargado y quedan
          fuera de este cálculo, junto con los <Money amount={rent.facturadoSinCosto} /> que
          facturaron. Contarlas con costo cero las mostraría como lo más rentable del local.
        </Alert>
      )}

      <Tabla
        titulo="Por producto"
        cabeceras={['Producto', 'Vendido', 'Costo', 'Ganancia', 'Margen']}
        filas={rent.porProducto.map((p) => [
          p.producto,
          <Money key="f" amount={p.facturado} />,
          <Money key="c" amount={p.costo} />,
          <Money key="g" amount={p.ganancia} />,
          p.margen === null ? '—' : `${p.margen}%`,
        ])}
      />
    </>
  )
}

function Clientes({ datos: clientes }: { datos: ReporteClientesDTO }) {
  return (
    <>
      <p className="text-sm text-ink-muted">
        La cartera es de hoy; lo fiado y lo cobrado, del período. No es ganancia: es lo que falta
        cobrar.
      </p>
      <Cifras>
        <Cifra
          titulo="Saldo pendiente"
          valor={<Money amount={clientes.cartera.saldoPendiente} size="lg" />}
          detalle={`${String(clientes.cartera.deudores)} cliente(s) deben`}
        />
        <Cifra
          titulo="Deuda promedio"
          valor={<Money amount={clientes.cartera.deudaPromedio} size="lg" />}
          detalle="Entre los que deben, no entre todos"
        />
        <Cifra
          titulo="Saldo a favor"
          valor={<Money amount={clientes.cartera.saldoAFavor} size="lg" />}
          detalle={`${String(clientes.cartera.conSaldoAFavor)} cliente(s) con crédito`}
        />
        <Cifra
          titulo="Sobre el límite"
          valor={String(clientes.cartera.sobreLimite)}
          detalle="Casi siempre por una autorización"
        />
      </Cifras>

      <Cifras>
        <Cifra
          titulo="Vendido a cuenta"
          valor={<Money amount={clientes.periodo.ventasACuenta} size="lg" />}
          detalle={`${String(clientes.periodo.cuantasVentasACuenta)} venta(s) en el período`}
        />
        <Cifra
          titulo="Cobrado"
          valor={<Money amount={clientes.periodo.cobrado} size="lg" />}
          detalle={`${String(clientes.periodo.cuantosCobros)} cobro(s)`}
        />
        <Cifra
          titulo="De eso, en efectivo"
          valor={<Money amount={clientes.periodo.cobradoEnEfectivo} size="lg" />}
          detalle="Lo único que entró al cajón"
        />
        <Cifra
          titulo="Ajustes manuales"
          valor={<Money amount={clientes.periodo.ajustes} size="lg" />}
          detalle="Correcciones administrativas"
        />
      </Cifras>

      <Tabla
        titulo="Quiénes deben más"
        cabeceras={['Cliente', 'Saldo', 'Límite']}
        filas={clientes.topDeudores.map((d) => [
          d.cliente,
          <Money key="s" amount={d.saldo} size="sm" />,
          d.limite === null ? 'Sin límite' : <Money key="l" amount={d.limite} size="sm" />,
        ])}
      />

      <Tabla
        titulo="Cobros por medio"
        cabeceras={['Medio', 'Cobrado', 'Cobros']}
        filas={clientes.cobrosPorMedio.map((m) => [
          m.etiqueta,
          <Money key="c" amount={m.cobrado} size="sm" />,
          String(m.cuantos),
        ])}
      />
    </>
  )
}

function Stock({ datos: inv }: { datos: ReporteInventarioDTO }) {
  return (
    <>
      <Cifras>
        <Cifra titulo="Productos activos" valor={String(inv.productos)} />
        <Cifra titulo="Agotados" valor={String(inv.agotados)} />
        <Cifra titulo="Bajo mínimo" valor={String(inv.bajoMinimo)} />
        <Cifra titulo="Sin costo cargado" valor={String(inv.sinCosto)} />
      </Cifras>

      {inv.valorizado !== null && (
        <Cifras>
          <Cifra
            titulo="Stock valorizado"
            valor={<Money amount={inv.valorizado} size="lg" />}
            detalle={
              inv.productosSinValorizar !== null && inv.productosSinValorizar > 0
                ? `${String(inv.productosSinValorizar)} producto(s) con stock quedan afuera por no tener costo`
                : 'A costo actual: lo que saldría reponerlo hoy'
            }
          />
        </Cifras>
      )}

      {inv.movimientosPorTipo.length > 0 && (
        <Tabla
          titulo="Movimientos del período"
          cabeceras={['Tipo', 'Cantidad']}
          filas={inv.movimientosPorTipo.map((m) => [m.etiqueta, String(m.cuantos)])}
        />
      )}
    </>
  )
}

/*
  MERMAS. Fase 4D.

  La diferencia de inventario tiene su propio renglón y NO suma al total. Un
  faltante contado puede ser robo, error de carga o una venta mal cobrada:
  meterlo dentro de "mermas" haría que el total afirme una causa que nadie
  averiguó.
*/
function Mermas({ datos: mermas }: { datos: ReporteDeMermas }) {
  if (mermas.renglones.length === 0) {
    return <SinDatos texto="No hubo bajas de mercadería en el período." />
  }
  return (
    <>
      <Cifras>
        <Cifra
          titulo="Unidades perdidas"
          valor={formatQuantity(mermas.totalUnidades, null)}
          detalle="No incluye las diferencias de inventario"
        />
        {mermas.totalACostoActual !== null && (
          <Cifra
            titulo="Valor a costo actual"
            valor={<Money amount={mermas.totalACostoActual} size="lg" />}
            detalle="Lo que costaría reponerlo hoy, no lo que costó"
          />
        )}
        <Cifra titulo="Productos afectados" valor={String(mermas.productos)} />
      </Cifras>

      <Tabla
        titulo="Por causa"
        cabeceras={
          mermas.totalACostoActual === null
            ? ['Causa', 'Unidades', 'Movimientos']
            : ['Causa', 'Unidades', 'Movimientos', 'A costo actual']
        }
        filas={mermas.renglones.map((r) => {
          const base: ReactNode[] = [
            r.categoria === 'INVENTORY_DIFF' ? (
              <span key="e" className="text-ink-muted">
                {r.etiqueta} <span className="text-xs text-ink-faint">(no es merma)</span>
              </span>
            ) : (
              r.etiqueta
            ),
            formatQuantity(r.unidades, null),
            String(r.movimientos),
          ]
          return r.valorACostoActual === null
            ? base
            : [...base, <Money key="v" amount={r.valorACostoActual} size="sm" />]
        })}
      />

      <Tabla
        titulo="Los productos con más bajas"
        textos={2}
        cabeceras={['Producto', 'Causa', 'Unidades']}
        filas={mermas.porProducto
          .slice(0, 15)
          .map((p) => [p.productName, p.categoria, formatQuantity(p.unidades, null)])}
      />
    </>
  )
}

function Inventarios({ datos: inventarios }: { datos: ReporteDeInventarios }) {
  if (inventarios.sesiones.length === 0) {
    return <SinDatos texto="No hubo inventarios físicos en el período." />
  }
  const conValor = inventarios.sesiones[0]?.valorACostoActual !== null
  return (
    <>
      <Cifras>
        <Cifra titulo="Sesiones" valor={String(inventarios.sesiones.length)} />
        <Cifra titulo="Aplicadas" valor={String(inventarios.aplicadas)} />
        <Cifra
          titulo="Sin terminar"
          valor={String(inventarios.pendientes)}
          detalle="Contando o esperando aplicarse"
        />
      </Cifras>

      <Tabla
        titulo="Sesiones"
        textos={3}
        cabeceras={[
          'Inventario',
          'Responsable',
          'Estado',
          'Contados',
          'Con diferencia',
          '+',
          '−',
          ...(conValor ? ['Valor'] : []),
        ]}
        filas={inventarios.sesiones.map((s) => {
          const base: ReactNode[] = [
            s.number,
            s.responsable,
            s.estado,
            String(s.productosContados),
            String(s.productosConDiferencia),
            s.diferenciaPositiva,
            s.diferenciaNegativa,
          ]
          return s.valorACostoActual === null
            ? base
            : [...base, <Money key="v" amount={s.valorACostoActual} size="sm" />]
        })}
      />
      <p className="text-xs text-ink-faint">
        Las diferencias van separadas y no netas: un inventario que encontró 20 de más y 20 de menos
        no encontró cero. El valor es el neto, a costo actual.
      </p>
    </>
  )
}

function Vencimientos({ datos: vencimientos }: { datos: ReporteDeVencimientos }) {
  return (
    <>
      <Cifras>
        {vencimientos.tramos.map((t) => (
          <Cifra
            key={t.tramo}
            titulo={t.etiqueta}
            valor={`${String(t.lotes)} lote(s)`}
            detalle={`${formatQuantity(t.unidades, null)} unidades · ${String(t.productos)} producto(s)`}
          />
        ))}
        <Cifra
          titulo="Sin vencimiento"
          valor={`${String(vencimientos.sinFecha.lotes)} lote(s)`}
          detalle={`${formatQuantity(vencimientos.sinFecha.unidades, null)} unidades — no hay nada que controlar`}
        />
      </Cifras>

      {vencimientos.tramos.some((t) => t.valorACostoActual !== null) && (
        <Cifras>
          <Cifra
            titulo="Valor a costo actual"
            valor={
              <Money
                amount={vencimientos.tramos
                  .reduce((s, t) => s + Number(t.valorACostoActual ?? 0), 0)
                  .toFixed(2)}
                size="lg"
              />
            }
            detalle="Lo que costaría reponerlo hoy. NO es una pérdida: lo que vence la semana que viene todavía se vende."
          />
        </Cifras>
      )}

      <Tabla
        titulo="Las partidas más próximas"
        textos={3}
        cabeceras={['Partida', 'Producto', 'Vence', 'Días', 'Unidades']}
        filas={vencimientos.detalle
          .slice(0, 25)
          .map((d) => [
            d.code,
            d.productName,
            d.expirationDate ?? '—',
            d.dias === null ? '—' : String(d.dias),
            d.quantity,
          ])}
      />
    </>
  )
}

function Compras({ datos: compras }: { datos: ReporteComprasDTO }) {
  return (
    <>
      <p className="text-sm text-ink-muted">
        Medidas por lo que LLEGÓ: una orden que nunca se recibió no es una compra.
      </p>
      {/*
        Bruto y neto SEPARADOS. Son dos preguntas distintas: cuánta mercadería
        entró por la puerta, y cuánta se quedó.
      */}
      <Cifras>
        <Cifra
          titulo="Recibido bruto"
          valor={<Money amount={compras.totalComprado} size="lg" />}
          detalle={`${String(compras.recepciones)} recepción(es)`}
        />
        <Cifra
          titulo="Devuelto"
          valor={<Money amount={compras.devuelto} size="lg" />}
          detalle={`${String(compras.devoluciones)} devolución(es)`}
        />
        <Cifra
          titulo="Compras netas"
          valor={<Money amount={compras.comprasNetas} size="lg" />}
          detalle="Lo que quedó"
        />
        <Cifra titulo="Órdenes" valor={String(compras.ordenes)} />
      </Cifras>

      <Tabla
        titulo="Por proveedor"
        cabeceras={['Proveedor', 'Órdenes', 'Total']}
        filas={compras.porProveedor.map((p) => [
          p.proveedor,
          String(p.ordenes),
          <Money key="t" amount={p.total} />,
        ])}
      />

      <Tabla
        titulo="Diferencias entre lo pedido y lo recibido"
        textos={2}
        cabeceras={['Orden', 'Producto', 'Esperado', 'Recibido', 'Diferencia']}
        filas={compras.diferenciasDeCosto.map((d) => [
          d.orden,
          d.producto,
          <Money key="e" amount={d.esperado} />,
          <Money key="r" amount={d.recibido} />,
          <Money key="d" amount={d.diferencia} />,
        ])}
      />
    </>
  )
}

function Proveedores({ datos: proveedores }: { datos: ReporteProveedoresDTO }) {
  return (
    <>
      <p className="text-sm text-ink-muted">
        Lo que se debe es de hoy; lo recibido y lo pagado, del período. Comprar y pagar son dos
        cosas distintas.
      </p>
      <Cifras>
        <Cifra
          titulo="Cuentas por pagar"
          valor={<Money amount={proveedores.cuentasPorPagar.total} size="lg" />}
          detalle={`${String(proveedores.cuentasPorPagar.proveedores)} proveedor(es) con saldo`}
        />
        <Cifra
          titulo="Vencido"
          valor={<Money amount={proveedores.cuentasPorPagar.vencido} size="lg" />}
          detalle="Al cierre del período mirado"
        />
        <Cifra
          titulo="Por vencer"
          valor={<Money amount={proveedores.cuentasPorPagar.porVencer} size="lg" />}
          detalle="Con fecha, todavía en plazo"
        />
        <Cifra
          titulo="Sin vencimiento"
          valor={<Money amount={proveedores.cuentasPorPagar.sinVencimiento} size="lg" />}
          detalle="Nadie cargó una fecha"
        />
        {/* NO se resta de la deuda: un anticipo de marzo y una deuda de ayer
            son dos cosas distintas. */}
        <Cifra
          titulo="Anticipos sin imputar"
          valor={<Money amount={proveedores.cuentasPorPagar.anticiposSinImputar} size="lg" />}
          detalle={`${String(proveedores.cuentasPorPagar.proveedoresConAnticipo)} proveedor(es) con crédito nuestro`}
        />
      </Cifras>

      <Cifras>
        <Cifra
          titulo="Recibido"
          valor={<Money amount={proveedores.periodo.recibido} size="lg" />}
          detalle={`${String(proveedores.periodo.cuantasRecepciones)} entrega(s) en el período`}
        />
        <Cifra
          titulo="Pagado"
          valor={<Money amount={proveedores.periodo.pagado} size="lg" />}
          detalle={`${String(proveedores.periodo.cuantosPagos)} pago(s)`}
        />
        <Cifra
          titulo="De eso, en efectivo"
          valor={<Money amount={proveedores.periodo.pagadoEnEfectivo} size="lg" />}
          detalle="Lo único que salió del cajón"
        />
        <Cifra
          titulo="Notas de crédito"
          valor={<Money amount={proveedores.periodo.notasDeCredito} size="lg" />}
          detalle="Bajan la deuda sin que salga plata"
        />
        <Cifra
          titulo="De eso, por devoluciones"
          valor={<Money amount={proveedores.periodo.devuelto} size="lg" />}
          detalle={`${String(proveedores.periodo.devoluciones)} devolución(es) con mercadería`}
        />
      </Cifras>

      <Tabla
        titulo="A quiénes se les debe más"
        cabeceras={['Proveedor', 'Saldo', 'Vencido']}
        filas={proveedores.deudaPorProveedor.map((d) => [
          d.proveedor,
          <Money key="s" amount={d.saldo} size="sm" />,
          <Money key="v" amount={d.vencido} size="sm" />,
        ])}
      />

      <Tabla
        titulo="A quiénes se les compró más"
        cabeceras={['Proveedor', 'Comprado', 'Entregas']}
        filas={proveedores.topPorCompras.map((t) => [
          t.proveedor,
          <Money key="c" amount={t.comprado} size="sm" />,
          String(t.recepciones),
        ])}
      />

      <Tabla
        titulo="Pagos por medio"
        cabeceras={['Medio', 'Pagado', 'Pagos']}
        filas={proveedores.pagosPorMedio.map((m) => [
          m.etiqueta,
          <Money key="p" amount={m.pagado} size="sm" />,
          String(m.cuantos),
        ])}
      />
    </>
  )
}

// ------------------------------------------------------------------ piezas

function SinDatos({ texto = 'No hubo ventas en el período.' }: { texto?: string }) {
  return <EmptyState title={texto} description="Probá con otro período." />
}

/** Una fila de cifras con su nombre, separadas por espacio y no por cajas. */
function Cifras({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg bg-sunken p-4 sm:grid-cols-4">
      {children}
    </dl>
  )
}

function Cifra({
  titulo,
  valor,
  detalle,
}: {
  titulo: string
  valor: ReactNode
  detalle?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-ink-muted">{titulo}</dt>
      <dd className="mt-1 text-xl font-semibold text-ink" data-numeric="">
        {valor}
      </dd>
      {detalle !== undefined && <dd className="mt-0.5 text-sm text-ink-muted">{detalle}</dd>}
    </div>
  )
}

/** Una barra proporcional, para comparar filas de un vistazo. Decorativa. */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const ancho = maximo > 0 && valor > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 0
  return (
    <span aria-hidden="true" className="block h-2 w-24 rounded-full bg-raised sm:w-40">
      <span
        className="block h-2 rounded-full bg-primary/70"
        style={{ width: `${String(ancho)}%` }}
      />
    </span>
  )
}

function Tabla({
  titulo,
  cabeceras,
  filas,
  textos = 1,
}: {
  titulo: string
  cabeceras: string[]
  filas: ReactNode[][]
  /** Cuantas columnas, desde la izquierda, son texto y no cifras. */
  textos?: number
}) {
  if (filas.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{titulo}</h3>
      <TableWrap>
        <Table caption={titulo}>
          <THead>
            <TR>
              {cabeceras.map((c, i) => (
                // La clave lleva el indice: hay cabeceras vacias (la barra).
                <TH key={`${c}-${String(i)}`} align={i < textos ? 'left' : 'right'}>
                  {c === '' ? <span className="sr-only">Comparación</span> : c}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {filas.map((fila, i) => (
              // La clave lleva el indice a proposito: una fila de reporte no
              // tiene identidad propia --es el resultado de un agregado-- y la
              // lista se reemplaza entera en cada consulta.
              <TR key={`fila-${String(i)}`}>
                {fila.map((celda, j) => (
                  <TD key={`celda-${String(j)}`} align={j < textos ? 'left' : 'right'}>
                    {celda}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  )
}

// ------------------------------------------------------------------ iconos

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function IconoCalendario() {
  return (
    <Icono>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icono>
  )
}

function IconoBilletera() {
  return (
    <Icono>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </Icono>
  )
}

function IconoCaja() {
  return (
    <Icono>
      <path d="M3.5 8 12 4l8.5 4v8L12 20l-8.5-4z" />
      <path d="M3.5 8 12 12l8.5-4M12 12v8" />
    </Icono>
  )
}

function IconoPersona() {
  return (
    <Icono>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Icono>
  )
}

function IconoCajon() {
  return (
    <Icono>
      <rect x="3" y="11" width="18" height="9" rx="1.5" />
      <path d="M6 11V5h12v6M10 15.5h4" />
    </Icono>
  )
}
