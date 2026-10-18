'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Metric, MetricRow, Money, PageContainer, Section, Skeleton, cn } from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { IconoDe } from '@/components/shell/icons'
import { apiRequest } from '@/lib/api-client'
import type { Monto } from '@/lib/money'
import { parsePaginaVentas } from '@/modules/sales/dto'
import { parseEstadoDeCaja, type EstadoDeCajaDTO } from '@/modules/cash/dto'
import { parseReposicion, type ReposicionDTO } from '@/modules/inventory/dto'
import type { Permission } from '@/server/authz/permissions'

/**
 * Inicio. UX V5.
 *
 * No es un tablero: es la puerta de entrada. Pregunta "¿qué vas a hacer?"
 * con cinco botones grandes --Vender, Caja, Productos, Stock, Hacer
 * inventario-- y muestra solo tres datos de hoy: cuanto se vendio, como esta
 * la caja y cuantos productos se estan quedando sin stock. Cada dato lleva a
 * la pantalla que lo explica.
 *
 * Lo que habia antes --once tarjetas con numeros de compras, deudas,
 * vencimientos, cobranzas-- sigue existiendo en Reportes, Caja y Clientes. Un
 * empleado que entra a trabajar no necesita leerlo para empezar.
 */

interface Acceso {
  href: string
  titulo: string
  descripcion: string
  permiso?: Permission
  principal?: boolean
}

const ACCESOS: Acceso[] = [
  {
    href: '/venta',
    titulo: 'Vender',
    descripcion: 'Escaneá o buscá productos y cobrá',
    permiso: 'sales.create',
    principal: true,
  },
  {
    href: '/caja',
    titulo: 'Caja',
    descripcion: 'Abrir, contar y cerrar la caja',
    permiso: 'cash.view',
  },
  {
    href: '/productos',
    titulo: 'Productos',
    descripcion: 'Agregar, buscar y cambiar precios',
    permiso: 'products.view',
  },
  { href: '/stock', titulo: 'Stock', descripcion: 'Qué mercadería tenés', permiso: 'stock.view' },
  {
    href: '/inventarios',
    titulo: 'Hacer inventario',
    descripcion: 'Contar lo que hay y corregir el stock',
    permiso: 'inventoryCounts.view',
  },
]

interface Hoy {
  ventas: { cantidad: number; total: Monto | null } | null
  caja: EstadoDeCajaDTO | null
  reposicion: ReposicionDTO | null
}

