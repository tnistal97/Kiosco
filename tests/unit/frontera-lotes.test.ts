/**
 * La frontera del stock por lote, comprobada ejecutando la regla de verdad.
 *
 * `tests/unit/inventory.test.ts` mira el codigo ya escrito: recorre `src/` y
 * falla si encuentra una escritura fuera de la puerta. Eso detecta la
 * infraccion DESPUES de cometida.
 *
 * Esta prueba mira la otra mitad del problema: que la regla siga ENCENDIDA.
 * Una lista de selectores puede quedar mal escrita, o apagada sin querer --el
 * caso tipico es que dos bloques de `eslint.config.mjs` configuren
 * `no-restricted-syntax` para el mismo archivo, porque el segundo REEMPLAZA al
 * primero-- y nada avisaria: el recorrido de arriba seguiria en verde porque
 * nadie escribio todavia la linea prohibida.
 *
 * Por eso no se comprueba el TEXTO de la configuracion sino su EFECTO: se le
 * pide a ESLint la configuracion que resuelve para un archivo real del modulo
 * de lotes, y se corren esos mismos selectores contra fragmentos de codigo.
 *
 * Y comprueba las dos direcciones. Que la escritura falle es la mitad util; que
 * la LECTURA no falle es la otra: una regla que prohibiera leer
 * `BranchLotStock` obligaria a duplicar consultas y alguien terminaria
 * apagandola entera.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint, Linter } from 'eslint'

/**
 * Un archivo REAL del modulo de lotes: es el que mas cerca esta de la frontera
 * sin ser la puerta. Si algun dia deja de existir, esta prueba falla al
 * resolver la configuracion, que es exactamente lo que corresponde.
 */
const ARCHIVO_VIGILADO = 'src/modules/lots/service.ts'

/** La regla que sostiene las seis fronteras del proyecto. */
const REGLA = 'no-restricted-syntax'

let selectores: Linter.RuleEntry
const linter = new Linter()

/** Corre los selectores reales sobre un fragmento y devuelve los mensajes. */
function revisar(cuerpo: string): string[] {
  const mensajes = linter.verify(
    `async function f(tx, prisma) { ${cuerpo} }`,
    { rules: { [REGLA]: selectores } },
    'fragmento.js',
  )
  return mensajes.map((m) => m.message)
}

beforeAll(async () => {
  const eslint = new ESLint({ cwd: process.cwd() })
  const config = (await eslint.calculateConfigForFile(ARCHIVO_VIGILADO)) as {
    rules?: Record<string, Linter.RuleEntry>
  }
  const entrada = config.rules?.[REGLA]

  if (entrada === undefined) {
    throw new Error(
      `ESLint no aplica ${REGLA} a ${ARCHIVO_VIGILADO}. La frontera del stock ` +
        'por lote no esta protegida por nada.',
    )
  }
  selectores = entrada
}, 60_000)

describe('La regla que protege el stock por lote esta encendida', () => {
  it.each([
    ['update', 'await tx.branchLotStock.update({ where: { id: 1 }, data: { quantity: 5 } })'],
    ['updateMany', 'await tx.branchLotStock.updateMany({ data: { quantity: 5 } })'],
    ['upsert', 'await tx.branchLotStock.upsert({ where: { id: 1 }, create: {}, update: {} })'],
    ['create', 'await prisma.branchLotStock.create({ data: { quantity: 1 } })'],
    ['delete', 'await tx.branchLotStock.delete({ where: { id: 1 } })'],
    ['deleteMany', 'await tx.branchLotStock.deleteMany({ where: { id: 1 } })'],
  ])('branchLotStock.%s queda rechazado', (_metodo, codigo) => {
    const mensajes = revisar(codigo)

    expect(mensajes.length, 'la regla tiene que saltar').toBe(1)
    expect(mensajes[0]).toContain('applyStockMovement')
    expect(mensajes[0]).toContain('LOT_TRACKING_DESIGN.md')
  })

  it.each([
    ['create', 'await tx.lotAssignment.create({ data: { quantity: 8 } })'],
    ['createMany', 'await tx.lotAssignment.createMany({ data: [] })'],
    ['update', 'await tx.lotAssignment.update({ where: { id: 1 }, data: {} })'],
    ['delete', 'await tx.lotAssignment.delete({ where: { id: 1 } })'],
  ])('lotAssignment.%s queda rechazado', (_metodo, codigo) => {
    const mensajes = revisar(codigo)

    expect(mensajes.length, 'el libro de atribuciones tambien tiene puerta').toBe(1)
    expect(mensajes[0]).toContain('applyLotAssignment')
  })

  it.each([
    ['UPDATE', 'await tx.$executeRaw`UPDATE "BranchLotStock" SET "quantity" = 1`'],
    ['INSERT', 'await tx.$executeRaw`INSERT INTO "BranchLotStock" ("quantity") VALUES (1)`'],
    ['DELETE', 'await tx.$executeRaw`DELETE FROM "BranchLotStock" WHERE "id" = 1`'],
    ['atribuciones', 'await tx.$executeRaw`INSERT INTO "LotAssignment" ("quantity") VALUES (1)`'],
  ])('el SQL crudo que escribe (%s) queda rechazado', (_que, codigo) => {
    const mensajes = revisar(codigo)

    expect(mensajes.length, 'rodear Prisma con SQL crudo no esquiva la frontera').toBe(1)
    expect(mensajes[0]).toContain('SQL crudo')
  })

  /**
   * La otra direccion. Sin estos casos, "endurecer" la regla hasta prohibir
   * cualquier mencion a la tabla pasaria inadvertido, y la frontera dejaria de
   * significar "no la escribas" para significar "no la mires".
   */
  it.each([
    ['findMany', 'await tx.branchLotStock.findMany({ where: { productId: 1 } })'],
    ['findUnique', 'await tx.branchLotStock.findUnique({ where: { id: 1 } })'],
    ['count', 'await tx.branchLotStock.count()'],
    ['aggregate', 'await tx.branchLotStock.aggregate({ _sum: { quantity: true } })'],
    ['atribuciones', 'await tx.lotAssignment.findMany({ where: { lotId: 1 } })'],
    ['SELECT crudo', 'await tx.$queryRaw`SELECT sum("quantity") FROM "BranchLotStock"`'],
  ])('la LECTURA (%s) sigue permitida', (_que, codigo) => {
    expect(revisar(codigo), 'leer un saldo no lo corrompe').toEqual([])
  })

  /**
   * Las fronteras anteriores comparten la misma regla, y ese es el punto
   * delicado: un bloque nuevo que liste solo los selectores de lotes apagaria
   * los cuatro de antes sin romper ninguna prueba de lotes.
   */
  it.each([
    ['stock del producto', 'await tx.branchStock.update({ where: { id: 1 }, data: {} })'],
    ['saldo del cliente', 'await tx.client.update({ where: { id: 1 }, data: { balance: 0 } })'],
    ['saldo del proveedor', 'await tx.supplier.update({ where: { id: 1 }, data: { balance: 0 } })'],
  ])('y la frontera anterior de %s sigue en pie', (_que, codigo) => {
    expect(revisar(codigo).length, 'agregar una frontera no puede apagar las otras').toBe(1)
  })
})
