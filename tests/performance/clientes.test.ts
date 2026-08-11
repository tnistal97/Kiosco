/**
 * Objetivo 38 — la cartera con volumen de verdad.
 *
 * Diez mil clientes y varias decenas de miles de movimientos. Es el volumen que
 * un comercio con dos anios de cuenta corriente puede tener, y es donde se ven
 * los problemas que con tres filas no existen.
 *
 * LO QUE SE MIDE, y por que cada uno:
 *
 *   · el listado paginado          no puede traer diez mil filas
 *   · el filtro "con deuda"        tiene que usar el indice, no recorrer todo
 *   · la busqueda del mostrador    se hace con el cliente enfrente
 *   · el saldo de un cliente       NO se calcula sumando su libro
 *   · el extracto paginado         un cliente viejo tiene cientos de filas
 *   · la cartera del reporte       agrega en la base, no en JavaScript
 *
 * Los topes son generosos a proposito: esto corre en una portatil junto con el
 * resto de la suite, y lo que se busca no es un numero fino sino detectar el
 * orden de magnitud equivocado --un N+1, un recorrido completo, una suma en
 * memoria--. Una consulta que hoy tarda 40 ms y manana 4.000 no pasa
 * desapercibida.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { GET as LISTAR } from '@/app/api/clients/route'
import { GET as BUSCAR } from '@/app/api/clients/buscar/route'
import { GET as EXTRACTO } from '@/app/api/clients/[id]/cuenta/route'
import { GET as REPORTE } from '@/app/api/reports/clientes/route'

/** Cuantos clientes. El objetivo pide diez mil. */
const CLIENTES = 10_000
/** Cuantos movimientos en total. Varias decenas de miles. */
const MOVIMIENTOS = 30_000

/** Tope generoso: lo que se busca es el orden de magnitud, no el milisegundo. */
const TOPE_MS = 1_500

let fx: Fixture
let clienteConHistorial = 0

/**
 * Lo medido, para imprimirlo al final.
 *
 * Una prueba de rendimiento que solo dice "por debajo del tope" obliga a
 * romperla para saber cuanto tarda en realidad. Los numeros se juntan aca y se
 * imprimen: sirven para el informe y para notar una subida que todavia pasa.
 */
const MEDIDO: Array<{ que: string; ms: number; tope: number }> = []

async function cuantoTarda(que: () => Promise<unknown>): Promise<number> {
  const arranque = Date.now()
  await que()
  return Date.now() - arranque
}

/** Comprueba el tope y deja anotado el numero. */
function anotar(que: string, ms: number, tope: number = TOPE_MS): void {
  MEDIDO.push({ que, ms, tope })
  expect(ms, `${que}: ${String(ms)} ms`).toBeLessThan(tope)
}

