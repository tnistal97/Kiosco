/**
 * `npm run rehearsal`
 *
 * Ensayo completo de la migración a producción, sobre bases DESCARTABLES.
 *
 * Lo que demuestra, en este orden:
 *
 *   1. se puede RESPALDAR                     `pg_dump`
 *   2. la cadena se aplica sobre el esquema anterior
 *   3. el resultado CIERRA                    `integrity:check`
 *   4. las consultas basicas siguen andando   humo
 *   5. el respaldo se puede RESTAURAR EN OTRA BASE  ← la mitad que falta
 *   6. lo restaurado es igual a lo respaldado
 *
 * El punto 5 es el motivo de que este guion exista. Saber hacer un `pg_dump`
 * no es tener respaldo: tener respaldo es haber restaurado uno y haber
 * comprobado que lo que salio es lo que habia entrado. Un archivo que nunca se
 * abrio es una suposicion.
 *
 * NUNCA toca la base productiva. Crea `kiosco_rehearsal_origen` y
 * `kiosco_rehearsal_restaurada`, las usa y las borra. Aborta si la URL apunta
 * a algo que no se llama asi.
 *
 * Ver docs/PRODUCTION_MIGRATION_REHEARSAL.md.
 */

// Carga `.env.local` al importarse. Ver `scripts/entorno.ts`.
import './entorno'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'

// Los nombres TERMINAN EN `_dev` a proposito: es lo que exige la guarda del
// seed de demostracion, y el ensayo no la afloja. Que una herramienta de
// prueba tenga que pedir permiso para escribir es la garantia, no un estorbo.
const ORIGEN = 'kiosco_rehearsal_origen_dev'
const RESTAURADA = 'kiosco_rehearsal_restaurada_dev'

/** Los nombres permitidos. Cualquier otro aborta antes de conectar. */
const DESCARTABLES = new Set([ORIGEN, RESTAURADA])

const ADMIN_URL =
  process.env.REHEARSAL_ADMIN_URL ??
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/postgres?schema=public'

const BIN = process.env.PG_BIN ?? ''
const RAIZ = process.cwd()
const PRISMA = path.join(RAIZ, 'node_modules/prisma/build/index.js')

