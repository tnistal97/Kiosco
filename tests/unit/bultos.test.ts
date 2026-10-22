/**
 * La regla que pasa a unidades los productos cargados como bulto. Ver
 * scripts/lib/bultos.ts.
 *
 * Los nombres son los de las listas de House. Lo que se prueba es la cuenta
 * (bultos × N, sumada a la unidad si existe) y la PRUDENCIA: dos productos
 * distintos no se juntan, y el codigo de la caja no pasa a la unidad.
 */

import { describe, it, expect } from 'vitest'
import {
  detectarBulto,
  planificar,
  seParecen,
  type Consolidar,
  type Paso,
  type ProductoDelCatalogo,
  type Renombrar,
  type Revisar,
} from '../../scripts/lib/bultos'

let siguiente = 1
function producto(
  nombre: string,
  stock: number,
  extra: Partial<ProductoDelCatalogo> = {},
): ProductoDelCatalogo {
  return {
    id: siguiente++,
    nombre,
    stock,
    saleUnit: 'UNIT',
    lotTracking: 'NONE',
    purchaseUnit: 'UNIT',
    unitsPerPurchaseUnit: 1,
    codigos: [],
    tieneFoto: false,
    soloCargaInicial: true,
    ...extra,
  }
}

/** El motivo del unico paso, que tiene que ser "revisar". */
function motivoDeRevision(pasos: Paso[]): string {
  expect(pasos).toHaveLength(1)
  const [paso] = pasos
  if (paso?.accion !== 'revisar') throw new Error(`se esperaba revisar: ${JSON.stringify(paso)}`)
  return paso.motivo
}

describe('Que es un bulto', () => {
  it('las dos formas de las listas: "(bulto x4)" y "bulto x8"', () => {
    expect(detectarBulto('Aceitunas Natura girasol 5 L (bulto x4)')).toEqual({
      base: 'Aceitunas Natura girasol 5 L',
      multiplicador: 4,
    })
    expect(detectarBulto('Puré de tomate Noel brick 520 g (bulto x12)')).toEqual({
      base: 'Puré de tomate Noel brick 520 g',
      multiplicador: 12,
    })
    expect(detectarBulto('Clight naranja 8g bulto x20')).toEqual({
      base: 'Clight naranja 8g',
      multiplicador: 20,
    })
    expect(detectarBulto('Encendedor Candela bulto x25')).toEqual({
      base: 'Encendedor Candela',
      multiplicador: 25,
    })
  })

  it('tolera espacios, ceros y mayusculas, que no cambian lo que dice', () => {
    expect(detectarBulto('Producto X (Bulto x 04)')).toEqual({
      base: 'Producto X',
      multiplicador: 4,
    })
    expect(detectarBulto('Producto X BULTO X6')).toEqual({ base: 'Producto X', multiplicador: 6 })
  })

  it('una caja o un pack que se vende entero NO es un bulto', () => {
    expect(detectarBulto('Raid tabletas caja x24')).toBeNull()
    expect(detectarBulto('Esponja Task fibra spun oro plata x3')).toBeNull()
    expect(detectarBulto('Paño Virulana Twist x3')).toBeNull()
    expect(detectarBulto('Cereal bar Flow yogur frutilla bosque 6 x 27 g')).toBeNull()
    expect(detectarBulto('Chupetines Mr Pops Evolution cereza 24 u')).toBeNull()
    expect(detectarBulto('Bolsas residuos Virutex rollo 45x60 x20')).toBeNull()
    expect(detectarBulto('Higienol Max HS 4x50m')).toBeNull()
  })
})

