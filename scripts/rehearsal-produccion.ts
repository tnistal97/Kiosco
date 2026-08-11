/**
 * `npm run rehearsal:prodlike`
 *
 * Ensayo de la migracion sobre un conjunto de datos con la FORMA y el VOLUMEN
 * de produccion.
 *
 * En que se diferencia de `npm run rehearsal`: aquel demuestra que el respaldo
 * se puede restaurar y que la cadena cierra, partiendo de una base vacia o de
 * la demo. Este parte del ESTADO EXACTO EN QUE ESTA PRODUCCION HOY --el esquema
 * de la migracion 1, con 41 migraciones pendientes-- y lo carga con la forma
 * real de esos datos antes de migrar.
 *
 * POR QUE UN CONJUNTO SINTETICO Y NO UNA COPIA
 *
 * Obtener los datos reales exigiria bajarlos del servidor, y con ellos los
 * hashes de contraseña y los datos de las personas. Nada de eso hace falta
 * para probar una migracion: lo que la migracion toca es la FORMA --tipos,
 * restricciones, textos que hay que reconocer con una expresion regular-- y el
 * VOLUMEN. Las dos cosas se midieron en el servidor en modo lectura y estan
 * escritas abajo, con su fecha.
 *
 * Lo unico que se pierde es la sorpresa: un dato raro que exista en produccion
 * y que no hayamos previsto. Contra eso esta el precheck de
 * docs/PRODUCTION_DATA_PRECHECK.md, que corrio contra la base real.
 *
 * NUNCA toca produccion. Crea bases descartables terminadas en `_dev` y las
 * borra. Aborta si el nombre no es uno de los previstos.
 *
 * Uso:
 *   npm run rehearsal:prodlike           volumen igual al real
 *   npm run rehearsal:prodlike -- 20     veinte veces el real
 */

import './entorno'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'

// ---------------------------------------------------------------------------
// Lo que se midio en produccion. 11-ago-2026, solo lectura.
// Ver docs/PRODUCTION_CURRENT_STATE.md.
// ---------------------------------------------------------------------------

const PRODUCCION = {
  roles: 2,
  usuarios: 1,
  sucursales: 1,
  categorias: 1,
  proveedores: 1,
  productos: 379,
  /** 174 de 379 tienen codigo. Los otros 205 no se pueden escanear. */
  productosConCodigo: 174,
  stock: 379,
  ventas: 1130,
  renglones: 1701,
  movimientosDeCaja: 1130,
  bitacora: 5035,
  /** El 96,5 % de los cobros fue en efectivo; el resto, Mercado Pago. */
  proporcionEfectivo: 1090 / 1130,
  desde: '2025-10-03',
  hasta: '2025-12-06',
  tamanoMb: 11,
} as const

const ORIGEN = 'kiosco_prodlike_dev'
const RESTAURADA = 'kiosco_prodlike_restaurada_dev'
const DESCARTABLES = new Set([ORIGEN, RESTAURADA])

const ADMIN_URL =
  process.env.REHEARSAL_ADMIN_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/postgres?schema=public'

const BIN = process.env.PG_BIN ?? ''
const RAIZ = process.cwd()
const PRISMA = path.join(RAIZ, 'node_modules/prisma/build/index.js')
const MIGRACIONES = path.join(RAIZ, 'prisma/migrations')

const FACTOR = Math.max(1, Number(process.argv[2] ?? '1') || 1)

function urlDe(base: string): string {
  if (!DESCARTABLES.has(base)) {
    throw new Error(`El ensayo solo trabaja sobre bases descartables. "${base}" no lo es.`)
  }
  return ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${base}$1`)
}

function urlParaHerramientas(base: string): string {
  return urlDe(base)
    .replace(/[?&]schema=[^&]*/g, '')
    .replace(/\?$/, '')
}

function pg(programa: string, args: string[]): string {
  return execFileSync(BIN ? path.join(BIN, programa) : programa, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
}

function prismaCli(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA, ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function conAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const cliente = new Client({ connectionString: ADMIN_URL })
  await cliente.connect()
  try {
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

async function conBase<T>(base: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const cliente = new Client({ connectionString: urlDe(base) })
  await cliente.connect()
  try {
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

async function recrear(base: string): Promise<void> {
  if (!DESCARTABLES.has(base)) throw new Error(`No se recrea "${base}"`)
  await conAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`)
    await c.query(`CREATE DATABASE "${base}"`)
  })
}

