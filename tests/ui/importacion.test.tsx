/**
 * @vitest-environment jsdom
 *
 * Productos → Importar, del lado de la pantalla (P0-B).
 *
 * El servidor es el que decide --eso lo prueba
 * `tests/integration/importacion-productos.test.ts`--. Aca se prueba lo que ve
 * y manda la interfaz: que lea el archivo en el navegador y mande solo las
 * columnas elegidas, que no deje importar sin vista previa ni sin decidir que
 * pasa con el stock, que pida confirmacion y que ate la importacion a la vista
 * previa que se mostro.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportarProductos } from '@/components/productos/ImportarProductos'
import { csvDeFilasConError, valorVisible } from '@/components/productos/importacion-formato'
import type { VistaPrevia } from '@/modules/importacion/dto'
import type { Planilla } from '@/modules/importacion/planilla'
import { renderConSesion, SESION_ADMIN } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

beforeEach(() => {
  peticion.mockReset()
})

const CSV =
  'Código;Descripción;Precio venta;Stock\n' +
  '7799000000017;Arroz largo fino;1.500;24\n' +
  '7790895000119;Fernet;13.000;10\n'

/** La fila n de una vista, o falla la prueba si no esta. */
function filaDe(v: VistaPrevia, n: number) {
  const f = v.filas[n]
  if (!f) throw new Error(`no hay fila ${String(n)}`)
  return f
}

function vista(parcial: Partial<VistaPrevia> = {}): VistaPrevia {
  return {
    importacion: '0b4f7a0e-6a3b-4a58-9d0c-2f0b6f1c9a11',
    huella: 'a'.repeat(64),
    totales: {
      filas: 2,
      conErrores: 0,
      crear: 1,
      actualizar: 1,
      sinCambios: 0,
      omitir: 0,
      existentes: 1,
      nuevos: 1,
      repetidasEnArchivo: 0,
      conStock: 0,
    },
    bloqueos: [],
    categoriasNuevas: ['Sin categoría'],
    filas: [
      {
        fila: 2,
        accion: 'crear',
        productoId: null,
        nombre: 'Arroz largo fino',
        codigo: '7799000000017',
        unidad: 'UNIT',
        cambios: [{ campo: 'precio', antes: null, despues: '1500.00' }],
        errores: [],
        avisos: [],
        motivo: null,
      },
      {
        fila: 3,
        accion: 'actualizar',
        productoId: 1,
        nombre: 'Fernet',
        codigo: '7790895000119',
        unidad: 'UNIT',
        cambios: [{ campo: 'precio', antes: '12500.00', despues: '13000.00' }],
        errores: [],
        avisos: [],
        motivo: null,
      },
    ],
    ...parcial,
  }
}

async function subir(contenido: string | Uint8Array<ArrayBuffer>, nombre = 'lista.csv') {
  const u = userEvent.setup()
  renderConSesion(<ImportarProductos />, SESION_ADMIN)
  const archivo = new File([contenido], nombre, { type: 'text/csv' })
  await u.upload(screen.getByLabelText('Archivo de productos'), archivo)
  return u
}

describe('Importar productos: el archivo y las columnas', () => {
  it('lee el archivo en el navegador y mapea las columnas solas', async () => {
    await subir(CSV)
    await screen.findByText('2. Revisá las columnas')

    expect(screen.getByRole('combobox', { name: 'Código de barras' })).toHaveDisplayValue(
      'A · Código',
    )
    expect(screen.getByRole('combobox', { name: 'Nombre' })).toHaveDisplayValue('B · Descripción')
    expect(screen.getByRole('combobox', { name: 'Precio de venta' })).toHaveDisplayValue(
      'C · Precio venta',
    )
    expect(screen.getByRole('combobox', { name: 'Costo' })).toHaveDisplayValue('— No importar —')
    // Las primeras filas, como se van a leer.
    expect(screen.getByRole('table', { name: 'Primeras filas del archivo' })).toHaveTextContent(
      'Arroz largo fino',
    )
    expect(peticion, 'leer el archivo no llama al servidor').not.toHaveBeenCalled()
  })

  it('un archivo que no es una planilla se rechaza con su motivo', async () => {
    await subir(Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0]), 'lista.csv')
    expect(await screen.findByText(/no es una planilla/)).toBeInTheDocument()
  })

  it('manda solo las columnas elegidas, y nunca el archivo', async () => {
    const u = await subir(CSV)
    await screen.findByText('2. Revisá las columnas')
    peticion.mockResolvedValueOnce(vista())

    await u.click(screen.getByRole('button', { name: 'Revisar' }))

    await waitFor(() => {
      expect(peticion).toHaveBeenCalledTimes(1)
    })
    const [ruta, opciones] = peticion.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(ruta).toBe('/api/products/import/preview')
    expect(opciones.body).toEqual({
      archivo: 'lista.csv',
      campos: ['codigo', 'nombre', 'precio', 'stock'],
      filas: [
        { f: 2, v: ['7799000000017', 'Arroz largo fino', '1.500', '24'] },
        { f: 3, v: ['7790895000119', 'Fernet', '13.000', '10'] },
      ],
      modo: 'solo-nuevos',
      stock: 'no-tocar',
    })
  })
})