export default function InicioPage() {
  const { session, puede, hoy } = useSession()
  const [datos, setDatos] = useState<Hoy | null>(null)

  const verVentas = puede('sales.view')
  const verVentasEnPesos = puede('reports.sales.view')
  const verCaja = puede('cash.view')
  const verStock = puede('stock.view')

  useEffect(() => {
    let vivo = true
    const d = hoy()
    void Promise.all([
      verVentas
        ? apiRequest(`/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=1`, {
            parse: parsePaginaVentas,
          })
            .then((r) => ({
              cantidad: r.totales.ventas,
              // Sin permiso de reportes el importe no viaja: no se muestra un
              // cero que no es cierto.
              total: verVentasEnPesos ? r.totales.recaudado : null,
            }))
            .catch(() => null)
        : Promise.resolve(null),
      verCaja
        ? apiRequest('/api/cash/shift', { parse: parseEstadoDeCaja }).catch(() => null)
        : Promise.resolve(null),
      verStock
        ? apiRequest('/api/inventory/replenishment', { parse: parseReposicion }).catch(() => null)
        : Promise.resolve(null),
    ]).then(([ventas, caja, reposicion]) => {
      if (vivo) setDatos({ ventas, caja, reposicion })
    })
    return () => {
      vivo = false
    }
  }, [hoy, verVentas, verVentasEnPesos, verCaja, verStock])

  const accesos = ACCESOS.filter((a) => !a.permiso || puede(a.permiso))
  const [principal, ...resto] = accesos
  const nombre = session?.name.split(' ')[0] ?? ''
  const turno = datos?.caja?.turno ?? null
  const pocoStock = datos?.reposicion
    ? datos.reposicion.agotados + datos.reposicion.bajoMinimo
    : null

  return (
    <PageContainer className="gap-8">
      <div>
        <h2 className="text-2xl font-semibold text-ink">Hola{nombre ? `, ${nombre}` : ''}</h2>
        <p className="mt-1 text-lg text-ink-muted">¿Qué vas a hacer?</p>
      </div>

      <nav aria-label="Accesos" className="flex flex-col gap-3">
        {principal && (
          <AccesoGrande
            acceso={principal}
            detalle={
              principal.href === '/venta' && datos?.caja && turno === null
                ? 'Primero hay que abrir la caja'
                : undefined
            }
          />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {resto.map((a) => (
            <AccesoGrande
              key={a.href}
              acceso={a}
              detalle={
                a.href === '/caja' && datos?.caja
                  ? turno === null
                    ? 'Cerrada · tocá para abrirla'
                    : 'Abierta'
                  : undefined
              }
            />
          ))}
        </div>
      </nav>

      {(verVentas || verCaja || verStock) && (
        <Section title="Hoy">
          {datos === null ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <MetricRow className="rounded-lg border border-line bg-surface p-5">
              {datos.ventas !== null && (
                <Metric
                  label="Ventas de hoy"
                  value={
                    datos.ventas.total !== null ? (
                      <Money amount={datos.ventas.total} size="lg" />
                    ) : (
                      String(datos.ventas.cantidad)
                    )
                  }
                  hint={
                    datos.ventas.total !== null
                      ? `${String(datos.ventas.cantidad)} ${datos.ventas.cantidad === 1 ? 'venta' : 'ventas'}`
                      : datos.ventas.cantidad === 1
                        ? 'venta'
                        : 'ventas'
                  }
                  href="/ventas"
                />
              )}
              {datos.caja !== null && (
                <Metric
                  label="Caja"
                  value={
                    turno === null ? 'Cerrada' : <Money amount={turno.expectedAmount} size="lg" />
                  }
                  hint={
                    turno === null ? 'Hay que abrirla para vender' : 'Tiene que haber en el cajón'
                  }
                  tone={turno === null ? 'warning' : 'neutral'}
                  href="/caja"
                />
              )}
              {pocoStock !== null && (
                <Metric
                  label="Productos con poco stock"
                  value={String(pocoStock)}
                  hint={
                    pocoStock === 0
                      ? 'Todo en orden'
                      : `${String(datos.reposicion?.agotados ?? 0)} sin stock · ${String(datos.reposicion?.bajoMinimo ?? 0)} con stock bajo`
                  }
                  tone={pocoStock === 0 ? 'neutral' : 'warning'}
                  href={
                    (datos.reposicion?.agotados ?? 0) > 0
                      ? '/stock?estado=sin'
                      : '/stock?estado=bajo'
                  }
                />
              )}
            </MetricRow>
          )}
        </Section>
      )}
    </PageContainer>
  )
}

function AccesoGrande({ acceso, detalle }: { acceso: Acceso; detalle?: ReactNode }) {
  return (
    <Link
      href={acceso.href}
      className={cn(
        'group flex items-center gap-4 rounded-lg border px-5 transition-colors',
        acceso.principal
          ? 'min-h-24 border-transparent bg-primary text-ink-on-solid hover:bg-primary-hover'
          : 'min-h-20 border-line-strong bg-surface text-ink hover:bg-raised',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-md [&_svg]:h-6 [&_svg]:w-6',
          acceso.principal ? 'bg-white/15' : 'bg-primary-quiet text-primary',
        )}
      >
        <IconoDe href={acceso.href} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('font-semibold', acceso.principal ? 'text-2xl' : 'text-lg')}>
          {acceso.titulo}
        </span>
        <span
          className={cn('text-sm', acceso.principal ? 'text-ink-on-solid/90' : 'text-ink-muted')}
        >
          {detalle ?? acceso.descripcion}
        </span>
      </span>
    </Link>
  )
}