describe('La cuenta', () => {
  it('1. Producto = 2 y Producto (bulto x 4) = 3: queda Producto = 14', () => {
    const unidad = producto('Leche Serenísima entera 1 L', 2)
    const bulto = producto('Leche Serenísima entera 1 L (bulto x4)', 3)
    const [paso] = planificar([unidad, bulto]) as [Consolidar]
    expect(paso).toMatchObject({
      accion: 'consolidar',
      nombre: 'Leche Serenísima entera 1 L',
      bultos: 3,
      multiplicador: 4,
      unidades: 12,
      stockPrevio: 2,
      stockFinal: 14,
    })
    expect(paso.unidad.id).toBe(unidad.id)
    expect(paso.bulto.id).toBe(bulto.id)
  })

  it('2. Solo Producto (bulto x 6) = 2: queda Producto = 12, con el nombre de la unidad', () => {
    const [paso] = planificar([producto('Agua Villavicencio 500 ml (bulto x6)', 2)]) as [Renombrar]
    expect(paso).toMatchObject({
      accion: 'renombrar',
      nombre: 'Agua Villavicencio 500 ml',
      bultos: 2,
      unidades: 12,
      fijarCompra: true,
    })
  })

  it('la unidad se encuentra sin importar tildes, mayusculas ni espacios', () => {
    const [paso] = planificar([
      producto('Pure de tomate  Noel 520 g', 1),
      producto('Puré de tomate Noel 520 g (bulto x12)', 2),
    ])
    expect(paso).toMatchObject({ accion: 'consolidar', stockFinal: 25 })
  })

  it('dos bultos del mismo producto sin unidad: el primero se renombra y el otro se suma', () => {
    const chico = producto('Gaseosa Cola 500 ml (bulto x6)', 2)
    const grande = producto('Gaseosa Cola 500 ml bulto x12', 1)
    const [primero, segundo] = planificar([chico, grande]) as [Renombrar, Consolidar]
    expect(primero).toMatchObject({ accion: 'renombrar', unidades: 12 })
    expect(segundo).toMatchObject({
      accion: 'consolidar',
      stockPrevio: 12,
      unidades: 12,
      stockFinal: 24,
    })
    expect(segundo.unidad.id).toBe(chico.id)
    expect(segundo.fijarCompra).toBe(false)
  })

  it('un bulto con cero bultos queda en cero, con el nombre de la unidad', () => {
    expect(planificar([producto('Red Bull 250ml bulto x4', 0)])).toMatchObject([
      { accion: 'renombrar', nombre: 'Red Bull 250ml', unidades: 0 },
    ])
  })

  it('6. el catalogo ya normalizado no tiene nada que hacer', () => {
    expect(
      planificar([
        producto('Leche Serenísima entera 1 L', 14),
        producto('Agua Villavicencio 500 ml', 12),
      ]),
    ).toEqual([])
  })
})

describe('3. Lo que se parece pero no es lo mismo NO se junta', () => {
  it('otra presentacion de la misma marca es otro producto', () => {
    const porron = producto('Cerveza Corona porrón 330/355cc bulto x6', 12)
    const lata = producto('Cerveza Corona lata 473cc', 6)
    const pasos = planificar([porron, lata, producto('Cerveza Corona descartable 710cc', 6)])
    expect(pasos).toHaveLength(1)
    expect(pasos[0]).toMatchObject({
      accion: 'renombrar',
      nombre: 'Cerveza Corona porrón 330/355cc',
      unidades: 72,
    })
  })

  it('otra variedad u otra medida no son la unidad', () => {
    expect(seParecen('Clight naranja 8g', 'Clight naranja dulce 7.5g')).toBe(false)
    expect(seParecen('Baño Pronto naranja 1L', 'Baño Fresh Liviano naranja dulce 1L')).toBe(false)
    expect(seParecen('Baño Pronto naranja 1L', 'Baño Pronto naranja 200cc')).toBe(false)
    const pasos = planificar([
      producto('Baño Pronto naranja 1L bulto x8', 8),
      producto('Baño Fresh Liviano naranja dulce 1L', 3),
    ])
    expect(pasos).toMatchObject([
      { accion: 'renombrar', nombre: 'Baño Pronto naranja 1L', unidades: 64 },
    ])
  })

  it('un nombre casi igual NO se adivina: queda para revisar y no se toca', () => {
    expect(seParecen('Red Bull 250ml', 'Red Bull lata 250 ml')).toBe(true)
    const [paso] = planificar([
      producto('Red Bull 250ml bulto x4', 4),
      producto('Red Bull lata 250 ml', 3),
    ]) as [Revisar]
    expect(paso.accion).toBe('revisar')
    expect(paso.motivo).toContain('Red Bull lata 250 ml')
  })

  it('dos productos con el nombre de la unidad: no se elige uno', () => {
    const pasos = planificar([
      producto('Yerba Playadito 1 kg', 3),
      producto('yerba playadito 1 KG', 2),
      producto('Yerba Playadito 1 kg (bulto x10)', 1),
    ])
    expect(motivoDeRevision(pasos)).toContain('hay 2 productos')
  })

  it('un bulto que ya se vendio o se ajusto no se multiplica', () => {
    const pasos = planificar([
      producto('Clight naranja 8g bulto x20', 19, { soloCargaInicial: false }),
    ])
    expect(motivoDeRevision(pasos)).toContain('ventas o ajustes')
  })

  it('lo que se vende por peso o por lote no se toca', () => {
    expect(
      planificar([producto('Queso cremoso (bulto x4)', 2, { saleUnit: 'KG' })])[0]?.accion,
    ).toBe('revisar')
    expect(
      planificar([producto('Yogur (bulto x12)', 2, { lotTracking: 'REQUIRED' })])[0]?.accion,
    ).toBe('revisar')
  })

  it('"bulto" sin cuantas trae queda para revisar', () => {
    expect(motivoDeRevision(planificar([producto('Fideos Lucchetti bulto', 3)]))).toContain(
      'no cuántas unidades trae',
    )
  })
})

