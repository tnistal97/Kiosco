/**
 * Alta de una instancia nueva de Kiosco: la parte que se prueba.
 *
 * `scripts/alta-instancia.ts` es la linea de comandos. Esto es lo que hace,
 * aparte para poder correrlo contra bases descartables en las pruebas.
 *
 * REEMPLAZA a `prisma/seed.ts` como forma de arrancar un comercio. Aquel
 * borraba las tablas principales sin mirar contra que base corria y creaba un
 * administrador con una clave fija escrita en el repositorio. Este:
 *
 *   - NO borra ni modifica nada que ya exista. Nunca.
 *   - Se niega a trabajar sobre una base con datos. `--completar` es la unica
 *     excepcion y solo AGREGA lo que falta (un rol nuevo, por ejemplo).
 *   - Se niega a trabajar sobre una base con tablas que no son de Kiosco.
 *   - Aplica las migraciones con `prisma migrate deploy`: nunca `reset` ni
 *     `db push`.
 *   - Crea roles, sucursal y administrador en UNA transaccion: o queda todo o
 *     no queda nada.
 *   - Genera la clave del administrador y la devuelve una vez. No la escribe
 *     en la base (solo el hash), ni en la bitacora, ni en el log.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { audit } from '@/server/audit/audit'
import { knownRoles } from '@/server/authz/permissions'
import { NOMBRE_MAX } from '@/server/comercio'
import { redactar } from '@/server/http/redaccion'
import { shortText } from '@/server/http/validate'
import { esZonaValida, ZONA_POR_DEFECTO } from '@/lib/tiempo'
import { crearSucursalSchema } from '@/modules/catalog/schemas'
import { generarClaveTemporal } from '@/modules/users/claves'
import { usernameSchema } from '@/modules/users/schemas'

/** El mismo coste que el alta de usuarios de la aplicacion. */
const BCRYPT_ROUNDS = 12

/** Lo que queda en `AuditLog.origin` para todo lo que crea el alta. */
export const ORIGEN_DEL_ALTA = 'scripts/alta-instancia'

/** Una negativa esperada: datos invalidos o una base que no se toca. */
export class AltaRechazada extends Error {
  override name = 'AltaRechazada'
}

// ---------------------------------------------------------------- los datos

/** Quien puede ser el primer usuario: alguien que administre el personal. */
const ROLES_INICIALES = ['duenio', 'admin'] as const

export const datosDeAltaSchema = z
  .object({
    nombreComercial: z.string().trim().min(1).max(NOMBRE_MAX),
    sucursal: crearSucursalSchema.shape.name,
    direccion: crearSucursalSchema.shape.address,
    telefono: crearSucursalSchema.shape.phone,
    email: crearSucursalSchema.shape.email,
    zonaHoraria: z
      .string()
      .trim()
      .refine(esZonaValida, 'no es una zona horaria IANA (p. ej. America/Argentina/Cordoba)')
      .default(ZONA_POR_DEFECTO),
    adminUsuario: usernameSchema,
    adminNombre: shortText(100),
    rolAdmin: z.enum(ROLES_INICIALES).default('duenio'),
  })
  .strict()

export type DatosDeAlta = z.input<typeof datosDeAltaSchema>
type Datos = z.output<typeof datosDeAltaSchema>

/** Como se llama cada campo en la linea de comandos, para los mensajes. */
export const BANDERA_DE: Record<keyof Datos, string> = {
  nombreComercial: '--nombre-comercial',
  sucursal: '--sucursal',
  direccion: '--direccion',
  telefono: '--telefono',
  email: '--email',
  zonaHoraria: '--zona-horaria',
  adminUsuario: '--admin-usuario',
  adminNombre: '--admin-nombre',
  rolAdmin: '--rol',
}

function validar(entrada: DatosDeAlta): Datos {
  const r = datosDeAltaSchema.safeParse(entrada)
  if (r.success) return r.data

  const problemas = r.error.issues.map((i) => {
    const campo = String(i.path[0] ?? '')
    const bandera = campo in BANDERA_DE ? BANDERA_DE[campo as keyof Datos] : campo
    return `  ${bandera}: ${i.message}`
  })
  throw new AltaRechazada(`Datos invalidos. No se toco ninguna base.\n${problemas.join('\n')}`)
}

// ----------------------------------------------------------------- la base

/**
 * `host:puerto/base`, sin usuario ni contrasena. Es lo unico de la URL que
 * se imprime.
 */
