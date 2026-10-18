'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  PageContainer,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  cn,
} from '@/components/ui'
import { useFuncion, usePermiso, useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaMovimientos, type MovimientoDTO } from '@/modules/inventory/dto'
import { aMilesimas, desdeMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { formatearCantidadConUnidad, type UnidadDeVenta } from '@/modules/products/units'
import { enlaceDeReferencia, textoDeReferencia } from '@/modules/inventory/referencias'
import { sumarDias } from '@/lib/tiempo'

const POR_PAGINA = 25
const ESPERA_MS = 250

/**
 * Movimientos de stock. UX V5.
 *
 * Contesta "¿por qué cambió mi stock?": cuándo, qué producto, qué pasó,
 * cuánto y por qué. Cinco columnas. Lo de antes --stock anterior y
 * posterior, referencia, usuario, codigo de lote-- queda en una linea chica
 * debajo del motivo o se fue: para la pregunta de todos los dias sobraba.
 *
 * Los nombres de cada movimiento son los del mostrador ("Entrada",
 * "Corrección", "Ajuste de inventario") y se ponen aca, en la pantalla: el
 * nombre que devuelve la API no cambia.
 */

const NOMBRE_DEL_MOVIMIENTO: Record<string, string> = {
  INITIAL: 'Stock inicial',
  SALE: 'Venta',
  SALE_CANCEL: 'Venta anulada',
  MANUAL_ADJUSTMENT: 'Corrección',
  LOSS: 'Pérdida',
  BREAKAGE: 'Rotura',
  INTERNAL_USE: 'Consumo del local',
  PURCHASE_RECEIPT: 'Entrada',
  PURCHASE_RETURN: 'Devolución al proveedor',
  INVENTORY_COUNT: 'Ajuste de inventario',
}

function nombreDe(m: MovimientoDTO): string {
  return NOMBRE_DEL_MOVIMIENTO[m.type] ?? m.typeLabel
}

type Periodo = 'hoy' | '7' | '30' | 'todos'

const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: 'hoy', etiqueta: 'Hoy' },
  { valor: '7', etiqueta: '7 días' },
  { valor: '30', etiqueta: '30 días' },
  { valor: 'todos', etiqueta: 'Todos' },
]

/** Fecha y hora cortas. */
function cuando(iso: string): { hora: string; fecha: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { hora: '—', fecha: '' }
  return {
    hora: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    fecha: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
  }
}

/** La cantidad con su signo: "+10 u.", "−2 u.". El signo dice todo, sin color. */
function Cantidad({ cantidad, unidad }: { cantidad: TextoCantidad; unidad: UnidadDeVenta }) {
  const entra = aMilesimas(cantidad) > 0
  const absoluta = desdeMilesimas(Math.abs(aMilesimas(cantidad)))
  return (
    <span data-numeric="" className="text-lg font-semibold whitespace-nowrap text-ink">
      {entra ? '+' : '−'}
      {formatearCantidadConUnidad(absoluta, unidad)}
    </span>
  )
}

