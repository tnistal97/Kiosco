/**
 * @vitest-environment jsdom
 *
 * Reportes, segunda vuelta de la UX V5.
 *
 *   1. arriba, el resumen de HOY en seis tarjetas: total vendido, cantidad de
 *      ventas, efectivo, transferencia, Mercado Pago y ticket promedio;
 *   2. accesos claros a ventas por dia, por medio de pago, por producto, por
 *      usuario y cierres de caja (y "Más reportes" para lo demas);
 *   3. un solo reporte a la vez, el elegido, con su periodo.
 *
 * Cada acceso respeta su permiso: lo que no se puede ver no se dibuja ni se
 * pide. `apiRequest` se simula por direccion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportesPage from '@/app/reportes/page'
import { hoyEn, sumarDias } from '@/lib/tiempo'
import { renderConSesion, SESION_ADMIN, SESION_CAJERO } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

const busqueda = vi.hoisted(() => ({ actual: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => busqueda.actual,
}))

const HOY = hoyEn('America/Argentina/Buenos_Aires')

const VENTAS_DE_HOY = {
  totales: {
    facturado: '37800.00',
    operaciones: 3,
    ticketPromedio: '12600.00',
    anuladas: 1,
    facturadoAnulado: '1690.00',
  },
  porDia: [{ dia: HOY, facturado: '37800.00', operaciones: 3 }],
  porCajero: [
    { usuario: 'Ana Duarte', facturado: '22850.00', operaciones: 1 },
    { usuario: 'Lucia Bravo', facturado: '14950.00', operaciones: 2 },
  ],
  porMedio: [
    { medio: 'CASH', etiqueta: 'Efectivo', cobrado: '20000.00', operaciones: 2 },
    { medio: 'MERCADO_PAGO', etiqueta: 'Mercado Pago', cobrado: '9000.00', operaciones: 1 },
    { medio: 'TRANSFER', etiqueta: 'Transferencia', cobrado: '6000.00', operaciones: 1 },
    { medio: 'DEBIT_CARD', etiqueta: 'Débito', cobrado: '2800.00', operaciones: 1 },
  ],
}

const CAJA = {
  turnos: 1,
  turnosConDiferencia: 1,
  sobrantes: '0.00',
  faltantes: '-850.00',
  ingresos: '38500.00',
  egresos: '0.00',
  retiros: '38700.00',
  ventasEnEfectivo: '195030.00',
  detalle: [
    {
      turno: 544,
      abierto: '2026-10-19T12:00:00.000Z',
      cerrado: null,
      abrio: 'Marina Sosa',
      cerradoPor: null,
      esperado: null,
      contado: null,
      diferencia: null,
    },
    {
      turno: 546,
      abierto: '2026-10-18T12:00:00.000Z',
      cerrado: '2026-10-18T23:00:00.000Z',
      abrio: 'Lucia Bravo',
      cerradoPor: 'Marina Sosa',
      esperado: '40500.00',
      contado: '39650.00',
      diferencia: '-850.00',
    },
  ],
}

beforeEach(() => {
  busqueda.actual = new URLSearchParams()
  peticion.mockReset()
  peticion.mockImplementation((url: string, opciones?: { parse?: (r: unknown) => unknown }) => {
    const parse = opciones?.parse ?? ((r: unknown) => r)
    let crudo: unknown = {}
    if (url.startsWith('/api/reports/ventas')) crudo = VENTAS_DE_HOY
    else if (url.startsWith('/api/reports/caja')) crudo = CAJA
    else if (url.startsWith('/api/reports/productos')) {
      crudo = {
        masVendidos: [{ producto: 'Yerba mate 1 kg', unidades: '6.000', facturado: '29100.00' }],
        menosVendidos: [{ producto: 'Leche entera 1 L', unidades: '1.000', facturado: '1690.00' }],
        sinVentas: 38,
      }
    }
    return Promise.resolve(parse(crudo))
  })
})

function pedidas(): string[] {
  return peticion.mock.calls.map((c) => String(c[0]))
}

describe('El resumen de hoy', () => {
  it('seis tarjetas: total, cantidad, efectivo, transferencia, Mercado Pago y ticket promedio', async () => {
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    const resumen = await waitFor(() => {
      const r = document.querySelector<HTMLElement>('[data-resumen-hoy]')
      if (!r) throw new Error('todavia no')
      return r
    })

    const tarjeta = (titulo: string) => within(resumen).getByText(titulo).parentElement
    expect(tarjeta('Total vendido hoy')).toHaveTextContent(/37\.800,00/)
    expect(tarjeta('Cantidad de ventas')).toHaveTextContent('3')
    expect(tarjeta('Efectivo')).toHaveTextContent(/20\.000,00/)
    expect(tarjeta('Transferencia')).toHaveTextContent(/6\.000,00/)
    // Mercado Pago aparte de las transferencias.
    expect(tarjeta('Mercado Pago')).toHaveTextContent(/9\.000,00/)
    expect(tarjeta('Ticket promedio')).toHaveTextContent(/12\.600,00/)
  })

  it('es de HOY, y las anuladas se avisan sin sumar', async () => {
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    await screen.findByText('Total vendido hoy')

    expect(pedidas()).toContain(`/api/reports/ventas?desde=${HOY}&hasta=${HOY}`)
    expect(screen.getByText('1 anulada, no suman')).toBeInTheDocument()
  })

  it('los demas medios no se pierden: van en una linea aparte', async () => {
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    expect(await screen.findByText('Otros medios hoy:')).toBeInTheDocument()
    expect(screen.getByText('Otros medios hoy:').parentElement).toHaveTextContent(
      /Débito\s*\$\s*2\.800,00/,
    )
  })
})

describe('Los accesos', () => {
  it('los cinco reportes principales, con nombre de pregunta', async () => {
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    await screen.findByText('Total vendido hoy')

    for (const nombre of [
      /^Ventas por día/,
      /^Ventas por medio de pago/,
      /^Ventas por producto/,
      /^Ventas por usuario/,
      /^Cierres de caja/,
    ]) {
      expect(screen.getByRole('button', { name: nombre })).toBeInTheDocument()
    }
    // Lo de vez en cuando, mas chico.
    expect(screen.getByRole('button', { name: 'Ganancia' })).toBeInTheDocument()
    // Compras y lotes estan apagados en un almacen: sus reportes no aparecen.
    expect(screen.queryByRole('button', { name: 'Compras' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vencimientos' })).toBeNull()
  })

  it('arranca en ventas por dia de la ultima semana, con los dias sin ventas en cero', async () => {
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    const reporte = await screen.findByRole('region', { name: 'Ventas por día' })

    expect(screen.getByRole('button', { name: /^Ventas por día/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(pedidas()).toContain(`/api/reports/ventas?desde=${sumarDias(HOY, -6)}&hasta=${HOY}`)
    // Siete dias, el de hoy arriba. Los seis sin ventas, en cero y no ausentes.
    const tabla = await within(reporte).findByRole('table')
    const filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas).toHaveLength(7)
    expect(filas[0]).toHaveTextContent(/37\.800,00/)
    expect(filas[1]).toHaveTextContent(/\$\s*0,00/)
  })

  it('elegir "Cierres de caja" muestra cada cierre con su diferencia', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    await screen.findByText('Total vendido hoy')

    await usuario.click(screen.getByRole('button', { name: /^Cierres de caja/ }))
    const reporte = await screen.findByRole('region', { name: 'Cierres de caja' })
    const tabla = await within(reporte).findByRole('table')

    expect(pedidas().some((u) => u.startsWith('/api/reports/caja?'))).toBe(true)
    const cerrada = within(tabla)
      .getAllByRole('row')
      .find((f) => f.textContent.includes('#546'))
    expect(cerrada).toHaveTextContent('Lucia Bravo')
    expect(cerrada).toHaveTextContent('Marina Sosa')
    expect(cerrada).toHaveTextContent(/▲ Faltó\s*\$\s*850,00/)
    expect(tabla).toHaveTextContent('Sigue abierta')
  })

  it('por medio de pago: cada medio con su parte del total', async () => {
    busqueda.actual = new URLSearchParams('ver=medio')
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    const reporte = await screen.findByRole('region', { name: 'Ventas por medio de pago' })
    const tabla = await within(reporte).findByRole('table')

    const fila = within(tabla)
      .getAllByRole('row')
      .find((f) => f.textContent.includes('Mercado Pago'))
    expect(fila).toHaveTextContent('24%')
    expect(fila).toHaveTextContent(/9\.000,00/)
  })

  it('por producto y por usuario', async () => {
    const usuario = userEvent.setup()
    renderConSesion(<ReportesPage />, SESION_ADMIN)
    await screen.findByText('Total vendido hoy')

    await usuario.click(screen.getByRole('button', { name: /^Ventas por producto/ }))
    const productos = await screen.findByRole('region', { name: 'Ventas por producto' })
    expect(await within(productos).findByText('Yerba mate 1 kg')).toBeInTheDocument()
    expect(productos).toHaveTextContent('38 productos activos no se vendieron')

    await usuario.click(screen.getByRole('button', { name: /^Ventas por usuario/ }))
    const usuarios = await screen.findByRole('region', { name: 'Ventas por usuario' })
    expect(await within(usuarios).findByText('Lucia Bravo')).toBeInTheDocument()
  })
})

describe('Cada acceso con su permiso', () => {
  it('sin reportes asignados, lo dice y no pide nada', async () => {
    renderConSesion(<ReportesPage />, SESION_CAJERO)
    expect(await screen.findByText('No tenés reportes asignados')).toBeInTheDocument()
    expect(peticion).not.toHaveBeenCalled()
  })

  it('con solo el permiso de caja: sin resumen de ventas, y solo los cierres', async () => {
    renderConSesion(<ReportesPage />, {
      ...SESION_CAJERO,
      permissions: ['reports.cash.view'],
    })
    await screen.findByRole('region', { name: 'Cierres de caja' })

    expect(screen.queryByText('Total vendido hoy')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Ventas por día/ })).toBeNull()
    expect(pedidas().every((u) => u.startsWith('/api/reports/caja'))).toBe(true)
  })
})
