// src/hooks/useProducts.ts
import { useState, useEffect } from 'react'
import { Product as ProductType, Category as CategoryType } from '@/types'

export type Product = ProductType
export type Category = CategoryType

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Recarga lista de productos
  const fetchProducts = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/products')
      if (!res.ok) throw new Error('Error al cargar productos')
      const data = await res.json()
      setProducts(data)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Error desconocido')
    } finally {
      setIsLoading(false)
    }
  }

  // Carga categorías
  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories')
      if (!res.ok) throw new Error('Error al cargar categorías')
      const data = await res.json()
      setCategories(data)
    } catch (err: any) {
      console.error(err)
      setCategories([])
    }
  }

  useEffect(() => {
    fetchProducts()
    fetchCategories()
  }, [])

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