export function describirBase(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`
  } catch {
    return '(DATABASE_URL ilegible)'
  }
}

function esquemaDe(url: string): string {
  let esquema = 'public'
  try {
    esquema = new URL(url).searchParams.get('schema') ?? 'public'
  } catch {
    throw new AltaRechazada('DATABASE_URL no es una URL valida.')
  }
  // Va entre comillas dentro de SQL armado a mano: solo un identificador simple.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(esquema)) {
    throw new AltaRechazada(`Esquema invalido en DATABASE_URL: "${esquema}".`)
  }
  return esquema
}

/**
 * Tablas donde una sola fila ya es un comercio en uso.
 *
 * `Role` no esta: los roles son catalogo del sistema, y una base con roles y
 * nada mas es una alta que no termino, no un comercio.
 */
const TABLAS_DE_NEGOCIO = [
  'User',
  'Branch',
  'Product',
  'Category',
  'Client',
  'Supplier',
  'Sale',
  'CashShift',
  'StockMovement',
  'PurchaseOrder',
] as const

export type EstadoDeLaBase =
  /** Sin ninguna tabla: una base recien creada. */
  | 'vacia'
  /** Tiene tablas y ninguna es de Kiosco. No se toca, nunca. */
  | 'ajena'
  /** Es de Kiosco, pero sin datos de negocio. */
  | 'sin-datos'
  /** Es de Kiosco y tiene datos. Solo con `--completar`. */
  | 'con-datos'

interface Inspeccion {
  estado: EstadoDeLaBase
  tablas: number
  migracionesAplicadas: number
  filas: Partial<Record<(typeof TABLAS_DE_NEGOCIO)[number], number>>
}

function primera<T>(filas: T[]): T {
  const fila = filas[0]
  if (fila === undefined) throw new Error('La consulta no devolvio ninguna fila')
  return fila
}

async function existeTabla(db: PrismaClient, esquema: string, tabla: string): Promise<boolean> {
  const nombre = `"${esquema}"."${tabla}"`
  const fila = primera(
    await db.$queryRaw<
      { existe: boolean }[]
    >`SELECT to_regclass(${nombre}::text) IS NOT NULL AS existe`,
  )
  return fila.existe
}

/** Solo lecturas. Es lo primero que se hace y decide si se sigue. */
async function inspeccionar(db: PrismaClient, esquema: string): Promise<Inspeccion> {
  const { tablas } = primera(
    await db.$queryRaw<{ tablas: number }[]>`
      SELECT count(*)::int AS tablas FROM information_schema.tables WHERE table_schema = ${esquema}`,
  )

  if (!(await existeTabla(db, esquema, '_prisma_migrations'))) {
    return { estado: tablas === 0 ? 'vacia' : 'ajena', tablas, migracionesAplicadas: 0, filas: {} }
  }

  const { aplicadas } = primera(
    await db.$queryRawUnsafe<{ aplicadas: number }[]>(
      `SELECT count(*)::int AS aplicadas FROM "${esquema}"."_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ),
  )

  const filas: Inspeccion['filas'] = {}
  for (const tabla of TABLAS_DE_NEGOCIO) {
    // Una base a medio migrar puede no tenerlas todas.
    if (!(await existeTabla(db, esquema, tabla))) continue
    const { n } = primera(
      await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${esquema}"."${tabla}"`,
      ),
    )
    filas[tabla] = n
  }

  const conDatos = Object.values(filas).some((n) => n > 0)
  return {
    estado: conDatos ? 'con-datos' : 'sin-datos',
    tablas,
    migracionesAplicadas: aplicadas,
    filas,
  }
}

function resumenDeFilas(filas: Inspeccion['filas']): string {
  return Object.entries(filas)
    .filter(([, n]) => n > 0)
    .map(([tabla, n]) => `${tabla}: ${String(n)}`)
    .join(', ')
}

/** Cuantas migraciones trae este codigo. Cada una es una carpeta. */
function migracionesDelCodigo(): number {
  return readdirSync(path.join(process.cwd(), 'prisma/migrations'), { withFileTypes: true }).filter(
    (d) => d.isDirectory(),
  ).length
}

// ------------------------------------------------------------ migraciones

export type Migrador = (url: string) => void

/**
 * `prisma migrate deploy`, y nada mas. Nunca `reset` ni `db push`.
 *
 * Se invoca el JavaScript del CLI con node, sin `npx` ni `shell: true`: asi
 * el comando es el mismo en Windows y en Linux. Si falla, la salida se tacha
 * antes de mostrarla (puede traer la cadena de conexion).
 */
export const migrarConPrisma: Migrador = (url) => {
  const cli = path.join(process.cwd(), 'node_modules/prisma/build/index.js')
  try {
    execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string }
    const salida = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n')
    throw new Error(
      `prisma migrate deploy fallo; no se crearon datos.\n${redactar(salida, { ...process.env, DATABASE_URL: url })}`,
    )
  }
}

// -------------------------------------------------------------------- plan

interface Plan {
  rolesFaltantes: string[]
  sucursal: 'crear' | 'existe'
  admin: 'crear' | 'existe'
}

