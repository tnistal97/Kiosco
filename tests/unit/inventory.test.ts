/**
 * Reglas del inventario que no necesitan base de datos.
 *
 * Dos grupos:
 *
 *   · el estado de reposicion, que se calcula y no se guarda;
 *   · la puerta unica, comprobada leyendo el codigo fuente.
 *
 * El segundo grupo es el que importa a largo plazo. `applyStockMovement` es la
 * unica funcion autorizada a escribir sobre `BranchStock`, y esa regla no se
 * sostiene sola: alcanza con que alguien con apuro escriba un `update` para
 * que el saldo y el libro empiecen a contar historias distintas, sin que nada
 * falle. Estas pruebas son la cerradura.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  SIGNO_DE_TIPO,
  TIPOS_DE_AJUSTE,
  TIPOS_MOVIMIENTO,
  esTipoDeAjuste,
  esTipoValido,
  etiquetaDeTipo,
} from '@/modules/inventory/movement-types'
import { minimoSugerido, estadoDeStock, tieneMinimo } from '@/modules/inventory/minimum'
import { enlaceDeReferencia, textoDeReferencia } from '@/modules/inventory/referencias'

const RAIZ = process.cwd()

describe('Estado de reposicion', () => {
  it('sin unidades es OUT, aunque no haya minimo', () => {
    expect(estadoDeStock('0.000', '0.000')).toBe('OUT')
    expect(estadoDeStock('0.000', '10.000')).toBe('OUT')
    expect(estadoDeStock('-1.000', '5.000'), 'un saldo negativo no deberia existir, pero no es OK').toBe('OUT') // prettier-ignore
  })

  it('con minimo cero nunca esta bajo minimo', () => {
    // Es la propiedad que hace honesta a la migracion: el catalogo existente
    // arranca en cero y NO empieza a gritar faltantes que nadie configuro.
    for (const cantidad of ['1.000', '2.000', '5.000', '10.000', '100.000', '10000.000']) {
      expect(estadoDeStock(cantidad, '0.000'), `${cantidad} unidades sin minimo`).toBe('OK')
    }
  })

  it('LOW incluye el borde: llegar al minimo ya es llegar', () => {
    expect(estadoDeStock('7.000', '6.000')).toBe('OK')
    expect(estadoDeStock('6.000', '6.000'), 'justo en el minimo ya hay que reponer').toBe('LOW')
    expect(estadoDeStock('1.000', '6.000')).toBe('LOW')
    expect(estadoDeStock('0.000', '6.000')).toBe('OUT')
  })

  it('el borde tambien se respeta con fracciones', () => {
    // La razon de que la comparacion sea entera: `0.1 + 0.2 <= 0.3` en punto
    // flotante da FALSO, y un producto que llego justo a su minimo no
    // apareceria en la lista de faltantes.
    expect(estadoDeStock('0.300', '0.300')).toBe('LOW')
    expect(estadoDeStock('0.301', '0.300')).toBe('OK')
    expect(estadoDeStock('3.499', '3.500')).toBe('LOW')
    expect(estadoDeStock('3.501', '3.500')).toBe('OK')
  })

  it('OUT y LOW son estados distintos, no grados del mismo', () => {
    // Un agotado no se puede vender; uno bajo minimo si. Mezclarlos en la
    // pantalla haria que el aviso urgente se confunda con el preventivo.
    expect(estadoDeStock('0.000', '6.000')).not.toBe(estadoDeStock('1.000', '6.000'))
  })

  it('cero es "sin minimo configurado", no "minimo cero"', () => {
    expect(tieneMinimo('0.000')).toBe(false)
    expect(tieneMinimo('1.000')).toBe(true)
    expect(tieneMinimo('0.001'), 'un gramo de minimo es un minimo').toBe(true)
  })

  it('el sugerido es una propuesta del formulario, no un umbral', () => {
    // Y depende de la unidad: diez unidades es una fila del estante, diez
    // kilos de queso es medio mostrador.
    expect(minimoSugerido('UNIT')).toBe('10.000')
    expect(minimoSugerido('KG')).toBe('1.000')
    // No se aplica solo: un producto con minimo cero sigue en OK.
    expect(estadoDeStock('9.000', '0.000')).toBe('OK')
  })
})

describe('Tipos de movimiento', () => {
  it('todo tipo tiene signo declarado y etiqueta', () => {
    for (const tipo of TIPOS_MOVIMIENTO) {
      expect(SIGNO_DE_TIPO[tipo], `falta el signo de ${tipo}`).toBeDefined()
      expect(etiquetaDeTipo(tipo), `falta la etiqueta de ${tipo}`).not.toBe(tipo)
    }
  })

  it('un tipo desconocido se muestra tal cual en vez de desaparecer', () => {
    // Que en pantalla diga `SOMETHING` es feo; que la fila quede vacia hace
    // que nadie se entere de que existe.
    expect(etiquetaDeTipo('SOMETHING')).toBe('SOMETHING')
    expect(esTipoValido('SOMETHING')).toBe(false)
  })

  it('los tipos de ajuste son un subconjunto, y no incluyen la venta', () => {
    // Si la pantalla de ajustes aceptara cualquier tipo, cualquiera podria
    // escribir una salida de mercaderia "por venta" sin venta que la respalde.
    for (const tipo of TIPOS_DE_AJUSTE) {
      expect(esTipoValido(tipo)).toBe(true)
    }
    expect(esTipoDeAjuste('SALE')).toBe(false)
    expect(esTipoDeAjuste('SALE_CANCEL')).toBe(false)
    expect(esTipoDeAjuste('INITIAL')).toBe(false)
    expect(esTipoDeAjuste('PURCHASE_RECEIPT')).toBe(false)
  })

  it('PURCHASE_RECEIPT lo emite la recepcion de compras, y NADIE mas', () => {
    expect(esTipoValido('PURCHASE_RECEIPT')).toBe(true)

    const emisores = archivosDe('src/modules')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => leer(f).includes("type: 'PURCHASE_RECEIPT'"))

    // Desde la Fase 3C hay exactamente UN emisor. Que sea uno solo es lo que
    // garantiza que toda entrada de mercaderia tenga una compra que la
    // respalde: si otro modulo pudiera emitirlo, habria unidades entrando al
    // deposito sin remito.
    expect(
      emisores,
      'la entrada de mercaderia sale de la recepcion de una compra, de ningun otro lado',
    ).toEqual(['src/modules/purchases/service.ts'])
  })

  it('PURCHASE_RECEIPT no figura entre los tipos de ajuste manual', () => {
    // Si estuviera, cualquiera con `stock.adjust` podria escribir una entrada
    // de mercaderia desde la pantalla de ajustes, sin orden y sin proveedor.
    expect(TIPOS_DE_AJUSTE as readonly string[]).not.toContain('PURCHASE_RECEIPT')
  })

  it('PURCHASE_RETURN lo emite la confirmacion de una devolucion, y NADIE mas', () => {
    expect(esTipoValido('PURCHASE_RETURN')).toBe(true)

    const emisores = archivosDe('src/modules')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => leer(f).includes("type: 'PURCHASE_RETURN'"))

    // El espejo exacto de `PURCHASE_RECEIPT`: un solo emisor es lo que
    // garantiza que toda salida de mercaderia al proveedor tenga una devolucion
    // que la respalde, con su costo historico y su credito.
    expect(
      emisores,
      'la salida al proveedor sale de una devolucion confirmada, de ningun otro lado',
    ).toEqual(['src/modules/purchases/service.returns.ts'])
  })

  it('PURCHASE_RETURN tampoco figura entre los tipos de ajuste manual', () => {
    // Si estuviera, cualquiera con `stock.adjust` podria sacar mercaderia
    // "devuelta al proveedor" sin devolucion, sin costo y sin credito.
    expect(TIPOS_DE_AJUSTE as readonly string[]).not.toContain('PURCHASE_RETURN')
    expect(esTipoDeAjuste('PURCHASE_RETURN')).toBe(false)
  })

  it('el catalogo de TypeScript y la restriccion de PostgreSQL dicen lo mismo', () => {
    // Dos definiciones de la misma verdad, en dos lenguajes. Si se separan, la
    // base rechaza filas que el servicio considera validas --o peor, al reves--.
    //
    // Se lee la ULTIMA definicion de la restriccion, no la de la Fase 3A: la
    // tabla de signos se reescribe entera cada vez que aparece un tipo nuevo
    // --lo hizo la 4C con `PURCHASE_RETURN`-- y anclar la prueba a la primera
    // version la volvia una prueba sobre historia, no sobre la regla vigente.
    const restriccion = ultimaTablaDeSignos()

    for (const tipo of TIPOS_MOVIMIENTO) {
      expect(restriccion, `${tipo} no figura en la restriccion de la base`).toContain(`'${tipo}'`)
    }

    // Y los signos, tipo por tipo.
    //
    // La tabla se escribe entera a mano, sin derivarla de `SIGNO_DE_TIPO`,
    // para que se vea la UNICA asimetria y no se cuele una segunda: la base
    // acepta `INITIAL` de cero unidades y el servicio no. Es deliberado --un
    // saldo de partida de cero es representable, pero no vale la pena
    // escribirlo-- y esta explicado en docs/INVENTORY_LEDGER.md.
    const EXIGIDO_POR_LA_BASE: Record<string, string> = {
      INITIAL: '>= 0',
      SALE: '< 0',
      SALE_CANCEL: '> 0',
      MANUAL_ADJUSTMENT: '<> 0',
      LOSS: '< 0',
      BREAKAGE: '< 0',
      INTERNAL_USE: '< 0',
      PURCHASE_RECEIPT: '> 0',
      PURCHASE_RETURN: '< 0',
    }

    // Se parte por RAMA (`OR`) y no por linea: una rama con cinco tipos no
    // entra en un renglon, y buscar el signo en la linea del tipo devolvia
    // "sin rama" para los que quedaban arriba del salto.
    const ramas = restriccion.split(/\bOR\b/)

    const discrepancias = TIPOS_MOVIMIENTO.map((tipo) => {
      const rama = ramas.find((r) => r.includes(`'${tipo}'`)) ?? ''
      const enLaBase = /(<=|>=|<>|<|>)\s*0/.exec(rama)?.[0].replace(/\s+/g, ' ') ?? 'sin rama'
      return { tipo, esperado: EXIGIDO_POR_LA_BASE[tipo], enLaBase }
    }).filter((f) => f.esperado !== f.enLaBase)

    expect(
      discrepancias,
      'El catalogo de TypeScript y la restriccion de PostgreSQL discrepan',
    ).toEqual([])

    // Y la tabla escrita a mano tiene que seguir siendo coherente con el
    // signo declarado: sin esto, cambiar `SIGNO_DE_TIPO` y olvidarse de la
    // base pasaria sin que nadie se entere.
    const incoherentes = TIPOS_MOVIMIENTO.filter((tipo) => {
      const sql = EXIGIDO_POR_LA_BASE[tipo] ?? ''
      const signo = SIGNO_DE_TIPO[tipo]
      if (signo === 'sale') return sql !== '< 0'
      if (signo === 'ambos') return sql !== '<> 0'
      return !sql.startsWith('>')
    })

    expect(incoherentes, 'un tipo cambio de signo en TypeScript y no en la base').toEqual([])
  })
})

describe('Referencias del historial', () => {
  it('la venta enlaza; el resto no inventa un enlace', () => {
    expect(enlaceDeReferencia('Sale', 4832)).toBe('/ventas?venta=4832')
    expect(enlaceDeReferencia('BranchStock', 12)).toBeNull()
    expect(enlaceDeReferencia(null, null)).toBeNull()
  })

  it('sin referencia se muestra un guion, no un hueco', () => {
    expect(textoDeReferencia(null, null)).toBe('—')
    expect(textoDeReferencia('Sale', 4832)).toBe('Venta #4832')
  })
})

// ---------------------------------------------------------------------------
// La puerta unica
// ---------------------------------------------------------------------------

/** Archivos de una carpeta, recursivo, con ruta relativa a la raiz. */
function archivosDe(carpeta: string): string[] {
  const salida: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const ruta = `${dir}/${entrada.name}`
      if (entrada.isDirectory()) recorrer(ruta)
      else salida.push(ruta)
    }
  }
  recorrer(carpeta)
  return salida
}

