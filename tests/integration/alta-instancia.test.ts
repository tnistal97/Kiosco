/**
 * Alta de una instancia nueva (P0-A): `scripts/lib/instancia.ts`.
 *
 * Corre contra bases DESCARTABLES que crea y borra esta misma prueba, con un
 * sufijo obligatorio. Nunca contra desarrollo ni contra `kiosco_test`.
 *
 * Lo que tiene que valer siempre:
 *   - en una base vacia: migra y crea roles, sucursal y duenio con clave
 *     generada, en una transaccion;
 *   - en una base con datos: se niega, salvo `--completar`, que solo agrega;
 *   - en una base con tablas ajenas: se niega siempre, sin migrar;
 *   - el simulacro no escribe nada;
 *   - la clave no queda ni en la bitacora ni en la base (solo el hash).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import bcrypt from 'bcrypt'
import { Client } from 'pg'
import { PrismaClient } from '@prisma/client'
import {
  AltaRechazada,
  darDeAlta,
  describirBase,
  destinoDeLaClave,
  ORIGEN_DEL_ALTA,
  type DatosDeAlta,
} from '../../scripts/lib/instancia'
import { knownRoles } from '@/server/authz/permissions'

/** Sufijo obligatorio. Ninguna base sin el se crea ni se borra desde aca. */
const SUFIJO = '_altatest'

const BASE_URL = process.env.DATABASE_URL ?? ''
const ADMIN_URL = BASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1')

function urlDe(nombre: string): string {
  return BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${nombre}$1`)
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

async function crearBase(nombre: string): Promise<string> {
  if (!nombre.endsWith(SUFIJO)) throw new Error(`Nombre inseguro: ${nombre}`)
  await conAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`)
    await c.query(`CREATE DATABASE "${nombre}"`)
  })
  return urlDe(nombre)
}

