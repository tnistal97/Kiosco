'use client'

import { useEffect, useState, useMemo } from 'react'

import toast from 'react-hot-toast'
import {
  useProducts,
  Product,
  Category,
} from '@/hooks/useProducts'

import ProductsHeader from '@/components/productos/ProductsHeader'
import ProductsMetrics from '@/components/productos/ProductsMetrics'
import ProductsFilters from '@/components/productos/ProductsFilters'
import ProductsTable from '@/components/productos/ProductosTable'
import ProductsPagination from '@/components/productos/ProductsPagination'
import ProductoModal from '@/components/productos/ProductoModal'

type SortKey = 'id' | 'name' | 'category' | 'stock' | 'price'
type SortDirection = 'asc' | 'desc'

export default function ProductosPage() {
  const {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    fetchProducts,
  } = useProducts()

  const [categoryFilter, setCategoryFilter] = useState<string>('Todas')
  const [lowStockFilter, setLowStockFilter] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const itemsPerPage = 20

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

  // 1️⃣ Filtrar (búsqueda + categoría + stock crítico)
  const filtered = useMemo(() => {
    let arr = products.filter((p) => {
      const term = searchTerm.trim().toLowerCase()
      const matchesSearch =
        p.name.toLowerCase().includes(term) ||
        (p.barcode ?? '').toLowerCase().includes(term)
      const matchesCategory =
        categoryFilter === 'Todas' || p.category?.name === categoryFilter
      return matchesSearch && matchesCategory
    })

    if (lowStockFilter) {
      arr = arr.filter((p) => p.totalStock < 10)
    }

    return arr
  }, [products, searchTerm, categoryFilter, lowStockFilter])

  // 2️⃣ Ordenar
  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const { key, direction } = sortConfig
      let cmp = 0
      switch (key) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'category':
          cmp = (a.category?.name ?? '').localeCompare(b.category?.name ?? '')
          break
        case 'stock':
          cmp = a.totalStock - b.totalStock
          break
        case 'price':
          cmp = a.price - b.price
          break
      }
      return direction === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortConfig])

  // 3️⃣ Paginación
  const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage))
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sorted.slice(start, start + itemsPerPage)
  }, [sorted, currentPage])

  // 4️⃣ Métricas
  const totalProductos = filtered.length
  const totalUnidades = filtered.reduce((sum, p) => sum + p.totalStock, 0)
  const stockCriticoCount = filtered.filter((p) => p.totalStock < 10).length

  // 5️⃣ Handlers
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

  const exportCSV = () => {
    alert('Función de exportar CSV no implementada.')
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Confirma que desea eliminar este producto?')) return
    try {
      await fetch(`/api/products/${id}`, { method: 'DELETE' })
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
      toast.error('No se pudo eliminar el producto.', {
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
          exportCSV={exportCSV}
          setLowStockFilter={setLowStockFilter}
        />

        <ProductsTable
          data={paginated}
          sortConfig={sortConfig}
          onSort={handleSort}
          onEdit={handleEdit}
          onDelete={handleDelete}
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
        onSaved={onSaved}
      />
    </div>
  )
}
