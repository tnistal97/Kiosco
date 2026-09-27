/**
 * Lectura de planillas: .csv como lo escribe Excel en castellano, .xlsx como
 * lo escriben Excel y otras bibliotecas, y todo lo que se tiene que rechazar
 * antes de mirar una sola fila.
 */

import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { leerPlanilla, textoDeCelda, type Planilla } from '@/modules/importacion/planilla'
import { ErrorDePlanilla, type MotivoPlanilla } from '@/modules/importacion/errores'
import { decodificar, detectarSeparador, leerCsv } from '@/modules/importacion/csv'
import { extraer, leerIndice } from '@/modules/importacion/zip'
import { empaquetarZip, escribirXlsx } from '../../scripts/lib/xlsx-escritor'

const bytes = (texto: string) => new TextEncoder().encode(texto)

async function motivo(promesa: Promise<unknown>): Promise<MotivoPlanilla | 'sin-error'> {
  try {
    await promesa
    return 'sin-error'
  } catch (e) {
    if (e instanceof ErrorDePlanilla) return e.motivo
    throw e
  }
}

function celdas(p: Planilla): string[][] {
  return p.filas.map((f) => f.celdas.map((c) => textoDeCelda(c)))
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('CSV', () => {
  it('Excel en castellano: punto y coma, coma decimal y Windows-1252', async () => {
    // "Lácteos" en Windows-1252: la á es el byte 0xE1, que en UTF-8 no es valido.
    const cabeza = bytes('Codigo;Producto;Categoria;Precio\r\n')
    const fila = Uint8Array.from([
      ...bytes('7790001;Leche entera;L'),
      0xe1,
      ...bytes('cteos;1500,50\r\n'),
    ])
    const p = await leerPlanilla('lista.csv', Uint8Array.from([...cabeza, ...fila]))

    expect(p.tipo).toBe('csv')
    expect(p.separador).toBe(';')
    expect(p.codificacion).toBe('windows-1252')
    expect(celdas(p)[1]).toEqual(['7790001', 'Leche entera', 'Lácteos', '1500,50'])
  })

  it('UTF-8 con marca de orden de bytes', () => {
    const d = decodificar(Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes('Categoría')]))
    expect(d).toEqual({ texto: 'Categoría', codificacion: 'utf-8' })
  })

  it('la coma decimal no le gana al punto y coma', () => {
    const texto = 'Codigo;Nombre;Precio\n1;Yerba;1500,50\n2;Azucar;980\n3;Arroz;1200,25\n'
    expect(detectarSeparador(texto)).toBe(';')
  })

  it('reconoce la coma y el tabulador cuando son el separador', () => {
    expect(detectarSeparador('codigo,nombre,precio\n1,Yerba,1500\n2,Azucar,980\n')).toBe(',')
    expect(detectarSeparador('codigo\tnombre\tprecio\n1\tYerba\t1500,50\n')).toBe('\t')
  })

  it('comillas: separador, comilla doble y salto de linea adentro de un campo', () => {
    const texto =
      'Codigo;Nombre;Precio\n' +
      '1;"Galletitas; surtidas";500\n' +
      '2;"Vino ""Reserva""";3000\n' +
      '3;"Queso\ncremoso";9800\n' +
      '4;Fideos;700\n'
    const filas = leerCsv(texto, ';', 100)
    expect(filas.map((f) => f.celdas[1])).toEqual([
      'Nombre',
      'Galletitas; surtidas',
      'Vino "Reserva"',
      'Queso\ncremoso',
      'Fideos',
    ])
    // Numeradas como las numera Excel: el salto adentro de las comillas no
    // abre una fila nueva.
    expect(filas.map((f) => f.numero)).toEqual([1, 2, 3, 4, 5])
  })

  it('las filas en blanco no se leen pero conservan la numeracion', () => {
    const filas = leerCsv('a;b\n\n1;2\n;;\n3;4\n', ';', 100)
    expect(filas.map((f) => f.numero)).toEqual([1, 3, 5])
  })

  it('una comilla que no cierra se rechaza y dice donde', () => {
    expect(() => leerCsv('a;b\n1;"sin cerrar\n2;3\n', ';', 100)).toThrow(/fila 2/)
  })

  it('pasado el tope de filas se corta', async () => {
    const texto = 'Nombre;Precio\n' + 'Yerba;1500\n'.repeat(10_100)
    expect(await motivo(leerPlanilla('grande.csv', bytes(texto)))).toBe('demasiadas-filas')
  })
})

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const CATALOGO = [
  ['Código', 'Producto', 'Precio'],
  ['7790001234567', 'Yerba 1 kg', 3500],
  ['7790001234574', 'Azúcar & Cía <1 kg>', 1234.5],
]

