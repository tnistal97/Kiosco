'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  MetricCard,
  Money,
  SaleStatusBadge,
  Skeleton,
  StockBadge,
  cn,
  formatMoney,
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { apiRequest } from '@/lib/api-client'
import { CERO, esCero, esPositivo, type Monto } from '@/lib/money'
import { parsePaginaProductos } from '@/modules/products/dto'
import { parsePaginaVentas, type VentaDTO } from '@/modules/sales/dto'
import { parseArqueos, parseSaldo, type ArqueoDTO } from '@/modules/cash/dto'
import { parseReposicion, type ReposicionDTO } from '@/modules/inventory/dto'
import { parseResumenCompras, type ResumenComprasDTO } from '@/modules/purchases/dto'
import {
  parseRentabilidadDelDia,
  parseReporteClientes,
  type ReporteClientesDTO,
} from '@/modules/reports/dto'
import type { Product } from '@/hooks/useProducts'

interface Panel {
  saldo: Monto | null
  efectivoHoy: Monto
  ventasHoy: number
  anuladasHoy: number
  /** `null` cuando quien mira no puede ver la facturacion del local. */
  recaudadoHoy: Monto | null
  gananciaHoy: Monto | null
  margenHoy: string | null
  lineasSinCostoHoy: number
  ultimasVentas: VentaDTO[]
  bajos: Product[]
  reposicion: ReposicionDTO
  compras: ResumenComprasDTO
  ultimoArqueo: ArqueoDTO | null
  /** La cartera de clientes. Null cuando no se puede ver. */
  clientes: ReporteClientesDTO | null
}

const VACIO: Panel = {
  saldo: null,
  efectivoHoy: CERO,
  ventasHoy: 0,
  anuladasHoy: 0,
  recaudadoHoy: null,
  gananciaHoy: null,
  margenHoy: null,
  lineasSinCostoHoy: 0,
  ultimasVentas: [],
  bajos: [],
  reposicion: { agotados: 0, bajoMinimo: 0, sinMinimo: 0 },
  compras: { pendientes: 0, parciales: 0, borradores: 0 },
  ultimoArqueo: null,
  clientes: null,
}

/**
 * Panel de inicio.
 *
 * Solo lo que ese usuario puede abrir. Un cajero no ve la recaudacion del
 * dia ni el saldo de la caja; un repositor ve el stock y nada mas. No es
 * cosmetica: cada tarjeta que se dibuja consulta un endpoint, y pedirle a la
 * API algo que va a responder 403 llena la bitacora de rechazos que no
 * significan nada.
 *
 * Cada tarjeta abre la pantalla que corresponde. Un numero que no lleva a
 * ningun lado obliga a buscar en el menu que pantalla lo explica.
 */