function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), 'utf8')
}

/**
 * La ULTIMA definicion de la tabla de signos del libro de inventario.
 *
 * Recorre las migraciones en orden y se queda con la definicion mas nueva. Las
 * lineas comentadas se descartan antes de buscar: el bloque ROLLBACK de la
 * migracion que reescribe la restriccion contiene una copia de la ANTERIOR, y
 * sin filtrar comentarios la prueba terminaria midiendo la version vieja.
 */
function ultimaTablaDeSignos(): string {
  const carpetas = readdirSync(join(RAIZ, 'prisma/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  let ultima = ''
  for (const carpeta of carpetas) {
    const sql = leer(`prisma/migrations/${carpeta}/migration.sql`)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')

    const desde = sql.lastIndexOf('ADD CONSTRAINT "StockMovement_tipo_signo_check"')
    if (desde === -1) continue

    const hasta = sql.indexOf(');', desde)
    ultima = sql.slice(desde, hasta === -1 ? undefined : hasta)
  }

  if (ultima === '') throw new Error('no se encontro la tabla de signos en ninguna migracion')
  return ultima
}

/** El unico archivo autorizado a escribir sobre BranchStock. */
const PUERTA = 'src/modules/inventory/service.ts'

describe('Nadie escribe stock fuera del servicio de inventario', () => {
  const fuentes = archivosDe('src').filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))

  it('ningun archivo usa un metodo de escritura de Prisma sobre branchStock', () => {
    // Las lecturas (findUnique, findMany, count, aggregate) estan permitidas
    // en todos lados: leer un saldo no lo corrompe.
    const escritura =
      /\bbranchStock\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\b/

    const culpables = fuentes.filter((f) => f !== PUERTA && escritura.test(leer(f)))

    expect(
      culpables,
      'Estos archivos escriben stock sin pasar por applyStockMovement(). ' +
        'El saldo va a quedar bien y el libro mal, y nada va a fallar. ' +
        'Ver docs/INVENTORY_LEDGER.md.',
    ).toEqual([])
  })

  it('ningun archivo escribe BranchStock con SQL crudo', () => {
    const escritura = /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"BranchStock"/i

    const culpables = fuentes.filter((f) => f !== PUERTA && escritura.test(leer(f)))

    expect(culpables, 'SQL crudo que escribe stock fuera del servicio de inventario').toEqual([])
  })

  it('la regla de ESLint que lo impide sigue configurada', () => {
    // El test de arriba detecta la infraccion despues de escrita; la regla la
    // detecta al escribirla, que es cuando todavia se puede evitar. Si alguien
    // borra la regla, este caso avisa.
    const config = leer('eslint.config.mjs')

    expect(config).toContain('PROHIBIDO_ESCRIBIR_STOCK')
    expect(config).toContain("object.property.name='branchStock'")
    expect(config).toContain('"BranchStock"')
    expect(
      config,
      'el servicio de inventario tiene que ser la unica excepcion declarada',
    ).toContain(PUERTA)
  })

  it('el disparador de inmutabilidad esta en la migracion', () => {
    const sql = leer('prisma/migrations/20260807130000_phase3_stock_ledger/migration.sql')
    expect(sql).toContain('CREATE TRIGGER "StockMovement_inmutable"')
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "StockMovement"')
  })
})