describe('XLSX', () => {
  it('textos compartidos, numeros y caracteres que hay que escapar', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([{ nombre: 'Productos', filas: CATALOGO }]),
    )

    expect(p.tipo).toBe('xlsx')
    expect(p.hoja).toBe('Productos')
    expect(celdas(p)).toEqual([
      ['Código', 'Producto', 'Precio'],
      ['7790001234567', 'Yerba 1 kg', '3500'],
      ['7790001234574', 'Azúcar & Cía <1 kg>', '1234,5'],
    ])
    // El numero viaja MARCADO como numero, con el punto de la maquina.
    expect(p.filas[2]?.celdas[2]).toEqual({ n: '1234.5' })
  })

  it('comprimido con deflate, como lo guarda Excel', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([{ nombre: 'Productos', filas: CATALOGO }], { comprimir: true }),
    )
    expect(celdas(p)[1]).toEqual(['7790001234567', 'Yerba 1 kg', '3500'])
  })

  it('textos en la celda, prefijo de espacio de nombres y sin referencias', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([{ nombre: 'Hoja1', filas: CATALOGO }], {
        textosEnLinea: true,
        prefijo: 'x',
        sinReferencias: true,
      }),
    )
    expect(celdas(p)[2]).toEqual(['7790001234574', 'Azúcar & Cía <1 kg>', '1234,5'])
  })

  it('de una formula toma el ultimo valor calculado y no la ejecuta', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([
        {
          nombre: 'Productos',
          filas: [
            ['Nombre', 'Precio', 'Etiqueta'],
            [
              'Yerba',
              { formula: 'B3*1.21', valor: 4235 },
              { formula: 'CONCAT("A","B")', valor: 'AB' },
            ],
            ['Cafe', 3500, null],
          ],
        },
      ]),
    )
    expect(p.filas[1]?.celdas).toEqual(['Yerba', { n: '4235' }, 'AB'])
  })

  it('lee la primera hoja VISIBLE y nombra las demas', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([
        { nombre: 'Oculta', filas: [['x']], oculta: true },
        { nombre: 'Productos', filas: CATALOGO },
        { nombre: 'Notas', filas: [['y']] },
      ]),
    )
    expect(p.hoja).toBe('Productos')
    expect(p.otrasHojas).toEqual(['Oculta', 'Notas'])
  })

  it('corridas con formato, lectura fonetica y escapes de Office', async () => {
    const rico =
      '<c r="A2" t="inlineStr"><is><r><t>Dulce de </t></r><r><rPr><b/></rPr><t>leche</t></r>' +
      '<rPh sb="0" eb="1"><t>NO</t></rPh></is></c>'
    const escapado = '<c r="B2" t="inlineStr"><is><t>Queso_x000D_ rallado</t></is></c>'
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([
        {
          nombre: 'P',
          filas: [
            ['Nombre', 'Otro'],
            [{ xml: rico }, { xml: escapado }],
          ],
        },
      ]),
    )
    expect(p.filas[1]?.celdas).toEqual(['Dulce de leche', 'Queso\r rallado'])
  })

  it('los errores de Excel se conservan como texto para explicarlos despues', async () => {
    const p = await leerPlanilla(
      'lista.xlsx',
      escribirXlsx([
        {
          nombre: 'P',
          filas: [['Precio'], [{ xml: '<c r="A2" t="e"><f>1/0</f><v>#DIV/0!</v></c>' }]],
        },
      ]),
    )
    expect(p.filas[1]?.celdas).toEqual(['#DIV/0!'])
  })

  it('una fila salteada conserva el numero de Excel', async () => {
    const xml =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Nombre</t></is></c></row>' +
      '<row r="7"><c r="C7"><v>12</v></c></row>'
    const archivo = escribirXlsx([{ nombre: 'P', filas: [] }], {
      partesExtra: {
        'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xml}</sheetData></worksheet>`,
      },
    })
    const p = await leerPlanilla('lista.xlsx', archivo)
    expect(p.filas.map((f) => f.numero)).toEqual([1, 7])
    expect(p.filas[1]?.celdas).toEqual(['', '', { n: '12' }])
  })
})

// ---------------------------------------------------------------------------
// Lo que se rechaza
// ---------------------------------------------------------------------------

