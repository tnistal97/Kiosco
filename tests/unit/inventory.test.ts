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
import { MINIMO_SUGERIDO, estadoDeStock, tieneMinimo } from '@/modules/inventory/minimum'
import { enlaceDeReferencia, textoDeReferencia } from '@/modules/inventory/referencias'

const RAIZ = process.cwd()

describe('Estado de reposicion', () => {
  it('sin unidades es OUT, aunque no haya minimo', () => {
    expect(estadoDeStock(0, 0)).toBe('OUT')
    expect(estadoDeStock(0, 10)).toBe('OUT')
    expect(estadoDeStock(-1, 5), 'un saldo negativo no deberia existir, pero no es OK').toBe('OUT')
  })

  it('con minimo cero nunca esta bajo minimo', () => {
    // Es la propiedad que hace honesta a la migracion: el catalogo existente
    // arranca en cero y NO empieza a gritar faltantes que nadie configuro.
    for (const cantidad of [1, 2, 5, 10, 100, 10_000]) {
      expect(estadoDeStock(cantidad, 0), `${String(cantidad)} unidades sin minimo`).toBe('OK')
    }
  })

  it('LOW incluye el borde: llegar al minimo ya es llegar', () => {
    expect(estadoDeStock(7, 6)).toBe('OK')
    expect(estadoDeStock(6, 6), 'justo en el minimo ya hay que reponer').toBe('LOW')
    expect(estadoDeStock(1, 6)).toBe('LOW')
    expect(estadoDeStock(0, 6)).toBe('OUT')
  })

  it('OUT y LOW son estados distintos, no grados del mismo', () => {
    // Un agotado no se puede vender; uno bajo minimo si. Mezclarlos en la
    // pantalla haria que el aviso urgente se confunda con el preventivo.
    expect(estadoDeStock(0, 6)).not.toBe(estadoDeStock(1, 6))
  })

  it('cero es "sin minimo configurado", no "minimo cero"', () => {
    expect(tieneMinimo(0)).toBe(false)
    expect(tieneMinimo(1)).toBe(true)
  })

  it('el sugerido es una propuesta del formulario, no un umbral', () => {
    expect(MINIMO_SUGERIDO).toBeGreaterThan(0)
    // Y no se aplica solo: un producto con minimo cero sigue en OK.
    expect(estadoDeStock(MINIMO_SUGERIDO - 1, 0)).toBe('OK')
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

  it('PURCHASE_RECEIPT existe reservado, pero nada lo emite todavia', () => {
    expect(esTipoValido('PURCHASE_RECEIPT')).toBe(true)

    const emisores = archivosDe('src/modules')
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => leer(f).includes("type: 'PURCHASE_RECEIPT'"))

    expect(
      emisores,
      'la recepcion de compras es Fase 3C: el tipo esta reservado, nadie deberia emitirlo',
    ).toEqual([])
  })

  it('el catalogo de TypeScript y la restriccion de PostgreSQL dicen lo mismo', () => {
    // Dos definiciones de la misma verdad, en dos lenguajes. Si se separan, la
    // base rechaza filas que el servicio considera validas --o peor, al reves--.
    const sql = leer('prisma/migrations/20260807130000_phase3_stock_ledger/migration.sql')
    const restriccion = sql.slice(
      sql.indexOf('StockMovement_tipo_signo_check'),
      sql.indexOf('StockMovement_referencia_check'),
    )

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
    }

    const discrepancias = TIPOS_MOVIMIENTO.map((tipo) => {
      const rama = restriccion.split('\n').find((l) => l.includes(`'${tipo}'`)) ?? ''
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
