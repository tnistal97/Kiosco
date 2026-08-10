'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardHeader,
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
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { sumarDias } from '@/lib/tiempo'
import {
  parseReporteCaja,
  parseReporteCompras,
  parseReporteInventario,
  parseReporteProductos,
  parseReporteRentabilidad,
  parseReporteVentas,
  type ReporteCajaDTO,
  type ReporteComprasDTO,
  type ReporteInventarioDTO,
  type ReporteProductosDTO,
  type ReporteRentabilidadDTO,
  type ReporteVentasDTO,
} from '@/modules/reports/dto'

/**
 * Reportes.
 *
 * Seis secciones, cada una con su permiso. Quien tenga uno solo entra y ve lo
 * suyo; el resto no se dibuja y --lo que importa mas-- no se pide: una
 * peticion que va a responder 403 llena la bitacora de rechazos que no
 * significan nada.
 *
 * El rango arranca en los ultimos siete dias porque es la pregunta que se hace
 * un almacen: "¿como viene la semana?". El dia de "hoy" lo dice la sucursal,
 * no el reloj del dispositivo. Ver docs/TIMEZONE_POLICY.md.
 */
export default function ReportesPage() {
  const { puede, hoy } = useSession()

  const verVentas = puede('reports.sales.view')
  const verCostos = puede('reports.costs.view')
  const verInventario = puede('reports.inventory.view')
  const verCaja = puede('reports.cash.view')
  const verCompras = puede('reports.purchases.view')
  const algo = verVentas || verCostos || verInventario || verCaja || verCompras

  const [desde, setDesde] = useState(() => sumarDias(hoy(), -6))
  const [hasta, setHasta] = useState(() => hoy())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ventas, setVentas] = useState<ReporteVentasDTO | null>(null)
  const [rent, setRent] = useState<ReporteRentabilidadDTO | null>(null)
  const [prods, setProds] = useState<ReporteProductosDTO | null>(null)
  const [inv, setInv] = useState<ReporteInventarioDTO | null>(null)
  const [compras, setCompras] = useState<ReporteComprasDTO | null>(null)
  const [caja, setCaja] = useState<ReporteCajaDTO | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const q = `desde=${desde}&hasta=${hasta}`

    try {
      await Promise.all([
        verVentas
          ? apiRequest(`/api/reports/ventas?${q}`, { parse: parseReporteVentas }).then(setVentas)
          : Promise.resolve(),
        verVentas
          ? apiRequest(`/api/reports/productos?${q}`, { parse: parseReporteProductos }).then(
              setProds,
            )
          : Promise.resolve(),
        verCostos
          ? apiRequest(`/api/reports/rentabilidad?${q}`, { parse: parseReporteRentabilidad }).then(
              setRent,
            )
          : Promise.resolve(),
        verInventario
          ? apiRequest(`/api/reports/inventario?${q}`, { parse: parseReporteInventario }).then(
              setInv,
            )
          : Promise.resolve(),
        verCompras
          ? apiRequest(`/api/reports/compras?${q}`, { parse: parseReporteCompras }).then(setCompras)
          : Promise.resolve(),
        verCaja
          ? apiRequest(`/api/reports/caja?${q}`, { parse: parseReporteCaja }).then(setCaja)
          : Promise.resolve(),
      ])
    } catch (e) {
      setError(mensajeDeError(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, verVentas, verCostos, verInventario, verCaja, verCompras])

  useEffect(() => {
    if (algo) void cargar()
    else setCargando(false)
  }, [algo, cargar])

  if (!algo) {
    return (
      <Card>
        <EmptyState
          title="No tenés reportes asignados"
          description="Tu rol no incluye ninguna de las materias de esta pantalla."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void cargar()
          }}
        >
          <Field label="Desde">
            {/* Sin `id` propio: `Field` genera el suyo y lo asocia a la
                etiqueta. Un `id` explicito lo pisa --se aplica despues- y deja
                el campo sin etiqueta accesible, que es lo que marco axe. */}
            <Input
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => {
                setDesde(e.target.value)
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => {
                setHasta(e.target.value)
              }}
            />
          </Field>
          <Button type="submit" disabled={cargando}>
            {cargando ? 'Calculando…' : 'Actualizar'}
          </Button>
        </form>
      </Card>

      {error !== null && <ErrorState title="No se pudo calcular" description={error} />}

      {cargando && <Skeleton className="h-40" />}

      {!cargando && verVentas && ventas && (
        <Card>
          <CardHeader title="Ventas" description="No incluye las anuladas." />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato
              titulo="Facturado"
              valor={<Money amount={ventas.totales.facturado} size="lg" />}
            />
            <Dato titulo="Operaciones" valor={String(ventas.totales.operaciones)} />
            <Dato
              titulo="Ticket promedio"
              valor={<Money amount={ventas.totales.ticketPromedio} size="lg" />}
            />
            <Dato titulo="Anuladas" valor={String(ventas.totales.anuladas)} />
          </div>

          {ventas.porMedio.length > 0 && (
            <Tabla
              titulo="Por medio de pago"
              cabeceras={['Medio', 'Cobrado', 'Operaciones']}
              filas={ventas.porMedio.map((m) => [
                m.etiqueta,
                <Money key="c" amount={m.cobrado} />,
                String(m.operaciones),
              ])}
            />
          )}

          {ventas.porCajero.length > 0 && (
            <Tabla
              titulo="Por cajero"
              cabeceras={['Persona', 'Facturado', 'Operaciones']}
              filas={ventas.porCajero.map((c) => [
                c.usuario,
                <Money key="f" amount={c.facturado} />,
                String(c.operaciones),
              ])}
            />
          )}

          {ventas.porDia.length > 0 && (
            <Tabla
              titulo="Por día"
              cabeceras={['Día', 'Facturado', 'Operaciones']}
              filas={ventas.porDia.map((d) => [
                d.dia,
                <Money key="f" amount={d.facturado} />,
                String(d.operaciones),
              ])}
            />
          )}
        </Card>
      )}

      {!cargando && verCostos && rent && (
        <Card>
          <CardHeader
            title="Rentabilidad"
            description="Con el costo que tenía cada producto AL VENDERSE, no con el de hoy."
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato titulo="Facturado" valor={<Money amount={rent.facturado} size="lg" />} />
            <Dato titulo="Costo vendido" valor={<Money amount={rent.costoVendido} size="lg" />} />
            <Dato titulo="Ganancia bruta" valor={<Money amount={rent.gananciaBruta} size="lg" />} />
            <Dato
              titulo="Margen bruto"
              valor={rent.margenBruto === null ? 'sin ventas' : `${rent.margenBruto}%`}
            />
          </div>

          {rent.lineasSinCosto > 0 && (
            <Alert tone="warning" className="mt-4">
              {rent.lineasSinCosto} de {rent.lineasTotales} líneas no tenían costo cargado y quedan
              fuera de este cálculo, junto con los <Money amount={rent.facturadoSinCosto} /> que
              facturaron. Contarlas con costo cero las mostraría como lo más rentable del local.
            </Alert>
          )}

          {rent.porProducto.length > 0 && (
            <Tabla
              titulo="Por producto"
              cabeceras={['Producto', 'Facturado', 'Costo', 'Ganancia', 'Margen']}
              filas={rent.porProducto.map((p) => [
                p.producto,
                <Money key="f" amount={p.facturado} />,
                <Money key="c" amount={p.costo} />,
                <Money key="g" amount={p.ganancia} />,
                p.margen === null ? '—' : `${p.margen}%`,
              ])}
            />
          )}
        </Card>
      )}

      {!cargando && verVentas && prods && (
        <Card>
          <CardHeader
            title="Productos"
            description={`${String(prods.sinVentas)} producto(s) activos no se vendieron en el período.`}
          />
          <Tabla
            titulo="Más vendidos"
            cabeceras={['Producto', 'Unidades', 'Facturado']}
            filas={prods.masVendidos.map((p) => [
              p.producto,
              p.unidades,
              <Money key="f" amount={p.facturado} />,
            ])}
          />
          <Tabla
            titulo="Menos vendidos"
            cabeceras={['Producto', 'Unidades', 'Facturado']}
            filas={prods.menosVendidos.map((p) => [
              p.producto,
              p.unidades,
              <Money key="f" amount={p.facturado} />,
            ])}
          />
        </Card>
      )}

      {!cargando && verInventario && inv && (
        <Card>
          <CardHeader title="Inventario" description="Estado de hoy, no del período." />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato titulo="Productos activos" valor={String(inv.productos)} />
            <Dato titulo="Agotados" valor={String(inv.agotados)} />
            <Dato titulo="Bajo mínimo" valor={String(inv.bajoMinimo)} />
            <Dato titulo="Sin costo cargado" valor={String(inv.sinCosto)} />
          </div>

          {inv.valorizado !== null && (
            <div className="mt-4">
              <Dato
                titulo="Stock valorizado"
                valor={<Money amount={inv.valorizado} size="lg" />}
                detalle={
                  inv.productosSinValorizar !== null && inv.productosSinValorizar > 0
                    ? `${String(inv.productosSinValorizar)} producto(s) con stock quedan afuera por no tener costo`
                    : 'A costo actual: lo que saldría reponerlo hoy'
                }
              />
            </div>
          )}

          {inv.movimientosPorTipo.length > 0 && (
            <Tabla
              titulo="Movimientos del período"
              cabeceras={['Tipo', 'Cantidad']}
              filas={inv.movimientosPorTipo.map((m) => [m.etiqueta, String(m.cuantos)])}
            />
          )}
        </Card>
      )}

      {!cargando && verCompras && compras && (
        <Card>
          <CardHeader
            title="Compras"
            description="Medidas por lo que LLEGÓ: una orden que nunca se recibió no es una compra."
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Dato
              titulo="Total comprado"
              valor={<Money amount={compras.totalComprado} size="lg" />}
            />
            <Dato titulo="Órdenes" valor={String(compras.ordenes)} />
            <Dato titulo="Recepciones" valor={String(compras.recepciones)} />
          </div>

          {compras.porProveedor.length > 0 && (
            <Tabla
              titulo="Por proveedor"
              cabeceras={['Proveedor', 'Órdenes', 'Total']}
              filas={compras.porProveedor.map((p) => [
                p.proveedor,
                String(p.ordenes),
                <Money key="t" amount={p.total} />,
              ])}
            />
          )}

          {compras.diferenciasDeCosto.length > 0 && (
            <Tabla
              titulo="Diferencias entre lo pedido y lo recibido"
              cabeceras={['Orden', 'Producto', 'Esperado', 'Recibido', 'Diferencia']}
              filas={compras.diferenciasDeCosto.map((d) => [
                d.orden,
                d.producto,
                <Money key="e" amount={d.esperado} />,
                <Money key="r" amount={d.recibido} />,
                <Money key="d" amount={d.diferencia} />,
              ])}
            />
          )}
        </Card>
      )}

      {!cargando && verCaja && caja && (
        <Card>
          <CardHeader
            title="Caja"
            description="Sobrantes y faltantes por separado: un turno que sobró y otro que faltó no son un cero."
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato titulo="Turnos cerrados" valor={String(caja.turnos)} />
            <Dato titulo="Con diferencia" valor={String(caja.turnosConDiferencia)} />
            <Dato titulo="Sobrantes" valor={<Money amount={caja.sobrantes} />} />
            <Dato titulo="Faltantes" valor={<Money amount={caja.faltantes} />} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato titulo="Ventas en efectivo" valor={<Money amount={caja.ventasEnEfectivo} />} />
            <Dato titulo="Ingresos" valor={<Money amount={caja.ingresos} />} />
            <Dato titulo="Egresos" valor={<Money amount={caja.egresos} />} />
            <Dato titulo="Retiros" valor={<Money amount={caja.retiros} />} />
          </div>

          {caja.detalle.length > 0 && (
            <Tabla
              titulo="Turnos"
              cabeceras={['Turno', 'Cerró', 'Esperado', 'Contado', 'Diferencia']}
              filas={caja.detalle.map((t) => [
                `#${String(t.turno)}`,
                t.cerradoPor ?? 'abierto',
                t.esperado === null ? '—' : <Money key="e" amount={t.esperado} />,
                t.contado === null ? '—' : <Money key="c" amount={t.contado} />,
                t.diferencia === null ? '—' : <Money key="d" amount={t.diferencia} />,
              ])}
            />
          )}
        </Card>
      )}
    </div>
  )
}

function Dato({
  titulo,
  valor,
  detalle,
}: {
  titulo: string
  valor: React.ReactNode
  detalle?: string
}) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{titulo}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{valor}</div>
      {detalle !== undefined && <div className="mt-1 text-xs text-ink-muted">{detalle}</div>}
    </div>
  )
}

function Tabla({
  titulo,
  cabeceras,
  filas,
}: {
  titulo: string
  cabeceras: string[]
  filas: React.ReactNode[][]
}) {
  if (filas.length === 0) return null
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">{titulo}</h3>
      <TableWrap>
        <Table caption={titulo}>
          <THead>
            <TR>
              {cabeceras.map((c, i) => (
                <TH key={c} align={i === 0 ? 'left' : 'right'}>
                  {c}
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
                  <TD key={`celda-${String(j)}`} align={j === 0 ? 'left' : 'right'}>
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