beforeAll(async () => {
  fx = await seedFixture()

  // Se insertan con SQL directo y en bloque: crearlos de a uno por la API
  // tardaria minutos y no probaria nada distinto. Lo que importa es el volumen
  // de LECTURA.
  //
  // El saldo se reparte a proposito: un tercio debe, un tercio esta al dia y un
  // tercio tiene saldo a favor. Con todos en cero, el filtro "con deuda"
  // devolveria vacio y el indice no se ejercitaria.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Client" ("branchId", "name", "phone", "document", "balance", "creditLimit", "updatedAt")
    SELECT ${String(fx.branchA.id)},
           'Cliente ' || i,
           '11-' || lpad((i % 10000)::text, 4, '0') || '-' || lpad((i % 9999)::text, 4, '0'),
           lpad((20000000 + i)::text, 8, '0'),
           CASE i % 3 WHEN 0 THEN (i % 500) * 100 WHEN 1 THEN 0 ELSE -((i % 50) * 10) END,
           CASE WHEN i % 4 = 0 THEN NULL ELSE 50000 END,
           now()
      FROM generate_series(1, ${String(CLIENTES)}) AS i
  `)

  // Y el libro que sostiene esos saldos. UN movimiento por cliente que tenga
  // saldo distinto de cero --asi la invariante cierra-- mas relleno hasta
  // llegar al volumen pedido, repartido entre los primeros clientes.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "CustomerAccountMovement"
      ("branchId", "clientId", "type", "amount", "previousBalance", "resultingBalance", "userId", "reason", "createdAt")
    SELECT ${String(fx.branchA.id)}, c."id", 'MANUAL_ADJUSTMENT',
           c."balance", 0, c."balance", ${String(fx.admin.id)},
           'Carga masiva para la prueba de volumen', now()
      FROM "Client" c
     WHERE c."branchId" = ${String(fx.branchA.id)} AND c."balance" <> 0
  `)

  // El relleno: pares de movimientos que se cancelan, para no mover ningun
  // saldo. Van todos al mismo cliente, que pasa a ser el del historial largo.
  const primero = await prisma.client.findFirstOrThrow({
    where: { branchId: fx.branchA.id, name: { startsWith: 'Cliente ' } },
    select: { id: true, balance: true },
    orderBy: { id: 'asc' },
  })
  clienteConHistorial = primero.id

  const yaHay = await prisma.customerAccountMovement.count()
  const faltan = Math.max(0, MOVIMIENTOS - yaHay)
  const pares = Math.floor(faltan / 2)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "CustomerAccountMovement"
      ("branchId", "clientId", "type", "amount", "previousBalance", "resultingBalance", "userId", "reason", "createdAt")
    SELECT ${String(fx.branchA.id)}, ${String(clienteConHistorial)},
           CASE WHEN par = 0 THEN 'MANUAL_ADJUSTMENT' ELSE 'MANUAL_ADJUSTMENT' END,
           CASE WHEN par = 0 THEN 100 ELSE -100 END,
           ${primero.balance.toFixed(2)}::numeric + CASE WHEN par = 0 THEN 0 ELSE 100 END,
           ${primero.balance.toFixed(2)}::numeric + CASE WHEN par = 0 THEN 100 ELSE 0 END,
           ${String(fx.admin.id)}, 'Relleno de la prueba de volumen', now()
      FROM generate_series(1, ${String(pares)}) AS i,
           generate_series(0, 1) AS par
  `)
}, 300_000)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('la cartera con diez mil clientes', () => {
  it('hay el volumen que se pidio', async () => {
    const [clientes, movimientos] = await Promise.all([
      prisma.client.count(),
      prisma.customerAccountMovement.count(),
    ])
    expect(clientes).toBeGreaterThanOrEqual(CLIENTES)
    expect(movimientos).toBeGreaterThanOrEqual(MOVIMIENTOS - 2)
  })

  it('el listado devuelve UNA pagina, no diez mil filas', async () => {
    const cookie = await sessionCookie(fx.admin)

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[]; pagination: { total: number } }>(
        LISTAR,
        '/api/clients?page=1&pageSize=25',
        { cookie },
      )
      expect(res.status).toBe(200)
      expect(res.body.data, 'la pagina no puede traer mas de lo pedido').toHaveLength(25)
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(CLIENTES)
    })

    anotar('listado paginado (25 de 10.000)', ms)
  })

  it('el filtro "con deuda" no recorre la tabla entera', async () => {
    const cookie = await sessionCookie(fx.admin)

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: Array<{ balance: string }> }>(
        LISTAR,
        '/api/clients?page=1&pageSize=25&deuda=conDeuda',
        { cookie },
      )
      expect(res.status).toBe(200)
      // Y filtra de verdad: todas las filas deben algo.
      for (const c of res.body.data) expect(Number(c.balance)).toBeGreaterThan(0)
    })

    anotar('filtro "con deuda"', ms)
  })

  it('la busqueda del mostrador responde rapido y devuelve poco', async () => {
    const cookie = await sessionCookie(fx.admin)

    const ms = await cuantoTarda(async () => {
      const res = await call<Array<{ name: string }>>(BUSCAR, '/api/clients/buscar?q=Cliente%209', {
        cookie,
      })
      expect(res.status).toBe(200)
      expect(res.body.length, 'el desplegable no puede traer cientos').toBeLessThanOrEqual(8)
    })

    // Es la consulta que se hace con el cliente enfrente: si tarda, se nota.
    anotar('busqueda del mostrador', ms)
  })

  it('el saldo NO se calcula sumando el libro', async () => {
    const cookie = await sessionCookie(fx.admin)

    // El cliente con treinta mil movimientos. Leer su saldo tiene que costar
    // UNA fila: si el listado sumara su libro, esta consulta se notaria.
    const ms = await cuantoTarda(async () => {
      const res = await call<{ balance: string }>(
        LISTAR,
        `/api/clients?page=1&pageSize=1&q=${encodeURIComponent('Cliente 1')}`,
        { cookie },
      )
      expect(res.status).toBe(200)
    })

    anotar('leer el saldo de un cliente', ms)
  })

  it('el extracto de un cliente con treinta mil movimientos se pagina', async () => {
    const cookie = await sessionCookie(fx.admin)

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[]; pagination: { total: number } }>(
        EXTRACTO,
        `/api/clients/${String(clienteConHistorial)}/cuenta?page=1&pageSize=20`,
        { cookie, params: { id: String(clienteConHistorial) } },
      )
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(20)
      expect(res.body.pagination.total).toBeGreaterThan(1000)
    })

    anotar('extracto paginado (20 de 30.000)', ms)
  })

  it('el reporte de cartera agrega en la base', async () => {
    const cookie = await sessionCookie(fx.admin)
    const hoy = new Date().toISOString().slice(0, 10)

    const ms = await cuantoTarda(async () => {
      const res = await call<{ cartera: { deudores: number } }>(
        REPORTE,
        `/api/reports/clientes?desde=${hoy}&hasta=${hoy}`,
        { cookie },
      )
      expect(res.status).toBe(200)
      // Con diez mil clientes repartidos en tercios, hay miles de deudores.
      expect(res.body.cartera.deudores).toBeGreaterThan(1000)
    })

    // Si el reporte trajera los clientes para sumarlos en JavaScript, diez mil
    // filas no cabrian en este tope.
    anotar('reporte de cartera', ms, TOPE_MS * 2)
  })

  it('y el libro sigue cuadrando con treinta mil movimientos', async () => {
    // La invariante no se afloja por volumen. Se comprueba por SQL, que es
    // como la comprueba la reconciliacion.
    const descuadres = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`
      SELECT count(*)::bigint AS n
        FROM "Client" c
        LEFT JOIN (
          SELECT "clientId", sum("amount") AS total
            FROM "CustomerAccountMovement" GROUP BY "clientId"
        ) m ON m."clientId" = c."id"
       WHERE c."balance" <> COALESCE(m.total, 0)
    `)

    expect(Number(descuadres[0]?.n ?? 0), 'la carga masiva dejo el libro descuadrado').toBe(0)
  })

  /**
   * Va al final y no en un `afterAll`: lo que se escribe desde un gancho
   * posterior no llega al informe.
   *
   * PARA VERLO hay que pedirselo a vitest, que por omision se guarda la
   * consola de los casos que pasan:
   *
   *   npx vitest run tests/performance/clientes.test.ts --reporter=verbose --disable-console-intercept
   *
   * Medicion del cierre de la Fase 4A, con 10.000 clientes y 30.000
   * movimientos, sobre una portatil y con el resto de la suite alrededor:
   *
   *   listado paginado (25 de 10.000)    62 ms
   *   filtro "con deuda"                 14 ms
   *   busqueda del mostrador             13 ms
   *   leer el saldo de un cliente        17 ms
   *   extracto paginado (20 de 30.000)   22 ms
   *   reporte de cartera                 14 ms
   */
  it('deja los tiempos por escrito', () => {
    const ancho = Math.max(...MEDIDO.map((m) => m.que.length))
    const lineas = MEDIDO.map(
      (m) =>
        `    ${m.que.padEnd(ancho)}  ${String(m.ms).padStart(5)} ms   (tope ${String(m.tope)})`,
    )

    console.log(
      `\n  CARTERA CON ${String(CLIENTES)} CLIENTES Y ${String(MOVIMIENTOS)} MOVIMIENTOS\n\n` +
        lineas.join('\n') +
        '\n',
    )

    // Que esten los seis: si alguien agrega una medicion y olvida anotarla,
    // esto lo dice en vez de dejar el informe corto sin avisar.
    expect(MEDIDO).toHaveLength(6)
  })
})
