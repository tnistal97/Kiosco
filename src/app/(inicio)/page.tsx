'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  ButtonLink,
  Card,
  MetricCard,
  Money,
  PageContainer,
  Skeleton,
  cn,
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { IconoDe } from '@/components/shell/icons'
import { accionesPara, destinoDeInicio } from '@/components/inicio/destino'
import { apiRequest } from '@/lib/api-client'
import { inicioDelDia, esZonaValida, ZONA_POR_DEFECTO } from '@/lib/tiempo'
import type { Monto } from '@/lib/money'
import { parsePaginaVentas } from '@/modules/sales/dto'
import { parseEstadoDeCaja, type EstadoDeCajaDTO } from '@/modules/cash/dto'
import { parseReposicion, type ReposicionDTO } from '@/modules/inventory/dto'
import { parseRentabilidadDelDia, parseReporteClientes } from '@/modules/reports/dto'

interface Hoy {
  ventasHoy: number
  anuladasHoy: number
  /** `null` cuando quien mira no puede ver la facturacion del local. */
  recaudadoHoy: Monto | null
  gananciaHoy: Monto | null
  lineasSinCostoHoy: number
  fiadoPendiente: Monto | null
  deudores: number
  sobreLimite: number
  caja: EstadoDeCajaDTO | null
  reposicion: ReposicionDTO | null
}

const VACIO: Hoy = {
  ventasHoy: 0,
  anuladasHoy: 0,
  recaudadoHoy: null,
  gananciaHoy: null,
  lineasSinCostoHoy: 0,
  fiadoPendiente: null,
  deudores: 0,
  sobreLimite: 0,
  caja: null,
  reposicion: null,
}

interface Aviso {
  codigo: string
  tono: 'warning' | 'danger'
  texto: string
  href: string
  accion: string
}

/**
 * Inicio. V1 comercial.
 *
 * La primera pregunta es "¿que queres hacer?", y la respuesta son seis
 * botones grandes: los que ese usuario puede abrir, y ninguno mas. Despues,
 * los cuatro numeros del dia y los avisos que piden hacer algo. Sin graficos:
 * un almacen no mira curvas, mira si la caja esta abierta y si falta stock.
 *
 * El cajero no llega aca: `destinoDeInicio` lo manda a Venta, en el login y
 * tambien si escribe la raiz a mano.
 *
 * Cada numero consulta un endpoint solo si hay permiso para verlo. Pedirle a
 * la API algo que va a responder 403 llena la bitacora de rechazos que no
 * significan nada.
 */
