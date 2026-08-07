/**
 * Deshace SOLO lo que creo la migracion de turnos en la base de desarrollo y
 * borra su registro, para poder volver a aplicarla despues de corregir el SQL.
 *
 * No toca ninguna otra tabla. La base es `kiosco_dev`, descartable.
 */
import pg from 'pg'

const URL = process.env.DATABASE_URL ?? ''
const nombre = URL.split('/').pop()?.split('?')[0] ?? ''
if (!nombre.endsWith('_dev') && !nombre.endsWith('_test')) {
  throw new Error(`Base insegura: ${nombre}`)
}

const cliente = new pg.Client({ connectionString: URL })
await cliente.connect()

const pasos = [
  'ALTER TABLE "CashRegisterMovement" DROP CONSTRAINT IF EXISTS "CashRegisterMovement_shiftId_fkey"',
  'ALTER TABLE "CashCount" DROP CONSTRAINT IF EXISTS "CashCount_shiftId_fkey"',
  'DROP INDEX IF EXISTS "CashRegisterMovement_shiftId_paymentMethod_idx"',
  'DROP INDEX IF EXISTS "CashCount_shiftId_idx"',
  'ALTER TABLE "CashRegisterMovement" DROP COLUMN IF EXISTS "shiftId"',
  'ALTER TABLE "CashCount" DROP COLUMN IF EXISTS "shiftId"',
  'ALTER TABLE "Branch" DROP COLUMN IF EXISTS "requireOpenShift"',
  'ALTER TABLE "Branch" DROP COLUMN IF EXISTS "cashDifferenceThreshold"',
  'DROP TABLE IF EXISTS "CashShift"',
  `DELETE FROM "_prisma_migrations" WHERE migration_name = '20260807110000_phase3_cash_shifts'`,
]

for (const sql of pasos) {
  await cliente.query(sql)
  console.log('ok', sql.slice(0, 70))
}

await cliente.end()