function urlDe(base: string): string {
  if (!DESCARTABLES.has(base)) {
    throw new Error(`El ensayo solo trabaja sobre bases descartables. "${base}" no lo es.`)
  }
  return ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${base}$1`)
}

/**
 * La misma URL sin `?schema=public`.
 *
 * `pg_dump` y `pg_restore` rechazan ese parametro --"invalid URI query
 * parameter"-- porque es una invencion de Prisma, no del protocolo. La
 * aplicacion lo necesita; las herramientas de PostgreSQL, no.
 */
function urlParaHerramientas(base: string): string {
  return urlDe(base)
    .replace(/[?&]schema=[^&]*/g, '')
    .replace(/\?$/, '')
}

function pg(programa: string, args: string[], entorno: Record<string, string> = {}): string {
  return execFileSync(BIN ? path.join(BIN, programa) : programa, args, {
    encoding: 'utf8',
    env: { ...process.env, ...entorno },
    maxBuffer: 256 * 1024 * 1024,
  })
}

function prisma(args: string[], url: string): string {
  return execFileSync(process.execPath, [PRISMA, ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
    maxBuffer: 32 * 1024 * 1024,
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

async function recrear(base: string): Promise<void> {
  if (!DESCARTABLES.has(base)) throw new Error(`No se recrea "${base}"`)
  await conAdmin(async (c) => {
    // `WITH (FORCE)` corta las conexiones colgadas de una corrida anterior.
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

/** Una foto del contenido que se pueda comparar antes y despues. */
async function huella(url: string): Promise<string> {
  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    const { rows } = await cliente.query<{ tabla: string; filas: string; suma: string }>(`
      SELECT 'Product'::text AS tabla, count(*)::text AS filas,
             COALESCE(sum("price"), 0)::text AS suma FROM "Product"
      UNION ALL
      SELECT 'Sale', count(*)::text, COALESCE(sum("total"), 0)::text FROM "Sale"
      UNION ALL
      SELECT 'SaleItem', count(*)::text, COALESCE(sum("quantity"), 0)::text FROM "SaleItem"
      UNION ALL
      SELECT 'StockMovement', count(*)::text, COALESCE(sum("quantity"), 0)::text
        FROM "StockMovement"
      UNION ALL
      SELECT 'CashRegisterMovement', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "CashRegisterMovement"
      UNION ALL
      SELECT 'PurchaseReceiptItem', count(*)::text, COALESCE(sum("stockQuantity"), 0)::text
        FROM "PurchaseReceiptItem"
      UNION ALL
      -- La cuenta corriente entra en la huella desde la Fase 4A. Sin estas
      -- tres, un respaldo que perdiera el libro de clientes se restauraria y
      -- la comparacion diria que todo esta bien: la deuda de cada persona
      -- habria desaparecido sin que nada avisara.
      SELECT 'Client', count(*)::text, COALESCE(sum("balance"), 0)::text FROM "Client"
      UNION ALL
      SELECT 'CustomerAccountMovement', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "CustomerAccountMovement"
      UNION ALL
      SELECT 'CustomerPayment', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "CustomerPayment"
      UNION ALL
      -- Y las cuentas por pagar, desde la Fase 4B, por el mismo motivo del otro
      -- lado del mostrador: sin estas cuatro, un respaldo que perdiera el libro
      -- de proveedores se restauraria y la comparacion diria que todo esta
      -- bien, con la deuda del negocio desaparecida y sin que nada avisara.
      --
      -- De Supplier se suma el SALDO y no el precio de nada: es el numero que
      -- tiene que sobrevivir. Y las imputaciones entran porque son lo unico que
      -- dice QUE entrega cancelo cada pago; perderlas deja los saldos intactos
      -- y la trazabilidad en cero, que es un dano que ningun total delataria.
      SELECT 'Supplier', count(*)::text, COALESCE(sum("balance"), 0)::text FROM "Supplier"
      UNION ALL
      SELECT 'SupplierAccountMovement', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "SupplierAccountMovement"
      UNION ALL
      SELECT 'SupplierPayment', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "SupplierPayment"
      UNION ALL
      SELECT 'SupplierPaymentAllocation', count(*)::text, COALESCE(sum("amount"), 0)::text
        FROM "SupplierPaymentAllocation"
      ORDER BY 1
    `)
    return rows.map((r) => `${r.tabla}: ${r.filas} filas, suma ${r.suma}`).join('\n')
  } finally {
    await cliente.end()
  }
}

function paso(n: number, que: string): void {
  console.log(`\n  ${String(n)}. ${que}`)
}

async function main(): Promise<void> {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'kiosco-rehearsal-'))
  const respaldo = path.join(carpeta, 'respaldo.dump')

  console.log('\nENSAYO DE MIGRACION')
  console.log(`\n  Bases descartables: ${ORIGEN}, ${RESTAURADA}`)
  console.log(`  Respaldo:           ${respaldo}`)

  try {
    // ---------------------------------------------------------------------
    paso(1, 'Se arma una base con el esquema y los datos de hoy')
    // ---------------------------------------------------------------------
    await recrear(ORIGEN)
    prisma(['migrate', 'deploy'], urlDe(ORIGEN))
    execFileSync(
      process.execPath,
      [path.join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed-demo.ts'],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: urlDe(ORIGEN), SEED_DEMO: 'si' },
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    const antes = await huella(urlDe(ORIGEN))
    console.log(antes.replace(/^/gm, '     '))

    // ---------------------------------------------------------------------
    paso(2, 'Respaldo con pg_dump')
    // ---------------------------------------------------------------------
    pg('pg_dump', ['--format=custom', '--file', respaldo, urlParaHerramientas(ORIGEN)])
    console.log('     hecho')

    // ---------------------------------------------------------------------
    paso(3, 'La cadena de migraciones no deja deriva')
    // ---------------------------------------------------------------------
    prisma(
      [
        'migrate',
        'diff',
        '--from-schema-datamodel',
        'prisma/schema.prisma',
        '--to-url',
        urlDe(ORIGEN),
        '--exit-code',
      ],
      urlDe(ORIGEN),
    )
    console.log('     sin diferencias')

    // ---------------------------------------------------------------------
    paso(4, 'La base resultante CIERRA')
    // ---------------------------------------------------------------------
    const integridad = execFileSync(
      process.execPath,
      [path.join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), 'scripts/integrity-check.ts'],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: urlDe(ORIGEN) },
      },
    )
    console.log(integridad.replace(/^/gm, '  '))

    // ---------------------------------------------------------------------
    paso(5, 'El respaldo se RESTAURA en otra base')
    // ---------------------------------------------------------------------
    await recrear(RESTAURADA)
    pg('pg_restore', ['--no-owner', '--dbname', urlParaHerramientas(RESTAURADA), respaldo])
    console.log('     hecho')

    // ---------------------------------------------------------------------
    paso(6, 'Lo restaurado es igual a lo respaldado')
    // ---------------------------------------------------------------------
    const despues = await huella(urlDe(RESTAURADA))
    if (despues !== antes) {
      console.error('\n  LA RESTAURACION NO COINCIDE\n')
      console.error('  antes:\n' + antes.replace(/^/gm, '     '))
      console.error('  despues:\n' + despues.replace(/^/gm, '     '))
      // Se lanza en vez de fijar el codigo de salida aca: el `finally` de
      // abajo tiene que borrar las bases descartables igual, y el codigo lo
      // pone el `catch` de mas abajo en un solo lugar.
      throw new Error('El respaldo restaurado no coincide con el original')
    }
    console.log('     coincide fila por fila y suma por suma')

    // ---------------------------------------------------------------------
    paso(7, 'Y la base restaurada tambien cierra')
    // ---------------------------------------------------------------------
    execFileSync(
      process.execPath,
      [path.join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), 'scripts/integrity-check.ts'],
      {
        cwd: RAIZ,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: urlDe(RESTAURADA) },
      },
    )
    console.log('     sin inconsistencias')

    console.log('\n  ENSAYO COMPLETO. El respaldo sirve.\n')
  } finally {
    await borrar(ORIGEN)
    await borrar(RESTAURADA)
    rmSync(carpeta, { recursive: true, force: true })
  }
}

main().catch((err: unknown) => {
  console.error('\n  EL ENSAYO FALLO:')
  console.error(err instanceof Error ? err.message : String(err))
  console.error('')
  process.exitCode = 1
})
