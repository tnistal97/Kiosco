/**
 * Columnas muertas: las que se borraron y las que estan por morir.
 *
 * Dos clases de columna, con dos riesgos distintos:
 *
 *   BORRADA     ya no existe. `tsc` rechaza cualquier referencia, asi que la
 *               garantia es del compilador. Lo que se comprueba aca es que
 *               efectivamente no este --ni en el esquema ni en la base--.
 *
 *   CONGELADA   sigue existiendo. `tsc` NO protege: `supplierId: 3` compila
 *               perfecto. Es la que necesita una prueba, y es la razon de que
 *               este archivo exista.
 *
 * Esta prueba se escribio ANTES de la migracion que borro `Product.barcode`, y
 * encontro una referencia que una revision a ojo habia dado por muerta:
 * `scripts/insertData.ts` seguia haciendo `upsert` por esa columna.
 *
 * Ver docs/DATABASE_MIGRATION_STRATEGY.md, regla 2.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const RAIZ = process.cwd()
const ESQUEMA = readFileSync(path.join(RAIZ, 'prisma/schema.prisma'), 'utf8')

function archivosDe(...carpetas: string[]): string[] {
  const salida: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada)
      if (statSync(completo).isDirectory()) {
        if (entrada === 'node_modules' || entrada === 'migrations') continue
        recorrer(completo)
      } else if (/\.(ts|tsx|mjs)$/.test(entrada)) {
        salida.push(path.relative(RAIZ, completo).replace(/\\/g, '/'))
      }
    }
  }
  for (const c of carpetas) recorrer(path.join(RAIZ, c))
  return salida.sort()
}

const leer = (f: string) => readFileSync(path.join(RAIZ, f), 'utf8')

// ---------------------------------------------------------------------------
// Borradas
// ---------------------------------------------------------------------------

describe('Product.barcode ya no existe', () => {
  it('no figura en el esquema', () => {
    const modelo = ESQUEMA.slice(
      ESQUEMA.indexOf('model Product {'),
      ESQUEMA.indexOf('model ProductBarcode'),
    )
    expect(/^\s*barcode\s+String/m.test(modelo), 'la columna volvio al esquema').toBe(false)
  })

  it('tampoco Product.supplierId ni Supplier.contact, borradas en la Fase 3D', () => {
    // Las dos cumplieron el ciclo de la regla 2: la 3C dejo de usarlas, la 3D
    // las borro. A partir de aca la garantia es de `tsc`, igual que con
    // `barcode`: el cliente de Prisma no las declara.
    const producto = ESQUEMA.slice(
      ESQUEMA.indexOf('model Product {'),
      ESQUEMA.indexOf('model ProductBarcode'),
    )
    const proveedor = ESQUEMA.slice(
      ESQUEMA.indexOf('model Supplier {'),
      ESQUEMA.indexOf('model ProductSupplier'),
    )

    expect(/^\s*supplierId\s+Int/m.test(producto), 'Product.supplierId volvio').toBe(false)
    expect(/^\s*supplier\s+Supplier/m.test(producto), 'la relacion congelada volvio').toBe(false)
    expect(/^\s*contact\s+String/m.test(proveedor), 'Supplier.contact volvio').toBe(false)
    // Y lo que las reemplaza sigue en pie.
    expect(producto).toContain('suppliers    ProductSupplier[]')
    expect(proveedor).toContain('contactName String?')
  })

  it('quien la use no compila, y la unicidad se mudo a ProductBarcode', () => {
    // Desde que la columna no esta en el esquema, el cliente de Prisma no la
    // declara: cualquier `barcode:` dentro de un `Product` es un error de
    // `tsc --noEmit`, que corre en cada validacion. Esa es la garantia, y es
    // mas fuerte que cualquier busqueda de texto.
    //
    // Una busqueda textual aca seria PEOR que inutil: `barcode` sigue siendo
    // el nombre del campo en la API --sale de `ProductBarcode`-- y aparece con
    // todo derecho en los DTO, en el carrito, en la pantalla de venta y en la
    // bitacora. Marcarlos daria una lista de falsos positivos que alguien
    // terminaria silenciando entera.
    //
    // Lo que si se comprueba es que la unicidad no se haya perdido en la
    // mudanza: sin esto, dos productos podrian compartir un codigo.
    expect(ESQUEMA).toContain('@@unique([code], map: "ProductBarcode_code_key")')
  })
})

// ---------------------------------------------------------------------------
// Congeladas
// ---------------------------------------------------------------------------

/**
 * Las columnas congeladas, con la fase en que mueren.
 *
 * `patron` es la forma en que Prisma la escribiria, acotada para no cazar usos
 * legitimos del mismo nombre. `donde` limita la busqueda a las carpetas donde
 * un uso seria un error de verdad.
 */
