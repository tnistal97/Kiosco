// src/hooks/useProducts.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseCategorias,
  parsePaginaProductos,
  type CategoriaDTO,
  type ProductoDTO,
} from '@/modules/products/dto'

export type Product = ProductoDTO
export type Category = CategoriaDTO

/** Tope por peticion. Coincide con PAGE_SIZE_MAX del servidor. */
const PAGE_SIZE_MAX = 100

/** Espera antes de consultar al servidor mientras el usuario escribe. */
const DEBOUNCE_MS = 250

export type CampoOrden = 'name' | 'price' | 'id'

/**
 * Trae varios productos por identificador, en una sola peticion.
 *
 * La usa la caja al restaurar el ticket guardado: de lo que quedo en el
 * navegador solo salen identificadores y cantidades, y el precio y el stock
 * se vuelven a preguntar aca. Un ticket de quince lineas es una peticion, no
 * quince.
 *
 * Solo devuelve productos activos: uno dado de baja no vuelve al ticket.
 */
export async function buscarProductosPorIds(ids: number[]): Promise<Product[]> {
  const limpios = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100)
  if (limpios.length === 0) return []

  const params = new URLSearchParams({
    ids: limpios.join(','),
    estado: 'activos',
    pageSize: String(Math.min(limpios.length, PAGE_SIZE_MAX)),
  })
  const pagina = await apiRequest(`/api/products?${params.toString()}`, {
    parse: parsePaginaProductos,
  })
  return pagina.data
}

export interface UseProductsOptions {
  /**
   * La busqueda y la paginacion las resuelve el servidor.
   *
   * La caja y la pantalla de productos lo usan. Con el catalogo completo en
   * el navegador, cada apertura de pantalla lo descargaba entero, y eso crece
   * sin limite; peor todavia, con un tope de pagina en el servidor los
   * productos que no entraran desaparecian de la pantalla sin aviso.
   */
  enServidor?: boolean
  /** Cuantos por pagina. Se recorta al maximo que acepta el servidor. */
  pageSize?: number
}

export interface FiltrosProductos {
  categoryId?: number
  lowStock?: boolean
  sinStock?: boolean
  /** 'activos' | 'inactivos' | 'todos'. La caja usa siempre 'activos'. */
  estado?: 'activos' | 'inactivos' | 'todos'
  sortBy?: CampoOrden
  sortDir?: 'asc' | 'desc'
}

export function useProducts(options: UseProductsOptions = {}) {
  const { enServidor = false, pageSize = PAGE_SIZE_MAX } = options
  const tamanoPagina = Math.min(pageSize, PAGE_SIZE_MAX)

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const [filtros, setFiltros] = useState<FiltrosProductos>({})
  const [total, setTotal] = useState<number>(0)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  /** Aborta la consulta anterior si el usuario sigue escribiendo. */
  const enCurso = useRef<AbortController | null>(null)

  const consultar = useCallback(
    async (termino: string, pagina: number, f: FiltrosProductos) => {
      setIsLoading(true)
      enCurso.current?.abort()
      const control = new AbortController()
      enCurso.current = control

      try {
        const params = new URLSearchParams({
          pageSize: String(tamanoPagina),
          page: String(pagina),
        })
        const q = termino.trim()
        if (enServidor && q) params.set('q', q)
        if (f.categoryId !== undefined) params.set('categoryId', String(f.categoryId))
        if (f.lowStock) params.set('lowStock', 'true')
        if (f.sinStock) params.set('sinStock', 'true')
        if (f.estado) params.set('estado', f.estado)
        if (f.sortBy) params.set('sortBy', f.sortBy)
        if (f.sortDir) params.set('sortDir', f.sortDir)

        const resultado = await apiRequest(`/api/products?${params.toString()}`, {
          parse: parsePaginaProductos,
          signal: control.signal,
        })

        setProducts(resultado.data)
        setTotal(resultado.total)
        setTotalPages(resultado.totalPages)
        setError(null)
      } catch (err) {
        // Una consulta cancelada no es un fallo: la reemplazo otra mas nueva.
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error(err)
        setError(mensajeDeError(err, 'Error al cargar productos'))
      } finally {
        if (enCurso.current === control) setIsLoading(false)
      }
    },
    [enServidor, tamanoPagina],
  )

  /** Recarga la vista actual. Para usar despues de crear o borrar. */
  const fetchProducts = useCallback(
    () => consultar(searchTerm, page, filtros),
    [consultar, searchTerm, page, filtros],
  )

  /**
   * Busca un producto por codigo de barras exacto, contra el servidor.
   *
   * Existe aparte de la busqueda por texto porque el lector no puede depender
   * de que el producto ya este en la lista cargada. Antes se buscaba en el
   * array local, lo cual funcionaba solo porque el navegador tenia el
   * catalogo entero; con la busqueda paginada, escanear un producto que no
   * estuviera en la pagina actual habria abierto el alta de producto nuevo
   * sobre uno que ya existe.
   */
  const buscarPorCodigo = useCallback(
    async (codigo: string, opciones: { soloActivos?: boolean } = {}): Promise<Product | null> => {
      const q = codigo.trim()
      if (!q) return null
      const params = new URLSearchParams({ q, pageSize: '20' })
      if (opciones.soloActivos === false) params.set('estado', 'todos')
      const pagina = await apiRequest(`/api/products?${params.toString()}`, {
        parse: parsePaginaProductos,
      })
      // El servidor busca por coincidencia parcial; aca se exige exacta.
      return pagina.data.find((p) => p.barcode?.toLowerCase() === q.toLowerCase()) ?? null
    },
    [],
  )

  const fetchCategories = useCallback(async () => {
    try {
      setCategories(await apiRequest('/api/categories', { parse: parseCategorias }))
    } catch (err) {
      // Sin categorias la pantalla sigue siendo utilizable: no se corta la
      // carga de productos por esto.
      console.error(err)
      setCategories([])
    }
  }, [])

  useEffect(() => {
    void fetchCategories()
  }, [fetchCategories])

  // Carga inicial y recarga al cambiar busqueda, pagina o filtros.
  useEffect(() => {
    if (!enServidor) {
      void consultar('', 1, {})
      return
    }
    const t = setTimeout(() => void consultar(searchTerm, page, filtros), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [enServidor, searchTerm, page, filtros, consultar])

  /** Cambiar la busqueda o un filtro vuelve a la primera pagina. */
  const buscar = useCallback((termino: string) => {
    setSearchTerm(termino)
    setPage(1)
  }, [])

  const aplicarFiltros = useCallback((f: FiltrosProductos) => {
    setFiltros(f)
    setPage(1)
  }, [])

  return {
    products,
    categories,
    searchTerm,
    setSearchTerm: buscar,
    filtros,
    aplicarFiltros,
    page,
    setPage,
    totalPages,
    total,
    fetchProducts,
    buscarPorCodigo,
    isLoading,
    error,
  }
}