async function borrar(base: string): Promise<void> {
  if (!DESCARTABLES.has(base)) return
  await conAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`)
  })
}

// ---------------------------------------------------------------------------
// 1. El estado inicial: exactamente el de produccion
// ---------------------------------------------------------------------------

/**
 * Aplica SOLO la primera migracion y la registra como aplicada, igual que la
 * tiene produccion.
 *
 * No se usa `prisma migrate deploy` acotado --no existe tal cosa--: se ejecuta
 * el SQL y se escribe la fila en `_prisma_migrations` con el checksum real del
 * archivo, que es el que produccion ya tiene guardado. Si no coincidiera,
 * `migrate deploy` se negaria a seguir, y esa negativa es justamente una de
 * las cosas que este ensayo comprueba.
 */
async function estadoDeProduccion(base: string): Promise<string> {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')

  const primera = readdirSync(MIGRACIONES)
    .filter((d) => /^\d{14}_/.test(d))
    .sort()[0]
  if (!primera) throw new Error('No hay migraciones')

  const sql = readFileSync(path.join(MIGRACIONES, primera, 'migration.sql'), 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')

  await conBase(base, async (c) => {
    await c.query(sql)
    await c.query(`
      CREATE TABLE "_prisma_migrations" (
        id                      VARCHAR(36) PRIMARY KEY,
        checksum                VARCHAR(64)  NOT NULL,
        finished_at             TIMESTAMPTZ,
        migration_name          VARCHAR(255) NOT NULL,
        logs                    TEXT,
        rolled_back_at          TIMESTAMPTZ,
        started_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
        applied_steps_count     INTEGER      NOT NULL DEFAULT 0
      )`)
    await c.query(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, $1, now(), $2, now(), 1)`,
      [checksum, primera],
    )
  })

  return primera
}

// ---------------------------------------------------------------------------
// 2. Los datos, con la forma real
// ---------------------------------------------------------------------------

/**
 * Todo se genera EN LA BASE con `generate_series`, no en JavaScript.
 *
 * Insertar 100.000 filas de a una desde el proceso tarda minutos y mide la
 * latencia del driver, no la migracion. Y hay una segunda razon, aprendida en
 * la Fase 4D: cuando el orden de las filas depende del plan que elija
 * PostgreSQL, el conjunto de datos deja de ser reproducible. Por eso cada id
 * se deriva del indice de la serie y nunca de un `ORDER BY` sobre otra tabla.
 */
