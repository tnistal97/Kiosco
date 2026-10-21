'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  PageContainer,
  Badge,
  Button,
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
  EstadoStockBadge,
  Field,
  formatQuantity,
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
import { parseProducto, type ProveedorDTO } from '@/modules/products/dto'

const POR_PAGINA = 25

function parseProveedores(raw: unknown): ProveedorDTO[] {
  const fuente = esObjeto(raw) && 'data' in raw ? raw.data : raw
  return lista(fuente, (p) => {
    if (!esObjeto(p)) throw new Error('La respuesta no tiene la forma de un proveedor')
    return { id: numero(p.id), name: texto(p.name) }
  })
}

/**
 * `useSearchParams` obliga a un limite de Suspense: sin el, el build de Next
 * falla al prerenderizar la pagina.
 */
export default function ProductosPage() {
  return (
    <Suspense fallback={null}>
      <ProductosContenido />
    </Suspense>
  )
}

function ProductosContenido() {
  const puedeCrear = usePermiso('products.create')
  const puedeEditar = usePermiso('products.update')
  const puedeBorrar = usePermiso('products.delete')
  const puedeCambiarPrecios = usePermiso('products.price.update')
  // Con Compras apagada (`KIOSCO_FUNCIONES`) este permiso no llega al
  // navegador: no hay proveedores que elegir y no se piden.
  const verProveedores = usePermiso('suppliers.view')

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
    fetchCategories,
    isLoading,
    error,
  } = useProducts({
    enServidor: true,
    pageSize: POR_PAGINA,
    // De la A a la Z. Sin pedirlo, la API ordena al reves y la lista
    // empezaba por la Z aunque el encabezado dijera "▲".
    //
    // Solo los activos: sin pedirlo, la API devuelve tambien los dados de
    // baja, y un catalogo que se reemplazo entero (House, la demostracion
    // fuera de uso) quedaba mezclado con el real. Los de baja siguen a un
    // toque, en "Más acciones → Ver dados de baja".
    filtrosIniciales: { sortBy: 'name', sortDir: 'asc', estado: 'activos' },
  })

  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])
  const [editando, setEditando] = useState<Product | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [borrando, setBorrando] = useState<Product | null>(null)

  // `?producto=12` abre la ficha de ese producto: es a donde enlazan el detalle
  // de una devolucion y la ficha de un proveedor (auditoria, H-04).
  const params = useSearchParams()
  const productoPedido = params.get('producto')
  useEffect(() => {
    if (productoPedido === null) return
    const id = Number(productoPedido)
    if (!Number.isInteger(id) || id <= 0) return
    let vivo = true
    apiRequest(`/api/products/${String(id)}`, { parse: parseProducto })
      .then((p) => {
        if (!vivo) return
        setEditando(p)
        setDialogoAbierto(true)
      })
      .catch(() => {
        if (vivo) aviso.error('No encontramos ese producto.')
      })
    return () => {
      vivo = false
    }
  }, [productoPedido])

  useEffect(() => {
    if (!verProveedores) return
    // Solo los ACTIVOS y hasta cien: es la lista del selector de la ficha, y
    // un proveedor dado de baja no se puede elegir. El endpoint esta paginado
    // desde la Fase 3C, asi que sin `pageSize` llegarian veinticinco.
    apiRequest('/api/suppliers?activos=true&pageSize=100', { parse: parseProveedores })
      .then(setProveedores)
      // Sin proveedores la ficha sigue sirviendo: es un campo opcional.
      .catch(() => {
        setProveedores([])
      })
  }, [verProveedores])

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
    <PageContainer width="wide">
      {/* Arriba, lo unico que se hace siempre: buscar. Al lado, la accion
          principal. Lo demas (cambiar precios, importar) en "Más acciones". */}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Categoría" className="sm:w-56">
            <Select
              className="h-control-lg"
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
          {/* En el telefono, los dos botones lado a lado: apilados empujaban
              la lista media pantalla. */}
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <DropdownMenu
              trigger={
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                  Más acciones ▾
                </Button>
              }
            >
              {puedeCambiarPrecios && (
                <DropdownItem href="/productos/precios">Cambiar precios</DropdownItem>
              )}
              {(puedeCrear || puedeEditar) && (
                <DropdownItem href="/productos/importar">Importar desde Excel</DropdownItem>
              )}
              <DropdownItem
                onClick={() => {
                  aplicarFiltros({
                    ...filtros,
                    estado: filtros.estado === 'inactivos' ? 'activos' : 'inactivos',
                  })
                }}
              >
                {filtros.estado === 'inactivos' ? 'Ver productos activos' : 'Ver dados de baja'}
              </DropdownItem>
            </DropdownMenu>
            {puedeCrear && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  setEditando(null)
                  setDialogoAbierto(true)
                }}
              >
                + Nuevo producto
              </Button>
            )}
          </div>
        </div>
      </div>

      {filtros.estado === 'inactivos' && (
        <p className="text-base text-ink-muted">
          Mostrando solo los productos dados de baja.{' '}
          <button
            type="button"
            className="min-h-touch font-semibold text-primary underline underline-offset-2"
            onClick={() => {
              aplicarFiltros({ ...filtros, estado: 'activos' })
            }}
          >
            Ver activos
          </button>
        </p>
      )}

      {error ? (
        <ErrorState description={error} onRetry={() => void fetchProducts()} />
      ) : isLoading ? (
        <SkeletonRows rows={8} />
      ) : products.length === 0 ? (
        <EmptyState
          title={searchTerm ? 'Ningún producto coincide' : 'Todavía no hay productos'}
          description={
            searchTerm
              ? 'Probá con otra palabra o elegí «Todas» en categoría.'
              : 'Cargá el primero para empezar a vender.'
          }
          action={
            puedeCrear && !searchTerm ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  setEditando(null)
                  setDialogoAbierto(true)
                }}
              >
                + Nuevo producto
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <Table caption="Productos">
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
                    <TH secondary>Categoría</TH>
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
                    <TH align="right">Stock</TH>
                    <TH secondary>Código de barras</TH>
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
                        {!p.isActive && (
                          <Badge tone="warning" className="mt-1">
                            <span aria-hidden="true">⊘</span> Dado de baja
                          </Badge>
                        )}
                      </TD>
                      <TD secondary className="text-ink-muted">
                        {p.category.name}
                      </TD>
                      <TD align="right">
                        <Money amount={p.price} />
                      </TD>
                      <TD align="right">
                        <span className="flex flex-col items-end gap-1">
                          <span className="font-semibold" data-numeric="">
                            {formatQuantity(p.totalStock, p.saleUnit)}
                          </span>
                          <EstadoStockBadge estado={p.estado} />
                        </span>
                      </TD>
                      <TD secondary className="font-mono text-sm text-ink-muted">
                        {p.barcode ?? '—'}
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
                    <p className="text-base font-semibold text-ink">{p.name}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">{p.category.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span data-numeric="">Stock: {formatQuantity(p.totalStock, p.saleUnit)}</span>
                      <EstadoStockBadge estado={p.estado} />
                      {!p.isActive && (
                        <Badge tone="warning">
                          <span aria-hidden="true">⊘</span> Dado de baja
                        </Badge>
                      )}
                    </p>
                  </div>
                  <Money amount={p.price} size="lg" />
                </div>
                <div className="mt-3 flex justify-end">
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

      <DialogoProducto
        producto={editando}
        abierto={dialogoAbierto}
        categorias={categories}
        proveedores={proveedores}
        onCategoriaCreada={() => {
          void fetchCategories()
        }}
        onCerrar={() => {
          setDialogoAbierto(false)
        }}
        onGuardado={() => {
          setDialogoAbierto(false)
          aviso.ok(editando ? 'Producto guardado.' : 'Producto creado.')
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
        confirmLabel="Eliminar producto"
        message={
          <>
            Se va a eliminar <strong className="text-ink">{borrando?.name}</strong>. Si ya se vendió
            alguna vez, el sistema no lo va a permitir: en ese caso, abrilo con «Editar» y dalo de
            baja.
          </>
        }
      />
    </PageContainer>
  )
}

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

  // "Editar" a la vista, con palabra: es lo que se busca. Eliminar, que casi
  // nunca corresponde, queda en el menu.
  return (
    <span className="inline-flex items-center gap-1">
      {puedeEditar && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onEditar}
          aria-label={`Editar ${producto.name}`}
        >
          Editar
        </Button>
      )}
      {puedeBorrar && (
        <DropdownMenu
          trigger={
            <IconButton label={`Más opciones de ${producto.name}`} size="sm">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="19" r="1.6" />
              </svg>
            </IconButton>
          }
        >
          <DropdownItem tone="danger" onClick={onBorrar}>
            Eliminar
          </DropdownItem>
        </DropdownMenu>
      )}
    </span>
  )
}
