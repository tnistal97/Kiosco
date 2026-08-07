'use client'

import { useState } from 'react'
import {
  Button,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  MetricCard,
  Money,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  StockBadge,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
} from '@/components/ui'
import { DialogoAjusteStock } from '@/components/stock/DialogoAjusteStock'
import { usePermiso } from '@/components/shell/SessionProvider'
import { useProducts, type Product } from '@/hooks/useProducts'
import { STOCK_CRITICO } from '@/modules/products/schemas'

const POR_PAGINA = 25

/**
 * Inventario.
 *
 * Mira lo mismo que el catalogo pero desde la otra punta: aca importa cuanto
 * hay, no cuanto sale. Por eso arranca ordenado por lo que falta y el ajuste
 * es la accion principal de cada fila.
 *
 * Todo ajuste exige motivo y queda auditado. No hay forma de cambiar el stock
 * sin decir por que.
 */
export default function StockPage() {
  const puedeAjustar = usePermiso('stock.adjust')

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
  } = useProducts({ enServidor: true, pageSize: POR_PAGINA })

  const [ajustando, setAjustando] = useState<Product | null>(null)

  const bajos = products.filter((p) => p.totalStock > 0 && p.totalStock < STOCK_CRITICO).length
  const agotados = products.filter((p) => p.totalStock <= 0).length

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Productos en esta página" value={products.length} />
        <MetricCard
          label="Con stock bajo"
          value={bajos}
          tone={bajos > 0 ? 'warning' : 'neutral'}
          detail={`Menos de ${STOCK_CRITICO} unidades`}
        />
        <MetricCard
          label="Agotados"
          value={agotados}
          tone={agotados > 0 ? 'danger' : 'neutral'}
          detail="No se pueden vender"
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-end">
          <div className="lg:max-w-md lg:flex-1">
            <SearchInput
              label="Buscar productos"
              placeholder="Nombre o código de barras…"
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

          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Categoría"
              value={filtros.categoryId === undefined ? '' : String(filtros.categoryId)}
              onChange={(e) => {
                aplicarFiltros({
                  ...filtros,
                  categoryId: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }}
              className="w-auto"
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              aria-label="Filtro de stock"
              value={filtros.sinStock ? 'agotados' : filtros.lowStock ? 'bajos' : ''}
              onChange={(e) => {
                const v = e.target.value
                aplicarFiltros({ ...filtros, lowStock: v === 'bajos', sinStock: v === 'agotados' })
              }}
              className="w-auto"
            >
              <option value="">Todo el inventario</option>
              <option value="bajos">Solo stock bajo</option>
              <option value="agotados">Solo agotados</option>
            </Select>
          </div>
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void fetchProducts()} />
          ) : isLoading ? (
            <SkeletonRows rows={8} />
          ) : products.length === 0 ? (
            <EmptyState
              title="Nada que mostrar"
              description="Probá con otro texto o quitá los filtros."
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap className="border-0">
                  <Table caption="Inventario de la sucursal">
                    <THead>
                      <TR>
                        <TH>Producto</TH>
                        <TH>Categoría</TH>
                        <TH>Stock</TH>
                        <TH align="right">Precio</TH>
                        <TH align="right">
                          <span className="sr-only">Acciones</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {products.map((p) => (
                        <TR key={p.id}>
                          <TD>
                            <p className="font-medium text-ink">{p.name}</p>
                            {p.barcode && (
                              <p className="font-mono text-xs text-ink-faint">{p.barcode}</p>
                            )}
                          </TD>
                          <TD className="text-ink-muted">{p.category.name}</TD>
                          <TD>
                            <StockBadge quantity={p.totalStock} critical={STOCK_CRITICO} />
                          </TD>
                          <TD align="right">
                            <Money amount={p.price} size="sm" tone="muted" />
                          </TD>
                          <TD align="right">
                            {puedeAjustar && (
                              <Button
                                size="xs"
                                variant="secondary"
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
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">{p.category.name}</p>
                        <div className="mt-2">
                          <StockBadge quantity={p.totalStock} critical={STOCK_CRITICO} />
                        </div>
                      </div>
                      {puedeAjustar && (
                        <Button
                          size="sm"
                          variant="secondary"
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
                className="mt-4"
                page={page}
                pageSize={POR_PAGINA}
                total={total}
                totalPages={totalPages}
                onPageChange={setPage}
                disabled={isLoading}
              />
            </>
          )}
        </div>
      </Card>

      <DialogoAjusteStock
        producto={ajustando}
        onCerrar={() => {
          setAjustando(null)
        }}
        onAjustado={() => {
          setAjustando(null)
          aviso.ok('Stock ajustado. Quedó registrado en la bitácora.')
          void fetchProducts()
        }}
      />
    </div>
  )
}
