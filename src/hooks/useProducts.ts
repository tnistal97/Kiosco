// src/hooks/useProducts.ts
import { useState, useEffect, useCallback } from 'react'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  parseCategorias,
  parseProductos,
  type CategoriaDTO,
  type ProductoDTO,
} from '@/modules/products/dto'

export type Product = ProductoDTO
export type Category = CategoriaDTO

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProducts = useCallback(async () => {
    setIsLoading(true)
    try {
      setProducts(await apiRequest('/api/products', { parse: parseProductos }))
      setError(null)
    } catch (err) {
      console.error(err)
      setError(mensajeDeError(err, 'Error al cargar productos'))
    } finally {
      setIsLoading(false)
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
    void fetchProducts()
    void fetchCategories()
  }, [fetchProducts, fetchCategories])

  return {
    products,
    categories,
    searchTerm,
    setSearchTerm,
    fetchProducts,
    isLoading,
    error,
  }
}
