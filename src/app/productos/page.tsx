'use client'

import { useEffect, useState, useMemo } from 'react'

import toast from 'react-hot-toast'
import { useProducts, type CampoOrden, type Product } from '@/hooks/useProducts'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { STOCK_CRITICO } from '@/modules/products/schemas'

import ProductsHeader from '@/components/productos/ProductsHeader'
import ProductsMetrics from '@/components/productos/ProductsMetrics'
import ProductsFilters from '@/components/productos/ProductsFilters'
import ProductsTable from '@/components/productos/ProductosTable'
import ProductsPagination from '@/components/productos/ProductsPagination'
import ProductoModal from '@/components/productos/ProductoModal'

type SortKey = 'id' | 'name' | 'category' | 'stock' | 'price'
type SortDirection = 'asc' | 'desc'

/** Campos que el servidor sabe ordenar. Ver CAMPOS_ORDEN_PRODUCTO. */
const ORDEN_EN_SERVIDOR: Partial<Record<SortKey, CampoOrden>> = {
  id: 'id',
  name: 'name',
  price: 'price',
}

export default function ProductosPage() {
  // La busqueda, el filtrado, el orden y la paginacion los resuelve el
  // servidor. Antes se traia el catalogo entero y se hacia todo en memoria;
  // con el tope de pagina eso habria ocultado productos sin avisar.
  const {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    aplicarFiltros,
    page: currentPage,
    setPage: setCurrentPage,
    totalPages,
    total,
    fetchProducts,
  } = useProducts({ enServidor: true, pageSize: 20 })

  const [categoryFilter, setCategoryFilter] = useState<string>('Todas')
  const [lowStockFilter, setLowStockFilter] = useState<boolean>(false)

  const [sortConfig, setSortConfig] = useState<{
    key: SortKey
    direction: SortDirection
  }>({
    key: 'id',
    direction: 'asc',
  })

  // Modal crear/editar
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  // Los filtros que el servidor entiende se le mandan a el.
  useEffect(() => {
    const categoria = categories.find((c) => c.name === categoryFilter)
    aplicarFiltros({
      ...(categoryFilter !== 'Todas' && categoria ? { categoryId: categoria.id } : {}),
      ...(lowStockFilter ? { lowStock: true } : {}),
      ...(ORDEN_EN_SERVIDOR[sortConfig.key]
        ? { sortBy: ORDEN_EN_SERVIDOR[sortConfig.key], sortDir: sortConfig.direction }
        : {}),
    })
  }, [categoryFilter, lowStockFilter, sortConfig, categories, aplicarFiltros])

  // `categoria` y `stock` no son campos de la tabla Product, asi que el
  // servidor no los ordena. Se ordena la pagina recibida, que es lo unico
  // que se puede hacer sin agregar un join solo para esto.
  const paginated = useMemo(() => {
    const { key, direction } = sortConfig
    if (ORDEN_EN_SERVIDOR[key]) return products

    const copy = [...products]
    copy.sort((a, b) => {
      const cmp =
        key === 'category'
          ? a.category.name.localeCompare(b.category.name)
          : a.totalStock - b.totalStock
      return direction === 'asc' ? cmp : -cmp
    })
    return copy
  }, [products, sortConfig])

  // Métricas de la página visible. El total sí es del servidor.
  const totalProductos = total
  const totalUnidades = products.reduce((sum, p) => sum + p.totalStock, 0)
  const stockCriticoCount = products.filter((p) => p.totalStock < STOCK_CRITICO).length

  const handleSort = (key: SortKey) => {
    setCurrentPage(1)
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  const clearFilters = () => {
    setSearchTerm('')
    setCategoryFilter('Todas')
    setLowStockFilter(false)
    setCurrentPage(1)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Confirma que desea eliminar este producto?')) return
    try {
      // Antes esto era `await fetch(...)` sin mirar la respuesta: un 403 por
      // falta de permiso, o un 409 porque el producto figura en ventas,
      // terminaba igual mostrando "eliminado correctamente".
      await apiRequest(`/api/products/${id}`, { method: 'DELETE', parse: () => null })
      await fetchProducts()
      toast.success('✅ Producto eliminado correctamente.', {
        duration: 4000,
        style: {
          background: '#1f2937',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #374151',
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#22c55e',
          secondary: '#1f2937',
        },
      })
    } catch (err) {
      console.error('Error eliminando producto:', err)
      toast.error(mensajeDeError(err, 'No se pudo eliminar el producto.'), {
        duration: 5000,
        style: {
          background: '#991b1b',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d',
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#f87171',
          secondary: '#991b1b',
        },
      })
    }
  }

  const handleCreate = () => {
    setEditingProduct(null)
    setIsModalOpen(true)
  }

  const handleEdit = (p: Product) => {
    setEditingProduct(p)
    setIsModalOpen(true)
  }

  const onSaved = async () => {
    await fetchProducts()
    setIsModalOpen(false)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <ProductsHeader onCreate={handleCreate} />

        <ProductsMetrics
          totalProductos={totalProductos}
          totalUnidades={totalUnidades}
          stockCriticoCount={stockCriticoCount}
          lowStockFilter={lowStockFilter}
          setLowStockFilter={setLowStockFilter}
          clearFilters={clearFilters}
          categoryFilter={categoryFilter}
          searchTerm={searchTerm}
        />

        <ProductsFilters
          categories={categories}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          clearFilters={clearFilters}

          setLowStockFilter={setLowStockFilter}
        />

        <ProductsTable
          data={paginated}
          sortConfig={sortConfig}
          onSort={handleSort}
          onEdit={handleEdit}
          onDelete={(id) => void handleDelete(id)}
        />

        <ProductsPagination
          currentPage={currentPage}
          totalPages={totalPages}
          setCurrentPage={setCurrentPage}
        />
      </div>

      <ProductoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        categories={categories}
        product={editingProduct}
        onSaved={() => void onSaved()}
      />
    </div>
  )
}