export default function MovimientosPage() {
  const puedeVer = usePermiso('inventory.movements.view')
  const usaCompras = useFuncion('compras')
  const usaLotes = useFuncion('lotes')
  const { hoy } = useSession()

  const [q, setQ] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>('7')
  const [movimientos, setMovimientos] = useState<MovimientoDTO[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Identifica la peticion en curso: si el usuario sigue escribiendo, la
  // respuesta vieja que llegue despues no puede pisar a la nueva.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!puedeVer) return
    const mia = ++peticion.current
    setCargando(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), pageSize: String(POR_PAGINA) })
    if (q.trim()) params.set('q', q.trim())
    // Solo el DIA: donde empieza y termina el dia del comercio lo resuelve el
    // servidor con la zona de la sucursal.
    if (periodo !== 'todos') {
      const dias = periodo === 'hoy' ? 0 : Number(periodo) - 1
      params.set('desde', sumarDias(hoy(), -dias))
    }

    try {
      const pagina = await apiRequest(`/api/inventory/movements?${params.toString()}`, {
        parse: parsePaginaMovimientos,
      })
      if (mia !== peticion.current) return
      setMovimientos(pagina.data)
      setTotal(pagina.pagination.total)
      setTotalPages(pagina.pagination.totalPages)
    } catch (err) {
      if (mia !== peticion.current) return
      setError(mensajeDeError(err, 'No se pudo cargar el historial. Revisá la conexión.'))
    } finally {
      if (mia === peticion.current) setCargando(false)
    }
  }, [puedeVer, page, q, periodo, hoy])

  useEffect(() => {
    const t = setTimeout(() => void cargar(), ESPERA_MS)
    return () => {
      clearTimeout(t)
    }
  }, [cargar])

  if (!puedeVer) {
    return (
      <PageContainer width="narrow">
        <EmptyState
          title="Tu usuario no puede ver los movimientos"
          description="Pedíselo a quien administra el sistema."
        />
      </PageContainer>
    )
  }

  /** El motivo, o lo que lo explica cuando no se escribio uno. */
  function motivoDe(m: MovimientoDTO) {
    const href = enlaceDeReferencia(m.referenceType, m.referenceId)
    // Con Compras apagada no hay pantalla de recepciones ni de devoluciones a
    // la que llevar: queda el texto.
    const deCompras = m.referenceType === 'PurchaseReceipt' || m.referenceType === 'PurchaseReturn'
    const enlace = href !== null && (!deCompras || usaCompras) ? href : null
    const referencia =
      m.referenceType === 'InventoryCountSession'
        ? 'Ver inventario'
        : textoDeReferencia(m.referenceType, m.referenceId)
    const vinculo =
      enlace === null ? null : (
        <Link href={enlace} className="font-medium text-primary underline underline-offset-2">
          {referencia}
        </Link>
      )
    if (m.reason !== null) {
      return vinculo === null ? (
        m.reason
      ) : (
        <>
          {m.reason} · {vinculo}
        </>
      )
    }
    // Sin motivo ni pantalla a la que llevar, no se muestra un "Producto #12"
    // o "Ajuste #40": son numeros internos que no le dicen nada a nadie.
    return vinculo
  }

  function detalleDe(m: MovimientoDTO): string {
    const partes = [
      `quedó en ${formatearCantidadConUnidad(m.resultingQuantity, m.product.saleUnit)}`,
      m.user.name,
    ]
    if (usaLotes && m.lotCode !== null) partes.push(`lote ${m.lotCode}`)
    return partes.join(' · ')
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <SearchInput
            label="Buscar producto"
            labelVisible
            size="lg"
            placeholder="Nombre o código de barras"
            value={q}
            loading={cargando}
            onClear={() => {
              setQ('')
              setPage(1)
            }}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => {
            const activo = periodo === p.valor
            return (
              <button
                key={p.valor}
                type="button"
                aria-pressed={activo}
                onClick={() => {
                  setPeriodo(p.valor)
                  setPage(1)
                }}
                className={cn(
                  'min-h-control-lg rounded-md px-4 text-base font-semibold transition-colors',
                  activo
                    ? 'border-2 border-primary bg-primary-quiet text-ink'
                    : 'border border-line-strong bg-surface text-ink hover:bg-raised',
                )}
              >
                {p.etiqueta}
              </button>
            )
          })}
        </div>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={() => void cargar()} />
      ) : cargando ? (
        <SkeletonRows rows={8} />
      ) : movimientos.length === 0 ? (
        <EmptyState
          title="No hay movimientos"
          description={
            q.trim() !== '' || periodo !== 'todos'
              ? 'Probá con otra palabra o con «Todos».'
              : 'Cada venta, entrada y corrección va a aparecer acá.'
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <Table caption="Movimientos de stock">
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Producto</TH>
                    <TH>Movimiento</TH>
                    <TH align="right">Cantidad</TH>
                    <TH>Motivo</TH>
                  </TR>
                </THead>
                <TBody>
                  {movimientos.map((m) => {
                    const t = cuando(m.createdAt)
                    const motivo = motivoDe(m)
                    return (
                      <TR key={m.id}>
                        <TD className="whitespace-nowrap">
                          <p className="font-medium text-ink" data-numeric="">
                            {t.fecha}
                          </p>
                          <p className="text-sm text-ink-muted" data-numeric="">
                            {t.hora}
                          </p>
                        </TD>
                        <TD>
                          <p className="font-semibold text-ink">{m.product.name}</p>
                        </TD>
                        <TD className="text-ink">{nombreDe(m)}</TD>
                        <TD align="right">
                          <Cantidad cantidad={m.quantity} unidad={m.product.saleUnit} />
                        </TD>
                        <TD className="max-w-80">
                          <p className="truncate text-ink">{motivo ?? '—'}</p>
                          <p className="truncate text-sm text-ink-muted">{detalleDe(m)}</p>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </div>

          <CardList className="md:hidden">
            {movimientos.map((m) => {
              const t = cuando(m.createdAt)
              const motivo = motivoDe(m)
              return (
                <CardListItem key={m.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-ink">{m.product.name}</p>
                      <p className="mt-0.5 text-sm text-ink">
                        {nombreDe(m)} · {t.fecha} {t.hora}
                      </p>
                      {motivo !== null && (
                        <p className="mt-1 truncate text-sm text-ink-muted">{motivo}</p>
                      )}
                    </div>
                    <Cantidad cantidad={m.quantity} unidad={m.product.saleUnit} />
                  </div>
                </CardListItem>
              )
            })}
          </CardList>

          <Pagination
            page={page}
            pageSize={POR_PAGINA}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            disabled={cargando}
          />
        </>
      )}
    </PageContainer>
  )
}