describe('4. Codigos de barras', () => {
  it('el codigo del bulto NO reemplaza el de la unidad: queda como nota', () => {
    const unidad = producto('Galletitas Express 100 g', 5, { codigos: ['7790000000010'] })
    const bulto = producto('Galletitas Express 100 g (bulto x24)', 1, {
      codigos: ['17790000000031'],
    })
    const [paso] = planificar([unidad, bulto]) as [Consolidar]
    expect(paso.codigoDeUnidad).toBeNull()
    expect(paso.nota).toBe('Código del bulto x24: 17790000000031 (no es el de la unidad).')
  })

  it('sin unidad, el codigo del bulto se saca y la unidad queda sin codigo', () => {
    const [paso] = planificar([
      producto('Red Bull 250ml bulto x4', 4, { codigos: ['9002490203306'] }),
    ]) as [Renombrar]
    expect(paso.codigoDeUnidad).toBeNull()
    expect(paso.nota).toContain('9002490203306')
  })

  it('el codigo de la unidad entra solo si alguien lo verifico', () => {
    const bulto = producto('Baño Pronto naranja 1L bulto x8', 8, { codigos: ['37790036000320'] })
    const verificados = new Map([['37790036000320', '7790036000329']])
    const [paso] = planificar([bulto], { codigosVerificados: verificados }) as [Renombrar]
    expect(paso.codigoDeUnidad).toBe('7790036000329')
    expect(paso.nota).toBe('Código del bulto x8: 37790036000320 (no es el de la unidad).')
  })

  it('un codigo verificado que ya es de otro producto no se usa', () => {
    const bulto = producto('Baño Pronto naranja 1L bulto x8', 8, { codigos: ['37790036000320'] })
    const otro = producto('Otro jugo 1L', 1, { codigos: ['7790036000329'] })
    const [paso] = planificar([bulto, otro], {
      codigosVerificados: new Map([['37790036000320', '7790036000329']]),
    }) as [Renombrar]
    expect(paso.codigoDeUnidad).toBeNull()
  })

  it('a una unidad que ya tiene codigo no se le cambia', () => {
    const unidad = producto('Galletitas Express 100 g', 5, { codigos: ['7790000000010'] })
    const bulto = producto('Galletitas Express 100 g (bulto x24)', 1, {
      codigos: ['17790000000031'],
    })
    const [paso] = planificar([unidad, bulto], {
      codigosVerificados: new Map([['17790000000031', '7790000000034']]),
    }) as [Consolidar]
    expect(paso.codigoDeUnidad).toBeNull()
  })
})

describe('5. La foto', () => {
  it('la del bulto pasa a la unidad si la unidad no tiene', () => {
    const [paso] = planificar([
      producto('Té Taragüi x25', 1),
      producto('Té Taragüi x25 (bulto x12)', 1, { tieneFoto: true }),
    ])
    expect(paso).toMatchObject({ accion: 'consolidar', foto: 'mover' })
  })

  it('si la unidad ya tiene, la del bulto sobra', () => {
    const [paso] = planificar([
      producto('Té Taragüi x25', 1, { tieneFoto: true }),
      producto('Té Taragüi x25 (bulto x12)', 1, { tieneFoto: true }),
    ])
    expect(paso).toMatchObject({ accion: 'consolidar', foto: 'quitar' })
  })

  it('al renombrar, la foto se queda donde esta', () => {
    const [paso] = planificar([producto('Té Taragüi x25 (bulto x12)', 1, { tieneFoto: true })])
    expect(paso).toMatchObject({ accion: 'renombrar' })
    expect(paso).not.toHaveProperty('foto')
  })
})

describe('La unidad de compra', () => {
  it('queda "caja de N", salvo que ya tuviera una', () => {
    expect(planificar([producto('Agua 500 ml (bulto x6)', 1)])).toMatchObject([
      { fijarCompra: true },
    ])
    expect(
      planificar([
        producto('Agua 500 ml', 1, { purchaseUnit: 'PACK', unitsPerPurchaseUnit: 12 }),
        producto('Agua 500 ml (bulto x6)', 1),
      ]),
    ).toMatchObject([{ fijarCompra: false }])
  })
})
