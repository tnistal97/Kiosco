'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  ButtonLink,
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
import { apiRequest } from '@/lib/api-client'
import { parseReposicion, type ReposicionDTO } from '@/modules/inventory/dto'

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
  const puedeVerMovimientos = usePermiso('inventory.movements.view')

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

  // Los tres números son de TODA la sucursal, no de la página que se está
  // viendo. Contar sobre `products` daba "2 agotados" cuando había 40, y esa
  // clase de número es peor que no mostrar ninguno.
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Productos en esta página" value={products.length} />
        <MetricCard
          label="Bajo mínimo"
          value={reposicion?.bajoMinimo ?? 0}
          tone={(reposicion?.bajoMinimo ?? 0) > 0 ? 'warning' : 'neutral'}
          detail="Llegaron al mínimo configurado"
        />
        <MetricCard
          label="Agotados"
          value={reposicion?.agotados ?? 0}
          tone={(reposicion?.agotados ?? 0) > 0 ? 'danger' : 'neutral'}
          detail="No se pueden vender"
        />
      </div>

      {/* El aviso de que nadie configuró mínimos. Sin esto, "0 bajo mínimo" se
          lee como "está todo bien", cuando lo que pasa es que el sistema no
          sabe cuánto tiene que haber de nada. */}
      {reposicion !== null && reposicion.sinMinimo > 0 && (
        <Alert tone="info" title="Todavía no hay mínimos configurados">
          {reposicion.sinMinimo === 1
            ? 'Un producto activo no tiene mínimo de reposición.'
            : `${reposicion.sinMinimo} productos activos no tienen mínimo de reposición.`}{' '}
          Hasta que se los cargues, el aviso de stock bajo no puede sonar para ellos: solo vas a ver
          los que ya están agotados. Se carga desde la ficha de cada producto.
        </Alert>
      )}

      {puedeVerMovimientos && (
        <div className="flex justify-end">
          <ButtonLink href="/stock/movimientos" variant="secondary" size="sm">
            Ver movimientos
          </ButtonLink>
        </div>
      )}

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
              <option value="bajos">Solo bajo mínimo</option>
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
                            <StockBadge
                              quantity={p.totalStock}
                              minimum={p.minimumStock}
                              unit={p.saleUnit}
                            />
                          </TD>
                          <TD align="right">
                            <Money amount={p.price} size="sm" tone="muted" />
                          </TD>
                          <TD align="right">
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
                          <StockBadge
                            quantity={p.totalStock}
                            minimum={p.minimumStock}
                            unit={p.saleUnit}
                          />
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
          aviso.ok('Stock ajustado. Quedó registrado en el libro de inventario.')
          void fetchProducts()
          recargarReposicion()
        }}
      />
    </div>
  )
}
