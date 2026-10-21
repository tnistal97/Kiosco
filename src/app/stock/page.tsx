'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  PageContainer,
  Button,
  ButtonLink,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  EstadoStockBadge,
  Field,
  Pagination,
  SearchInput,
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
  cn,
  formatQuantity,
} from '@/components/ui'
import { DialogoAjusteStock } from '@/components/stock/DialogoAjusteStock'
import { usePermiso } from '@/components/shell/SessionProvider'
import { useProducts, type Product } from '@/hooks/useProducts'
import { apiRequest } from '@/lib/api-client'
import { parseReposicion, type ReposicionDTO } from '@/modules/inventory/dto'

const POR_PAGINA = 25

type Filtro = 'todos' | 'bajo' | 'sin'

/**
 * Stock. UX V5.
 *
 * Contesta una sola pregunta: "¿qué mercadería tengo?". Producto, cuánto hay
 * y, solo cuando dice algo, el estado: "Stock bajo" o "Sin stock". Lo que
 * falta se encuentra con un toque en "Stock bajo" o "Sin stock", que ademas
 * dicen cuantos hay. Nada de metricas sueltas ni de precios: para eso esta
 * Productos.
 *
 * `?estado=bajo` o `?estado=sin` abre la lista ya filtrada: es a donde lleva
 * el aviso de Inicio.
 */
export default function StockPage() {
  return (
    <Suspense fallback={null}>
      <StockContenido />
    </Suspense>
  )
}

