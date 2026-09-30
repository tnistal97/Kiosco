/**
 * @vitest-environment jsdom
 *
 * Inicio por acciones y por rol. V1 comercial.
 *
 * Dos reglas: la pantalla dibuja SOLO las acciones que el usuario puede
 * abrir, y el cajero no la ve --entra directo a Venta--.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace, refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}))

import InicioPage from '@/app/(inicio)/page'
import { accionesPara, destinoDeInicio } from '@/components/inicio/destino'
import { permissionsForRole } from '@/server/authz/permissions'
import { renderConSesion, SESION_ADMIN, SESION_CAJERO, SESION_REPOSITOR } from './helpers'

/** Respuestas minimas para que el panel no se quede cargando. */
function respuesta(url: string): unknown {
  if (url.includes('/api/cash/shift')) {
    return { turno: null, politica: { requiereTurno: true, umbralDiferencia: '0.00' } }
  }
  if (url.includes('/api/admin/sales')) {
    return {
      data: [],
      pagination: { page: 1, totalPages: 1 },
      totales: { ventas: 7, anuladas: 0, recaudado: '48540.00' },
    }
  }
  if (url.includes('/api/reports/rentabilidad')) {
    return { gananciaBruta: '12000.00', margenBruto: '24.7', lineasSinCosto: 0 }
  }
  if (url.includes('/api/reports/clientes')) {
    return {
      cartera: {
        saldoPendiente: '31000.00',
        deudores: 4,
        deudaPromedio: '7750.00',
        saldoAFavor: '0.00',
        conSaldoAFavor: 0,
        sobreLimite: 1,
      },
      periodo: {},
      topDeudores: [],
      cobrosPorMedio: [],
    }
  }
  if (url.includes('/api/inventory/replenishment')) {
    return { agotados: 2, bajoMinimo: 5, sinMinimo: 0 }
  }
  return {}
}

beforeEach(() => {
  replace.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: RequestInfo | URL) => {
      const url =
        typeof entrada === 'string'
          ? entrada
          : entrada instanceof URL
            ? entrada.toString()
            : entrada.url
      return Promise.resolve(
        new Response(JSON.stringify(respuesta(url)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('A donde entra cada uno', () => {
  it('el cajero y el vendedor van a Venta; el dueño, el admin y el encargado al Inicio', () => {
    for (const rol of ['cajero', 'vendedor']) {
      expect(destinoDeInicio({ role: rol, permissions: permissionsForRole(rol) })).toBe('/venta')
    }
    for (const rol of ['duenio', 'admin', 'encargado', 'supervisor', 'repositor', 'auditor']) {
      expect(destinoDeInicio({ role: rol, permissions: permissionsForRole(rol) })).toBe('/')
    }
  })

  it('un cajero al que le sacaron sales.create no va al mostrador', () => {
    expect(destinoDeInicio({ role: 'cajero', permissions: new Set(['products.view']) })).toBe('/')
  })
})

describe('Las acciones grandes', () => {
  it('el dueño ve las seis', () => {
    expect(accionesPara(permissionsForRole('duenio')).map((a) => a.titulo)).toEqual([
      'Vender',
      'Caja',
      'Consultar precio',
      'Llegó mercadería',
      'Fiados',
      'Cambiar precios',
    ])
  })

  it('el repositor solo ve consultar precio', () => {
    expect(accionesPara(new Set(SESION_REPOSITOR.permissions)).map((a) => a.titulo)).toEqual([
      'Consultar precio',
    ])
  })

  it('el encargado no ve "Cambiar precios" si no tiene el permiso', () => {
    const sin = new Set(
      [...permissionsForRole('encargado')].filter((p) => p !== 'products.price.update'),
    )
    expect(accionesPara(sin).map((a) => a.titulo)).not.toContain('Cambiar precios')
  })
})

describe('La pantalla', () => {
  it('para el dueño: la pregunta, las acciones, los numeros de hoy y los avisos', async () => {
    renderConSesion(<InicioPage />, SESION_ADMIN)

    expect(screen.getByRole('heading', { name: '¿Qué querés hacer?' })).toBeInTheDocument()
    const acciones = screen.getByRole('navigation', { name: 'Acciones' })
    expect(acciones.querySelector('a[href="/venta"]')).not.toBeNull()
    expect(acciones.querySelector('a[href="/consultar-precio"]')).not.toBeNull()
    expect(acciones.querySelector('a[href="/compras"]')).not.toBeNull()

    await waitFor(() => {
      expect(screen.getByText('Ganancia estimada')).toBeInTheDocument()
    })
    expect(screen.getByText('Ventas')).toBeInTheDocument()
    expect(screen.getByText('Cantidad de ventas')).toBeInTheDocument()
    expect(screen.getByText('Fiado pendiente')).toBeInTheDocument()

    // Los avisos que piden hacer algo hoy.
    expect(screen.getByText(/La caja está sin abrir/)).toBeInTheDocument()
    expect(screen.getByText(/Poco stock: 2 agotados y 5 bajo mínimo/)).toBeInTheDocument()
    expect(screen.getByText(/1 cliente\(s\) pasaron su límite/)).toBeInTheDocument()

    // Sin graficos ni tarjetas de proveedores: eso vive en sus pantallas.
    expect(screen.queryByText('Cuentas por pagar')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('el cajero es mandado a Venta y no ve el panel', async () => {
    renderConSesion(<InicioPage />, SESION_CAJERO)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/venta')
    })
    expect(screen.queryByRole('heading', { name: '¿Qué querés hacer?' })).toBeNull()
  })

  it('el repositor no ve la ganancia ni la caja', async () => {
    renderConSesion(<InicioPage />, SESION_REPOSITOR)

    expect(screen.getByRole('heading', { name: '¿Qué querés hacer?' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/Poco stock/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Ganancia estimada')).toBeNull()
    expect(screen.queryByText(/La caja está sin abrir/)).toBeNull()
  })
})
