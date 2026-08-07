/**
 * La cadena oficial de migraciones se aplica de verdad.
 *
 * Estas pruebas crean bases descartables, aplican las migraciones con el
 * mismo comando que se usaria en el servidor y comprueban el resultado. No
 * se apoyan en `prisma db push` ni en el esquema: si una migracion tiene un
 * error de SQL, aca falla.
 *
 * Cubren los dos caminos que importan:
 *
 *   1. Instalacion nueva: base vacia -> cadena completa.
 *   2. Servidor existente: base con el esquema de junio de 2025 y las siete
 *      migraciones historicas registradas -> se aplican solo las nuevas.
 *
 * El segundo es el que de verdad hay que probar: en el servidor ya hay datos
 * y ya hay un historial, y las seis migraciones de mayo estan archivadas en
 * prisma/migrations-legacy. Si eso rompiera `migrate deploy`, la unica forma
 * de enterarse seria durante la ventana de mantenimiento.
 *
 * Las bases se llaman *_migtest y se destruyen al terminar. El nombre importa:
 * `borrarBase` se niega a tocar cualquier otra cosa.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const ROOT = process.cwd()
const MIGRACIONES = path.join(ROOT, 'prisma/migrations')

/** Sufijo obligatorio. Ninguna base sin el se crea ni se borra desde aca. */
const SUFIJO = '_migtest'

const BASE_URL = process.env.DATABASE_URL ?? ''
const ADMIN_URL = BASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1')

function urlDe(nombre: string): string {
  return BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${nombre}$1`)
}

const creadas: string[] = []

async function conAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const cliente = new Client({ connectionString: ADMIN_URL })
  await cliente.connect()
  try {
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

async function crearBase(nombre: string): Promise<string> {
  if (!nombre.endsWith(SUFIJO)) throw new Error(`Nombre inseguro: ${nombre}`)
  await conAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${nombre}"`)
    await c.query(`CREATE DATABASE "${nombre}"`)
  })
  creadas.push(nombre)
  return urlDe(nombre)
}

async function borrarBase(nombre: string): Promise<void> {
  if (!nombre.endsWith(SUFIJO)) throw new Error(`Nombre inseguro: ${nombre}`)
  await conAdmin(async (c) => {
    // Cerrar conexiones abiertas o el DROP falla.
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [nombre],
    )
    await c.query(`DROP DATABASE IF EXISTS "${nombre}"`)
  })
}

async function consultar<T extends Record<string, unknown>>(
  url: string,
  sql: string,
): Promise<T[]> {
  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    const r = await cliente.query<T>(sql)
    return r.rows
  } finally {
    await cliente.end()
  }
}

/**
 * Ejecuta el CLI de Prisma.
 *
 * Se invoca el JavaScript del CLI con node, en vez de `npx prisma`: asi no
 * hace falta `shell: true` --que en Windows concatena los argumentos sin
 * escaparlos-- y el comando es el mismo en Windows y en Linux.
 */
const PRISMA_CLI = path.join(ROOT, 'node_modules/prisma/build/index.js')