type Lector = PrismaClient | Prisma.TransactionClient

/** Que falta. Solo lee; se corre otra vez dentro de la transaccion. */
async function planificar(db: Lector, datos: Datos): Promise<Plan> {
  const existentes = new Set(
    (await db.role.findMany({ select: { name: true } })).map((r) => r.name),
  )
  const rolesFaltantes = knownRoles().filter((r) => !existentes.has(r))

  const sucursal = await db.branch.findUnique({
    where: { name: datos.sucursal },
    select: { id: true },
  })
  if (!sucursal) {
    const otras = await db.branch.count()
    if (otras > 0) {
      throw new AltaRechazada(
        `La base ya tiene ${String(otras)} sucursal(es) y ninguna se llama "${datos.sucursal}". ` +
          '--completar no agrega sucursales a una instancia en uso.',
      )
    }
  }

  const admin = await db.user.findUnique({
    where: { username: datos.adminUsuario },
    select: { id: true },
  })

  return {
    rolesFaltantes,
    sucursal: sucursal ? 'existe' : 'crear',
    admin: admin ? 'existe' : 'crear',
  }
}

const PLAN_DE_BASE_VACIA = (): Plan => ({
  rolesFaltantes: knownRoles(),
  sucursal: 'crear',
  admin: 'crear',
})

function describirPlan(plan: Plan, datos: Datos, futuro: boolean): string[] {
  const se = futuro ? 'se crearia' : 'creada'
  return [
    plan.rolesFaltantes.length === 0
      ? `Roles: estan los ${String(knownRoles().length)}`
      : `Roles: ${futuro ? 'se crearian' : 'creados'} ${String(plan.rolesFaltantes.length)} (${plan.rolesFaltantes.join(', ')})`,
    plan.sucursal === 'crear'
      ? `Sucursal "${datos.sucursal}": ${se} (zona ${datos.zonaHoraria})`
      : `Sucursal "${datos.sucursal}": ya existe, no se toca`,
    plan.admin === 'crear'
      ? `Usuario "${datos.adminUsuario}" (${datos.rolAdmin}): ${futuro ? 'se crearia' : 'creado'} con una clave generada`
      : `Usuario "${datos.adminUsuario}": ya existe, no se toca y no se genera clave`,
  ]
}

// ------------------------------------------------------------------- alta

export interface OpcionesDeAlta {
  /** La base destino. Se imprime solo como `host:puerto/base`. */
  url: string
  /** Solo leer y contar lo que se haria. No migra ni escribe. */
  dryRun?: boolean
  /** Permitir una base de Kiosco con datos, agregando solo lo que falta. */
  completar?: boolean
  /** Para las pruebas. Por omision, `prisma migrate deploy`. */
  migrar?: Migrador
}

export interface ResultadoDeAlta {
  base: string
  estado: EstadoDeLaBase
  dryRun: boolean
  acciones: string[]
  /** Solo si se creo el administrador. Se muestra una vez y no se guarda. */
  claveInicial: string | null
  datos: Datos
}

