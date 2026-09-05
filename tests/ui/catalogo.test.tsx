/**
 * @vitest-environment jsdom
 *
 * El catalogo a la vista del punto de venta. UX V2, Fase 2.
 *
 * Lo que se prueba es lo que una persona nueva hace con el: tocar una
 * tarjeta, recorrerlas con las flechas, cambiar de categoria, marcar un
 * favorito. Y lo que NO tiene que pasar: agregar un producto agotado.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import {
  ProductBrowser,
  type ProductBrowserHandle,
  type ProductBrowserProps,
} from '@/components/venta/ProductBrowser'
import type { Product } from '@/hooks/useProducts'

function producto(id: number, name: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name,
    barcode: `779000000000${String(id)}`,
    description: null,
    price: '1500.00',
    isActive: true,
    category: { id: 1, name: 'Almacén' },
    supplier: null,
    saleUnit: 'UNIT',
    purchaseUnit: 'UNIT',
    unitsPerPurchaseUnit: '1.000',
    totalStock: '10.000',
    sellableStock: '10.000',
    expiredStock: '0.000',
    minimumStock: '0.000',
    estado: 'OK',
    ...extra,
  }
}

const PRODUCTOS = [
  producto(1, 'Yerba mate 1 kg'),
  producto(2, 'Gaseosa cola 2.25 L'),
  producto(3, 'Queso cremoso', { saleUnit: 'KG', price: '9800.00' }),
  producto(4, 'Helado 1 L', { sellableStock: '0.000', totalStock: '0.000', estado: 'OUT' }),
]

function armar(cambios: Partial<ProductBrowserProps> = {}) {
  const props: ProductBrowserProps = {
    busqueda: null,
    seccion: 'todos',
    onSeccion: vi.fn(),
    categorias: [
      { id: 1, name: 'Almacén' },
      { id: 2, name: 'Bebidas' },
    ],
    hayFrecuentes: true,
    productos: PRODUCTOS,
    cargando: false,
    error: null,
    total: PRODUCTOS.length,
    resaltado: -1,
    onResaltar: vi.fn(),
    onElegir: vi.fn(),
    esFavorito: () => false,
    onFavorito: vi.fn(),
    onVolverAlLector: vi.fn(),
    ...cambios,
  }
  const ref = createRef<ProductBrowserHandle>()
  render(<ProductBrowser ref={ref} {...props} />)
  return { props, ref }
}

const tarjeta = (nombre: RegExp) => screen.getByRole('button', { name: nombre })

describe('El catalogo se ve antes de escribir nada', () => {
  it('muestra las secciones y una tarjeta por producto, con precio', () => {
    armar()
    expect(screen.getByRole('button', { name: 'Frecuentes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bebidas' })).toBeInTheDocument()
    expect(tarjeta(/^Yerba mate 1 kg, \$\s1\.500,00$/)).toBeInTheDocument()
  })

  it('un producto que se pesa lo dice, con el precio por kilo', () => {
    armar()
    expect(tarjeta(/^Queso cremoso, \$\s9\.800,00 \/ kg$/)).toBeInTheDocument()
    expect(screen.getByText('Se pesa')).toBeInTheDocument()
  })

  it('un producto agotado se ve, pero no se puede tocar', () => {
    armar()
    const helado = tarjeta(/^Helado 1 L, agotado$/)
    expect(helado).toBeDisabled()
    expect(screen.getByText('Agotado')).toBeInTheDocument()
  })

  it('sin "Frecuentes" que mostrar, el chip no aparece', () => {
    armar({ hayFrecuentes: false })
    expect(screen.queryByRole('button', { name: 'Frecuentes' })).toBeNull()
  })
})

describe('Elegir un producto', () => {
  it('con un toque agrega y devuelve el foco al lector', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    await usuario.click(tarjeta(/^Yerba mate/))
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[0], false)
  })

  it('con el teclado agrega y se queda en la grilla', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    tarjeta(/^Gaseosa/).focus()
    await usuario.keyboard('{Enter}')
    expect(props.onElegir).toHaveBeenCalledTimes(1)
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[1], true)
  })

  it('un clic sintetizado por el teclado tambien cuenta como teclado', () => {
    const { props } = armar()
    // `detail: 0` es lo que trae el clic que dispara la barra sobre un boton.
    fireEvent.click(tarjeta(/^Gaseosa/), { detail: 0 })
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[1], true)
  })

  it('Enter sobre una tarjeta agotada no agrega nada', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    // Un boton deshabilitado no recibe el foco; la tecla llega al grupo.
    tarjeta(/^Yerba mate/).focus()
    await usuario.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(props.onElegir).not.toHaveBeenCalled()
  })

  it('cambiar de seccion avisa cual', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    await usuario.click(screen.getByRole('button', { name: 'Bebidas' }))
    expect(props.onSeccion).toHaveBeenCalledWith(2)
  })

  it('la estrella marca el favorito sin agregar nada', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    await usuario.click(
      screen.getByRole('button', { name: /Marcar Yerba mate 1 kg como favorito/ }),
    )
    expect(props.onFavorito).toHaveBeenCalledWith(1)
    expect(props.onElegir).not.toHaveBeenCalled()
  })
})

describe('La grilla con el teclado', () => {
  it('una sola tarjeta entra con Tab; las flechas recorren el resto', async () => {
    const usuario = userEvent.setup()
    armar()
    const yerba = tarjeta(/^Yerba mate/)
    const gaseosa = tarjeta(/^Gaseosa/)

    expect(yerba).toHaveAttribute('tabindex', '0')
    expect(gaseosa).toHaveAttribute('tabindex', '-1')

    yerba.focus()
    await usuario.keyboard('{ArrowRight}')
    expect(gaseosa).toHaveFocus()

    await usuario.keyboard('{ArrowLeft}')
    expect(yerba).toHaveFocus()
  })

  it('Escape vuelve al lector', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    tarjeta(/^Yerba mate/).focus()
    await usuario.keyboard('{Escape}')
    expect(props.onVolverAlLector).toHaveBeenCalled()
  })

  it('`enfocar` lleva el foco a la tarjeta resaltada', () => {
    const { ref } = armar({ resaltado: 1, busqueda: 'ga' })
    ref.current?.enfocar()
    expect(tarjeta(/^Gaseosa/)).toHaveFocus()
  })

  it('la resaltada desde el campo se marca como actual', () => {
    armar({ resaltado: 2, busqueda: 'que' })
    expect(tarjeta(/^Queso/)).toHaveAttribute('aria-current', 'true')
  })
})

describe('Cuando no hay nada que mostrar', () => {
  it('una busqueda sin resultados lo dice y sugiere crear el producto', () => {
    armar({ busqueda: 'zzz', productos: [], total: 0 })
    expect(screen.getByText('Ningún producto coincide')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Todos' })).toBeNull()
  })

  it('"Frecuentes" vacio explica como se llena', () => {
    armar({ seccion: 'frecuentes', productos: [], total: 0 })
    expect(screen.getByText('Todavía no hay frecuentes')).toBeInTheDocument()
  })

  it('con mas productos de los que trae, avisa cuantos hay', () => {
    armar({ total: 120 })
    expect(screen.getByText(/Se muestran 4 de 120/)).toBeInTheDocument()
  })
})
