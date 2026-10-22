/**
 * La regla de una compra que entra al stock. Ver scripts/lib/compra.ts.
 *
 * Lo que se prueba es la PRUDENCIA: una linea nueva con el nombre de un
 * producto que ya existe no crea un duplicado, una que suma tiene que dar con
 * UN producto exacto, y nada repetido ni invalido pasa.
 */

import { describe, it, expect } from 'vitest'
import {
  planificarCompra,
  type LineaDeCompra,
  type ProductoActivo,
  type Revisar,
} from '../../scripts/lib/compra'

let siguiente = 1
function producto(nombre: string, extra: Partial<ProductoActivo> = {}): ProductoActivo {
  return {
    id: siguiente++,
    nombre,
    codigoPrincipal: null,
    saleUnit: 'UNIT',
    lotTracking: 'NONE',
    ...extra,
  }
}

function linea(
  nombre: string,
  cantidad: number,
  extra: Partial<LineaDeCompra> = {},
): LineaDeCompra {
  return { nombre, cantidad, codigo: null, accion: 'crear', origen: 'hoja 1 fila 1', ...extra }
}

const motivo = (paso: unknown) => (paso as Revisar).motivo

describe('planificarCompra', () => {
  const catalogo = [
    producto('Cereal Nesquik bolitas chocolate 230 g'),
    producto('Coca Cola 600cc', { codigoPrincipal: '7790895650833' }),
    producto('Queso por kilo', { saleUnit: 'KG' }),
  ]

  it('crea lo que no existe y suma a lo que existe con el nombre exacto', () => {
    const pasos = planificarCompra(catalogo, [
      linea('Nueces', 5),
      linea('Coca Cola 600cc', 6, { accion: 'sumar', codigo: '7790895650833' }),
    ])
    expect(pasos.map((p) => p.accion)).toEqual(['crear', 'sumar'])
    expect(pasos[1]).toMatchObject({ producto: { nombre: 'Coca Cola 600cc' } })
  })

  it('no crea un producto con el nombre de uno que ya existe, aunque cambien mayusculas o tildes', () => {
    const [paso] = planificarCompra(catalogo, [linea('cereal nesquík BOLITAS chocolate 230 g', 3)])
    expect(paso?.accion).toBe('revisar')
    expect(motivo(paso)).toContain('ya existe "Cereal Nesquik bolitas chocolate 230 g"')
  })

  it('no adivina: sumar exige el nombre EXACTO de un producto activo', () => {
    const pasos = planificarCompra(catalogo, [
      linea('Bolitas choco', 3, { accion: 'sumar' }),
      linea('Coca Cola 600 cc', 6, { accion: 'sumar' }),
    ])
    expect(pasos.map((p) => p.accion)).toEqual(['revisar', 'revisar'])
    expect(motivo(pasos[0])).toContain('nombre exacto')
  })

  it('sumar con un codigo que no es el del producto queda para revisar', () => {
    const [paso] = planificarCompra(catalogo, [
      linea('Coca Cola 600cc', 6, { accion: 'sumar', codigo: '7790895650840' }),
    ])
    expect(motivo(paso)).toContain('no es el de "Coca Cola 600cc"')
  })

  it('no suma a un producto que se vende por peso', () => {
    const [paso] = planificarCompra(catalogo, [linea('Queso por kilo', 2, { accion: 'sumar' })])
    expect(motivo(paso)).toContain('por peso')
  })

  it('un producto nuevo no puede traer el codigo de otro', () => {
    const [paso] = planificarCompra(catalogo, [
      linea('Gaseosa cola 600', 6, { codigo: '7790895650833' }),
    ])
    expect(motivo(paso)).toContain('ya es de "Coca Cola 600cc"')
  })

  it('rechaza cantidades que no son enteros positivos y codigos invalidos', () => {
    const pasos = planificarCompra(catalogo, [
      linea('Almendras', 0),
      linea('Pasas', 2.5),
      linea('Chía', 2, { codigo: '7790895650834' }),
      linea(' Lino', 2),
    ])
    expect(pasos.every((p) => p.accion === 'revisar')).toBe(true)
    expect(motivo(pasos[2])).toContain('no es válido')
    expect(motivo(pasos[3])).toContain('espacios')
  })

  it('dos lineas del mismo producto no pasan: se suman antes, en una', () => {
    const pasos = planificarCompra(catalogo, [linea('Nueces', 5), linea('nueces', 2)])
    expect(pasos.map((p) => p.accion)).toEqual(['revisar', 'revisar'])
    expect(motivo(pasos[0])).toContain('se repite')
  })
})
