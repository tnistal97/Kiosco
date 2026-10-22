/**
 * La regla que decide si un producto de una tienda es el de la lista.
 *
 * Los casos son nombres reales de la lista de House y de las tiendas. Lo que
 * se prueba es la PRUDENCIA: que una foto equivocada no pase como encontrada.
 */

import { describe, it, expect } from 'vitest'
import {
  codigoDeUnidad,
  comparar,
  digitoVerificadorValido,
  medidas,
  normalizar,
  sinBulto,
} from '../../scripts/lib/coincidencia-de-productos'

describe('Medidas', () => {
  it('lleva peso y volumen a g y ml', () => {
    expect([...medidas('Yerba Canarias 1 kg')]).toEqual(['1000g'])
    expect([...medidas('Coca Cola 1.75L')]).toEqual(['1750ml'])
    expect([...medidas('Aceitunas Cañuelas verdes 500 cc')]).toEqual(['500ml'])
    expect([...medidas('Ketchup doypack 250 Grs.')]).toEqual(['250g'])
    expect([...medidas('Clight naranja dulce 7.5g bulto x20')]).toEqual(['7.5g'])
  })

  it('"330/355cc" son dos medidas aceptables', () => {
    expect([...medidas('Cerveza Corona porrón 330/355cc')].sort()).toEqual(['330ml', '355ml'])
  })

  it('no confunde un numero suelto ni "x20" con una medida', () => {
    expect(medidas('Encendedor Candela bulto x25').size).toBe(0)
    expect(medidas('Rollo cocina Sussex familiar 200 paños').size).toBe(0)
  })
})

describe('Normalizacion', () => {
  it('sin tildes ni mayusculas', () => {
    expect(normalizar('Yerba Mañanita 4Flex')).toBe('yerba mananita 4flex')
    expect(normalizar("Kellogg's Froot Loops")).toBe('kelloggs froot loops')
  })

  it('el bulto es como se compra, no que producto es', () => {
    expect(sinBulto('Aceitunas Natura girasol 5 L (bulto x4)')).toBe('Aceitunas Natura girasol 5 L')
    expect(sinBulto('Red Bull 250ml bulto x4')).toBe('Red Bull 250ml')
  })
})

describe('Comparar', () => {
  it('misma marca, medida y variedad: encontrada, aunque cambie el orden', () => {
    const r = comparar('Mermelada Arcor frutilla sin azúcar 390 g', {
      nombre: 'Mermelada de frutilla sin azúcar Arcor 390 g',
      marca: 'Arcor',
    })
    expect(r.veredicto).toBe('encontrada')
  })

  it('otra medida es otro producto: no se ofrece ni como dudosa', () => {
    const r = comparar('Cacao Nesquik 360 g', {
      nombre: 'Cacao en polvo Nesquik 800 g',
      marca: 'Nesquik',
    })
    expect(r.veredicto).toBeNull()
  })

  it('otro porcentaje es otro producto, aunque coincida el litro', () => {
    const r = comparar('Leche La Serenísima UAT descremada fortificada 1% 1 L', {
      nombre: 'Leche parcialmente descremada La Serenísima uat 2% fortificada 1 L',
      marca: 'La Serenísima',
    })
    expect(r.veredicto).toBeNull()
    expect(r.motivos.join(' ')).toMatch(/otro porcentaje: 2%/)
  })

  it('otro sabor no es encontrada', () => {
    const r = comparar('Gelatina Exquisita Light frutilla 22 g', {
      nombre: 'Gelatina light sabor durazno Exquisita 22 g',
      marca: 'Exquisita',
    })
    expect(r.veredicto).not.toBe('encontrada')
  })

  it('"sin azucar" distingue: la comun no es la sin azucar', () => {
    const r = comparar('Sprite lima limón sin azúcar 1.75L', {
      nombre: 'Gaseosa Sprite lima limón 1,75 L',
      marca: 'Sprite',
    })
    expect(r.veredicto).not.toBe('encontrada')
    expect(r.motivos.join(' ')).toMatch(/sin|azucar/)
  })

  it('otra marca no es encontrada', () => {
    const r = comparar('Dulce de leche Milkaut 400 g', {
      nombre: 'Dulce de leche clásico La Serenísima 400 g',
      marca: 'La Serenísima',
    })
    expect(r.veredicto).not.toBe('encontrada')
  })

  it('si falta una palabra que distingue, queda dudosa con el motivo', () => {
    const r = comparar('Dulce de leche La Serenísima colonial calcio 400 g', {
      nombre: 'Dulce de leche La Serenísima colonial 400 g.',
      marca: 'La Serenísima',
    })
    expect(r.veredicto).toBe('dudosa')
    expect(r.motivos).toContain('faltan: calcio')
  })

  it('si la tienda no dice la medida, queda dudosa', () => {
    const r = comparar('Pelapapas Ilko', { nombre: 'Pelapapas Ilko', marca: 'Ilko' })
    expect(r.veredicto).toBe('encontrada')
    const sinMedida = comparar('Vodka Smirnoff 700cc', {
      nombre: 'Vodka Smirnoff',
      marca: 'Smirnoff',
    })
    expect(sinMedida.veredicto).toBe('dudosa')
  })
})

describe('Codigos', () => {
  it('reconoce el digito verificador', () => {
    expect(digitoVerificadorValido('7790310985182')).toBe(true)
    // Los cuatro de la lista que tienen el digito mal.
    expect(digitoVerificadorValido('7790310985553')).toBe(false)
    expect(digitoVerificadorValido('7798427620045')).toBe(false)
  })

  it('saca el codigo de la unidad de un codigo de bulto', () => {
    expect(codigoDeUnidad('37790036000320')).toBe('7790036000329')
    expect(codigoDeUnidad('7790036000329')).toBeNull()
  })
})
