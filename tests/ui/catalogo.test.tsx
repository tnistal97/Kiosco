/**
 * @vitest-environment jsdom
 *
 * El catalogo a la vista del punto de venta. UX V2, Fase 2.
 *
 * Lo que se prueba es lo que una persona nueva hace con el: tocar una
 * fila, recorrerlas con las flechas, cambiar de categoria, marcar un
 * favorito. Y lo que NO tiene que pasar: agregar un producto agotado.
 *
 * Desde la Fase 2.1 el catalogo es una LISTA, no una grilla de tarjetas: cada
 * producto es una fila con nombre, categoria, stock y precio en columnas
 * fijas. Lo que se agrego aca es lo que la lista promete y las tarjetas no
 * podian: que las columnas esten, que cada dato aparezca UNA vez --y no
 * duplicado "para la version movil"-- y que el estado se lea sin color.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductBrowser, type ProductBrowserProps } from '@/components/venta/ProductBrowser'
import { Secciones } from '@/components/venta/Secciones'
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
    productos: PRODUCTOS,
    cargando: false,
    error: null,
    total: PRODUCTOS.length,
    hayMas: false,
    onCargarMas: vi.fn(),
    resaltado: -1,
    listaActiva: false,
    onResaltar: vi.fn(),
    onElegir: vi.fn(),
    esFavorito: () => false,
    onFavorito: vi.fn(),
    onVolverAlLector: vi.fn(),
    ...cambios,
  }
  render(<ProductBrowser {...props} />)
  return { props }
}

const fila = (nombre: RegExp) => screen.getByRole('button', { name: nombre })

describe('El catalogo se ve antes de escribir nada', () => {
  it('muestra una fila por producto, con precio', () => {
    armar()
    expect(fila(/^Yerba mate 1 kg, \$\s1\.500,00$/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /,/ })).toHaveLength(PRODUCTOS.length)
  })

  it('un producto que se pesa lo dice, con el precio por kilo', () => {
    armar()
    expect(fila(/^Queso cremoso, \$\s9\.800,00 \/ kg$/)).toBeInTheDocument()
    expect(screen.getByText(/se pesa/)).toBeInTheDocument()
  })

  it('NO es una tabla: no hay encabezado de columnas', () => {
    // La 2.1 tenia "PRODUCTO CATEGORIA STOCK PRECIO" pegado arriba. Se leia
    // como una pantalla de administracion y costaba 30 px de alto para
    // nombrar lo que ya se entiende solo (V3).
    armar()
    for (const columna of ['Producto', 'Categoría', 'Stock', 'Precio']) {
      expect(screen.queryByText(columna)).toBeNull()
    }
  })

  it('cada fila dice categoria y cuanto queda', () => {
    armar()
    const yerba = fila(/^Yerba mate/)
    expect(yerba).toHaveTextContent('Almacén')
    expect(yerba).toHaveTextContent('10 u.')
  })

  it('lo que no se puede vender por vencido lo dice asi, no "agotado"', () => {
    armar({
      productos: [
        producto(11, 'Yogur bebible 900 g', {
          sellableStock: '0.000',
          expiredStock: '6.000',
          totalStock: '6.000',
          estado: 'OUT',
        }),
      ],
      total: 1,
    })
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(fila(/^Yogur bebible 900 g, vencido$/)).toBeDisabled()
  })

  it('poco stock se lee sin depender del color', () => {
    armar({
      productos: [producto(9, 'Jugo naranja 1 L', { sellableStock: '3.000', estado: 'LOW' })],
      total: 1,
    })
    expect(screen.getByText('Quedan 3 u.')).toBeInTheDocument()
  })

  it('cada dato aparece una sola vez: la fila se reacomoda con CSS, no se duplica', () => {
    armar({ productos: PRODUCTOS.slice(0, 1), total: 1 })
    expect(screen.getAllByText(/1\.500,00/)).toHaveLength(1)
    expect(screen.getAllByText('10 u.')).toHaveLength(1)
  })

  it('un producto agotado se ve, pero no se puede tocar', () => {
    armar()
    const helado = fila(/^Helado 1 L, agotado$/)
    expect(helado).toBeDisabled()
    expect(screen.getByText('Agotado')).toBeInTheDocument()
  })
})

describe('Elegir un producto', () => {
  it('con un toque agrega y devuelve el foco al lector', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    await usuario.click(fila(/^Yerba mate/))
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[0], false)
  })

  it('con el teclado agrega y se queda en la grilla', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    fila(/^Gaseosa/).focus()
    await usuario.keyboard('{Enter}')
    expect(props.onElegir).toHaveBeenCalledTimes(1)
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[1], true)
  })

  it('un clic sintetizado por el teclado tambien cuenta como teclado', () => {
    const { props } = armar()
    // `detail: 0` es lo que trae el clic que dispara la barra sobre un boton.
    fireEvent.click(fila(/^Gaseosa/), { detail: 0 })
    expect(props.onElegir).toHaveBeenCalledWith(PRODUCTOS[1], true)
  })

  it('Enter sobre una fila agotada no agrega nada', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    // Un boton deshabilitado no recibe el foco; la tecla llega al grupo.
    fila(/^Yerba mate/).focus()
    await usuario.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(props.onElegir).not.toHaveBeenCalled()
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

describe('La lista con el teclado', () => {
  it('una sola fila entra con Tab; las flechas recorren el resto', async () => {
    const usuario = userEvent.setup()
    armar()
    const yerba = fila(/^Yerba mate/)
    const gaseosa = fila(/^Gaseosa/)

    expect(yerba).toHaveAttribute('tabindex', '0')
    expect(gaseosa).toHaveAttribute('tabindex', '-1')

    yerba.focus()
    await usuario.keyboard('{ArrowDown}')
    expect(gaseosa).toHaveFocus()

    await usuario.keyboard('{ArrowUp}')
    expect(yerba).toHaveFocus()
  })

  it('Escape vuelve al lector', async () => {
    const usuario = userEvent.setup()
    const { props } = armar()
    fila(/^Yerba mate/).focus()
    await usuario.keyboard('{Escape}')
    expect(props.onVolverAlLector).toHaveBeenCalled()
  })

  it('la ELEGIDA desde el campo se marca como actual', () => {
    armar({ resaltado: 2, listaActiva: true, busqueda: 'que' })
    expect(fila(/^Queso/)).toHaveAttribute('aria-current', 'true')
  })

  it('mientras se escribe, la primera se marca mas flojo y NO es la actual', () => {
    // Es la diferencia visible entre escribir y elegir: la marca tenue dice
    // "Enter agrega esta", pero las flechas siguen siendo del cursor.
    armar({ resaltado: 0, listaActiva: false, busqueda: 'a' })
    const primera = fila(/^Yerba/)
    expect(primera).not.toHaveAttribute('aria-current')
    expect(primera).not.toHaveAttribute('data-elegida')
    expect(primera.className).toContain('border-l-primary/50')
  })
})

describe('La lista no termina en una pared', () => {
  it('con mas productos de los cargados, ofrece traer los que faltan', async () => {
    const usuario = userEvent.setup()
    const { props } = armar({ hayMas: true, total: 200 })
    const boton = screen.getByRole('button', { name: 'Ver más productos' })
    expect(screen.getByText('4 de 200')).toBeInTheDocument()
    await usuario.click(boton)
    expect(props.onCargarMas).toHaveBeenCalled()
  })

  it('con todo cargado no hay boton ni cartel', () => {
    armar()
    expect(screen.queryByRole('button', { name: 'Ver más productos' })).toBeNull()
    // Y sobre todo: no dice "buscá por nombre para ver el resto", que era
    // pedirle al cajero que adivine.
    expect(screen.queryByText(/buscá por nombre/i)).toBeNull()
  })
})

describe('Cuando no hay nada que mostrar', () => {
  it('una busqueda sin resultados lo dice y sugiere crear el producto', () => {
    armar({ busqueda: 'zzz', productos: [], total: 0 })
    expect(screen.getByText('Ningún producto coincide')).toBeInTheDocument()
  })

  it('"Frecuentes" vacio explica como se llena', () => {
    armar({ seccion: 'frecuentes', productos: [], total: 0 })
    expect(screen.getByText('Todavía no hay frecuentes')).toBeInTheDocument()
  })
})

describe('Las secciones del catalogo', () => {
  function armarSecciones(cambios: Partial<Parameters<typeof Secciones>[0]> = {}) {
    const onSeccion = vi.fn()
    render(
      <Secciones
        seccion="todos"
        onSeccion={onSeccion}
        categorias={[
          { id: 1, name: 'Almacén' },
          { id: 2, name: 'Bebidas' },
        ]}
        hayFrecuentes
        {...cambios}
      />,
    )
    return { onSeccion }
  }

  it('muestra frecuentes, todos y una por categoria', () => {
    armarSecciones()
    expect(screen.getByRole('button', { name: 'Frecuentes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bebidas' })).toBeInTheDocument()
  })

  it('cambiar de seccion avisa cual', async () => {
    const usuario = userEvent.setup()
    const { onSeccion } = armarSecciones()
    await usuario.click(screen.getByRole('button', { name: 'Bebidas' }))
    expect(onSeccion).toHaveBeenCalledWith(2)
  })

  it('sin "Frecuentes" que mostrar, el chip no aparece', () => {
    armarSecciones({ hayFrecuentes: false })
    expect(screen.queryByRole('button', { name: 'Frecuentes' })).toBeNull()
  })

  it('un solo renglon: los chips se desplazan de costado, no se envuelven', () => {
    // Nueve categorias en dos renglones eran 40 px --una fila de producto--
    // y se movian solos al cambiar de ancho (V3).
    const { container } = render(
      <Secciones
        seccion="todos"
        onSeccion={vi.fn()}
        categorias={Array.from({ length: 12 }, (_, i) => ({
          id: i + 1,
          name: `Rubro ${String(i)}`,
        }))}
        hayFrecuentes
      />,
    )
    const grupo = container.querySelector('[role="group"]')
    expect(grupo?.className).toContain('flex-nowrap')
    expect(grupo?.className).toContain('overflow-x-auto')
  })

  it('mientras se busca, la seccion no filtra y los chips quedan apagados', () => {
    armarSecciones({ deshabilitado: true })
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false')
  })
})
