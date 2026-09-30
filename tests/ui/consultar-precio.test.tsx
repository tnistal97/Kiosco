/**
 * @vitest-environment jsdom
 *
 * Consultar precio. V1 comercial.
 *
 * Una pregunta, una respuesta grande. Se prueba con el lector (un codigo y
 * Enter), con el nombre, el "no esta cargado" con y sin permiso de carga, y
 * que Esc limpia.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  usePathname: () => '/consultar-precio',
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}))

import { ConsultarPrecio, esCodigo } from '@/components/precio/ConsultarPrecio'
import { renderConSesion, SESION_ADMIN, SESION_CAJERO } from './helpers'

const COCA = {
  id: 12,
  name: 'Coca Cola 2,25 L',
  barcode: '7790895000997',
  description: null,
  price: '3400.00',
  isActive: true,
  category: { id: 1, name: 'Bebidas' },
  supplier: null,
  saleUnit: 'UNIT',
  purchaseUnit: 'UNIT',
  unitsPerPurchaseUnit: '1.000',
  totalStock: '14.000',
  sellableStock: '14.000',
  expiredStock: '0.000',
  minimumStock: '0.000',
}

const QUESO = {
  ...COCA,
  id: 13,
  name: 'Queso cremoso',
  barcode: null,
  price: '8000.00',
  saleUnit: 'KG',
  sellableStock: '3.250',
  totalStock: '3.250',
}

function respuesta(url: string): { status: number; body: unknown } {
  if (url.includes('/api/products/barcode/7790895000997')) return { status: 200, body: COCA }
  if (url.includes('/api/products/barcode/')) {
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'No hay ningun producto con ese codigo' } },
    }
  }
  if (url.includes('/api/products?')) {
    const q = new URL(url, 'http://x').searchParams.get('q') ?? ''
    const data = [COCA, QUESO].filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    return {
      status: 200,
      body: { data, pagination: { page: 1, totalPages: 1, total: data.length } },
    }
  }
  if (url.includes('/api/categories')) return { status: 200, body: [{ id: 1, name: 'Bebidas' }] }
  return { status: 200, body: {} }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: RequestInfo | URL) => {
      const url =
        typeof entrada === 'string'
          ? entrada
          : entrada instanceof URL
            ? entrada.toString()
            : entrada.url
      const r = respuesta(url)
      return Promise.resolve(
        new Response(JSON.stringify(r.body), {
          status: r.status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Que es un codigo', () => {
  it('solo digitos, cuatro o mas', () => {
    expect(esCodigo('7790895000997')).toBe(true)
    expect(esCodigo('1234')).toBe(true)
    expect(esCodigo('123')).toBe(false)
    expect(esCodigo('coca')).toBe(false)
    expect(esCodigo('coca 2')).toBe(false)
  })
})

describe('Consultar precio', () => {
  it('con el lector: el codigo y Enter muestran el precio en grande y el stock', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ConsultarPrecio />, SESION_CAJERO)

    const campo = screen.getByRole('textbox', { name: 'Escaneá o escribí un producto' })
    expect(campo).toHaveFocus()
    await usuario.type(campo, '7790895000997{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Coca Cola 2,25 L')).toBeInTheDocument()
    })
    expect(screen.getByText('$ 3.400,00')).toBeInTheDocument()
    expect(screen.getByText(/Stock:/)).toHaveTextContent('14 u.')
  })

  it('por nombre: se ofrecen coincidencias y Enter toma la primera', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ConsultarPrecio />, SESION_CAJERO)

    await usuario.type(screen.getByRole('textbox'), 'ques')
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Coincidencias' })).toBeInTheDocument()
    })
    await usuario.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('$ 8.000,00')).toBeInTheDocument()
    })
    // Por kilo: el precio dice por que.
    expect(screen.getByText('/ kg')).toBeInTheDocument()
    expect(screen.getByText(/Stock:/)).toHaveTextContent('3,250 kg')
  })

  it('un codigo desconocido dice "No está cargado" y, con permiso, ofrece cargarlo', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ConsultarPrecio />, SESION_ADMIN)

    await usuario.type(screen.getByRole('textbox'), '99999999{Enter}')
    await waitFor(() => {
      expect(screen.getByText('No está cargado')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Cargar producto' })).toBeInTheDocument()
  })

  it('sin permiso de carga, solo lo dice', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ConsultarPrecio />, {
      ...SESION_CAJERO,
      permissions: SESION_CAJERO.permissions.filter((p) => p !== 'products.quickCreate'),
    })

    await usuario.type(screen.getByRole('textbox'), '99999999{Enter}')
    await waitFor(() => {
      expect(screen.getByText('No está cargado')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Cargar producto' })).toBeNull()
  })

  it('Esc limpia todo y vuelve al campo', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ConsultarPrecio />, SESION_CAJERO)

    const campo = screen.getByRole('textbox')
    await usuario.type(campo, '7790895000997{Enter}')
    await waitFor(() => {
      expect(screen.getByText('Coca Cola 2,25 L')).toBeInTheDocument()
    })

    await usuario.keyboard('{Escape}')
    expect(screen.queryByText('Coca Cola 2,25 L')).toBeNull()
    expect(campo).toHaveValue('')
    expect(campo).toHaveFocus()
  })
})