async function cargar(base: string, factor: number): Promise<void> {
  const n = (x: number) => Math.round(x * factor)

  await conBase(base, async (c) => {
    await c.query(`
      INSERT INTO "Branch" ("name", "address", "currentCash")
      VALUES ('Sucursal Central', 'Av. Principal 123', 3818350)`)
    await c.query(`INSERT INTO "Role" ("name") VALUES ('admin'), ('vendedor')`)
    await c.query(`INSERT INTO "Category" ("name") VALUES ('General')`)
    // El proveedor tiene `contact` cargado, como en produccion: es la
    // condicion que hace ABORTAR a phase3d_drop_legacy_columns si la fase 3C
    // no lo hubiera copiado antes a `contactName`.
    await c.query(
      `INSERT INTO "Supplier" ("name", "contact") VALUES ('Default Supplier', 'Juan / 11-5555-0000')`,
    )
    // El hash es el de la contraseña "prodlike", generado una vez y fijo: no
    // hay ningun dato real aca.
    await c.query(`
      INSERT INTO "User" ("username", "name", "password", "roleId", "branchId")
      SELECT 'u' || i, 'Usuario ' || i,
             '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123456789',
             1, 1
        FROM generate_series(1, ${String(n(PRODUCCION.usuarios))}) AS i`)

    // Productos. El 46 % SIN codigo de barras, como en produccion: son los que
    // no se pueden escanear, y son los que el backfill de ProductBarcode saltea.
    const productos = n(PRODUCCION.productos)
    const conCodigo = n(PRODUCCION.productosConCodigo)
    await c.query(`
      INSERT INTO "Product" ("name", "barcode", "price", "categoryId", "branchId")
      SELECT 'Producto ' || i,
             CASE WHEN i <= ${String(conCodigo)} THEN '779' || lpad(i::text, 10, '0') END,
             round((100 + (i % 9000))::numeric, 2)::double precision,
             1, 1
        FROM generate_series(1, ${String(productos)}) AS i`)

    await c.query(`
      INSERT INTO "BranchStock" ("branchId", "productId", "quantity")
      SELECT 1, p."id", (p."id" * 7) % 926 FROM "Product" p`)

    // Ventas repartidas en el mismo rango de fechas que las reales.
    const ventas = n(PRODUCCION.ventas)
    await c.query(`
      INSERT INTO "Sale" ("userId", "branchId", "date", "createdAt", "isVerified")
      SELECT 1, 1,
             '${PRODUCCION.desde}'::timestamp
               + (i * interval '1 second'
                  * (extract(epoch from '${PRODUCCION.hasta}'::timestamp
                                       - '${PRODUCCION.desde}'::timestamp)
                     / ${String(ventas)})),
             '${PRODUCCION.desde}'::timestamp + (i * interval '1 minute'),
             false
        FROM generate_series(1, ${String(ventas)}) AS i`)

    // 1,5 renglones por venta, como el real (1701 / 1130). El producto se
    // elige por aritmetica sobre el id de la venta: sin ORDER BY, sin plan que
    // pueda cambiar el resultado.
    await c.query(`
      INSERT INTO "SaleItem" ("saleId", "productId", "quantity", "price")
      SELECT s."id",
             ((s."id" * 13 + k) % ${String(productos)}) + 1,
             1 + ((s."id" + k) % 3),
             round((100 + ((s."id" * 7 + k) % 9000))::numeric, 2)::double precision
        FROM "Sale" s
        CROSS JOIN generate_series(0, 1) AS k
       WHERE k = 0 OR s."id" % 2 = 0`)

    // El movimiento de caja de cada venta. DOS cosas que la migracion necesita:
    //
    //   - la descripcion "Venta #N", que es de donde phase0 recupera el vinculo
    //     entre el cobro y la venta. Es texto libre y es el unico hilo que
    //     existe: si el formato no coincide, las 1130 ventas migran sin pagos.
    //   - el importe EXACTO de la venta, para que el control de phase3 no
    //     encuentre ventas descuadradas.
    await c.query(`
      INSERT INTO "CashRegisterMovement"
             ("branchId", "userId", "amount", "paymentMethod", "description", "date", "type")
      SELECT 1, 1,
             COALESCE((SELECT sum(round(i."price"::numeric * i."quantity", 2))
                         FROM "SaleItem" i WHERE i."saleId" = s."id"), 0)::double precision,
             CASE WHEN s."id" % 100 < ${String(Math.round(PRODUCCION.proporcionEfectivo * 100))}
                  THEN 'efectivo' ELSE 'mercado_pago' END,
             'Venta #' || s."id",
             s."date",
             'sale'
        FROM "Sale" s`)

    await c.query(`
      INSERT INTO "AuditLog" ("userId", "tableName", "recordId", "actionType", "changes", "origin")
      SELECT 1,
             (ARRAY['BranchStock','Sale','Branch','Product'])[1 + (i % 4)],
             i,
             (ARRAY['update','create','delete','bulk_delete'])[1 + (i % 4)],
             jsonb_build_object('antes', i, 'despues', i + 1),
             'legacy'
        FROM generate_series(1, ${String(n(PRODUCCION.bitacora))}) AS i`)
  })
}

// ---------------------------------------------------------------------------
// 3. Medicion
// ---------------------------------------------------------------------------

interface Medida {
  migracion: string
  ms: number
  /** Nivel de bloqueo mas fuerte que toma, deducido del SQL. */
  bloqueo: string
  /** true si reescribe una tabla entera. Es lo que domina la ventana. */
  reescribe: boolean
}