async function borrarBase(nombre: string): Promise<void> {
  if (!nombre.endsWith(SUFIJO)) throw new Error(`Nombre inseguro: ${nombre}`)
  await conAdmin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`)
  })
}

async function consultar<T extends Record<string, unknown>>(url: string, sql: string) {
  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    return (await cliente.query<T>(sql)).rows
  } finally {
    await cliente.end()
  }
}

async function cantidadDeTablas(url: string): Promise<number> {
  const [fila] = await consultar<{ n: number }>(
    url,
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
  )
  return fila?.n ?? -1
}

const DATOS: DatosDeAlta = {
  nombreComercial: 'Almacén Don Pepe',
  sucursal: 'Casa central',
  direccion: 'Av. Siempreviva 742',
  telefono: '11 5555-0000',
  email: 'pepe@example.com',
  zonaHoraria: 'America/Argentina/Cordoba',
  adminUsuario: 'pepe',
  adminNombre: 'José Pérez',
  rolAdmin: 'duenio',
}

const NUEVA = `kiosco_nueva${SUFIJO}`
const AJENA = `kiosco_ajena${SUFIJO}`

// Crear y migrar una base lleva su tiempo: 43 migraciones.
const LARGO = 240_000

describe('Una base vacia', () => {
  let url = ''
  let clave = ''

  beforeAll(async () => {
    url = await crearBase(NUEVA)
  }, LARGO)

  afterAll(async () => {
    await borrarBase(NUEVA)
  }, LARGO)

  it('el simulacro dice lo que haria y no escribe nada', async () => {
    const r = await darDeAlta(DATOS, { url, dryRun: true })

    expect(r.estado).toBe('vacia')
    expect(r.claveInicial).toBeNull()
    const texto = r.acciones.join('\n')
    expect(texto).toMatch(/Migraciones: \d+ pendiente/)
    expect(texto).toContain('Usuario "pepe" (duenio): se crearia')
    expect(await cantidadDeTablas(url)).toBe(0)
  })

  it(
    'migra y crea roles, sucursal y duenio con una clave generada',
    async () => {
      const r = await darDeAlta(DATOS, { url })

      expect(r.claveInicial).toMatch(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/)
      clave = r.claveInicial ?? ''

      const db = new PrismaClient({ datasources: { db: { url } } })
      try {
        const roles = (await db.role.findMany({ select: { name: true } })).map((x) => x.name)
        expect(roles.sort()).toEqual(knownRoles().sort())

        const sucursal = await db.branch.findUniqueOrThrow({ where: { name: 'Casa central' } })
        expect(sucursal.address).toBe('Av. Siempreviva 742')
        expect(sucursal.phone).toBe('11 5555-0000')
        expect(sucursal.email).toBe('pepe@example.com')
        expect(sucursal.timeZone).toBe('America/Argentina/Cordoba')

        const pepe = await db.user.findUniqueOrThrow({
          where: { username: 'pepe' },
          include: { role: true },
        })
        expect(pepe.role.name).toBe('duenio')
        expect(pepe.branchId).toBe(sucursal.id)
        expect(pepe.isActive).toBe(true)
        expect(await bcrypt.compare(clave, pepe.password)).toBe(true)

        // Bitacora: lo que se creo, sin la clave ni el hash.
        const logs = await db.auditLog.findMany({ where: { origin: ORIGEN_DEL_ALTA } })
        expect(logs.map((l) => l.tableName).sort()).toEqual(['Branch', 'User'])
        const bitacora = JSON.stringify(logs)
        expect(bitacora).not.toContain(clave)
        expect(bitacora).not.toMatch(/\$2[aby]\$/)

        // Nada mas: un comercio nuevo arranca sin productos ni ventas.
        expect(await db.product.count()).toBe(0)
        expect(await db.sale.count()).toBe(0)
        expect(await db.user.count()).toBe(1)
      } finally {
        await db.$disconnect()
      }
    },
    LARGO,
  )

  it('una segunda corrida se niega: la base ya tiene datos', async () => {
    await expect(darDeAlta({ ...DATOS, adminUsuario: 'otro' }, { url })).rejects.toThrow(
      AltaRechazada,
    )
    const [fila] = await consultar<{ n: number }>(url, 'SELECT count(*)::int AS n FROM "User"')
    expect(fila?.n).toBe(1)
  })

  it('--completar sobre lo mismo no crea nada ni genera otra clave', async () => {
    const r = await darDeAlta(DATOS, { url, completar: true })

    expect(r.claveInicial).toBeNull()
    expect(r.acciones.join('\n')).toContain('Usuario "pepe": ya existe, no se toca')

    // La clave de pepe sigue siendo la de antes.
    const [fila] = await consultar<{ password: string }>(
      url,
      `SELECT password FROM "User" WHERE username = 'pepe'`,
    )
    expect(await bcrypt.compare(clave, fila?.password ?? '')).toBe(true)
  })

  it('--completar repone un rol que falte, sin tocar lo demas', async () => {
    await consultar(url, `DELETE FROM "Role" WHERE name = 'auditor'`)

    const r = await darDeAlta(DATOS, { url, completar: true })

    expect(r.acciones.join('\n')).toContain('auditor')
    const roles = await consultar<{ name: string }>(url, 'SELECT name FROM "Role"')
    expect(roles.map((x) => x.name).sort()).toEqual(knownRoles().sort())
  })

  it('--completar no agrega una sucursal a una instancia en uso', async () => {
    await expect(
      darDeAlta({ ...DATOS, sucursal: 'Sucursal Norte' }, { url, completar: true }),
    ).rejects.toThrow(/ninguna se llama "Sucursal Norte"/)

    const [fila] = await consultar<{ n: number }>(url, 'SELECT count(*)::int AS n FROM "Branch"')
    expect(fila?.n).toBe(1)
  })
})

describe('Bases que no se tocan', () => {
  afterAll(async () => {
    await borrarBase(AJENA)
  }, LARGO)

  it('una base con tablas que no son de Kiosco: ni migra', async () => {
    const url = await crearBase(AJENA)
    await consultar(url, 'CREATE TABLE pedidos (id int PRIMARY KEY)')

    let migro = false
    await expect(
      darDeAlta(DATOS, {
        url,
        migrar: () => {
          migro = true
        },
      }),
    ).rejects.toThrow(/ninguna es de Kiosco/)

    expect(migro).toBe(false)
    expect(await cantidadDeTablas(url)).toBe(1)
  })

  it('con datos invalidos falla antes de conectarse', async () => {
    // Un puerto donde no hay nada: si intentara conectarse, el error seria otro.
    const url = 'postgresql://nadie:nada@127.0.0.1:1/ninguna?schema=public'

    await expect(darDeAlta({ ...DATOS, zonaHoraria: 'Marte/Olympus' }, { url })).rejects.toThrow(
      /--zona-horaria/,
    )
    await expect(darDeAlta({ ...DATOS, adminUsuario: 'a b' }, { url })).rejects.toThrow(
      /--admin-usuario/,
    )
    await expect(darDeAlta({ ...DATOS, nombreComercial: '  ' }, { url })).rejects.toThrow(
      /--nombre-comercial/,
    )
  })

  it('el rol inicial tiene que poder administrar el personal', async () => {
    const url = 'postgresql://nadie:nada@127.0.0.1:1/ninguna?schema=public'
    await expect(
      darDeAlta({ ...DATOS, rolAdmin: 'cajero' as unknown as 'duenio' }, { url }),
    ).rejects.toThrow(/--rol/)
  })
})

describe('Lo que se imprime y donde va la clave', () => {
  it('la base se describe sin usuario ni contrasena', () => {
    const texto = describirBase(
      'postgresql://kiosco:una-clave-secreta@db.local:5433/kiosco_pepe?schema=public',
    )
    expect(texto).toBe('db.local:5433/kiosco_pepe')
    expect(texto).not.toContain('una-clave-secreta')
  })

  it('en una terminal, la clave se muestra', () => {
    expect(destinoDeLaClave({ esTerminal: true, dryRun: false })).toBe('pantalla')
  })

  it('con --clave-en, va al archivo aunque haya terminal', () => {
    expect(destinoDeLaClave({ esTerminal: true, claveEn: '/tmp/clave', dryRun: false })).toBe(
      'archivo',
    )
  })

  it('sin terminal y sin --clave-en, se niega antes de empezar: terminaria en un log', () => {
    expect(() => destinoDeLaClave({ esTerminal: false, dryRun: false })).toThrow(AltaRechazada)
  })

  it('el simulacro no genera clave', () => {
    expect(destinoDeLaClave({ esTerminal: false, dryRun: true })).toBe('ninguno')
  })
})