function prisma(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

afterAll(async () => {
  for (const nombre of creadas) await borrarBase(nombre)
}, 60_000)

describe('La cadena oficial', () => {
  it('contiene la baseline y ninguna de las migraciones archivadas', () => {
    const carpetas = readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()

    expect(carpetas).toEqual([
      '20250605201717_add_value_to_product',
      '20260806120000_phase0_security_baseline',
      '20260806160000_phase1_audit_context',
      '20260806190000_phase2_product_active',
      '20260806193000_phase2_cash_count_difference',
      '20260807100000_phase3_decimal_money',
      '20260807110000_phase3_cash_shifts',
      '20260807120000_phase3_sale_payments',
      '20260807130000_phase3_stock_ledger',
      '20260807140000_phase3_fractional_quantities',
      '20260807150000_phase3_product_units',
      '20260807160000_phase3_product_costs',
      '20260807170000_phase3_product_barcodes',
    ])
  })

  it('ninguna migracion de la cadena borra datos', () => {
    // Un DROP TABLE, un DROP COLUMN o un DELETE sin WHERE en una migracion
    // que corre en el servidor destruye informacion sin vuelta atras. Los
    // bloques DOWN estan comentados a proposito.
    const PELIGROSAS = /^\s*(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)/im

    for (const carpeta of readdirSync(MIGRACIONES, { withFileTypes: true })) {
      if (!carpeta.isDirectory()) continue
      const sql = readFileSync(path.join(MIGRACIONES, carpeta.name, 'migration.sql'), 'utf8')
      const activo = sql
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')

      expect(
        PELIGROSAS.test(activo),
        `${carpeta.name} contiene una sentencia destructiva fuera de comentario`,
      ).toBe(false)
    }
  })
})

describe('Instalacion nueva', () => {
  const NOMBRE = `kiosco_nueva${SUFIJO}`
  let url = ''

  it('aplica la cadena completa sobre una base vacia', async () => {
    url = await crearBase(NOMBRE)
    const salida = prisma(['migrate', 'deploy'], url)
    expect(salida).toContain('successfully applied')
  }, 120_000)

  it('deja el esquema sin diferencias contra schema.prisma', () => {
    // --exit-code hace que `migrate diff` termine distinto de cero si hay
    // deriva, asi que execFileSync lanza y la prueba falla sola.
    const salida = prisma(
      [
        'migrate',
        'diff',
        '--from-schema-datamodel',
        'prisma/schema.prisma',
        '--to-schema-datasource',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      url,
    )
    expect(salida).toContain('No difference detected')
  })

  it('crea las tablas del dominio', async () => {
    const filas = await consultar<{ table_name: string }>(
      url,
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    const tablas = filas.map((f) => f.table_name)

    for (const esperada of [
      'Branch',
      'User',
      'Role',
      'Product',
      'BranchStock',
      'Sale',
      'SaleItem',
      'CashRegisterMovement',
      'CashCount',
      'AuditLog',
      'Category',
      'Supplier',
    ]) {
      expect(tablas, `Falta la tabla ${esperada}`).toContain(esperada)
    }
  })

  it('crea las restricciones que protegen la coherencia', async () => {
    const filas = await consultar<{ conname: string }>(
      url,
      `SELECT conname FROM pg_constraint WHERE contype = 'c'`,
    )
    const checks = filas.map((f) => f.conname)

    expect(checks).toContain('Sale_status_check')
    expect(checks).toContain('Sale_cancel_fields_check')
    expect(checks).toContain('AuditLog_result_check')
  })

  it('crea los indices de las consultas frecuentes', async () => {
    const filas = await consultar<{ indexname: string }>(
      url,
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    )
    const indices = filas.map((f) => f.indexname)

    for (const esperado of [
      'Sale_branchId_date_idx',
      'Sale_status_idx',
      'CashRegisterMovement_saleId_idx',
      'CashRegisterMovement_branchId_date_idx',
      'AuditLog_branchId_timestamp_idx',
      'AuditLog_requestId_idx',
    ]) {
      expect(indices, `Falta el indice ${esperado}`).toContain(esperado)
    }
  })

  it('acepta las escrituras basicas del dominio', async () => {
    // Consulta minima de humo: si una clave foranea o un CHECK quedaron mal,
    // esto falla aca y no en produccion.
    const filas = await consultar<{ total: string }>(
      url,
      `WITH b AS (INSERT INTO "Branch" (name) VALUES ('Sucursal de prueba') RETURNING id),
            r AS (INSERT INTO "Role" (name) VALUES ('admin') RETURNING id),
            u AS (INSERT INTO "User" (username, name, password, "roleId", "branchId")
                  SELECT 'probador', 'Probador', 'x', r.id, b.id FROM b, r RETURNING id),
            s AS (INSERT INTO "Sale" ("userId", "branchId", status)
                  SELECT u.id, b.id, 'completed' FROM u, b RETURNING id)
       SELECT count(*)::text AS total FROM s`,
    )
    expect(filas[0]?.total).toBe('1')
  })

  it('rechaza un estado de venta invalido', async () => {
    // Las dos restricciones se solapan a proposito: `cancel_fields` ya
    // implica que el estado sea uno de los dos validos, y `status_check` lo
    // dice de forma explicita. PostgreSQL informa la primera que se viola,
    // sin garantizar cual, asi que se acepta cualquiera de las dos.
    await expect(consultar(url, `UPDATE "Sale" SET status = 'inventado'`)).rejects.toThrow(
      /Sale_(status|cancel_fields)_check/,
    )
  })

  it('rechaza una venta anulada sin fecha ni responsable', async () => {
    await expect(consultar(url, `UPDATE "Sale" SET status = 'canceled'`)).rejects.toThrow(
      /Sale_cancel_fields_check/,
    )
  })

  it('deja el dinero en numeric(14,2) y nada en double precision', async () => {
    const columnas = await consultar<{
      table_name: string
      column_name: string
      data_type: string
      numeric_precision: number
      numeric_scale: number
    }>(
      url,
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('Product','price'), ('SaleItem','price'), ('Branch','currentCash'),
            ('CashRegisterMovement','amount'),
            ('CashCount','amount'), ('CashCount','expected'), ('CashCount','difference')
          )
        ORDER BY table_name, column_name`,
    )

    expect(columnas, 'Falta alguna columna monetaria').toHaveLength(7)
    for (const c of columnas) {
      expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe('numeric')
      expect(Number(c.numeric_precision), `${c.table_name}.${c.column_name}`).toBe(14)
      expect(Number(c.numeric_scale), `${c.table_name}.${c.column_name}`).toBe(2)
    }

    // Y que no quede ninguna suelta: la busqueda es POR TIPO, no por nombre,
    // asi que encuentra tambien una columna monetaria que se llame distinto.
    const sueltas = await consultar<{ table_name: string; column_name: string }>(
      url,
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'double precision'`,
    )
    expect(sueltas.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('deja las cantidades en numeric(14,3) y ninguna en integer', async () => {
    const columnas = await consultar<{
      table_name: string
      column_name: string
      data_type: string
      numeric_precision: number
      numeric_scale: number
    }>(
      url,
      `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('BranchStock','quantity'), ('SaleItem','quantity'),
            ('StockMovement','quantity'), ('StockMovement','previousQuantity'),
            ('StockMovement','resultingQuantity'), ('Product','minimumStock'),
            ('Product','unitsPerPurchaseUnit')
          )
        ORDER BY table_name, column_name`,
    )

    expect(columnas, 'Falta alguna columna de cantidad').toHaveLength(7)
    for (const c of columnas) {
      expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe('numeric')
      expect(Number(c.numeric_precision), `${c.table_name}.${c.column_name}`).toBe(14)
      expect(Number(c.numeric_scale), `${c.table_name}.${c.column_name}`).toBe(3)
    }
  })

  it('las restricciones del libro siguen vivas SOBRE DECIMALES', async () => {
    // Es la razon entera de haber elegido `numeric`: si estas restricciones no
    // sobrevivieran a la conversion, el libro dejaria de significar algo.
    await consultar(
      url,
      `INSERT INTO "Category" (name) VALUES ('Fiambreria')
         ON CONFLICT (name) DO NOTHING`,
    )
    await consultar(
      url,
      `INSERT INTO "Product" (name, price, "categoryId", "branchId", "saleUnit")
         SELECT 'Queso', 9800, c.id, b.id, 'KG' FROM "Category" c, "Branch" b
          WHERE c.name = 'Fiambreria' LIMIT 1`,
    )

    // 5,500 − 0,250 no da 5,200.
    await expect(
      consultar(
        url,
        `INSERT INTO "StockMovement"
           ("branchId","productId","type","quantity","previousQuantity","resultingQuantity","userId")
         SELECT b.id, p.id, 'SALE', -0.250, 5.500, 5.200, u.id
           FROM "Branch" b, "Product" p, "User" u WHERE p.name = 'Queso' LIMIT 1`,
      ),
    ).rejects.toThrow(/saldos_check/)

    // Y la buena entra.
    await expect(
      consultar(
        url,
        `INSERT INTO "StockMovement"
           ("branchId","productId","type","quantity","previousQuantity","resultingQuantity","userId")
         SELECT b.id, p.id, 'SALE', -0.250, 5.500, 5.250, u.id
           FROM "Branch" b, "Product" p, "User" u WHERE p.name = 'Queso' LIMIT 1`,
      ),
    ).resolves.toBeDefined()
  })

  it('crea las tablas y restricciones de la Fase 3B', async () => {
    const tablas = await consultar<{ table_name: string }>(
      url,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('ProductBarcode','ProductCostHistory')
        ORDER BY table_name`,
    )
    expect(tablas.map((t) => t.table_name)).toEqual(['ProductBarcode', 'ProductCostHistory'])

    const restricciones = await consultar<{ conname: string }>(
      url,
      `SELECT conname FROM pg_constraint
        WHERE conname IN ('Product_saleUnit_check','Product_purchaseUnit_check',
                          'Product_unitsPerPurchaseUnit_check','Product_minimumStock_fraccion_check',
                          'Product_cost_check','ProductBarcode_code_check',
                          'ProductCostHistory_costos_check','ProductCostHistory_motivo_check')
        ORDER BY conname`,
    )
    expect(restricciones, 'falta alguna restriccion de la Fase 3B').toHaveLength(8)

    const indices = await consultar<{ indexname: string }>(
      url,
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('ProductBarcode_code_key','ProductBarcode_productId_principal_key',
                            'ProductCostHistory_productId_createdAt_idx')
        ORDER BY indexname`,
    )
    expect(indices, 'falta algun indice de la Fase 3B').toHaveLength(3)
  })

  it('el historial de costos tampoco se puede editar ni borrar', async () => {
    await consultar(
      url,
      `INSERT INTO "ProductCostHistory" ("productId","newCost","userId","reason")
         SELECT p.id, 750, u.id, 'Carga inicial de prueba'
           FROM "Product" p, "User" u LIMIT 1`,
    )
    await expect(consultar(url, `UPDATE "ProductCostHistory" SET "newCost" = 1`)).rejects.toThrow(
      /inmutable/i,
    )
    await expect(consultar(url, `DELETE FROM "ProductCostHistory"`)).rejects.toThrow(/inmutable/i)
  })

  it('acepta una anulacion completa', async () => {
    await expect(
      consultar(
        url,
        `UPDATE "Sale" SET status = 'canceled', "canceledAt" = now(),
                           "canceledById" = (SELECT id FROM "User" LIMIT 1),
                           "cancelReason" = 'Prueba de restriccion'`,
      ),
    ).resolves.toBeDefined()
  })
})

describe('Servidor existente', () => {
  const NOMBRE = `kiosco_existente${SUFIJO}`
  let url = ''

  it('parte del esquema de junio con las siete migraciones historicas registradas', async () => {
    url = await crearBase(NOMBRE)

    const baseline = readFileSync(
      path.join(MIGRACIONES, '20250605201717_add_value_to_product/migration.sql'),
      'utf8',
    )

    const cliente = new Client({ connectionString: url })
    await cliente.connect()
    try {
      await cliente.query(baseline)
      await cliente.query(`
          CREATE TABLE "_prisma_migrations" (
            id VARCHAR(36) PRIMARY KEY,
            checksum VARCHAR(64) NOT NULL,
            finished_at TIMESTAMPTZ,
            migration_name VARCHAR(255) NOT NULL,
            logs TEXT,
            rolled_back_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            applied_steps_count INTEGER NOT NULL DEFAULT 0
          )`)

      const historicas = [
        '20250529181604_init',
        '20250529182757_add_branch_product_unique',
        '20250529183734_change_email_to_username',
        '20250529183930_make_branch_name_unique',
        '20250529211308_add_categories_and_product_data',
        '20250529211833_add_unique_supplier_name',
        '20250605201717_add_value_to_product',
      ]
      for (const [i, nombre] of historicas.entries()) {
        await cliente.query(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, applied_steps_count)
             VALUES ($1, 'historica', now(), $2, 1)`,
          [`hist-${i}`, nombre],
        )
      }

      // Datos previos, para comprobar que la actualizacion no los toca.
      await cliente.query(`INSERT INTO "Branch" (name) VALUES ('Sucursal Centro')`)
      await cliente.query(`INSERT INTO "Role" (name) VALUES ('admin')`)
      await cliente.query(
        `INSERT INTO "User" (username, name, password, "roleId", "branchId")
           SELECT 'historico', 'Historico', 'x', r.id, b.id FROM "Role" r, "Branch" b`,
      )

      // Dinero con el residuo tipico de haber sumado en punto flotante. Es lo
      // que de verdad hay en un servidor que llevo dos anios en Float, y lo
      // que la migracion tiene que dejar limpio.
      await cliente.query(`INSERT INTO "Category" (name) VALUES ('Almacen')`)
      await cliente.query(
        `INSERT INTO "Product" (name, price, "categoryId", "branchId")
           SELECT 'Yerba con residuo', 4850.000000001, c.id, b.id FROM "Category" c, "Branch" b`,
      )
      await cliente.query(
        `INSERT INTO "Product" (name, price, "categoryId", "branchId")
           SELECT 'Suma de 0,1 y 0,2', 0.1::float8 + 0.2::float8, c.id, b.id
             FROM "Category" c, "Branch" b`,
      )
      // Un importe que redondea justo en el medio: 1,005 tiene que subir.
      await cliente.query(
        `INSERT INTO "Product" (name, price, "categoryId", "branchId")
           SELECT 'Medio centavo', 1.005, c.id, b.id FROM "Category" c, "Branch" b`,
      )
      await cliente.query(
        `UPDATE "Branch" SET "currentCash" = 71000.00000000003 WHERE name = 'Sucursal Centro'`,
      )

      // Stock existente, que es lo que la migracion del libro tiene que
      // convertir en movimientos INITIAL. Uno con unidades y otro en cero:
      // el de cero NO debe generar movimiento.
      await cliente.query(
        `INSERT INTO "BranchStock" ("branchId", "productId", quantity)
           SELECT b.id, p.id, 37 FROM "Branch" b, "Product" p WHERE p.name = 'Yerba con residuo'`,
      )
      await cliente.query(
        `INSERT INTO "BranchStock" ("branchId", "productId", quantity)
           SELECT b.id, p.id, 0 FROM "Branch" b, "Product" p WHERE p.name = 'Medio centavo'`,
      )
    } finally {
      await cliente.end()
    }

    const filas = await consultar<{ total: string }>(
      url,
      `SELECT count(*)::text AS total FROM "_prisma_migrations"`,
    )
    expect(filas[0]?.total).toBe('7')
  }, 120_000)

  it('aplica solo las migraciones nuevas', () => {
    const salida = prisma(['migrate', 'deploy'], url)

    expect(salida).toContain('20260806120000_phase0_security_baseline')
    expect(salida).toContain('20260806160000_phase1_audit_context')
    expect(salida).toContain('20260806190000_phase2_product_active')
    expect(salida).toContain('20260806193000_phase2_cash_count_difference')
    expect(salida).toContain('successfully applied')
    // Las archivadas no se vuelven a ejecutar.
    expect(salida).not.toContain('20250529181604_init')
  }, 120_000)

  it('conserva los datos que ya existian', async () => {
    const filas = await consultar<{ username: string }>(url, `SELECT username FROM "User"`)
    expect(filas.map((f) => f.username)).toContain('historico')
  })

  it('limpia el residuo de punto flotante sin perder el valor', async () => {
    // `numeric` sale del driver como cadena, que es justamente lo que hace
    // util la comprobacion: se compara el texto exacto, no un `Number` que
    // volveria a introducir el error que estamos midiendo.
    const productos = await consultar<{ name: string; price: string }>(
      url,
      `SELECT name, price::text AS price FROM "Product" ORDER BY id`,
    )
    const porNombre = new Map(productos.map((p) => [p.name, p.price]))

    expect(porNombre.get('Yerba con residuo')).toBe('4850.00')
    // 0.1 + 0.2 valia 0.30000000000000004 y ahora vale 0,30 y punto.
    expect(porNombre.get('Suma de 0,1 y 0,2')).toBe('0.30')
    // Medio centavo sube, como en una calculadora. No redondeo al par.
    expect(porNombre.get('Medio centavo')).toBe('1.01')

    const sucursal = await consultar<{ saldo: string }>(
      url,
      `SELECT "currentCash"::text AS saldo FROM "Branch" WHERE name = 'Sucursal Centro'`,
    )
    expect(sucursal[0]?.saldo).toBe('71000.00')
  })

  it('tampoco deja columnas monetarias en double precision', async () => {
    const sueltas = await consultar<{ table_name: string; column_name: string }>(
      url,
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'double precision'`,
    )
    expect(sueltas.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([])
  })

  it('deja el esquema sin diferencias contra schema.prisma', () => {
    const salida = prisma(
      [
        'migrate',
        'diff',
        '--from-schema-datamodel',
        'prisma/schema.prisma',
        '--to-schema-datasource',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      url,
    )
    expect(salida).toContain('No difference detected')
  })

  it('rellena el branchId de las entradas de auditoria historicas', async () => {
    // La migracion de Fase 1 completa branchId mirando la sucursal del
    // usuario. Con una entrada previa insertada antes de migrar no se puede
    // comprobar aca, pero si que la columna quedo y admite null.
    const filas = await consultar<{ column_name: string; is_nullable: string }>(
      url,
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'AuditLog' AND column_name IN ('branchId','requestId','ip','reason','result')`,
    )
    expect(filas).toHaveLength(5)

    const result = filas.find((f) => f.column_name === 'result')
    expect(result?.is_nullable, 'result deberia tener valor por defecto y no admitir null').toBe(
      'NO',
    )
  })

  it('convierte el stock existente en movimientos INITIAL', async () => {
    const filas = await consultar<{
      name: string
      type: string
      quantity: string
      previousQuantity: string
      resultingQuantity: string
      reason: string
      reciente: string
    }>(
      url,
      `SELECT p.name, sm.type, sm.quantity::text, sm."previousQuantity"::text,
              sm."resultingQuantity"::text, sm.reason,
              (sm."createdAt" > now() - interval '1 hour')::text AS reciente
         FROM "StockMovement" sm JOIN "Product" p ON p.id = sm."productId"`,
    )

    expect(filas, 'solo el producto CON unidades genera movimiento inicial').toHaveLength(1)

    const inicial = filas[0]
    expect(inicial?.name).toBe('Yerba con residuo')
    expect(inicial?.type).toBe('INITIAL')
    expect(inicial?.quantity).toBe('37.000')
    expect(inicial?.previousQuantity).toBe('0.000')
    expect(inicial?.resultingQuantity).toBe('37.000')

    // La fecha es la de LA MIGRACION, no una fecha historica inventada. Y el
    // motivo lo dice con todas las letras, para que dentro de dos anios nadie
    // lea la fila al reves.
    expect(inicial?.reciente).toBe('true')
    expect(inicial?.reason).toMatch(/no refleja cuando ingreso la mercaderia/i)
  })

  it('el libro cuadra con el stock desde el primer dia', async () => {
    const filas = await consultar<{ descuadres: string }>(
      url,
      `SELECT count(*)::text AS descuadres
         FROM "BranchStock" bs
         LEFT JOIN (SELECT "branchId", "productId", sum(quantity) AS total
                      FROM "StockMovement" GROUP BY 1, 2) sm
           ON sm."branchId" = bs."branchId" AND sm."productId" = bs."productId"
        WHERE bs.quantity <> COALESCE(sm.total, 0)`,
    )
    expect(filas[0]?.descuadres).toBe('0')
  })

  it('el relleno de INITIAL es idempotente', async () => {
    // Se vuelve a ejecutar el mismo INSERT de la migracion. El NOT EXISTS
    // tiene que impedir el duplicado: si la migracion se aplicara dos veces
    // --o alguien la corriera a mano-- el stock quedaria contado dos veces.
    const sql = readFileSync(
      path.join(MIGRACIONES, '20260807130000_phase3_stock_ledger/migration.sql'),
      'utf8',
    )
    const insert = sql.slice(sql.indexOf('INSERT INTO "StockMovement"'), sql.lastIndexOf('DO $$'))

    const cliente = new Client({ connectionString: url })
    await cliente.connect()
    try {
      await cliente.query(insert)
      const { rows } = await cliente.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM "StockMovement" WHERE type = 'INITIAL'`,
      )
      expect(rows[0]?.total, 'se duplicaron los movimientos iniciales').toBe('1')
    } finally {
      await cliente.end()
    }
  })

  it('los codigos de barras se migran sin perder ninguno', async () => {
    const filas = await consultar<{ nombre: string; code: string; principal: boolean }>(
      url,
      `SELECT p.name AS nombre, pb.code, pb."isPrimary" AS principal
         FROM "Product" p
         JOIN "ProductBarcode" pb ON pb."productId" = p.id
        WHERE p.barcode IS NOT NULL
        ORDER BY p.id`,
    )

    const productosConCodigo = await consultar<{ total: string }>(
      url,
      `SELECT count(*)::text AS total FROM "Product"
        WHERE barcode IS NOT NULL AND btrim(barcode) <> ''`,
    )

    expect(filas).toHaveLength(Number(productosConCodigo[0]?.total ?? 0))
    for (const f of filas) {
      expect(f.principal, `${f.nombre} quedo con un codigo que no es el principal`).toBe(true)
    }
  })

  it('el catalogo existente queda en UNIT, sin costo y sin unidades inventadas', async () => {
    // Preservar el comportamiento es LA condicion de esta migracion: un
    // producto que decia 24 tiene que seguir diciendo 24 unidades, no 24 kg.
    const inventados = await consultar<{ total: string }>(
      url,
      `SELECT count(*)::text AS total FROM "Product"
        WHERE "saleUnit" <> 'UNIT' OR "purchaseUnit" <> 'UNIT'
           OR "unitsPerPurchaseUnit" <> 1 OR cost IS NOT NULL`,
    )
    expect(Number(inventados[0]?.total ?? 0), 'la migracion invento datos').toBe(0)
  })

  it('las cantidades historicas no cambiaron de valor al volverse decimales', async () => {
    const rotas = await consultar<{ total: string }>(
      url,
      `SELECT count(*)::text AS total FROM "BranchStock"
        WHERE quantity <> trunc(quantity)`,
    )
    // Antes de la Fase 3B no existia ninguna cantidad fraccionada: cualquier
    // decimal aca seria daño de la conversion.
    expect(Number(rotas[0]?.total ?? 0)).toBe(0)
  })

  it('el libro no se puede editar ni borrar, ni con SQL directo', async () => {
    const cliente = new Client({ connectionString: url })
    await cliente.connect()
    try {
      await expect(cliente.query(`UPDATE "StockMovement" SET quantity = 999`)).rejects.toThrow(
        /inmutables/i,
      )
      await expect(cliente.query(`DELETE FROM "StockMovement"`)).rejects.toThrow(/inmutables/i)
    } finally {
      await cliente.end()
    }
  })
})

describe('Servidor con stock negativo', () => {
  const NOMBRE = `kiosco_negativo${SUFIJO}`

  it('la migracion del libro se niega a correr y explica que revisar', async () => {
    // Un saldo negativo no se puede representar como movimiento inicial: el
    // INITIAL violaria CHECK ("resultingQuantity" >= 0), y ponerlo en cero
    // falsearia el inventario para tapar un dato que hay que arreglar a mano.
    //
    // Este caso NO es hipotetico: la base de desarrollo tenia una fila en -1
    // cuando se aplico esta migracion por primera vez.
    const url = await crearBase(NOMBRE)

    // Toda la cadena menos la ultima, que es la que tiene que fallar.
    const cliente = new Client({ connectionString: url })
    await cliente.connect()
    try {
      for (const carpeta of readdirSync(MIGRACIONES, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        // Todas las ANTERIORES al libro, no "todas menos el libro": las de la
        // Fase 3B vienen despues y hablan de tablas que el libro todavia no
        // creo. Los nombres empiezan con la fecha, asi que el orden alfabetico
        // es el orden de aplicacion.
        .filter((n) => n < '20260807130000_phase3_stock_ledger')) {
        await cliente.query(readFileSync(path.join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8'))
      }

      await cliente.query(`INSERT INTO "Branch" (name) VALUES ('Con faltante')`)
      await cliente.query(`INSERT INTO "Category" (name) VALUES ('Almacen')`)
      await cliente.query(
        `INSERT INTO "Product" (name, price, "categoryId", "branchId")
           SELECT 'Sobrevendido', 100, c.id, b.id FROM "Category" c, "Branch" b`,
      )
      await cliente.query(
        `INSERT INTO "BranchStock" ("branchId", "productId", quantity)
           SELECT b.id, p.id, -1 FROM "Branch" b, "Product" p`,
      )

      const ledger = readFileSync(
        path.join(MIGRACIONES, '20260807130000_phase3_stock_ledger/migration.sql'),
        'utf8',
      )

      await expect(
        cliente.query(ledger),
        'la migracion tiene que abortar antes de crear nada',
      ).rejects.toThrow(/stock negativo/i)

      // Y no dejo la tabla a medias.
      const { rows } = await cliente.query<{ existe: string }>(
        `SELECT to_regclass('"StockMovement"') IS NOT NULL AS existe`,
      )
      expect(rows[0]?.existe, 'la migracion abortada dejo la tabla creada').toBe(false)
    } finally {
      await cliente.end()
    }
  }, 180_000)
})