function StockContenido() {
  const puedeAjustar = usePermiso('stock.adjust')
  const puedeVerMovimientos = usePermiso('inventory.movements.view')
  const puedeContar = usePermiso('inventoryCounts.view')

  const {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    filtros,
    aplicarFiltros,
    page,
    setPage,
    total,
    totalPages,
    fetchProducts,
    isLoading,
    error,
  } = useProducts({
    enServidor: true,
    pageSize: POR_PAGINA,
    // De la A a la Z. Sin pedirlo, la API ordena al reves y la lista
    // empezaba por la Z aunque el encabezado dijera "▲".
    //
    // Solo los activos: la mercaderia de un producto dado de baja no esta a
    // la venta, y sin pedirlo la API los devuelve tambien.
    filtrosIniciales: { sortBy: 'name', sortDir: 'asc', estado: 'activos' },
  })

  const [ajustando, setAjustando] = useState<Product | null>(null)
  const [reposicion, setReposicion] = useState<ReposicionDTO | null>(null)

  const recargarReposicion = useCallback(() => {
    apiRequest('/api/inventory/replenishment', { parse: parseReposicion })
      .then(setReposicion)
      .catch(() => {
        setReposicion(null)
      })
  }, [])

  useEffect(() => {
    recargarReposicion()
  }, [recargarReposicion])

  const filtro: Filtro = filtros.sinStock ? 'sin' : filtros.lowStock ? 'bajo' : 'todos'

  const elegirFiltro = useCallback(
    (f: Filtro) => {
      aplicarFiltros({ ...filtros, lowStock: f === 'bajo', sinStock: f === 'sin' })
    },
    [filtros, aplicarFiltros],
  )

  // El filtro que pide la direccion se aplica una sola vez, al entrar.
  const params = useSearchParams()
  const aplicado = useRef(false)
  useEffect(() => {
    if (aplicado.current) return
    aplicado.current = true
    const pedido = params.get('estado')
    if (pedido === 'bajo' || pedido === 'sin') elegirFiltro(pedido)
  }, [params, elegirFiltro])

  const opciones: Array<{ valor: Filtro; etiqueta: string; cuantos: number | null }> = [
    { valor: 'todos', etiqueta: 'Todos', cuantos: null },
    { valor: 'bajo', etiqueta: 'Stock bajo', cuantos: reposicion?.bajoMinimo ?? null },
    { valor: 'sin', etiqueta: 'Sin stock', cuantos: reposicion?.agotados ?? null },
  ]

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <SearchInput
            label="Buscar productos"
            labelVisible
            size="lg"
            placeholder="Nombre o código de barras"
            value={searchTerm}
            loading={isLoading}
            onClear={() => {
              setSearchTerm('')
            }}
            onChange={(e) => {
              setSearchTerm(e.target.value)
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {puedeVerMovimientos && (
            <ButtonLink href="/stock/movimientos" variant="secondary" size="lg">
              Ver movimientos
            </ButtonLink>
          )}
          {puedeContar && (
            <ButtonLink href="/inventarios" variant="secondary" size="lg">
              Hacer inventario
            </ButtonLink>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div role="group" aria-label="Mostrar" className="flex flex-wrap gap-2">
          {opciones.map((o) => {
            const activo = filtro === o.valor
            return (
              <button
                key={o.valor}
                type="button"
                aria-pressed={activo}
                onClick={() => {
                  elegirFiltro(o.valor)
                }}
                className={cn(
                  'inline-flex min-h-control items-center gap-2 rounded-md px-4 text-[0.9375rem] font-semibold transition-colors',
                  activo
                    ? 'border-2 border-primary bg-primary-quiet text-ink'
                    : 'border border-line-strong bg-surface text-ink hover:bg-raised',
                )}
              >
                {o.valor === 'bajo' && (
                  <span aria-hidden="true" className="text-warning">
                    ▲
                  </span>
                )}
                {o.valor === 'sin' && (
                  <span aria-hidden="true" className="text-danger">
                    ✕
                  </span>
                )}
                {o.etiqueta}
                {o.cuantos !== null && (
                  <span
                    className="rounded-sm bg-raised px-1.5 text-sm text-ink-muted"
                    data-numeric=""
                  >
                    {o.cuantos}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <Field label="Categoría" className="sm:w-56">
          <Select
            value={filtros.categoryId === undefined ? '' : String(filtros.categoryId)}
            onChange={(e) => {
              aplicarFiltros({
                ...filtros,
                categoryId: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }}
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={() => void fetchProducts()} />
      ) : isLoading ? (
        <SkeletonRows rows={8} />
      ) : products.length === 0 ? (
        <EmptyState
          title={
            filtro === 'sin'
              ? 'No hay productos sin stock'
              : filtro === 'bajo'
                ? 'No hay productos con stock bajo'
                : 'No encontramos productos'
          }
          description={
            filtro === 'todos'
              ? 'Probá con otra palabra o elegí «Todas» en categoría.'
              : 'Está todo en orden.'
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <Table caption="Stock de la sucursal">
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH align="right">Stock actual</TH>
                    <TH>Estado</TH>
                    <TH align="right">
                      <span className="sr-only">Acciones</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {products.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <p className="font-semibold text-ink">{p.name}</p>
                        <p className="text-sm text-ink-muted">{p.category.name}</p>
                      </TD>
                      <TD align="right" className="text-lg font-semibold" data-numeric="">
                        {formatQuantity(p.totalStock, p.saleUnit)}
                      </TD>
                      <TD>
                        <EstadoStockBadge estado={p.estado} mostrarNormal />
                      </TD>
                      <TD align="right">
                        {puedeAjustar && (
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Ajustar el stock de ${p.name}`}
                            onClick={() => {
                              setAjustando(p)
                            }}
                          >
                            Ajustar
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </div>

          <CardList className="md:hidden">
            {products.map((p) => (
              <CardListItem key={p.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-ink">{p.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold text-ink" data-numeric="">
                        {formatQuantity(p.totalStock, p.saleUnit)}
                      </span>
                      <EstadoStockBadge estado={p.estado} mostrarNormal />
                    </p>
                  </div>
                  {puedeAjustar && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Ajustar el stock de ${p.name}`}
                      onClick={() => {
                        setAjustando(p)
                      }}
                    >
                      Ajustar
                    </Button>
                  )}
                </div>
              </CardListItem>
            ))}
          </CardList>

          <Pagination
            page={page}
            pageSize={POR_PAGINA}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </>
      )}

      {reposicion !== null && reposicion.sinMinimo > 0 && filtro === 'bajo' && (
        <p className="text-sm text-ink-muted">
          {reposicion.sinMinimo === 1
            ? 'Un producto no tiene cargado cuándo avisar que queda poco.'
            : `${String(reposicion.sinMinimo)} productos no tienen cargado cuándo avisar que queda poco.`}{' '}
          Se carga en Productos → Editar → Más opciones.
        </p>
      )}

      <DialogoAjusteStock
        producto={ajustando}
        onCerrar={() => {
          setAjustando(null)
        }}
        onAjustado={() => {
          setAjustando(null)
          aviso.ok('Stock ajustado. Quedó en Movimientos.')
          void fetchProducts()
          recargarReposicion()
        }}
      />
    </PageContainer>
  )
}
