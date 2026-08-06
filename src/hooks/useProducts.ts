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
const PAGE_SIZE = 100

/** Espera antes de consultar al servidor mientras el usuario escribe. */
const DEBOUNCE_MS = 250

export interface UseProductsOptions {
  /**
   * Si es true, la busqueda la resuelve el servidor.
   *
   * La caja lo usa: con el catalogo completo en el navegador, cada apertura
   * de pantalla descargaba todos los productos, y eso crece sin limite. Con
   * la busqueda en el servidor se traen como mucho una pagina.
   *
   * Las pantallas administrativas lo dejan en false y filtran en memoria
   * sobre la pagina que ya tienen.
   */
  buscarEnServidor?: boolean
}

export function useProducts(options: UseProductsOptions = {}) {
  const { buscarEnServidor = false } = options

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [total, setTotal] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  /** Aborta la consulta anterior si el usuario sigue escribiendo. */
  const enCurso = useRef<AbortController | null>(null)

  const fetchProducts = useCallback(
    async (termino?: string) => {
      setIsLoading(true)
      enCurso.current?.abort()
      const control = new AbortController()
      enCurso.current = control

      try {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) })
        const q = (termino ?? '').trim()
        if (buscarEnServidor && q) params.set('q', q)

        const pagina = await apiRequest(`/api/products?${params.toString()}`, {
          parse: parsePaginaProductos,
          signal: control.signal,
        })

        setProducts(pagina.data)
        setTotal(pagina.total)
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
    [buscarEnServidor],
  )

  /**
   * Busca un producto por codigo de barras exacto, contra el servidor.
   *
   * Existe aparte de la busqueda por texto porque el lector no puede depender
   * de que el producto ya este en la lista cargada. Antes se buscaba en el
   * array local, lo cual funcionaba solo porque el navegador tenia el
   * catalogo entero; con la busqueda en el servidor, escanear un producto que
   * no estuviera en la pagina actual habria abierto el alta de producto nuevo
   * sobre uno que ya existe.
   */
  const buscarPorCodigo = useCallback(async (codigo: string): Promise<Product | null> => {
    const q = codigo.trim()
    if (!q) return null
    try {
      const params = new URLSearchParams({ q, pageSize: '20' })
      const pagina = await apiRequest(`/api/products?${params.toString()}`, {
        parse: parsePaginaProductos,
      })
      // El servidor busca por coincidencia parcial; aca se exige exacta.
      return pagina.data.find((p) => p.barcode?.toLowerCase() === q.toLowerCase()) ?? null
    } catch (err) {
      console.error(err)
      return null
    }
  }, [])

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

  // Carga inicial y, si la busqueda es del servidor, recarga al escribir.
  useEffect(() => {
    if (!buscarEnServidor) {
      void fetchProducts()
      return
    }

    const t = setTimeout(() => void fetchProducts(searchTerm), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [buscarEnServidor, searchTerm, fetchProducts])

  return {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    fetchProducts,
    buscarPorCodigo,
    total,
    /** true si el servidor tiene mas resultados de los que se trajeron. */
    hayMas: total > products.length,
    isLoading,
    error,
  }
}
