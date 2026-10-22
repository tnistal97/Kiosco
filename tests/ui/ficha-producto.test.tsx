/**
 * @vitest-environment jsdom
 *
 * La ficha del producto no pierde datos. UX V5.
 *
 * Tres maneras de perder algo sin darse cuenta, las tres encontradas en la
 * revision final:
 *
 *   - editar un producto lo pasaba a la PRIMERA categoria de la lista;
 *   - crear una categoria desde la ficha borraba lo que ya se habia escrito;
 *   - guardar antes de que llegaran los codigos alternativos los borraba.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/productos',
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}))
import { DialogoProducto } from '@/components/productos/DialogoProducto'
import { CampoCodigoDeBarras } from '@/components/productos/CampoCodigoDeBarras'
import type { CategoriaDTO, ProductoDTO } from '@/modules/products/dto'
import { renderConSesion, SESION_ADMIN } from './helpers'

const CATEGORIAS: CategoriaDTO[] = [
  { id: 1, name: 'Almacen' },
  { id: 2, name: 'Bebidas' },
]

const GASEOSA: ProductoDTO = {
  id: 7,
  name: 'Gaseosa cola 2.25 L',
  barcode: '7790002000014',
  description: null,
  price: '3450.00',
  isActive: true,
  category: { id: 2, name: 'Bebidas' },
  supplier: null,
  saleUnit: 'UNIT',
  purchaseUnit: 'UNIT',
  unitsPerPurchaseUnit: '1.000',
  totalStock: '30.000',
  sellableStock: '30.000',
  expiredStock: '0.000',
  minimumStock: '6.000',
  estado: 'OK',
  imageUrl: null,
}

type Pedido = { metodo: string; ruta: string; cuerpo: unknown }

/**
 * Un servidor de mentira: responde por metodo y ruta, y anota lo que llega.
 * Lo que no conoce contesta 404 con el formato de error de la API.
 */
function servidor(rutas: Record<string, (cuerpo: unknown) => unknown>) {
  const pedidos: Pedido[] = []
  globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET'
    const direccion = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    const ruta = direccion.split('?')[0] ?? ''
    const cuerpo: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    pedidos.push({ metodo, ruta, cuerpo })
    const responder = rutas[`${metodo} ${ruta}`]
    if (responder === undefined) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no', requestId: 'r' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    const salida = responder(cuerpo)
    if (salida instanceof Promise) return salida as Promise<Response>
    return Promise.resolve(
      new Response(JSON.stringify(salida), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return pedidos
}

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

describe('La ficha del producto no pierde datos', () => {
  it('editar un producto deja su categoria, no la primera de la lista', async () => {
    servidor({ 'GET /api/products/7': () => ({ ...GASEOSA, alternateBarcodes: [] }) })
    renderConSesion(
      <DialogoProducto
        producto={GASEOSA}
        abierto
        categorias={CATEGORIAS}
        proveedores={[]}
        onCerrar={() => undefined}
        onGuardado={() => undefined}
      />,
      SESION_ADMIN,
    )
    await screen.findByRole('dialog')

    expect(screen.getByLabelText(/^categoría/i)).toHaveValue('2')
  })

  it('guardar antes de leer los codigos alternativos no los manda (y no los borra)', async () => {
    const usuario = userEvent.setup()
    const pedidos = servidor({
      // Los alternativos no llegan nunca: la red esta lenta.
      'GET /api/products/7': () => new Promise<Response>(() => undefined),
      'PUT /api/products/7': () => ({ ...GASEOSA }),
    })
    const onGuardado = vi.fn()
    renderConSesion(
      <DialogoProducto
        producto={GASEOSA}
        abierto
        categorias={CATEGORIAS}
        proveedores={[]}
        onCerrar={() => undefined}
        onGuardado={onGuardado}
      />,
      SESION_ADMIN,
    )
    await screen.findByRole('dialog')

    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(onGuardado).toHaveBeenCalled()
    })

    const put = pedidos.find((p) => p.metodo === 'PUT')
    expect(put?.cuerpo).toMatchObject({ name: GASEOSA.name, categoryId: 2 })
    expect(put?.cuerpo).not.toHaveProperty('alternateBarcodes')
  })

  it('crear una categoria desde la ficha no borra lo escrito y la deja elegida', async () => {
    const usuario = userEvent.setup()
    servidor({ 'POST /api/categories': () => ({ id: 3, name: 'Pastas' }) })

    function ConLista() {
      const [categorias, setCategorias] = useState(CATEGORIAS)
      return (
        <DialogoProducto
          producto={null}
          abierto
          categorias={categorias}
          proveedores={[]}
          onCerrar={() => undefined}
          onGuardado={() => undefined}
          onCategoriaCreada={() => {
            // Como la pantalla de productos: vuelve a pedir la lista.
            setCategorias([...CATEGORIAS, { id: 3, name: 'Pastas' }])
          }}
        />
      )
    }
    renderConSesion(<ConLista />, SESION_ADMIN)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/^nombre\s*\*?$/i), 'Fideos tirabuzón 500 g')
    await usuario.type(screen.getByLabelText(/^precio/i), '1200')
    expect(screen.getByLabelText(/^categoría/i)).toHaveValue('1')

    await usuario.click(screen.getByRole('button', { name: '+ Nueva' }))
    await usuario.type(screen.getByLabelText(/categoría nueva/i), 'Pastas')
    await usuario.click(screen.getByRole('button', { name: 'Crear' }))

    await waitFor(() => {
      expect(screen.getByLabelText(/^categoría/i)).toHaveValue('3')
    })
    expect(screen.getByLabelText(/^nombre\s*\*?$/i)).toHaveValue('Fideos tirabuzón 500 g')
    expect(screen.getByLabelText(/^precio/i)).toHaveValue('1.200,00')
  })

  it('un lector sin Enter: el codigo se confirma entero, no cortado', async () => {
    const lector = userEvent.setup({ delay: null })
    const pedidos = servidor({})

    function Campo() {
      const [codigo, setCodigo] = useState('')
      return <CampoCodigoDeBarras value={codigo} onChange={setCodigo} />
    }
    renderConSesion(<Campo />, SESION_ADMIN)

    await lector.type(screen.getByLabelText(/código de barras/i), '7790001000019')

    expect(await screen.findByText(/código detectado/i)).toBeInTheDocument()
    const consultas = pedidos.filter((p) => p.ruta.startsWith('/api/products/barcode/'))
    // Una sola consulta, con el codigo completo.
    expect(consultas.map((p) => p.ruta)).toEqual(['/api/products/barcode/7790001000019'])
  })
})