/**
 * Clasifica el bloqueo leyendo el SQL, no adivinando por el nombre.
 *
 * `ALTER COLUMN ... TYPE` reescribe la tabla entera con ACCESS EXCLUSIVE: nadie
 * lee ni escribe mientras dura. `ADD COLUMN` con DEFAULT no reescribe desde
 * PostgreSQL 11, pero igual toma ACCESS EXCLUSIVE un instante. `CREATE INDEX`
 * sin CONCURRENTLY bloquea escrituras. Un `UPDATE` masivo no bloquea lecturas
 * pero si toma ROW EXCLUSIVE y puede tardar.
 */
function clasificar(sql: string): { bloqueo: string; reescribe: boolean } {
  const activo = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

  const reescribe = /ALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE/i.test(activo)
  if (reescribe) return { bloqueo: 'ACCESS EXCLUSIVE (reescribe la tabla)', reescribe: true }
  if (/ALTER\s+TABLE/i.test(activo)) return { bloqueo: 'ACCESS EXCLUSIVE', reescribe: false }
  if (/CREATE\s+(UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)/i.test(activo)) {
    return { bloqueo: 'SHARE (bloquea escrituras)', reescribe: false }
  }
  if (/^\s*(UPDATE|INSERT|DELETE)/im.test(activo)) {
    return { bloqueo: 'ROW EXCLUSIVE', reescribe: false }
  }
  return { bloqueo: 'ninguno relevante', reescribe: false }
}

async function medirMigraciones(base: string): Promise<Medida[]> {
  const { readdirSync, readFileSync } = await import('node:fs')

  const { rows } = await conBase(base, (c) =>
    c.query<{ migration_name: string; ms: string }>(`
      SELECT migration_name,
             round(extract(epoch from (finished_at - started_at)) * 1000)::text AS ms
        FROM "_prisma_migrations"
       ORDER BY started_at`),
  )

  const carpetas = new Set(readdirSync(MIGRACIONES).filter((d) => /^\d{14}_/.test(d)))

  return rows.map((r) => {
    const sql = carpetas.has(r.migration_name)
      ? readFileSync(path.join(MIGRACIONES, r.migration_name, 'migration.sql'), 'utf8')
      : ''
    return { migracion: r.migration_name, ms: Number(r.ms), ...clasificar(sql) }
  })
}

async function conteos(base: string): Promise<Record<string, number>> {
  const { rows } = await conBase(base, (c) =>
    c.query<{ tabla: string; filas: string }>(`
      SELECT 'Product' AS tabla, count(*)::text AS filas FROM "Product"
      UNION ALL SELECT 'Sale', count(*)::text FROM "Sale"
      UNION ALL SELECT 'SaleItem', count(*)::text FROM "SaleItem"
      UNION ALL SELECT 'SalePayment', count(*)::text FROM "SalePayment"
      UNION ALL SELECT 'CashRegisterMovement', count(*)::text FROM "CashRegisterMovement"
      UNION ALL SELECT 'StockMovement', count(*)::text FROM "StockMovement"
      UNION ALL SELECT 'ProductBarcode', count(*)::text FROM "ProductBarcode"
      UNION ALL SELECT 'AuditLog', count(*)::text FROM "AuditLog"`),
  )
  return Object.fromEntries(rows.map((r) => [r.tabla, Number(r.filas)]))
}