const CONGELADAS: Array<{
  campo: string
  patron: RegExp
  donde: string[]
  muereEn: string
}> = [
  // `Supplier.contact` y `Product.supplierId` YA NO ESTAN: las borro la Fase
  // 3D y pasaron al bloque de columnas borradas de mas arriba. Quien las
  // escriba ahora no compila.
  {
    // Resto de una migracion de mayo de 2025. Nunca significo nada.
    campo: 'Product.value',
    patron: /\bvalue:\s*\d/,
    donde: ['prisma/seed.ts', 'prisma/seed-demo.ts', ...archivosDe('scripts')],
    muereEn: 'sin fecha: no molesta a nadie',
  },
]

describe('Columnas congeladas: existen, pero nadie las toca', () => {
  it.each(CONGELADAS)('$campo no se escribe desde ningun lado', ({ campo, patron, donde }) => {
    const culpables = donde.filter((archivo) => patron.test(leer(archivo)))
    expect(
      culpables,
      `${campo} esta congelada: no se lee y no se escribe. ` +
        'Si hace falta el dato, va por su reemplazo.',
    ).toEqual([])
  })

  it('toda columna marcada CONGELADA en el esquema figura en esta prueba', () => {
    // Anti-oxido: congelar una columna y olvidarse de agregarla aca dejaria
    // exactamente el agujero que este archivo existe para tapar.
    // `CONGELADA\b` y no `CONGELADA`: el plural "CONGELADAS" marca los campos
    // que se congelan al crear una LINEA de compra --purchaseUnit,
    // unitsPerPurchaseUnit-- que son otra cosa: se escriben una vez y despues
    // no se tocan, pero no son columnas muertas.
    //
    // Tampoco entra "Relacion CONGELADA": una relacion de Prisma no es una
    // columna, existe solo para sostener la que si lo es.
    const marcadas = [
      ...ESQUEMA.matchAll(/\/\/\/ CONGELADA\b[^\n]*\n(?:\s*\/\/\/[^\n]*\n)*\s*(\w+)/g),
    ]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined)

    // Del nombre del campo al `Modelo.campo` de la lista de arriba.
    const cubiertos = new Set(CONGELADAS.map((c) => c.campo.split('.')[1]))

    for (const campo of marcadas) {
      expect(
        cubiertos.has(campo),
        `"${campo}" esta marcada CONGELADA en schema.prisma pero no figura en CONGELADAS`,
      ).toBe(true)
    }

    // Y que la busqueda de arriba encuentre algo: una expresion que no case
    // con nada nunca fallaria, y la prueba pasaria sin comprobar nada.
    expect(marcadas.length, 'el esquema dejo de marcar columnas congeladas').toBeGreaterThan(0)
  })
})

describe('El proveedor del producto sale de la tabla nueva', () => {
  it('`supplier:` no aparece en el select del catalogo', () => {
    // El proveedor del producto sale de `ProductSupplier`. Un
    // `supplier: { select: ... }` dentro de CAMPOS_PRODUCTO ya ni siquiera
    // compilaria --la relacion se borro con la columna-- pero la prueba se
    // conserva: describe la intencion, y el dia que alguien agregue una
    // relacion directa nueva con el mismo nombre queda dicho por que no.
    const servicio = leer('src/modules/products/service.ts')
    const campos = servicio.slice(
      servicio.indexOf('const CAMPOS_PRODUCTO'),
      servicio.indexOf('} as const', servicio.indexOf('const CAMPOS_PRODUCTO')),
    )

    expect(campos).toContain('suppliers:')
    expect(/^\s*supplier:\s*\{/m.test(campos), 'volvio a leerse Product.supplier').toBe(false)
  })
})
