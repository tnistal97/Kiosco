/**
 * Acceso a la base de pruebas y datos de partida.
 *
 * Se usa el mismo cliente Prisma que las rutas (`@/lib/prisma`) para que lo
 * que ve el test sea exactamente lo que ve el codigo bajo prueba.
 */

import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { knownRoles } from '@/server/authz/permissions'
import type { Monto } from '@/lib/money'
import { aMonto } from '@/server/money'

export { prisma }

/** Orden hijo → padre. TRUNCATE ... CASCADE lo resuelve igual, pero es explicito. */
const TABLES = [
  'AuditLog',
  'StockCheck',
  'SaleItem',
  'Sale',
  'CashRegisterMovement',
  'CashCount',
  'BranchStock',
  'Product',
  'User',
  'Category',
  'Supplier',
  'Role',
  'Branch',
] as const

export async function resetDb(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export interface Fixture {
  branchA: { id: number; name: string }
  branchB: { id: number; name: string }
  admin: TestUser
  cajero: TestUser
  /** Cajero de la OTRA sucursal, para probar aislamiento. */
  cajeroB: TestUser
  /** Usuario dado de baja. */
  inactivo: TestUser
  /**
   * Los precios salen como CADENA decimal, igual que por la API.
   *
   * Asi las pruebas comparan `'12500.00'` contra lo que devuelve el endpoint,
   * sin convertir a numero en el medio --que es justo donde se colaban los
   * centavos fantasma que la Fase 3 vino a eliminar--.
   */
  productoA: { id: number; name: string; price: Monto; barcode: string }
  /** Producto de la sucursal B. Un usuario de A no debe poder tocarlo. */
  productoB: { id: number; name: string; price: Monto; barcode: string }
  categoryId: number
  /** Un usuario por cada rol del catalogo, todos en la sucursal A. */
  porRol: Record<string, TestUser>
}

export interface TestUser {
  id: number
  username: string
  password: string
  role: string
  branchId: number
  sessionVersion: number
}

/** Contrasena unica de pruebas. No se usa en ningun otro lado. */
const TEST_PASSWORD = 'Prueba-1234'

/**
 * Escenario base: dos sucursales, cuatro usuarios, un producto por sucursal
 * con 10 unidades de stock.
 */
export async function seedFixture(): Promise<Fixture> {
  await resetDb()

  const hash = await bcrypt.hash(TEST_PASSWORD, 4) // coste bajo: son tests

  const [adminRole, cajeroRole] = await Promise.all([
    prisma.role.create({ data: { name: 'admin' } }),
    prisma.role.create({ data: { name: 'cajero' } }),
  ])

  const branchA = await prisma.branch.create({ data: { name: 'Sucursal A' } })
  const branchB = await prisma.branch.create({ data: { name: 'Sucursal B' } })

  const mkUser = async (
    username: string,
    roleId: number,
    role: string,
    branchId: number,
    isActive = true,
  ): Promise<TestUser> => {
    const u = await prisma.user.create({
      data: { username, name: username, password: hash, roleId, branchId, isActive },
    })
    return {
      id: u.id,
      username,
      password: TEST_PASSWORD,
      role,
      branchId,
      sessionVersion: u.sessionVersion,
    }
  }

  const admin = await mkUser('admin1', adminRole.id, 'admin', branchA.id)
  const cajero = await mkUser('cajero1', cajeroRole.id, 'cajero', branchA.id)
  const cajeroB = await mkUser('cajero2', cajeroRole.id, 'cajero', branchB.id)
  const inactivo = await mkUser('baja1', cajeroRole.id, 'cajero', branchA.id, false)

  // Un usuario por cada perfil operativo, para poder probar la matriz de
  // permisos completa y no solo los dos extremos.
  const porRol: Record<string, TestUser> = { admin, cajero }
  for (const nombre of knownRoles()) {
    if (nombre in porRol) continue
    const rol = await prisma.role.create({ data: { name: nombre } })
    porRol[nombre] = await mkUser(`u_${nombre}`, rol.id, nombre, branchA.id)
  }

  const category = await prisma.category.create({ data: { name: 'Almacen' } })

  const productoA = await prisma.product.create({
    data: {
      name: 'Fernet Branca 750ml',
      barcode: '7790895000119',
      price: 12500,
      categoryId: category.id,
      branchId: branchA.id,
    },
  })
  const productoB = await prisma.product.create({
    data: {
      name: 'Yerba Playadito 1kg',
      barcode: '7792798000029',
      price: 4800,
      categoryId: category.id,
      branchId: branchB.id,
    },
  })

  await prisma.branchStock.createMany({
    data: [
      { branchId: branchA.id, productId: productoA.id, quantity: 10 },
      { branchId: branchB.id, productId: productoB.id, quantity: 10 },
    ],
  })

  return {
    branchA: { id: branchA.id, name: branchA.name },
    branchB: { id: branchB.id, name: branchB.name },
    admin,
    cajero,
    cajeroB,
    inactivo,
    productoA: {
      id: productoA.id,
      name: productoA.name,
      price: aMonto(productoA.price),
      barcode: productoA.barcode ?? '',
    },
    productoB: {
      id: productoB.id,
      name: productoB.name,
      price: aMonto(productoB.price),
      barcode: productoB.barcode ?? '',
    },
    categoryId: category.id,
    porRol,
  }
}

/** Stock actual de un producto en una sucursal. */
export async function stockOf(branchId: number, productId: number): Promise<number> {
  const row = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId, productId } },
  })
  return row?.quantity ?? 0
}

/** Saldo de caja de la sucursal, como cadena decimal. */
export async function cashOf(branchId: number): Promise<Monto> {
  const b = await prisma.branch.findUnique({ where: { id: branchId } })
  return b === null ? '0.00' : aMonto(b.currentCash)
}
