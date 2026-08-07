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
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { apiRequest } from '@/lib/api-client'
import { CERO, esCero, esPositivo, type Monto } from '@/lib/money'
import { parsePaginaProductos } from '@/modules/products/dto'
import { parsePaginaVentas, type VentaDTO } from '@/modules/sales/dto'
import { parseArqueos, parseSaldo, type ArqueoDTO } from '@/modules/cash/dto'
import { STOCK_CRITICO } from '@/modules/products/schemas'
import type { Product } from '@/hooks/useProducts'

/** YYYY-MM-DD de hoy, en hora local. */
function hoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // prettier-ignore
}

interface Panel {
  saldo: Monto | null
  efectivoHoy: Monto
  ventasHoy: number
  anuladasHoy: number
  recaudadoHoy: Monto
  ultimasVentas: VentaDTO[]
  bajos: Product[]
  agotados: number
  ultimoArqueo: ArqueoDTO | null
}

const VACIO: Panel = {
  saldo: null,
  efectivoHoy: CERO,
  ventasHoy: 0,
  anuladasHoy: 0,
  recaudadoHoy: CERO,
  ultimasVentas: [],
  bajos: [],
  agotados: 0,
  ultimoArqueo: null,
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
  const { session, puede } = useSession()
  const [datos, setDatos] = useState<Panel>(VACIO)
  const [cargando, setCargando] = useState(true)

  const verCaja = puede('cash.view')
  const verVentas = puede('sales.view')
  const verReportes = puede('reports.view')
  const verStock = puede('stock.view')
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

    if (verReportes) {
      const d = hoy()
      tareas.push(
        apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=5`, {
          parse: parsePaginaVentas,
        })
          .then((r) => {
            salida.ventasHoy = r.totales.ventas
            salida.anuladasHoy = r.totales.anuladas
            salida.recaudadoHoy = r.totales.recaudado
            salida.ultimasVentas = r.data
          })
          .catch(() => undefined),
      )
    }

    if (verStock) {
      tareas.push(
        apiRequest('/api/products?lowStock=true&estado=activos&pageSize=5&sortBy=name', {
          parse: parsePaginaProductos,
        })
          .then((p) => {
            salida.bajos = p.data
          })
          .catch(() => undefined),
        apiRequest('/api/products?sinStock=true&estado=activos&pageSize=1', {
          parse: parsePaginaProductos,
        })
          .then((p) => {
            salida.agotados = p.total
          })
          .catch(() => undefined),
      )
    }

    await Promise.all(tareas)
    setDatos(salida)
    setCargando(false)
  }, [verCaja, verReportes, verStock])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const sinNada =
    !cargando &&
    datos.ventasHoy === 0 &&
    datos.bajos.length === 0 &&
    datos.agotados === 0 &&
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

          {verReportes && (
            <>
              <MetricCard
                href="/ventas"
                label="Ventas de hoy"
                value={datos.ventasHoy}
                detail={datos.anuladasHoy > 0 ? `${datos.anuladasHoy} anuladas` : 'Sin anulaciones'}
                tone={datos.anuladasHoy > 0 ? 'warning' : 'neutral'}
              />
              <MetricCard
                href="/ventas"
                label="Recaudado hoy"
                value={<Money amount={datos.recaudadoHoy} size="lg" />}
                detail="No incluye las anuladas"
              />
            </>
          )}

          {verStock && (
            <MetricCard
              href="/stock"
              label="Faltantes"
              value={datos.agotados + datos.bajos.length}
              detail={`${datos.agotados} agotados · ${datos.bajos.length} por debajo de ${STOCK_CRITICO}`}
              tone={datos.agotados > 0 ? 'danger' : datos.bajos.length > 0 ? 'warning' : 'success'}
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
                  description={`Ningún producto activo tiene menos de ${STOCK_CRITICO} unidades.`}
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {datos.bajos.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                      <StockBadge quantity={p.totalStock} critical={STOCK_CRITICO} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}
      </div>

      {!cargando && !verCaja && !verReportes && !verStock && (
        <Card>
          <EmptyState
            title="Tu panel está vacío a propósito"
            description="Tu rol no incluye caja, reportes ni stock. Usá el menú para ir a lo que sí podés hacer."
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