export async function darDeAlta(
  entrada: DatosDeAlta,
  opciones: OpcionesDeAlta,
): Promise<ResultadoDeAlta> {
  // Todo lo que se puede comprobar sin la base, antes de conectarse.
  const datos = validar(entrada)
  const esquema = esquemaDe(opciones.url)
  const base = describirBase(opciones.url)
  const dryRun = opciones.dryRun === true

  const db = new PrismaClient({ datasources: { db: { url: opciones.url } } })
  try {
    const inspeccion = await inspeccionar(db, esquema)

    if (inspeccion.estado === 'ajena') {
      throw new AltaRechazada(
        `La base ${base} tiene ${String(inspeccion.tablas)} tabla(s) y ninguna es de Kiosco ` +
          '(no hay _prisma_migrations). No se toca: una instancia va en una base propia y vacia.',
      )
    }
    if (inspeccion.estado === 'con-datos' && opciones.completar !== true) {
      throw new AltaRechazada(
        `La base ${base} ya tiene datos (${resumenDeFilas(inspeccion.filas)}). No se toca. ` +
          'Si es esta misma instancia y le falta algo, --completar agrega solo lo que falta, ' +
          'sin modificar ni borrar nada.',
      )
    }

    const total = migracionesDelCodigo()
    const pendientes = total - inspeccion.migracionesAplicadas
    if (pendientes < 0) {
      throw new AltaRechazada(
        `La base ${base} tiene ${String(inspeccion.migracionesAplicadas)} migraciones aplicadas y ` +
          `este codigo trae ${String(total)}: la base es de una version mas nueva. No se toca.`,
      )
    }

    // El plan se arma LEYENDO, antes de migrar: si algo impide el alta, la
    // negativa llega antes de cualquier escritura, migraciones incluidas.
    const hayTablas = inspeccion.estado !== 'vacia' && (await existeTabla(db, esquema, 'Role'))
    const planPrevio = hayTablas ? await planificar(db, datos) : PLAN_DE_BASE_VACIA()

    const acciones = [
      pendientes > 0
        ? `Migraciones: ${String(pendientes)} ${dryRun ? 'pendiente(s)' : 'aplicada(s)'} de ${String(total)}`
        : `Migraciones: al dia (${String(total)})`,
    ]

    if (dryRun) {
      acciones.push(...describirPlan(planPrevio, datos, true))
      return { base, estado: inspeccion.estado, dryRun, acciones, claveInicial: null, datos }
    }

    if (pendientes > 0) (opciones.migrar ?? migrarConPrisma)(opciones.url)

    const { plan, clave } = await db.$transaction(
      async (tx) => {
        // Otra vez adentro: lo que se decide es lo que hay AHORA.
        const plan = await planificar(tx, datos)

        for (const nombre of plan.rolesFaltantes) {
          await tx.role.create({ data: { name: nombre } })
        }

        const sucursal =
          plan.sucursal === 'crear'
            ? await tx.branch.create({
                data: {
                  name: datos.sucursal,
                  address: datos.direccion ?? null,
                  phone: datos.telefono ?? null,
                  email: datos.email ?? null,
                  timeZone: datos.zonaHoraria,
                },
              })
            : await tx.branch.findUniqueOrThrow({ where: { name: datos.sucursal } })

        let clave: string | null = null
        let adminId: number
        if (plan.admin === 'crear') {
          const rol = await tx.role.findUniqueOrThrow({ where: { name: datos.rolAdmin } })
          clave = generarClaveTemporal(4)
          const creado = await tx.user.create({
            data: {
              username: datos.adminUsuario,
              name: datos.adminNombre,
              password: await bcrypt.hash(clave, BCRYPT_ROUNDS),
              roleId: rol.id,
              branchId: sucursal.id,
            },
            select: { id: true },
          })
          adminId = creado.id
        } else {
          adminId = (
            await tx.user.findUniqueOrThrow({
              where: { username: datos.adminUsuario },
              select: { id: true },
            })
          ).id
        }

        // Bitacora de lo que se creo, nada mas. Quien figura es el propio
        // administrador: la tabla pide un usuario y es el unico que hay.
        // `origin` dice que fue el alta y no una persona en la pantalla.
        if (plan.sucursal === 'crear') {
          await audit(tx, {
            userId: adminId,
            branchId: sucursal.id,
            table: 'Branch',
            recordId: sucursal.id,
            action: 'create',
            after: {
              name: sucursal.name,
              address: sucursal.address,
              timeZone: sucursal.timeZone,
              comercio: datos.nombreComercial,
            },
            reason: 'Alta de la instancia',
            origin: ORIGEN_DEL_ALTA,
          })
        }
        if (plan.admin === 'crear') {
          await audit(tx, {
            userId: adminId,
            branchId: sucursal.id,
            table: 'User',
            recordId: adminId,
            action: 'create',
            // Nunca la clave ni el hash.
            after: { username: datos.adminUsuario, name: datos.adminNombre, rol: datos.rolAdmin },
            reason: 'Alta de la instancia',
            origin: ORIGEN_DEL_ALTA,
          })
        }

        return { plan, clave }
      },
      // bcrypt con 12 rondas tarda; el limite por omision (5 s) es justo.
      { timeout: 60_000, maxWait: 10_000 },
    )

    acciones.push(...describirPlan(plan, datos, false))
    return { base, estado: inspeccion.estado, dryRun, acciones, claveInicial: clave, datos }
  } finally {
    await db.$disconnect()
  }
}

// --------------------------------------------------------- donde va la clave

export type DestinoDeLaClave = 'pantalla' | 'archivo' | 'ninguno'

/**
 * Donde se entrega la clave inicial. Se decide ANTES de tocar la base.
 *
 * En una terminal se muestra una vez. Si la salida no es una terminal --un
 * pipe, un servicio, un CI--, la clave terminaria en un log: sin
 * `--clave-en` el alta se niega antes de empezar.
 */
export function destinoDeLaClave(opciones: {
  esTerminal: boolean
  claveEn?: string
  dryRun: boolean
}): DestinoDeLaClave {
  if (opciones.dryRun) return 'ninguno'
  if (opciones.claveEn !== undefined && opciones.claveEn !== '') return 'archivo'
  if (opciones.esTerminal) return 'pantalla'
  throw new AltaRechazada(
    'La salida no es una terminal: la clave inicial terminaria en un log. ' +
      'Usa --clave-en <archivo> para guardarla en un archivo nuevo (permisos 600).',
  )
}