export default function InicioPage() {
  const { session, puede, hoy } = useSession()
  const [datos, setDatos] = useState<Panel>(VACIO)
  const [cargando, setCargando] = useState(true)

  const verCaja = puede('cash.view')
  const verVentas = puede('sales.view')
  // La recaudacion y la ganancia son dos permisos distintos: se puede
  // necesitar saber cuanto se vendio sin saber cuanto se gano.
  const verRecaudado = puede('reports.sales.view')
  const verGanancia = puede('reports.costs.view')
  const verStock = puede('stock.view')
  const verCompras = puede('purchases.view')
  /**
   * La CARTERA, no la cuenta de una persona.
   *
   * `reports.clients.view` y no `accounts.view`, que es lo que tiene el cajero:
   * el cajero necesita saber cuanto debe Juan cuando lo tiene enfrente --y eso
   * lo ve en el POS y en la ficha-- pero no la lista completa de deudores del
   * negocio. Es lo que pide el objetivo 31.
   */
  const verCartera = puede('reports.clients.view')
  const vender = puede('sales.create')

  const cargar = useCallback(async () => {
    setCargando(true)
    const salida: Panel = { ...VACIO }

    // Cada bloque falla por su cuenta: que la caja no responda no puede
    // dejar el panel entero en blanco.
    const tareas: Array<Promise<void>> = []

    if (verCaja) {
      tareas.push(
        apiRequest('/api/cash/balance', { parse: parseSaldo })
          .then((s) => {
            salida.saldo = s.balance
            salida.efectivoHoy = s.efectivoHoy
          })
          .catch(() => undefined),
        apiRequest('/api/cash/count?limite=1', { parse: parseArqueos })
          .then((a) => {
            salida.ultimoArqueo = a[0] ?? null
          })
          .catch(() => undefined),
      )
    }

    // El dia lo dice la sucursal, no el reloj del dispositivo.
    const d = hoy()

    if (verVentas) {
      tareas.push(
        apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=5`, {
          parse: parsePaginaVentas,
        })
          .then((r) => {
            salida.ventasHoy = r.totales.ventas
            salida.anuladasHoy = r.totales.anuladas
            // Llega nulo sin `reports.sales.view`: el cajero ve sus ventas,
            // no cuanto factura el local.
            salida.recaudadoHoy = r.totales.recaudado
            salida.ultimasVentas = r.data
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
            salida.margenHoy = r.margenBruto
            salida.lineasSinCostoHoy = r.lineasSinCosto
          })
          .catch(() => undefined),
      )
    }

    if (verStock) {
      tareas.push(
        // Los que hay que reponer, para la lista. Solo cinco: es un panel, no
        // un informe.
        apiRequest('/api/products?lowStock=true&estado=activos&pageSize=5&sortBy=name', {
          parse: parsePaginaProductos,
        })
          .then((p) => {
            salida.bajos = p.data
          })
          .catch(() => undefined),
        // Los tres numeros, contados por el servidor en una sola peticion.
        // Antes eran dos consultas al catalogo que traian productos enteros
        // para contarlos.
        apiRequest('/api/inventory/replenishment', { parse: parseReposicion })
          .then((r) => {
            salida.reposicion = r
          })
          .catch(() => undefined),
      )
    }

    if (verCompras) {
      // Los tres numeros de compras, contados por el servidor. El importe
      // pendiente viene solo si ademas se pueden ver costos, y de eso decide
      // el servicio: la pantalla no tiene que volver a preguntarlo.
      tareas.push(
        apiRequest('/api/purchases/summary', { parse: parseResumenCompras })
          .then((r) => {
            salida.compras = r
          })
          .catch(() => undefined),
      )
    }

    if (verCartera) {
      // La cartera de clientes: cuanto se debe y cuanto se cobro HOY. El
      // cajero NO la pide --no tiene `reports.clients.view`-- y por eso ni
      // siquiera se dibuja la tarjeta: pedirle a la API algo que va a
      // responder 403 llena la bitacora de rechazos que no significan nada.
      tareas.push(
        apiRequest(`/api/reports/clientes?desde=${d}&hasta=${d}`, {
          parse: parseReporteClientes,
        })
          .then((r) => {
            salida.clientes = r
          })
          .catch(() => undefined),
      )
    }

    await Promise.all(tareas)
    setDatos(salida)
    setCargando(false)
  }, [verCaja, verVentas, verGanancia, verStock, verCompras, verCartera, hoy])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const sinNada =
    !cargando &&
    datos.ventasHoy === 0 &&
    datos.bajos.length === 0 &&
    datos.reposicion.agotados === 0 &&
    datos.ultimasVentas.length === 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">
            Hola, {session?.name.split(' ')[0] ?? ''}
          </h2>
          <p className="text-sm text-ink-muted">{session?.branchName}</p>
        </div>
        {vender && (
          <ButtonLink href="/venta" variant="confirm" size="lg">
            Ir a vender
          </ButtonLink>
        )}
      </div>

      {cargando ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {verCaja && (
            <MetricCard
              href="/caja"
              label="Efectivo en caja"
              value={<Money amount={datos.saldo ?? CERO} size="lg" />}
              detail={
                datos.ultimoArqueo
                  ? esCero(datos.ultimoArqueo.difference)
                    ? 'Último arqueo: cuadró'
                    : `Último arqueo: ${esPositivo(datos.ultimoArqueo.difference) ? 'sobró' : 'faltó'}`
                  : 'Sin arqueos todavía'
              }
              tone={
                !datos.ultimoArqueo
                  ? 'neutral'
                  : esCero(datos.ultimoArqueo.difference)
                    ? 'success'
                    : 'warning'
              }
            />
          )}

          {verVentas && (
            <MetricCard
              href="/ventas"
              label="Ventas de hoy"
              value={datos.ventasHoy}
              detail={datos.anuladasHoy > 0 ? `${datos.anuladasHoy} anuladas` : 'Sin anulaciones'}
              tone={datos.anuladasHoy > 0 ? 'warning' : 'neutral'}
            />
          )}

          {verRecaudado && datos.recaudadoHoy !== null && (
            <MetricCard
              href="/reportes"
              label="Recaudado hoy"
              value={<Money amount={datos.recaudadoHoy} size="lg" />}
              detail="No incluye las anuladas"
            />
          )}

          {verGanancia && datos.gananciaHoy !== null && (
            <MetricCard
              href="/reportes"
              label="Ganancia bruta hoy"
              value={<Money amount={datos.gananciaHoy} size="lg" />}
              detail={
                datos.lineasSinCostoHoy > 0
                  ? `${datos.margenHoy ?? '—'}% · ${datos.lineasSinCostoHoy} línea(s) sin costo`
                  : `${datos.margenHoy ?? '—'}% de margen`
              }
              tone={datos.lineasSinCostoHoy > 0 ? 'warning' : 'neutral'}
            />
          )}

          {verStock && (
            <MetricCard
              href="/stock"
              label="Faltantes"
              value={datos.reposicion.agotados + datos.reposicion.bajoMinimo}
              detail={`${datos.reposicion.agotados} agotados · ${datos.reposicion.bajoMinimo} bajo mínimo`}
              tone={
                datos.reposicion.agotados > 0
                  ? 'danger'
                  : datos.reposicion.bajoMinimo > 0
                    ? 'warning'
                    : 'success'
              }
            />
          )}

          {verCartera && datos.clientes && (
            <MetricCard
              href="/clientes"
              label="Por cobrar"
              value={<Money amount={datos.clientes.cartera.saldoPendiente} size="lg" />}
              detail={
                datos.clientes.cartera.sobreLimite > 0
                  ? `${String(datos.clientes.cartera.deudores)} deben · ${String(datos.clientes.cartera.sobreLimite)} sobre el límite`
                  : `${String(datos.clientes.cartera.deudores)} cliente(s) deben`
              }
              tone={datos.clientes.cartera.sobreLimite > 0 ? 'warning' : 'neutral'}
            />
          )}

          {verCartera && datos.clientes && (
            <MetricCard
              href="/clientes"
              label="Cobrado hoy"
              value={<Money amount={datos.clientes.periodo.cobrado} size="lg" />}
              detail={`${String(datos.clientes.periodo.cuantosCobros)} cobro(s) · fiado hoy ${formatMoney(datos.clientes.periodo.ventasACuenta)}`}
            />
          )}

          {verCompras && (
            <MetricCard
              href="/compras"
              label="Esperando mercadería"
              value={datos.compras.pendientes + datos.compras.parciales}
              detail={
                /*
                  El detalle nombra las PARCIALES aparte porque son el numero
                  accionable: una orden pedida y todavia sin entregar es lo
                  normal; una a medio entregar hace una semana, no.
                */
                datos.compras.parciales > 0
                  ? `${String(datos.compras.parciales)} a medio recibir`
                  : datos.compras.borradores > 0
                    ? `${String(datos.compras.borradores)} borrador(es) sin confirmar`
                    : 'Nada a medio recibir'
              }
              tone={datos.compras.parciales > 0 ? 'warning' : 'neutral'}
            />
          )}
        </div>
      )}

      {sinNada && (
        <Alert tone="info" title="Todavía no hay actividad">
          Cuando registres la primera venta o cargues productos, este panel se llena solo.
          {puede('products.create') && (
            <>
              {' '}
              <Link href="/productos" className="font-medium text-primary underline">
                Cargar productos
              </Link>
            </>
          )}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {verVentas && (
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Últimas ventas"
                actions={
                  <ButtonLink href="/ventas" variant="ghost" size="sm">
                    Ver todas
                  </ButtonLink>
                }
                className="mb-3"
              />
              {cargando ? (
                <Skeleton className="h-32" />
              ) : datos.ultimasVentas.length === 0 ? (
                <EmptyState
                  title="Sin ventas hoy"
                  description={vender ? 'La caja está lista cuando quieras.' : undefined}
                  action={
                    vender ? (
                      <ButtonLink href="/venta" variant="confirm" size="sm">
                        Abrir la caja
                      </ButtonLink>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {datos.ultimasVentas.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-14 shrink-0 text-sm text-ink-muted" data-numeric="">
                        #{v.id}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {v.user.name}
                      </span>
                      {v.status === 'canceled' && <SaleStatusBadge status={v.status} />}
                      <Money
                        amount={v.total}
                        size="sm"
                        tone={v.status === 'canceled' ? 'muted' : 'neutral'}
                        className={cn(v.status === 'canceled' && 'line-through')}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {verStock && (
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Hay que reponer"
                actions={
                  <ButtonLink href="/stock" variant="ghost" size="sm">
                    Ver el stock
                  </ButtonLink>
                }
                className="mb-3"
              />
              {cargando ? (
                <Skeleton className="h-32" />
              ) : datos.bajos.length === 0 ? (
                <EmptyState
                  title="Nada por debajo del mínimo"
                  description={
                    datos.reposicion.sinMinimo > 0
                      ? `Todavía no hay mínimos configurados: ${datos.reposicion.sinMinimo} producto(s) activos no tienen uno, así que este aviso no puede sonar para ellos.`
                      : 'Ningún producto activo llegó a su mínimo.'
                  }
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {datos.bajos.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                      <StockBadge
                        quantity={p.totalStock}
                        minimum={p.minimumStock}
                        unit={p.saleUnit}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>

      {!cargando && !verCaja && !verVentas && !verStock && (
        <Card>
          <EmptyState
            title="Tu panel está vacío a propósito"
            description="Tu rol no incluye caja, ventas ni stock. Usá el menú para ir a lo que sí podés hacer."
            action={
              vender ? (
                <ButtonLink href="/venta" variant="confirm">
                  Ir a vender
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      )}

      {!cargando && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void cargar()}>
            Actualizar
          </Button>
        </div>
      )}
    </div>
  )
}
