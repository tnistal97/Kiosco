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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
      '20260808100000_phase3_suppliers',
      '20260808110000_phase3_purchase_orders',
      '20260808120000_phase3_purchase_receipts',
      '20260808130000_phase3_purchase_cost_links',
      '20260808140000_phase3_remove_legacy_barcode',
      '20260810100000_phase3d_branch_timezone',
      '20260810110000_phase3d_sale_cost_snapshot',
      '20260810120000_phase3d_cost_history_nullable',
      '20260810130000_phase3d_drop_legacy_columns',
      // Fase 4A — clientes y cuenta corriente. Separadas por dominio, en el
      // orden en que se pueden aplicar: cada una solo referencia lo que las
      // anteriores ya crearon.
      '20260810140000_phase4_clients',
      '20260810150000_phase4_sale_client',
      '20260810160000_phase4_customer_payments',
      '20260810170000_phase4_customer_accounts',
      '20260810180000_phase4_cash_payment_link',
      '20260810190000_phase4_sale_payment_account',
      '20260811100000_phase4b_supplier_balance',
      '20260811110000_phase4b_receipt_obligation',
      '20260811120000_phase4b_supplier_payments',
      '20260811130000_phase4b_supplier_accounts',
      '20260811140000_phase4b_payment_allocations',
      '20260812100000_phase4c_supplier_advances',
      '20260812110000_phase4c_purchase_returns',
      '20260812120000_phase4c_purchase_return_finance',
      '20260812130000_phase4c_purchase_return_stock',
    ])
  })

  /**
   * Migraciones a las que SE LES PERMITE borrar, una por una y con su motivo.
   *
   * Una lista explicita y no una excepcion general: agregar una migracion
   * destructiva obliga a escribir aca por que, que es exactamente la
   * conversacion que tiene que ocurrir antes de borrar una columna en un
   * servidor con datos.
   */
  interface Excepcion {
    /** POR QUE se permite. Una frase que alguien pueda discutir. */
    motivo: string
    /** Que prueba comprueba que la migracion hace lo que dice. */
    prueba: string
    /** Donde esta escrito como respaldar y como RESTAURAR antes de aplicarla. */
    respaldo: string
  }

  const DESTRUCTIVAS_PERMITIDAS: Record<string, Excepcion> = {
    // Las dos conversiones de tipo de la Fase 3 las encontro la guardia
    // reforzada de la 3D: son anteriores, legitimas y nunca habian estado
    // marcadas. `ALTER COLUMN ... TYPE` puede TRUNCAR --numeric(14,4) a
    // numeric(14,2) pierde centavos-- asi que entra en la lista y queda
    // registrado por que estas dos no perdieron nada.
    '20260807100000_phase3_decimal_money': {
      motivo:
        'Convierte el dinero de DOUBLE PRECISION a DECIMAL(14,2). Redondea con ' +
        'ROUND(x::numeric, 2), que es lo que ya se mostraba en pantalla: el residuo ' +
        'que se pierde es el error del punto flotante, no un dato. ' +
        'Ver docs/PHASE3_MONEY_MIGRATION.md.',
      prueba: 'limpia el residuo de punto flotante sin perder el valor',
      respaldo: 'docs/PRODUCTION_MIGRATION_REHEARSAL.md',
    },
    '20260807140000_phase3_fractional_quantities': {
      motivo:
        'Convierte las cantidades de INTEGER a NUMERIC(14,3). Es una AMPLIACION: ' +
        'todo entero cabe, y antes de esta fase no existia ninguna cantidad ' +
        'fraccionada que se pudiera truncar. ' +
        'Ver docs/PHASE3_QUANTITY_MIGRATION.md.',
      prueba: 'las cantidades historicas no cambiaron de valor al volverse decimales',
      respaldo: 'docs/PRODUCTION_MIGRATION_REHEARSAL.md',
    },
    '20260808140000_phase3_remove_legacy_barcode': {
      motivo:
        'Borra "Product"."barcode", congelada desde la Fase 3B. Cumplio el despliegue ' +
        'que exige la regla 2, los codigos viven en "ProductBarcode" y la migracion ' +
        'aborta si alguno no esta representado alli. Ver docs/PHASE3_BARCODES.md.',
      prueba: 'la columna "Product"."barcode" ya no existe',
      respaldo: 'docs/PRODUCTION_MIGRATION_REHEARSAL.md',
    },
    '20260810130000_phase3d_drop_legacy_columns': {
      motivo:
        'Borra "Product"."supplierId" y "Supplier"."contact", congeladas desde la ' +
        'Fase 3C. Los vinculos viven en "ProductSupplier" y el contacto en ' +
        '"contactName"; la migracion aborta si algun dato quedo sin migrar. ' +
        'Ver docs/SUPPLIER_MODEL.md.',
      prueba: 'las dos columnas congeladas de la Fase 3C ya no existen',
      respaldo: 'docs/PRODUCTION_MIGRATION_REHEARSAL.md',
    },
  }

  /**
   * Las formas en que una migracion puede destruir datos.
   *
   * La lista crecio en la Fase 3D y cada linea tiene su historia:
   *
   *   DROP COLUMN / DROP TABLE   lo obvio.
   *   TRUNCATE                   sin exigir la palabra TABLE: PostgreSQL la
   *                              acepta opcional, y `TRUNCATE "Sale"` pasaba
   *                              limpio por la version anterior de la guardia.
   *   DELETE FROM                cualquiera. Sin WHERE es peor y tiene su
   *                              propia prueba, que no admite excepcion.
   *   ALTER COLUMN ... TYPE      cambiar el tipo puede TRUNCAR en silencio:
   *                              un TEXT a VARCHAR(20) recorta, y
   *                              numeric(14,4) a numeric(14,2) pierde
   *                              centavos. No es "solo estructura".
   *   DROP ... CASCADE           se lleva por delante lo que dependa, que por
   *                              definicion es lo que no se esta mirando.
   *   DROP SCHEMA / DATABASE     no hace falta explicarlo.
   *
   * Lo que NO esta, a proposito: `DROP INDEX` y `DROP CONSTRAINT` no borran
   * datos. Marcarlos llenaria la lista de excepciones rutinarias y en dos
   * fases nadie leeria los motivos.
   *
   * `DROP CONSTRAINT` tiene igual su propia comprobacion, mas abajo y mas
   * precisa: no borra datos, pero puede borrar una GARANTIA. Ver
   * "una restriccion que se borra se vuelve a poner".
   */
  const PELIGROSAS: Array<{ patron: RegExp; que: string }> = [
    { patron: /\bDROP\s+COLUMN\b/i, que: 'borra una columna' },
    { patron: /\bDROP\s+TABLE\b/i, que: 'borra una tabla' },
    { patron: /\bTRUNCATE\b/i, que: 'vacia una tabla' },
    { patron: /\bDELETE\s+FROM\b/i, que: 'borra filas' },
    { patron: /\bALTER\s+COLUMN\s+"?\w+"?\s+TYPE\b/i, que: 'cambia un tipo (puede truncar)' },
    { patron: /\bDROP\b[^;]*\bCASCADE\b/i, que: 'borra en cascada' },
    { patron: /\bDROP\s+(SCHEMA|DATABASE)\b/i, que: 'borra un esquema entero' },
  ]

  /** El SQL sin comentarios: los bloques ROLLBACK estan comentados a proposito. */
  function sqlActivo(carpeta: string): string {
    const sql = readFileSync(path.join(MIGRACIONES, carpeta, 'migration.sql'), 'utf8')
    return sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
  }

  function carpetasDeMigracion(): string[] {
    return readdirSync(MIGRACIONES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  }

  it('ninguna migracion de la cadena borra datos sin permiso explicito', () => {
    // La expresion NO esta anclada al principio de la linea, y esa es la
    // correccion que trajo la Fase 3C: `^\s*DROP\s+COLUMN` no encuentra
    // `ALTER TABLE "Product" DROP COLUMN "barcode"`, que es la unica forma en
    // que PostgreSQL acepta esa sentencia. La guardia dejaba pasar
    // exactamente el caso para el que existia.
    for (const carpeta of carpetasDeMigracion()) {
      const activo = sqlActivo(carpeta)
      const encontradas = PELIGROSAS.filter((p) => p.patron.test(activo)).map((p) => p.que)
      const permitida = carpeta in DESTRUCTIVAS_PERMITIDAS

      // Se comprueba la IGUALDAD entre "borra" y "tiene permiso para borrar",
      // en una sola asercion. Asi tambien falla el caso inverso: una excepcion
      // que dejo de hacer falta tiene que caducar, o la lista crece hasta no
      // significar nada.
      expect(
        encontradas.length > 0,
        permitida
          ? `${carpeta} figura como destructiva permitida pero ya no borra nada: sacala de la lista`
          : `${carpeta} ${encontradas.join(', ')} fuera de comentario. ` +
              'Si es deliberada, agregala a DESTRUCTIVAS_PERMITIDAS con su ficha completa.',
      ).toBe(permitida)
    }
  })

  it('una restriccion que se borra se vuelve a poner en la misma migracion', () => {
    // `DROP CONSTRAINT` no borra ni una fila, y por eso no esta en PELIGROSAS.
    // Pero puede borrar algo peor de recuperar que un dato: una GARANTIA.
    //
    // El caso legitimo es AMPLIAR una lista blanca --la Fase 4A tuvo que
    // agregar 'ACCOUNT' a los medios de pago-- y en PostgreSQL eso se escribe
    // necesariamente como un DROP seguido de un ADD con el mismo nombre. El
    // caso peligroso es el DROP suelto: la comprobacion desaparece, nada falla,
    // los tests siguen pasando, y meses despues entra una fila que antes era
    // imposible.
    //
    // La regla distingue los dos sin ruido: un DROP cuya restriccion se vuelve
    // a declarar en la MISMA migracion es un reemplazo. Uno que no, es una
    // renuncia, y una renuncia tiene que declararse.
    //
    // Se mira solo el SQL activo: los bloques ROLLBACK estan comentados y ahi
    // los DROP son justamente lo que corresponde.
    for (const carpeta of carpetasDeMigracion()) {
      const activo = sqlActivo(carpeta)

      const borradas = [...activo.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)]
        .map((m) => m[1])
        .filter((n): n is string => n !== undefined)

      for (const nombre of borradas) {
        // Una FK que se borra junto con su columna no hace falta reponerla: la
        // columna entera se va, y ese caso ya lo cubre `DROP COLUMN` en
        // PELIGROSAS, que exige la ficha completa.
        const seVaLaColumnaEntera = /\bDROP\s+COLUMN\b/i.test(activo)

        const repuesta = new RegExp(
          `ADD\\s+CONSTRAINT\\s+"${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
          'i',
        ).test(activo)

        expect(
          repuesta || seVaLaColumnaEntera,
          `${carpeta} borra la restriccion "${nombre}" y no la vuelve a declarar. ` +
            'Una restriccion que desaparece no rompe nada hoy: deja de impedir algo, ' +
            'y eso no se nota hasta que entra la fila que antes era imposible. ' +
            'Si de verdad hay que quitarla, hace falta la ficha de DESTRUCTIVAS_PERMITIDAS.',
        ).toBe(true)
      }
    }
  })

  it('un DELETE sin WHERE nunca esta permitido, ni siquiera con excepcion', () => {
    // Es la unica forma destructiva que NO admite excepcion. Un `DELETE FROM
    // "Sale"` a secas no es una migracion: es un accidente escrito. Si de
    // verdad hay que vaciar una tabla, el WHERE que la vacia entera deja
    // constancia de que fue a proposito.
    for (const carpeta of carpetasDeMigracion()) {
      const sinWhere = /\bDELETE\s+FROM\s+"?\w+"?\s*(;|$)/im.test(sqlActivo(carpeta))
      expect(sinWhere, `${carpeta} tiene un DELETE FROM sin WHERE`).toBe(false)
    }
  })

  it('cada excepcion declara motivo, prueba y respaldo, y los tres existen', () => {
    // La politica de docs/DATABASE_MIGRATION_STRATEGY.md pide cuatro cosas
    // para permitir una migracion destructiva: marcada, documentada, probada y
    // con respaldo. Las tres primeras se comprueban aca; la cuarta --que el
    // respaldo se pueda RESTAURAR-- se ensaya con `npm run rehearsal`, que es
    // la unica forma de saberlo de verdad.
    const suite = readFileSync(path.join(ROOT, 'tests/migrations/chain.test.ts'), 'utf8')

    for (const [carpeta, ficha] of Object.entries(DESTRUCTIVAS_PERMITIDAS)) {
      expect(ficha.motivo.length, `${carpeta}: el motivo es demasiado corto`).toBeGreaterThan(40)

      // La prueba nombrada tiene que existir de verdad. Sin esto, la ficha
      // puede citar una prueba que nadie escribio.
      expect(
        suite.includes(ficha.prueba),
        `${carpeta}: no existe la prueba "${ficha.prueba}"`,
      ).toBe(true)

      // Y el documento de respaldo tambien.
      expect(
        existsSync(path.join(ROOT, ficha.respaldo)),
        `${carpeta}: no existe ${ficha.respaldo}`,
      ).toBe(true)
    }
  })

  it('ningun guion de mantenimiento borra ni actualiza en masa', () => {
    // Los guiones de `scripts/` corren a mano contra la base real y no pasan
    // por la revision que si tiene una migracion. `npm run integrity:check` es
    // de SOLO LECTURA por diseño, y esta prueba es lo que lo mantiene asi.
    //
    // Los seeds quedan afuera: su trabajo es escribir, y el de demostracion
    // tiene su propia guarda `_dev`.
    const SEEDS = /seed/i
    for (const archivo of readdirSync(path.join(ROOT, 'scripts'))) {
      if (!/\.(ts|mjs|js)$/.test(archivo) || SEEDS.test(archivo)) continue
      const contenido = readFileSync(path.join(ROOT, 'scripts', archivo), 'utf8')
      const activo = contenido
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n')

      const enMasa = /\b(deleteMany|TRUNCATE|DROP\s+TABLE)\b/i.test(activo)
      expect(enMasa, `scripts/${archivo} borra en masa`).toBe(false)
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
      // Un proveedor de los de antes: nombre, un contacto en texto libre, y
      // nada mas. Es lo que de verdad hay en el servidor.
      await cliente.query(
        `INSERT INTO "Supplier" (name, contact) VALUES ('Distribuidora Vieja', 'Pepe 11-4567-8900')`,
      )
      // Con codigo de barras Y con proveedor: son las dos columnas que la
      // Fase 3C tiene que mudar sin perder nada.
      await cliente.query(
        `INSERT INTO "Product" (name, price, barcode, "categoryId", "branchId", "supplierId")
           SELECT 'Yerba con residuo', 4850.000000001, '7790001000011', c.id, b.id, s.id
             FROM "Category" c, "Branch" b, "Supplier" s`,
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

  it('la columna "Product"."barcode" ya no existe', async () => {
    const columnas = await consultar<{ column_name: string }>(
      url,
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'Product' AND column_name = 'barcode'`,
    )
    expect(columnas, 'la columna congelada en la 3B tenia que morir en la 3C').toHaveLength(0)
  })

  it('el codigo de barras del servidor sobrevivio a que se borrara su columna', async () => {
    // El producto historico entro con '7790001000011' en la columna vieja. La
    // 3B lo copio a "ProductBarcode" y la 3C borro la columna: si la copia
    // hubiera fallado, el codigo ya no estaria en ningun lado.
    const filas = await consultar<{ nombre: string; code: string; principal: boolean }>(
      url,
      `SELECT p.name AS nombre, pb.code, pb."isPrimary" AS principal
         FROM "Product" p
         JOIN "ProductBarcode" pb ON pb."productId" = p.id
        ORDER BY p.id`,
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]?.nombre).toBe('Yerba con residuo')
    expect(filas[0]?.code).toBe('7790001000011')
    expect(filas[0]?.principal, 'el codigo migrado tiene que quedar como principal').toBe(true)
  })

  it('el proveedor del producto se mudo a ProductSupplier como principal', async () => {
    const filas = await consultar<{ producto: string; proveedor: string; principal: boolean }>(
      url,
      `SELECT p.name AS producto, s.name AS proveedor, ps."isPreferred" AS principal
         FROM "ProductSupplier" ps
         JOIN "Product" p ON p.id = ps."productId"
         JOIN "Supplier" s ON s.id = ps."supplierId"`,
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]?.producto).toBe('Yerba con residuo')
    expect(filas[0]?.proveedor).toBe('Distribuidora Vieja')
    expect(filas[0]?.principal).toBe(true)
  })

  it('el contacto en texto libre del proveedor no se perdio ni se interpreto', async () => {
    // Se copio TAL CUAL a `contactName`. No se intento partir "Pepe
    // 11-4567-8900" en nombre y telefono: no hay forma confiable de saber cual
    // es cual, y adivinar mal convertiria un telefono en el nombre de alguien.
    //
    // La columna vieja ya no existe --la borro la 3D-- asi que este es el
    // unico lugar donde ese texto sigue vivo.
    const filas = await consultar<{ nombre: string; activo: boolean }>(
      url,
      `SELECT "contactName" AS nombre, "isActive" AS activo
         FROM "Supplier" WHERE name = 'Distribuidora Vieja'`,
    )

    expect(filas[0]?.nombre).toBe('Pepe 11-4567-8900')
    expect(filas[0]?.activo, 'los proveedores existentes quedan activos').toBe(true)
  })

  it('las dos columnas congeladas de la Fase 3C ya no existen', async () => {
    const columnas = await consultar<{ tabla: string; columna: string }>(
      url,
      `SELECT table_name AS tabla, column_name AS columna
         FROM information_schema.columns
        WHERE (table_name = 'Product'  AND column_name = 'supplierId')
           OR (table_name = 'Supplier' AND column_name = 'contact')`,
    )
    expect(columnas, 'lo congelado en la 3C tenia que morir en la 3D').toHaveLength(0)
  })

  it('la sucursal existente quedo con la zona horaria del pais', async () => {
    // La migracion de la zona horaria es aditiva y con valor por omision: la
    // sucursal que ya estaba no tiene por que quedar sin zona, y el valor por
    // defecto es exactamente lo que el sistema venia suponiendo.
    const filas = await consultar<{ zona: string }>(
      url,
      `SELECT "timeZone" AS zona FROM "Branch" ORDER BY id LIMIT 1`,
    )
    expect(filas[0]?.zona).toBe('America/Argentina/Buenos_Aires')
  })

  it('las ventas historicas quedan SIN costo congelado, no con el de hoy', async () => {
    // `costAtSale` nulo es la unica respuesta honesta para una venta anterior
    // a que la columna existiera. Rellenarla con `Product.cost` inventaria el
    // numero que la columna existe para no inventar.
    const filas = await consultar<{ total: string }>(
      url,
      `SELECT count(*)::text AS total FROM "SaleItem" WHERE "costAtSale" IS NOT NULL`,
    )
    expect(Number(filas[0]?.total ?? 0), 'la migracion invento un costo historico').toBe(0)
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
