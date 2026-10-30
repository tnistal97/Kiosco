/**
 * La migracion del usuario canonico, sobre una tabla con datos.
 *
 * Es de las pocas que reescriben una fila: tiene que dejar "Franco" como
 * "franco", y frenar sin tocar nada si dos usuarios difieren solo en
 * mayusculas, porque elegir cual queda no es una decision de una migracion.
 *
 * Aplica el SQL del archivo sobre una tabla TEMPORAL `"User"`, que en esa
 * conexion tapa a la real: lo que se prueba es esta migracion, y la cadena
 * completa ya la recorre `chain.test.ts`. No crea una base por prueba porque
 * en una corrida completa crear y borrar bases tarda mas que el limite.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const SQL = readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20261030120000_username_canonico/migration.sql'),
  'utf8',
)

async function conTabla<T>(usuarios: string[], fn: (c: Client) => Promise<T>): Promise<T> {
  const cliente = new Client({ connectionString: process.env.DATABASE_URL })
  await cliente.connect()
  try {
    await cliente.query(`CREATE TEMP TABLE "User" (id SERIAL PRIMARY KEY, username TEXT UNIQUE)`)
    for (const u of usuarios) await cliente.query(`INSERT INTO "User" (username) VALUES ($1)`, [u])
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

async function usuarios(c: Client): Promise<string[]> {
  const r = await c.query<{ username: string }>(`SELECT username FROM "User" ORDER BY id`)
  return r.rows.map((f) => f.username)
}

describe('20261030120000_username_canonico', () => {
  it('pasa cada usuario a su forma canonica y no toca los que ya lo estan', async () => {
    await conTabla(['admin', 'Franco', ' Pedro '], async (c) => {
      await c.query(SQL)
      expect(await usuarios(c)).toEqual(['admin', 'franco', 'pedro'])
    })
  })

  it('despues, la base rechaza un usuario no canonico', async () => {
    await conTabla(['franco'], async (c) => {
      await c.query(SQL)

      await expect(c.query(`INSERT INTO "User" (username) VALUES ('Franco')`)).rejects.toThrow(
        /User_username_canonico/,
      )
      await expect(c.query(`UPDATE "User" SET username = 'FRANCO'`)).rejects.toThrow(
        /User_username_canonico/,
      )
      await expect(c.query(`INSERT INTO "User" (username) VALUES ('franco')`)).rejects.toThrow()
      expect(await usuarios(c)).toEqual(['franco'])
    })
  })

  it('con una colision frena, las nombra y no cambia nada', async () => {
    await conTabla(['Admin', 'admin', 'Franco'], async (c) => {
      await expect(c.query(SQL)).rejects.toThrow(/Admin, admin/)
      expect(await usuarios(c)).toEqual(['Admin', 'admin', 'Franco'])
    })
  })
})
