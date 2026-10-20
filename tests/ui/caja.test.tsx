/**
 * @vitest-environment jsdom
 *
 * La pantalla de Caja, segunda vuelta de la UX V5.
 *
 * Pedido del dueño: nada importante detras de "Ver detalle". Abierta o
 * cerrada, monto inicial, ingresos, egresos, ventas, saldo esperado y
 * diferencia se ven al entrar; y un "Cómo funciona" explica abrir y cerrar.
 *
 * `apiRequest` se simula por direccion: lo que se prueba es lo que se dibuja.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CajaPage from '@/app/caja/page'
import { AyudaCaja } from '@/components/caja/AyudaCaja'
import { CuentaDeLaCaja } from '@/components/caja/CuentaDeLaCaja'
import { renderConSesion, SESION_ADMIN } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

const ABRIO = { id: 1, name: 'Ana Duarte' }

function turno(extra: Record<string, unknown> = {}) {
  return {
    id: 40,
    status: 'open',
    openedAt: new Date().toISOString(),
    closedAt: null,
    openingAmount: '10000.00',
    expectedAmount: '33500.00',
    countedAmount: null,
    difference: null,
    openedBy: ABRIO,
    closedBy: null,
    authorizedBy: null,
    openingNotes: null,
    closingNotes: null,
    ventasEnEfectivo: '25000.00',
    ingresos: '1500.00',
    egresos: '3000.00',
    cantidadDeVentas: 12,
    ...extra,
  }
}

interface Escenario {
  abierto: boolean
  conteos?: unknown[]
  cierres?: unknown[]
}

function simular({ abierto, conteos = [], cierres = [] }: Escenario) {
  peticion.mockImplementation((url: string, opciones?: { parse?: (r: unknown) => unknown }) => {
    const parse = opciones?.parse ?? ((r: unknown) => r)
    let crudo: unknown = { data: [], pagination: { page: 1, totalPages: 1, total: 0 } }
    if (url === '/api/cash/shift') {
      crudo = {
        turno: abierto ? turno() : null,
        politica: { requiereTurno: true, umbralDiferencia: '5000.00' },
      }
    } else if (url.startsWith('/api/admin/sales')) {
      crudo = { data: [], totales: { ventas: 14, anuladas: 0, recaudado: '41000.00' } }
    } else if (url === '/api/cash/count?limite=1') {
      crudo = conteos
    } else if (url.startsWith('/api/cash/shifts?estado=closed')) {
      crudo = { data: cierres }
    }
    return Promise.resolve(parse(crudo))
  })
}

beforeEach(() => {
  peticion.mockReset()
})

describe('Caja abierta: todo a la vista', () => {
  it('dice que esta abierta y cuanto tiene que haber', async () => {
    simular({ abierto: true })
    renderConSesion(<CajaPage />, SESION_ADMIN)

    expect(await screen.findByText('CAJA ABIERTA')).toBeInTheDocument()
    expect(screen.getByText('Tiene que haber en el cajón')).toBeInTheDocument()
    expect(screen.getAllByText(/33\.500,00/).length).toBeGreaterThan(0)
  })

  it('la cuenta completa sin abrir nada: inicial, ventas, ingresos, egresos y esperado', async () => {
    simular({ abierto: true })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')

    const cuenta = document.querySelector<HTMLElement>('[data-cuenta-caja]')
    if (!cuenta) throw new Error('Falta la cuenta de la caja')
    const renglon = (nombre: RegExp) => within(cuenta).getByText(nombre).closest('div')

    expect(renglon(/^Monto inicial/)).toHaveTextContent(/10\.000,00/)
    expect(renglon(/^Ventas en efectivo/)).toHaveTextContent(/25\.000,00/)
    expect(renglon(/^Ventas en efectivo/)).toHaveTextContent('12 ventas')
    expect(renglon(/^Ingresos/)).toHaveTextContent(/1\.500,00/)
    expect(renglon(/^Egresos/)).toHaveTextContent(/3\.000,00/)
    expect(renglon(/^Saldo esperado/)).toHaveTextContent(/33\.500,00/)
  })

  it('no hay "Ver detalle": movimientos, conteos y cajas anteriores ya estan', async () => {
    simular({ abierto: true })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')

    expect(screen.queryByRole('button', { name: /ver detalle/i })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Movimientos de caja' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Cajas anteriores' })).toBeInTheDocument()
  })

  it('las ventas de hoy, de todas las formas de pago, aparte del cajon', async () => {
    simular({ abierto: true })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')

    const ventas = screen.getByText('Ventas de hoy').closest('a, div')
    expect(ventas).toHaveTextContent(/41\.000,00/)
    expect(ventas).toHaveTextContent(/14 ventas, todas las formas de pago/)
  })

  it('sin conteo, la diferencia dice que todavia no se conto', async () => {
    simular({ abierto: true })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')

    expect(document.querySelector('[data-diferencia-caja]')).toHaveAttribute(
      'data-diferencia-caja',
      'sin-contar',
    )
    expect(screen.getByText(/todavía no se contó esta caja/i)).toBeInTheDocument()
  })

  it('con un conteo de esta caja, la diferencia se ve con palabra y monto', async () => {
    simular({
      abierto: true,
      conteos: [
        {
          id: 9,
          amount: '32300.00',
          expected: '33500.00',
          difference: '-1200.00',
          date: new Date(Date.now() + 1000).toISOString(),
          notes: null,
          user: { id: 2, name: 'Pablo Ferrer' },
        },
      ],
    })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')

    const diferencia = document.querySelector('[data-diferencia-caja]')
    expect(diferencia).toHaveAttribute('data-diferencia-caja', 'falta')
    expect(diferencia).toHaveTextContent(/Diferencia: faltan\s*\$\s*1\.200,00/)
    expect(diferencia).toHaveTextContent('Pablo Ferrer')
  })

  it('un conteo de una caja ANTERIOR no se muestra como diferencia de esta', async () => {
    simular({
      abierto: true,
      conteos: [
        {
          id: 8,
          amount: '1000.00',
          expected: '2000.00',
          difference: '-1000.00',
          date: '2020-01-01T12:00:00.000Z',
          notes: null,
          user: { id: 2, name: 'Pablo Ferrer' },
        },
      ],
    })
    renderConSesion(<CajaPage />, SESION_ADMIN)
    await screen.findByText('CAJA ABIERTA')
    expect(document.querySelector('[data-diferencia-caja]')).toHaveAttribute(
      'data-diferencia-caja',
      'sin-contar',
    )
  })
})

describe('Caja cerrada', () => {
  it('lo dice, ofrece abrirla y muestra la cuenta del ultimo cierre', async () => {
    simular({
      abierto: false,
      cierres: [
        turno({
          id: 39,
          status: 'closed',
          closedAt: new Date().toISOString(),
          closedBy: ABRIO,
          countedAmount: '33000.00',
          difference: '-500.00',
          closingNotes: 'Faltó cambio',
        }),
      ],
    })
    renderConSesion(<CajaPage />, SESION_ADMIN)

    expect(await screen.findByText('CAJA CERRADA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir caja' })).toHaveAttribute('href', '/caja/abrir')

    expect(screen.getByRole('heading', { name: 'Último cierre' })).toBeInTheDocument()
    const cuenta = document.querySelector<HTMLElement>('[data-cuenta-caja]')
    expect(cuenta).toHaveTextContent(/Monto inicial\s*\$\s*10\.000,00/)
    expect(cuenta).toHaveTextContent(/Saldo esperado\s*\$\s*33\.500,00/)
    expect(screen.getByText(/▲ Faltó/)).toHaveTextContent(/500,00/)
    expect(screen.getByText('“Faltó cambio”')).toBeInTheDocument()
  })
})

describe('Cómo funciona', () => {
  it('esta a la vista y explica abrir, cuando, cerrar, que revisar y la diferencia', async () => {
    const usuario = userEvent.setup()
    render(<AyudaCaja requiereTurno umbralDiferencia="5000.00" />)

    await usuario.click(screen.getByRole('button', { name: 'Cómo funciona' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Cómo funciona la caja' })

    for (const pregunta of [
      '¿Qué es abrir la caja?',
      '¿Cuándo hay que abrirla?',
      '¿Qué es cerrar la caja?',
      '¿Qué revisar antes de cerrar?',
      '¿Y si hay diferencia?',
    ]) {
      expect(within(dialogo).getByRole('heading', { name: pregunta })).toBeInTheDocument()
    }
    // Lo que dice sale de las reglas del local, no de un texto fijo.
    expect(dialogo).toHaveTextContent('no se puede cobrar con la caja cerrada')
    expect(dialogo).toHaveTextContent(/mayor a\s*\$\s*5\.000,00, un encargado/)

    await usuario.click(within(dialogo).getByRole('button', { name: 'Entendido' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('sin limite de diferencia, no menciona autorizacion', async () => {
    const usuario = userEvent.setup()
    render(<AyudaCaja requiereTurno={false} umbralDiferencia="0.00" />)
    await usuario.click(screen.getByRole('button', { name: 'Cómo funciona' }))
    const dialogo = await screen.findByRole('dialog')

    expect(dialogo).not.toHaveTextContent('un encargado tiene que autorizar')
    expect(dialogo).toHaveTextContent('se puede vender con la caja cerrada')
  })
})

describe('La cuenta de la caja', () => {
  it('cada renglon con su signo, y el esperado como total', () => {
    render(
      <CuentaDeLaCaja
        inicial="10000.00"
        ventasEnEfectivo="25000.00"
        cantidadDeVentas={1}
        ingresos="1500.00"
        egresos="3000.00"
        esperado="33500.00"
      />,
    )
    const cuenta = document.querySelector<HTMLElement>('[data-cuenta-caja]')
    expect(cuenta?.textContent).toMatch(
      /Monto inicial.*\+Ventas en efectivo\s*\(1 venta\).*\+Ingresos.*−Egresos.*=Saldo esperado/,
    )
  })
})
