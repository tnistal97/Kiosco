/**
 * @vitest-environment jsdom
 *
 * Productos → Cambiar precios, del lado de la pantalla (P0-B).
 *
 * El servidor decide y recalcula --eso lo prueba
 * `tests/integration/precios-masivos.test.ts`--. Aca: que no se pueda pedir la
 * vista previa con un valor invalido, que nada se aplique sin vista previa ni
 * confirmacion, que lo destildado viaje, y que deshacer pida confirmacion y
 * diga que no toco.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CambioMasivoDePrecios } from '@/components/productos/CambioMasivoDePrecios'
import type { VistaDePrecios } from '@/modules/products/precios-dto'
import { renderConSesion, SESION_ADMIN } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

const VISTA: VistaDePrecios = {
  descripcion: 'Aumento del 10 %, que termine en 90',
  huella: 'b'.repeat(64),
  resumen: {
    productos: 3,
    cambian: 2,
    iguales: 0,
    noAplican: 1,
    minimo: '1190.00',
    maximo: '1390.00',
    variacion: '17.50',
  },
  items: [
    {
      id: 1,
      nombre: 'Agua 1,5 L',
      codigo: '7790000000011',
      categoria: 'Bebidas',
      activo: true,
      antes: '1000.00',
      despues: '1190.00',
      costo: '1200.0000',
      estado: 'cambia',
      motivo: null,
      bajoCosto: true,
    },
    {
      id: 2,
      nombre: 'Soda 2 L',
      codigo: null,
      categoria: 'Bebidas',
      activo: true,
      antes: '1234.00',
      despues: '1390.00',
      costo: null,
      estado: 'cambia',
      motivo: null,
      bajoCosto: false,
    },
    {
      id: 3,
      nombre: 'Jugo 1 L',
      codigo: null,
      categoria: 'Bebidas',
      activo: true,
      antes: '999.99',
      despues: null,
      costo: null,
      estado: 'no-aplica',
      motivo: 'No tiene costo cargado.',
      bajoCosto: false,
    },
  ],
}

type Respuestas = Record<string, unknown>

function responder(respuestas: Respuestas) {
  peticion.mockImplementation((ruta: string) => {
    const clave = Object.keys(respuestas).find((r) => ruta.startsWith(r))
    return Promise.resolve(clave === undefined ? null : respuestas[clave])
  })
}

function llamadasA(ruta: string): Array<{ body?: Record<string, unknown> }> {
  return peticion.mock.calls
    .filter((c) => c[0] === ruta)
    .map((c) => c[1] as { body?: Record<string, unknown> })
}

const BASE: Respuestas = {
  '/api/categories': [{ id: 9, name: 'Bebidas' }],
  // Ya parseado, como lo devolveria apiRequest: la pagina de proveedores.
  '/api/suppliers': { data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } },
  '/api/products/prices/last': null,
}

beforeEach(() => {
  peticion.mockReset()
})

async function montar(respuestas: Respuestas = {}) {
  responder({ ...BASE, ...respuestas })
  const u = userEvent.setup()
  renderConSesion(<CambioMasivoDePrecios />, SESION_ADMIN)
  await screen.findByRole('option', { name: 'Bebidas' })
  return u
}

describe('Cambiar precios', () => {
  it('con un valor invalido no se puede pedir la vista previa, y dice por que', async () => {
    const u = await montar()
    await u.type(screen.getByLabelText('Porcentaje (%)'), '10,555')
    expect(screen.getByRole('button', { name: 'Ver cómo quedan' })).toBeDisabled()
    expect(screen.getByText(/dos decimales/)).toBeInTheDocument()

    await u.clear(screen.getByLabelText('Porcentaje (%)'))
    await u.type(screen.getByLabelText('Porcentaje (%)'), '1500')
    expect(screen.getByText(/no puede pasar del 1000 %/)).toBeInTheDocument()
  })

  it('un precio fijo no se redondea', async () => {
    const u = await montar()
    await u.selectOptions(screen.getByLabelText('Cambio'), 'fijar')
    expect(screen.getByLabelText('Redondeo')).toBeDisabled()
    expect(screen.getByLabelText('Monto ($)')).toBeInTheDocument()
  })

  it('vista previa, destildar uno, confirmar: viaja la huella y lo destildado', async () => {
    const u = await montar({
      '/api/products/prices/preview': VISTA,
      '/api/products/prices': { operacion: 'x', cambiados: 1, descripcion: VISTA.descripcion },
    })
    await u.selectOptions(screen.getByLabelText('Categoría'), '9')
    await u.type(screen.getByLabelText('Porcentaje (%)'), '10')
    await u.selectOptions(screen.getByLabelText('Redondeo'), 'termina-90')
    await u.click(screen.getByRole('button', { name: 'Ver cómo quedan' }))

    expect(await screen.findByText('3. Así quedan')).toBeInTheDocument()
    expect(llamadasA('/api/products/prices/preview')[0]?.body).toEqual({
      seleccion: { categoriaId: 9, incluirInactivos: false },
      criterio: { operacion: 'aumentar', valor: '10.00', redondeo: 'termina-90' },
    })
    expect(screen.getByText('Queda por debajo del costo')).toBeInTheDocument()
    expect(screen.getByText(/1 no se pueden cambiar/)).toBeInTheDocument()

    await u.click(screen.getByRole('checkbox', { name: /Agua 1,5 L/ }))
    await u.click(screen.getByRole('button', { name: 'Aplicar a 1 productos' }))

    const dialogo = await screen.findByRole('dialog')
    await u.click(within(dialogo).getByRole('button', { name: 'Sí, cambiar' }))

    await waitFor(() => {
      expect(llamadasA('/api/products/prices')).toHaveLength(1)
    })
    expect(llamadasA('/api/products/prices')[0]?.body).toMatchObject({
      huella: VISTA.huella,
      excluidos: [1],
    })
    expect(await screen.findByText(/se cambió el precio de 1 productos/)).toBeInTheDocument()
  })

  it('cambiar el criterio despues de la vista previa la descarta', async () => {
    const u = await montar({ '/api/products/prices/preview': VISTA })
    await u.type(screen.getByLabelText('Porcentaje (%)'), '10')
    await u.click(screen.getByRole('button', { name: 'Ver cómo quedan' }))
    await screen.findByText('3. Así quedan')

    await u.type(screen.getByLabelText('Porcentaje (%)'), '5')
    expect(screen.queryByText('3. Así quedan')).not.toBeInTheDocument()
  })

  it('deshacer el ultimo pide confirmacion y dice que no toco', async () => {
    const u = await montar({
      '/api/products/prices/last': {
        operacion: '0b4f7a0e-6a3b-4a58-9d0c-2f0b6f1c9a11',
        fecha: '2026-09-27T13:31:00.000Z',
        usuario: 'Ana Duarte',
        descripcion: 'Aumento del 10 %',
        productos: 3,
        deshacible: true,
      },
      '/api/products/prices/undo': {
        restaurados: 2,
        saltados: [{ nombre: 'Soda 2 L', motivo: 'Lo cambiaron después: hoy está a $ 1.500,00.' }],
        totalSaltados: 1,
      },
    })
    await u.click(await screen.findByRole('button', { name: 'Deshacer' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('Los que alguien haya cambiado después no se tocan')
    await u.click(within(dialogo).getByRole('button', { name: 'Sí, deshacer' }))

    expect(await screen.findByText(/Se devolvieron 2 precios/)).toBeInTheDocument()
    expect(screen.getByText(/Soda 2 L: Lo cambiaron después/)).toBeInTheDocument()
    expect(llamadasA('/api/products/prices/undo')[0]?.body).toEqual({
      operacion: '0b4f7a0e-6a3b-4a58-9d0c-2f0b6f1c9a11',
    })
  })
})