describe('Archivos que se rechazan', () => {
  it('vacio y demasiado grande', async () => {
    expect(await motivo(leerPlanilla('a.csv', new Uint8Array(0)))).toBe('vacio')
    expect(await motivo(leerPlanilla('a.csv', new Uint8Array(10 * 1024 * 1024 + 1)))).toBe(
      'demasiado-grande',
    )
  })

  it('un ejecutable, un PDF o una imagen, aunque se llamen .csv', async () => {
    expect(await motivo(leerPlanilla('lista.csv', bytes('MZ\u0090\u0000programa')))).toBe(
      'no-es-planilla',
    )
    expect(await motivo(leerPlanilla('lista.xlsx', bytes('%PDF-1.7 ...')))).toBe('no-es-planilla')
    expect(
      await motivo(leerPlanilla('lista.csv', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))),
    ).toBe('no-es-planilla')
  })

  it('un binario sin firma conocida no pasa por texto', async () => {
    expect(await motivo(leerPlanilla('lista.csv', Uint8Array.from([1, 2, 0, 0, 5, 6])))).toBe(
      'no-es-planilla',
    )
  })

  it('el Excel antiguo (.xls) o protegido con contraseña', async () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(await motivo(leerPlanilla('lista.xls', ole))).toBe('xls-antiguo')
  })

  it('macros: por la extension, por la parte que las guarda y por el tipo de contenido', async () => {
    const normal = escribirXlsx([{ nombre: 'P', filas: CATALOGO }])
    expect(await motivo(leerPlanilla('lista.xlsm', normal))).toBe('macros')

    const conVba = escribirXlsx([{ nombre: 'P', filas: CATALOGO }], {
      partesExtra: { 'xl/vbaProject.bin': new Uint8Array([1, 2, 3]) },
    })
    expect(await motivo(leerPlanilla('lista.xlsx', conVba))).toBe('macros')

    const declarado = escribirXlsx([{ nombre: 'P', filas: CATALOGO }], {
      tipoDelLibro: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    })
    expect(await motivo(leerPlanilla('lista.xlsx', declarado))).toBe('macros')
  })

  it('una planilla de LibreOffice (.ods)', async () => {
    const ods = empaquetarZip(
      [{ nombre: 'mimetype', datos: bytes('application/vnd.oasis.opendocument.spreadsheet') }],
      false,
    )
    expect(await motivo(leerPlanilla('lista.ods', ods))).toBe('ods')
  })

  it('un .zip cualquiera no es una planilla', async () => {
    const zip = empaquetarZip([{ nombre: 'fotos/a.txt', datos: bytes('hola') }], true)
    expect(await motivo(leerPlanilla('lista.xlsx', zip))).toBe('no-es-planilla')
  })

  it('cortado a la mitad', async () => {
    const archivo = escribirXlsx([{ nombre: 'P', filas: CATALOGO }], { comprimir: true })
    expect(await motivo(leerPlanilla('lista.xlsx', archivo.subarray(0, 400)))).toBe('corrupto')
  })

  it('con un byte cambiado: el CRC no coincide', async () => {
    const archivo = escribirXlsx([{ nombre: 'P', filas: CATALOGO }])
    const roto = Uint8Array.from(archivo)
    // Un byte adentro de los textos compartidos, que van guardados sin comprimir.
    const i = Buffer.from(roto).indexOf('Yerba')
    roto[i] = 0x5a
    expect(await motivo(leerPlanilla('lista.xlsx', roto))).toBe('corrupto')
  })

  it('con una parte cifrada', async () => {
    const archivo = Uint8Array.from(escribirXlsx([{ nombre: 'P', filas: CATALOGO }]))
    const vista = new DataView(archivo.buffer)
    // Bit 0 de las banderas de cada entrada del directorio central.
    for (let i = 0; i < archivo.length - 4; i++) {
      if (vista.getUint32(i, true) === 0x02014b50) vista.setUint16(i + 8, 0x0801, true)
    }
    expect(await motivo(leerPlanilla('lista.xlsx', archivo))).toBe('protegido')
  })

  it('una bomba: declara poco y se expande mucho, y se corta al pasar el tope', async () => {
    const ceros = new Uint8Array(5 * 1024 * 1024)
    const comprimido = new Uint8Array(deflateRawSync(ceros))
    const zip = Uint8Array.from(empaquetarZip([{ nombre: 'x.xml', datos: comprimido }], false))
    const [entrada] = [...leerIndice(zip).values()]
    if (!entrada) throw new Error('sin entrada')

    // El indice miente: dice que la parte descomprimida mide 100 bytes.
    const bomba = { ...entrada, metodo: 8, original: 100 }
    expect(await motivo(extraer(zip, bomba, 1024 * 1024))).toBe('demasiado-grande')
  })
})