async function tamano(base: string): Promise<string> {
  const { rows } = await conBase(base, (c) =>
    c.query<{ t: string }>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS t`),
  )
  return rows[0]?.t ?? '?'
}

function seg(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Guion
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'prodlike-'))
  const respaldo = path.join(carpeta, 'antes-de-migrar.dump')
  const cronometro: Record<string, number> = {}
  const t = <T>(nombre: string, fn: () => T): T => {
    const a = Date.now()
    const r = fn()
    cronometro[nombre] = Date.now() - a
    return r
  }
  const ta = async <T>(nombre: string, fn: () => Promise<T>): Promise<T> => {
    const a = Date.now()
    const r = await fn()
    cronometro[nombre] = Date.now() - a
    return r
  }

  console.log(`\nENSAYO CON VOLUMEN DE PRODUCCION  (factor ${String(FACTOR)}×)\n`)

  try {
    // 1 ─ el estado en que esta produccion hoy
    await recrear(ORIGEN)
    const primera = await ta('esquema inicial', () => estadoDeProduccion(ORIGEN))
    console.log(`1. Esquema inicial: ${primera}, unica migracion aplicada. Igual que produccion.`)

    // 2 ─ los datos
    await ta('carga', () => cargar(ORIGEN, FACTOR))
    const antes = await conBase(ORIGEN, (c) =>
      c
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM "Sale"`)
        .then((r) => Number(r.rows[0]?.n ?? 0)),
    )
    console.log(
      `2. Datos cargados en ${seg(cronometro.carga ?? 0)}: ` +
        `${String(antes)} ventas, base de ${await tamano(ORIGEN)}.`,
    )

    // 3 ─ el respaldo PREVIO, que es el unico rollback real
    t('respaldo', () =>
      pg('pg_dump', ['--format=custom', '--file', respaldo, urlParaHerramientas(ORIGEN)]),
    )
    const bytes = statSync(respaldo).size
    console.log(`3. Respaldo: ${mb(bytes)} en ${seg(cronometro.respaldo ?? 0)}.`)

    // 4 ─ la cadena entera
    t('migracion', () => prismaCli(['migrate', 'deploy'], urlDe(ORIGEN)))
    const medidas = await medirMigraciones(ORIGEN)
    console.log(
      `4. Migracion: ${String(medidas.length)} migraciones en ${seg(cronometro.migracion ?? 0)}.`,
    )

    const lentas = [...medidas].sort((a, b) => b.ms - a.ms).slice(0, 8)
    console.log('\n   Las mas lentas:')
    for (const m of lentas) {
      console.log(`   ${String(m.ms).padStart(6)} ms  ${m.migracion.padEnd(46)} ${m.bloqueo}`)
    }
    const reescriben = medidas.filter((m) => m.reescribe)
    console.log(
      `\n   Reescriben una tabla entera: ${String(reescriben.length)} ` +
        `(${reescriben.map((m) => m.migracion.replace(/^\d+_/, '')).join(', ')})`,
    )

    // 5 ─ el resultado cierra
    const c = await conteos(ORIGEN)
    console.log(
      `\n5. Despues de migrar: ${String(c.SalePayment ?? 0)} pagos, ` +
        `${String(c.StockMovement ?? 0)} movimientos de stock, ` +
        `${String(c.ProductBarcode ?? 0)} codigos, base de ${await tamano(ORIGEN)}.`,
    )

    execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/integrity-check.ts'],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: urlDe(ORIGEN) },
        stdio: 'inherit',
      },
    )

    // 6 ─ el respaldo previo se puede restaurar: es el rollback
    await recrear(RESTAURADA)
    t('restauracion', () =>
      pg('pg_restore', [
        '--dbname',
        urlParaHerramientas(RESTAURADA),
        '--no-owner',
        '--no-privileges',
        respaldo,
      ]),
    )
    const ventasRestauradas = await conBase(RESTAURADA, (cl) =>
      cl
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM "Sale"`)
        .then((r) => Number(r.rows[0]?.n ?? 0)),
    )
    console.log(
      `\n6. Restauracion del respaldo PREVIO en ${seg(cronometro.restauracion ?? 0)}: ` +
        `${String(ventasRestauradas)} ventas ` +
        `(${ventasRestauradas === antes ? 'coincide' : 'NO COINCIDE'}).`,
    )
    if (ventasRestauradas !== antes) throw new Error('La restauracion no devolvio lo mismo')

    // ─ resumen para la ventana de mantenimiento
    console.log('\nVENTANA DE MANTENIMIENTO, medida:')
    for (const [k, v] of Object.entries(cronometro)) {
      console.log(`   ${k.padEnd(18)} ${seg(v).padStart(8)}`)
    }
    const critico = (cronometro.respaldo ?? 0) + (cronometro.migracion ?? 0)
    console.log(`   ${'CORTE (respaldo+migracion)'.padEnd(18)} ${seg(critico).padStart(8)}`)
    console.log('\nENSAYO COMPLETO.\n')
  } finally {
    await borrar(ORIGEN)
    await borrar(RESTAURADA)
    rmSync(carpeta, { recursive: true, force: true })
  }
}

main().catch((e: unknown) => {
  console.error('\nENSAYO FALLIDO:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
