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

/** Todo el codigo que puede hablarle a Prisma. Sin migraciones ni pruebas. */
const CODIGO = [...archivosDe('src', 'scripts'), 'prisma/seed.ts', 'prisma/seed-demo.ts']

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
  {
    // Texto libre reemplazado por `contactName`, `phone` y `email`.
    campo: 'Supplier.contact',
    patron: /\bcontact:\s/,
    donde: CODIGO,
    muereEn: 'Fase 3D',
  },
  // `Product.supplierId` NO esta en esta lista, y conviene decir por que.
  //
  // Una busqueda de texto no sirve: `supplierId` es un campo legitimo de
  // `ProductSupplier`, de `ProductCostHistory` y de `PurchaseOrder`, y aparece
  // en los tres servicios con todo derecho. Cualquier expresion lo bastante
  // laxa para encontrar el uso prohibido encuentra tambien los tres usos
  // correctos, y una prueba que hay que silenciar deja de proteger.
  //
  // Se comprueba de la unica forma exacta que hay, que ademas es mas fuerte:
  // creando y editando un producto de verdad y mirando que la columna quede
  // NULL. Esta en tests/integration/compras.test.ts, "la columna congelada
  // Product.supplierId no se escribe".
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

    // Del nombre del campo al `Modelo.campo` de la lista de arriba, mas las
    // que se comprueban de otra forma y estan documentadas ahi mismo.
    const cubiertos = new Set([...CONGELADAS.map((c) => c.campo.split('.')[1]), 'supplierId'])

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

describe('La relacion congelada tampoco se lee', () => {
  it('`supplier:` no aparece en el select del catalogo', () => {
    // El proveedor del producto sale de `ProductSupplier`, no de la relacion
    // directa. Un `supplier: { select: ... }` dentro de CAMPOS_PRODUCTO seria
    // volver a la fuente vieja sin que nada lo avise.
    const servicio = leer('src/modules/products/service.ts')
    const campos = servicio.slice(
      servicio.indexOf('const CAMPOS_PRODUCTO'),
      servicio.indexOf('} as const', servicio.indexOf('const CAMPOS_PRODUCTO')),
    )

    expect(campos).toContain('suppliers:')
    expect(/^\s*supplier:\s*\{/m.test(campos), 'volvio a leerse Product.supplier').toBe(false)
  })
})
