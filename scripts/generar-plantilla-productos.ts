/**
 * Genera `public/productos-ejemplo.xlsx`, la plantilla de Productos → Importar.
 *
 *   npm run plantilla:productos
 *
 * Tres productos inventados, con codigos que no pueden existir en ningun
 * comercio (`EJEMPLO-001`): si alguien importa la plantilla tal cual, lo que
 * queda cargado se reconoce a simple vista y no pisa nada real.
 *
 * La columna del codigo va con formato Texto. Es el consejo mas util que se le
 * puede dar a quien arma su lista: un codigo de barras guardado como numero
 * pierde los ceros de adelante y, si es largo, termina en notacion cientifica.
 *
 * tests/unit/importacion-plantilla.test.ts comprueba que el archivo que queda
 * se lea con el mismo lector de la aplicacion y mapee solo sus ocho columnas.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { escribirXlsx, type CeldaAEscribir } from './lib/xlsx-escritor'

const ENCABEZADOS: CeldaAEscribir[] = [
  'Código de barras',
  'Nombre',
  'Categoría',
  'Precio de venta',
  'Costo',
  'Stock',
  'Stock mínimo',
  'Unidad',
]

const PRODUCTOS: CeldaAEscribir[][] = [
  ['EJEMPLO-001', 'Yerba de ejemplo 1 kg', 'Almacén', 3500, 2600, 24, 6, 'unidad'],
  ['EJEMPLO-002', 'Gaseosa de ejemplo 2,25 L', 'Bebidas', 2800, 2000, 12, 6, 'unidad'],
  ['EJEMPLO-003', 'Queso de ejemplo (por kilo)', 'Fiambrería', 9800, 7000, 3.5, 1, 'kg'],
]

const destino = path.join(process.cwd(), 'public', 'productos-ejemplo.xlsx')

writeFileSync(
  destino,
  escribirXlsx(
    [
      {
        nombre: 'Productos',
        filas: [ENCABEZADOS, ...PRODUCTOS],
        anchos: [20, 34, 16, 16, 12, 10, 14, 10],
        columnasDeTexto: [0],
        encabezadoEnNegrita: true,
      },
    ],
    { comprimir: true },
  ),
)

console.log(`Plantilla escrita en ${path.relative(process.cwd(), destino)}`)