describe('Importar productos: vista previa y confirmacion', () => {
  it('con la columna de stock, no deja importar hasta elegir que hacer con el stock', async () => {
    const u = await subir(CSV)
    await screen.findByText('2. Revisá las columnas')
    peticion.mockResolvedValueOnce(vista())
    await u.click(screen.getByRole('button', { name: 'Revisar' }))

    const importar = await screen.findByRole('button', { name: 'Importar 2 productos' })
    expect(importar).toBeDisabled()
    expect(screen.getByText('Elegí qué hacer con el stock para seguir.')).toBeInTheDocument()

    peticion.mockResolvedValueOnce(vista({ totales: { ...vista().totales, conStock: 2 } }))
    await u.click(screen.getByRole('radio', { name: /Dejar el stock como dice el archivo/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Importar 2 productos' })).toBeEnabled()
    })
    const segunda = peticion.mock.calls[1] as [string, { body: Record<string, unknown> }]
    expect(segunda[1].body.stock).toBe('ajustar')
  })

  it('los bloqueos se muestran y no dejan importar', async () => {
    const u = await subir('Código;Descripción;Precio venta\n1;Arroz;100\n')
    await screen.findByText('2. Revisá las columnas')
    peticion.mockResolvedValueOnce(vista({ bloqueos: ['Tu usuario no puede cambiar precios.'] }))
    await u.click(screen.getByRole('button', { name: 'Revisar' }))

    expect(await screen.findByText('Tu usuario no puede cambiar precios.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar 2 productos' })).toBeDisabled()
  })

  it('confirma, importa atado a la vista previa y muestra el resultado', async () => {
    const u = await subir('Código;Descripción;Precio venta\n7799000000017;Arroz;1500\n')
    await screen.findByText('2. Revisá las columnas')
    peticion.mockResolvedValueOnce(vista())
    await u.click(screen.getByRole('button', { name: 'Revisar' }))
    await u.click(await screen.findByRole('button', { name: 'Importar 2 productos' }))

    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('Se van a agregar 1 productos y actualizar 1')
    expect(dialogo).toHaveTextContent('si algo falla, no se guarda nada')

    peticion.mockResolvedValueOnce({
      importacion: vista().importacion,
      creados: 1,
      actualizados: 1,
      sinCambios: 0,
      omitidos: 0,
      conErrores: 0,
      categoriasCreadas: ['Sin categoría'],
      movimientosDeStock: 0,
      milisegundos: 120,
    })
    await u.click(within(dialogo).getByRole('button', { name: 'Sí, importar' }))

    expect(await screen.findByText('Importación terminada')).toBeInTheDocument()
    const [ruta, opciones] = peticion.mock.calls[1] as [string, { body: Record<string, unknown> }]
    expect(ruta).toBe('/api/products/import')
    expect(opciones.body).toMatchObject({
      importacion: vista().importacion,
      huella: vista().huella,
      modo: 'solo-nuevos',
    })
  })

  it('la vista previa arranca por las filas con error', async () => {
    const u = await subir(CSV)
    await screen.findByText('2. Revisá las columnas')
    const base = vista()
    peticion.mockResolvedValueOnce(
      vista({
        totales: { ...base.totales, conErrores: 1, crear: 0 },
        filas: [
          {
            ...filaDe(base, 0),
            accion: 'error',
            errores: ['Precio: tiene que ser mayor que cero'],
          },
          filaDe(base, 1),
        ],
      }),
    )
    await u.click(screen.getByRole('button', { name: 'Revisar' }))

    expect(await screen.findByRole('button', { name: 'Con error (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('Precio: tiene que ser mayor que cero')).toBeInTheDocument()
  })
})

describe('Formato', () => {
  it('muestra cada dato como se lee', () => {
    expect(valorVisible('precio', '1500.00', 'UNIT')).toMatch(/1\.500,00/)
    expect(valorVisible('costo', '1100.5000', 'UNIT')).toBe('$ 1.100,50')
    expect(valorVisible('stock', '1.500', 'KG')).toMatch(/1,5.*kg/)
    expect(valorVisible('unidad', 'KG', 'KG')).toBe('Kilogramo')
  })

  it('el CSV de errores trae las columnas originales y no deja formulas vivas', () => {
    const planilla: Planilla = {
      tipo: 'csv',
      hoja: null,
      otrasHojas: [],
      separador: ';',
      codificacion: 'utf-8',
      filas: [
        { numero: 1, celdas: ['Código', 'Nombre', 'Precio'] },
        { numero: 2, celdas: ['1', '=HYPERLINK("x")', 'abc'] },
        { numero: 3, celdas: ['2', 'Bien', '100'] },
      ],
    }
    const base = vista()
    const v = vista({
      filas: [
        { ...filaDe(base, 0), fila: 2, accion: 'error', errores: ['Precio: no es un número'] },
        { ...filaDe(base, 1), fila: 3 },
      ],
    })
    const csv = csvDeFilasConError(planilla, ['Código', 'Nombre', 'Precio'], 0, v)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('Fila;Código;Nombre;Precio;Error')
    expect(csv).toContain(`2;1;"'=HYPERLINK(""x"")";abc;Precio: no es un número`)
    expect(csv).not.toContain('Bien')
  })
})