export default function InicioPage() {
  const { session, permisos, puede, hoy } = useSession()
  const router = useRouter()

  const destino = session ? destinoDeInicio(session) : '/'
  useEffect(() => {
    if (destino !== '/') router.replace(destino)
  }, [destino, router])

  const [datos, setDatos] = useState<Hoy>(VACIO)
  const [cargando, setCargando] = useState(true)

  const verVentas = puede('sales.view')
  const verRecaudado = puede('reports.sales.view')
  const verGanancia = puede('reports.costs.view')
  const verCartera = puede('reports.clients.view')
  const verCaja = puede('cash.view')
  const verStock = puede('stock.view')

  const cargar = useCallback(async () => {
    setCargando(true)
    const salida: Hoy = { ...VACIO }
    const tareas: Array<Promise<void>> = []
    const d = hoy()

    if (verVentas) {
      tareas.push(
        apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=1`, {
          parse: parsePaginaVentas,
        })
          .then((r) => {
            salida.ventasHoy = r.totales.ventas
            salida.anuladasHoy = r.totales.anuladas
            salida.recaudadoHoy = r.totales.recaudado
          })
          .catch(() => undefined),
      )
    }
    if (verGanancia) {
      tareas.push(
        apiRequest(`/api/reports/rentabilidad?desde=${d}&hasta=${d}`, {
          parse: parseRentabilidadDelDia,
        })
          .then((r) => {
            salida.gananciaHoy = r.gananciaBruta
            salida.lineasSinCostoHoy = r.lineasSinCosto
          })
          .catch(() => undefined),
      )
    }
    if (verCartera) {
      tareas.push(
        apiRequest(`/api/reports/clientes?desde=${d}&hasta=${d}`, { parse: parseReporteClientes })
          .then((r) => {
            salida.fiadoPendiente = r.cartera.saldoPendiente
            salida.deudores = r.cartera.deudores
            salida.sobreLimite = r.cartera.sobreLimite
          })
          .catch(() => undefined),
      )
    }
    if (verCaja) {
      tareas.push(
        apiRequest('/api/cash/shift', { parse: parseEstadoDeCaja })
          .then((r) => {
            salida.caja = r
          })
          .catch(() => undefined),
      )
    }
    if (verStock) {
      tareas.push(
        apiRequest('/api/inventory/replenishment', { parse: parseReposicion })
          .then((r) => {
            salida.reposicion = r
          })
          .catch(() => undefined),
      )
    }

    await Promise.all(tareas)
    setDatos(salida)
    setCargando(false)
  }, [verVentas, verGanancia, verCartera, verCaja, verStock, hoy])

  useEffect(() => {
    if (destino === '/') void cargar()
  }, [cargar, destino])

  if (destino !== '/') return null

  const acciones = accionesPara(permisos)
  const avisos = avisosDe(datos, session?.timeZone ?? ZONA_POR_DEFECTO, hoy())
  const hayNumeros = verVentas || verRecaudado || verGanancia || verCartera

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">¿Qué querés hacer?</h2>
          <p className="text-sm text-ink-muted">
            Hola, {session?.name.split(' ')[0] ?? ''} · {session?.branchName}
          </p>
        </div>
      </div>

      {acciones.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Tu rol no incluye ninguna de las acciones del mostrador. Usá el menú para ir a lo que sí
            podés hacer.
          </p>
        </Card>
      ) : (
        <nav aria-label="Acciones" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {acciones.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                'flex min-h-[6.5rem] flex-col justify-between rounded-lg border p-4 transition-colors sm:min-h-[7.5rem]',
                a.principal
                  ? 'border-success bg-success-quiet hover:bg-success/15'
                  : 'border-line bg-surface hover:border-line-strong hover:bg-raised',
              )}
            >
              <span
                className={cn('h-6 w-6', a.principal ? 'text-success' : 'text-ink-muted')}
                aria-hidden="true"
              >
                <IconoDe href={a.href} />
              </span>
              <span className="flex flex-col">
                <span className="text-base font-semibold text-ink sm:text-lg">{a.titulo}</span>
                <span className="text-xs text-ink-muted sm:text-sm">{a.detalle}</span>
              </span>
            </Link>
          ))}
        </nav>
      )}

      {hayNumeros && (
        <section aria-labelledby="hoy">
          <h3
            id="hoy"
            className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase"
          >
            Hoy
          </h3>
          {cargando ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {verRecaudado && datos.recaudadoHoy !== null && (
                <MetricCard
                  href="/caja/cierre"
                  label="Ventas"
                  value={<Money amount={datos.recaudadoHoy} size="lg" />}
                  detail="Ver el cierre del día"
                />
              )}
              {verVentas && (
                <MetricCard
                  href="/ventas"
                  label="Cantidad de ventas"
                  value={datos.ventasHoy}
                  detail={
                    datos.anuladasHoy > 0
                      ? `${String(datos.anuladasHoy)} anuladas`
                      : 'Sin anulaciones'
                  }
                  tone={datos.anuladasHoy > 0 ? 'warning' : 'neutral'}
                />
              )}
              {verGanancia && datos.gananciaHoy !== null && (
                <MetricCard
                  href="/reportes"
                  label="Ganancia estimada"
                  value={<Money amount={datos.gananciaHoy} size="lg" />}
                  detail={
                    datos.lineasSinCostoHoy > 0
                      ? `${String(datos.lineasSinCostoHoy)} línea(s) sin costo cargado`
                      : 'Precio menos costo de lo vendido'
                  }
                  tone={datos.lineasSinCostoHoy > 0 ? 'warning' : 'neutral'}
                />
              )}
              {verCartera && datos.fiadoPendiente !== null && (
                <MetricCard
                  href="/clientes"
                  label="Fiado pendiente"
                  value={<Money amount={datos.fiadoPendiente} size="lg" />}
                  detail={`${String(datos.deudores)} cliente(s) deben`}
                />
              )}
            </div>
          )}
        </section>
      )}

      {!cargando && avisos.length > 0 && (
        <section aria-labelledby="avisos" className="flex flex-col gap-2">
          <h3 id="avisos" className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Avisos
          </h3>
          {avisos.map((a) => (
            <Alert key={a.codigo} tone={a.tono}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{a.texto}</span>
                <ButtonLink href={a.href} variant="secondary" size="sm">
                  {a.accion}
                </ButtonLink>
              </div>
            </Alert>
          ))}
        </section>
      )}

      {!cargando && avisos.length === 0 && (verCaja || verStock) && (
        <p className="text-sm text-ink-faint">Sin avisos. Todo en orden.</p>
      )}
    </PageContainer>
  )
}

/**
 * Los avisos, calculados sobre lo que ya vino del servidor. Cuatro y no
 * veinte: los que piden hacer algo hoy.
 */
function avisosDe(datos: Hoy, zona: string, hoyLocal: string): Aviso[] {
  const avisos: Aviso[] = []
  const zonaValida = esZonaValida(zona) ? zona : ZONA_POR_DEFECTO

  if (datos.caja !== null) {
    if (datos.caja.turno === null) {
      avisos.push({
        codigo: 'caja_sin_abrir',
        tono: 'warning',
        texto: datos.caja.politica.requiereTurno
          ? 'La caja está sin abrir. No se puede cobrar hasta abrirla.'
          : 'La caja está sin abrir.',
        href: '/caja/abrir',
        accion: 'Abrir caja',
      })
    } else if (new Date(datos.caja.turno.openedAt) < inicioDelDia(hoyLocal, zonaValida)) {
      avisos.push({
        codigo: 'caja_de_ayer',
        tono: 'danger',
        texto: `La caja de ayer sigue abierta (${datos.caja.turno.openedBy.name}). Cerrala antes de seguir.`,
        href: '/caja/cerrar',
        accion: 'Cerrar caja',
      })
    }
  }

  if (datos.reposicion !== null) {
    const faltan = datos.reposicion.agotados + datos.reposicion.bajoMinimo
    if (faltan > 0) {
      avisos.push({
        codigo: 'poco_stock',
        tono: datos.reposicion.agotados > 0 ? 'danger' : 'warning',
        texto:
          datos.reposicion.agotados > 0
            ? `Poco stock: ${String(datos.reposicion.agotados)} agotados y ${String(datos.reposicion.bajoMinimo)} bajo mínimo.`
            : `Poco stock: ${String(faltan)} producto(s) bajo mínimo.`,
        href: '/stock',
        accion: 'Ver stock',
      })
    }
  }

  if (datos.sobreLimite > 0) {
    avisos.push({
      codigo: 'sobre_limite',
      tono: 'warning',
      texto: `${String(datos.sobreLimite)} cliente(s) pasaron su límite de fiado.`,
      href: '/clientes',
      accion: 'Ver fiados',
    })
  }

  return avisos
}
