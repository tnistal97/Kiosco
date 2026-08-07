'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  ConfirmationDialog,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  Money,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  SortableTH,
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
import { DialogoProducto } from '@/components/productos/DialogoProducto'
import { usePermiso } from '@/components/shell/SessionProvider'
import { useProducts, type CampoOrden, type Product } from '@/hooks/useProducts'
import { apiRequest, lista, mensajeDeError, esObjeto, numero, texto } from '@/lib/api-client'
import type { ProveedorDTO } from '@/modules/products/dto'

const POR_PAGINA = 25

function parseProveedores(raw: unknown): ProveedorDTO[] {
  const fuente = esObjeto(raw) && 'data' in raw ? raw.data : raw
  return lista(fuente, (p) => {
    if (!esObjeto(p)) throw new Error('La respuesta no tiene la forma de un proveedor')
    return { id: numero(p.id), name: texto(p.name) }
  })
}

export default function ProductosPage() {
  const puedeCrear = usePermiso('products.create')
  const puedeEditar = usePermiso('products.update')
  const puedeBorrar = usePermiso('products.delete')

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

  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])
  const [editando, setEditando] = useState<Product | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [borrando, setBorrando] = useState<Product | null>(null)

  useEffect(() => {
    apiRequest('/api/suppliers', { parse: parseProveedores })
      .then(setProveedores)
      // Sin proveedores la ficha sigue sirviendo: es un campo opcional.
      .catch(() => {
        setProveedores([])
      })
  }, [])

  const ordenar = useCallback(
    (campo: CampoOrden) => {
      const mismo = filtros.sortBy === campo
      aplicarFiltros({
        ...filtros,
        sortBy: campo,
        sortDir: mismo && filtros.sortDir === 'asc' ? 'desc' : 'asc',
      })
    },
    [filtros, aplicarFiltros],
  )

  async function borrar() {
    if (!borrando) return
    try {
      await apiRequest(`/api/products/${borrando.id}`, { method: 'DELETE', parse: () => null })
      aviso.ok(`Se eliminó ${borrando.name}.`)
      setBorrando(null)
      void fetchProducts()
    } catch (err) {
      // Un producto con ventas no se puede borrar. El servidor lo explica; se
      // muestra tal cual en vez de un "no se pudo" que no dice por que.
      aviso.error(mensajeDeError(err, 'No se pudo eliminar el producto.'))
      setBorrando(null)
    }
  }

  const orden = filtros.sortBy ?? 'name'
  const dir = filtros.sortDir ?? 'asc'

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 sm:p-5">
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
              aria-label="Estado"
              value={filtros.estado ?? 'todos'}
              onChange={(e) => {
                aplicarFiltros({
                  ...filtros,
                  estado: e.target.value as 'activos' | 'inactivos' | 'todos',
                })
              }}
              className="w-auto"
            >
              <option value="todos">Todos</option>
              <option value="activos">En venta</option>
              <option value="inactivos">Dados de baja</option>
            </Select>

            <Select
              aria-label="Stock"
              value={filtros.sinStock ? 'agotados' : filtros.lowStock ? 'bajos' : ''}
              onChange={(e) => {
                const v = e.target.value
                aplicarFiltros({
                  ...filtros,
                  lowStock: v === 'bajos',
                  sinStock: v === 'agotados',
                })
              }}
              className="w-auto"
            >
              <option value="">Cualquier stock</option>
              <option value="bajos">Stock bajo</option>
              <option value="agotados">Agotados</option>
            </Select>
          </div>

          {puedeCrear && (
            <Button
              variant="primary"
              className="lg:ml-auto"
              onClick={() => {
                setEditando(null)
                setDialogoAbierto(true)
              }}
            >
              Nuevo producto
            </Button>
          )}
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void fetchProducts()} />
          ) : isLoading ? (
            <SkeletonRows rows={8} />
          ) : products.length === 0 ? (
            <EmptyState
              title={searchTerm ? 'Ningún producto coincide' : 'Todavía no hay productos'}
              description={
                searchTerm
                  ? 'Probá con otro texto o quitá los filtros.'
                  : 'Cargá el primero para empezar a vender.'
              }
              action={
                puedeCrear && !searchTerm ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setEditando(null)
                      setDialogoAbierto(true)
                    }}
                  >
                    Nuevo producto
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap className="border-0">
                  <Table caption="Catálogo de la sucursal">
                    <THead>
                      <TR>
                        <SortableTH
                          active={orden === 'name'}
                          direction={dir}
                          onSort={() => {
                            ordenar('name')
                          }}
                        >
                          Producto
                        </SortableTH>
                        <TH>Categoría</TH>
                        <TH>Estado</TH>
                        <TH>Stock</TH>
                        <SortableTH
                          align="right"
                          active={orden === 'price'}
                          direction={dir}
                          onSort={() => {
                            ordenar('price')
                          }}
                        >
                          Precio
                        </SortableTH>
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
                            {p.isActive ? (
                              <Badge tone="neutral">
                                <span aria-hidden="true">✓</span> En venta
                              </Badge>
                            ) : (
                              <Badge tone="warning">
                                <span aria-hidden="true">⊘</span> De baja
                              </Badge>
                            )}
                          </TD>
                          <TD>
                            <StockBadge quantity={p.totalStock} unit={p.saleUnit} />
                          </TD>
                          <TD align="right">
                            <Money amount={p.price} />
                          </TD>
                          <TD align="right">
                            <AccionesProducto
                              producto={p}
                              puedeEditar={puedeEditar}
                              puedeBorrar={puedeBorrar}
                              onEditar={() => {
                                setEditando(p)
                                setDialogoAbierto(true)
                              }}
                              onBorrar={() => {
                                setBorrando(p)
                              }}
                            />
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
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StockBadge quantity={p.totalStock} unit={p.saleUnit} />
                          {!p.isActive && (
                            <Badge tone="warning">
                              <span aria-hidden="true">⊘</span> De baja
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Money amount={p.price} />
                        <AccionesProducto
                          producto={p}
                          puedeEditar={puedeEditar}
                          puedeBorrar={puedeBorrar}
                          onEditar={() => {
                            setEditando(p)
                            setDialogoAbierto(true)
                          }}
                          onBorrar={() => {
                            setBorrando(p)
                          }}
                        />
                      </div>
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

      <DialogoProducto
        producto={editando}
        abierto={dialogoAbierto}
        categorias={categories}
        proveedores={proveedores}
        onCerrar={() => {
          setDialogoAbierto(false)
        }}
        onGuardado={() => {
          setDialogoAbierto(false)
          aviso.ok(editando ? 'Producto actualizado.' : 'Producto creado.')
          void fetchProducts()
        }}
      />

      <ConfirmationDialog
        open={borrando !== null}
        onClose={() => {
          setBorrando(null)
        }}
        onConfirm={borrar}
        title="Eliminar el producto"
        confirmLabel="Eliminar"
        message={
          <>
            Se va a eliminar <strong className="text-ink">{borrando?.name}</strong> del catálogo. Si
            figura en alguna venta el sistema no lo va a permitir: en ese caso, dalo de baja desde
            la ficha.
          </>
        }
      />
    </div>
  )
}

/**
 * Acciones de la fila, dentro de un menu.
 *
 * "Eliminar" ya no es un boton rojo pegado a "Editar". Era la accion
 * destructiva mas facil de tocar por accidente de todo el sistema: mismo
 * tamanio, mismo lugar, en cada una de las cuarenta filas.
 */
function AccionesProducto({
  producto,
  puedeEditar,
  puedeBorrar,
  onEditar,
  onBorrar,
}: {
  producto: Product
  puedeEditar: boolean
  puedeBorrar: boolean
  onEditar: () => void
  onBorrar: () => void
}) {
  if (!puedeEditar && !puedeBorrar) return null

  return (
    <DropdownMenu
      trigger={
        <IconButton label={`Acciones de ${producto.name}`} size="sm">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </IconButton>
      }
    >
      {puedeEditar && <DropdownItem onClick={onEditar}>Editar</DropdownItem>}
      {puedeBorrar && (
        <DropdownItem tone="danger" onClick={onBorrar}>
          Eliminar
        </DropdownItem>
      )}
    </DropdownMenu>
  )
}
