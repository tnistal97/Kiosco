/**
 * Acceso a la base de pruebas y datos de partida.
 *
 * Se usa el mismo cliente Prisma que las rutas (`@/lib/prisma`) para que lo
 * que ve el test sea exactamente lo que ve el codigo bajo prueba.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import { knownRoles } from '@/server/authz/permissions'
import type { Monto } from '@/lib/money'
import { aMonto, sumar, sumaODefecto } from '@/server/money'
import { MEDIO_EFECTIVO } from '@/modules/sales/payment-methods'
import { hoyEn, sumarDias, ZONA_POR_DEFECTO } from '@/lib/tiempo'

export { prisma }

/** Orden hijo → padre. TRUNCATE ... CASCADE lo resuelve igual, pero es explicito. */
const TABLES = [
  'AuditLog',
  'StockCheck',
  'SaleItem',
  // El libro de cuenta corriente y los cobros tambien tienen disparador de
  // inmutabilidad, y TRUNCATE tampoco los dispara.
  'CustomerAccountMovement',
  'CustomerPayment',
  'Sale',
  'Client',
  'CashRegisterMovement',
  'CashCount',
  'CashShift',
  // TRUNCATE no dispara disparadores de fila, asi que los disparadores de
  // inmutabilidad de StockMovement, ProductCostHistory y PurchaseReceipt no
  // impiden vaciar la base entre pruebas. Es la unica puerta.
  'StockMovement',
  'ProductCostHistory',
  'ProductBarcode',
  'PurchaseReceiptItem',
  'PurchaseReceipt',
  'PurchaseOrderItem',
  'PurchaseOrder',
  'ProductSupplier',
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

  // Las secuencias que numeran documentos NO pertenecen a ninguna tabla, asi
  // que `RESTART IDENTITY` no las toca: los numeros seguirian creciendo entre
  // pruebas y "la primera orden es la OC-00000001" seria cierto una sola vez.
  //
  // FASE 5A.2: se reiniciaban DOS de las CINCO que existen. Las otras tres
  // --inventarios, devoluciones a proveedor y pagos a proveedor-- seguian
  // subiendo. Ninguna prueba de hoy afirma su primer numero, asi que era una
  // trampa y no un fallo: la primera que lo afirmara pasaria una vez y fallaria
  // en la corrida siguiente, que es la peor clase de prueba que se puede
  // escribir. Ahora se descubren en vez de listarse, para que la sexta quede
  // cubierta el dia que exista.
  const secuencias = await prisma.$queryRaw<Array<{ sequencename: string }>>`
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  `
  for (const { sequencename } of secuencias) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${sequencename}" RESTART WITH 1`)
  }
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
  /** Producto POR PESO: `saleUnit = KG`, $9.800/kg, 5,000 kg de saldo. */
  productoPeso: { id: number; name: string; price: Monto; barcode: string }
  /**
   * Producto que se COMPRA POR CAJA y se VENDE POR UNIDAD.
   *
   * Es el ejemplo del pedido, con sus numeros: `purchaseUnit = BOX`,
   * `unitsPerPurchaseUnit = 8`, 100 unidades de saldo. Existe en la fixture
   * porque es el caso que da sentido a toda la conversion de la Fase 3C, y
   * armarlo a mano en cada archivo repetiria los tres numeros que importan.
   */
  productoCaja: { id: number; name: string; price: Monto; barcode: string }
  /** Proveedor ACTIVO, sin historial. */
  proveedor: { id: number; name: string }
  /** Proveedor dado de baja: no se le puede comprar. */
  proveedorInactivo: { id: number; name: string }
  productoA: { id: number; name: string; price: Monto; barcode: string }
  /** Producto de la sucursal B. Un usuario de A no debe poder tocarlo. */
  productoB: { id: number; name: string; price: Monto; barcode: string }
  categoryId: number
  /**
   * Cliente con limite de $50.000 y saldo en cero. Los numeros del ejemplo del
   * pedido de la Fase 4A.
   */
  cliente: { id: number; name: string }
  /** Cliente SIN limite configurado (`creditLimit = null`): se le fia sin tope. */
  clienteSinLimite: { id: number; name: string }
  /** Cliente con el fiado cortado. Sigue comprando de contado. */
  clienteBloqueado: { id: number; name: string }
  /** Cliente de la sucursal B. Un usuario de A no debe poder tocarlo. */
  clienteB: { id: number; name: string }
  /** Un usuario por cada rol del catalogo, todos en la sucursal A. */
  porRol: Record<string, TestUser>
  /** Turno abierto de cada sucursal. Sin turno no se puede vender. */
  turnoA: number
  turnoB: number
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

  // Las dos sucursales arrancan con la caja ABIERTA y en cero.
  //
  // Desde la Fase 3 no se puede vender sin turno abierto, asi que la fixture
  // lo abre: si no, cada prueba de venta empezaria con seis lineas de
  // preparacion que no tienen nada que ver con lo que prueba. Las pruebas del
  // turno en si lo cierran o lo borran cuando necesitan el otro caso.
  const turnoA = await prisma.cashShift.create({
    data: { branchId: branchA.id, openedById: admin.id, openingAmount: 0, status: 'open' },
  })
  const turnoB = await prisma.cashShift.create({
    data: { branchId: branchB.id, openedById: cajeroB.id, openingAmount: 0, status: 'open' },
  })

  const category = await prisma.category.create({ data: { name: 'Almacen' } })

  // Los codigos van en `ProductBarcode`, no en `Product.barcode`: esa columna
  // quedo congelada en la Fase 3B y nadie la lee. Ver docs/PHASE3_BARCODES.md.
  const productoA = await prisma.product.create({
    data: {
      name: 'Fernet Branca 750ml',
      price: 12500,
      categoryId: category.id,
      branchId: branchA.id,
      barcodes: { create: { code: '7790895000119', isPrimary: true } },
    },
  })
  const productoB = await prisma.product.create({
    data: {
      name: 'Yerba Playadito 1kg',
      price: 4800,
      categoryId: category.id,
      branchId: branchB.id,
      barcodes: { create: { code: '7792798000029', isPrimary: true } },
    },
  })

  /**
   * Producto POR PESO, en la sucursal A.
   *
   * Existe en la fixture y no en cada prueba porque desde la Fase 3B la mitad
   * de los escenarios interesantes son fraccionados, y armarlo a mano en cada
   * archivo repetiria la unidad, el precio por kilo y el saldo inicial.
   *
   * $9.800 el kilo y 5,000 kg de saldo: los numeros del ejemplo del pedido.
   */
  const productoPeso = await prisma.product.create({
    data: {
      name: 'Queso cremoso',
      price: 9800,
      categoryId: category.id,
      branchId: branchA.id,
      saleUnit: 'KG',
      purchaseUnit: 'KG',
      unitsPerPurchaseUnit: 1,
      barcodes: { create: { code: '2000000000015', isPrimary: true } },
    },
  })

  const [proveedor, proveedorInactivo] = await Promise.all([
    prisma.supplier.create({
      data: {
        name: 'Distribuidora del Sur',
        taxId: '30-12345678-9',
        phone: '11-4567-8900',
        contactName: 'Pepe',
      },
    }),
    prisma.supplier.create({ data: { name: 'Mayorista Cerrado', isActive: false } }),
  ])

  /**
   * El producto del ejemplo del pedido: se compra por caja de 8 y se vende por
   * unidad. Arranca con 100 unidades y con `Distribuidora del Sur` como
   * proveedor principal.
   */
  const productoCaja = await prisma.product.create({
    data: {
      name: 'Gaseosa cola 2.25 L',
      price: 3450,
      categoryId: category.id,
      branchId: branchA.id,
      saleUnit: 'UNIT',
      purchaseUnit: 'BOX',
      unitsPerPurchaseUnit: 8,
      barcodes: { create: { code: '7790002000014', isPrimary: true } },
      suppliers: { create: { supplierId: proveedor.id, isPreferred: true } },
    },
  })

  await prisma.branchStock.createMany({
    data: [
      { branchId: branchA.id, productId: productoA.id, quantity: 10 },
      { branchId: branchB.id, productId: productoB.id, quantity: 10 },
      { branchId: branchA.id, productId: productoPeso.id, quantity: 5 },
      { branchId: branchA.id, productId: productoCaja.id, quantity: 100 },
    ],
  })

  // El saldo de partida, en el libro.
  //
  // La fixture escribe `BranchStock` directamente --es preparacion, no una
  // operacion del sistema-- pero tiene que dejar el libro cuadrado igual: la
  // invariante suma(movimientos) == cantidad se comprueba sobre TODOS los
  // productos, y un producto que aparece con diez unidades y sin movimientos
  // haria fallar esa prueba por culpa de la preparacion, no del codigo.
  await prisma.stockMovement.createMany({
    data: [
      {
        branchId: branchA.id,
        productId: productoA.id,
        type: 'INITIAL',
        quantity: 10,
        previousQuantity: 0,
        resultingQuantity: 10,
        userId: admin.id,
        reason: 'Saldo de partida de la fixture',
      },
      {
        branchId: branchB.id,
        productId: productoB.id,
        type: 'INITIAL',
        quantity: 10,
        previousQuantity: 0,
        resultingQuantity: 10,
        userId: cajeroB.id,
        reason: 'Saldo de partida de la fixture',
      },
      {
        branchId: branchA.id,
        productId: productoPeso.id,
        type: 'INITIAL',
        quantity: 5,
        previousQuantity: 0,
        resultingQuantity: 5,
        userId: admin.id,
        reason: 'Saldo de partida de la fixture',
      },
      {
        branchId: branchA.id,
        productId: productoCaja.id,
        type: 'INITIAL',
        quantity: 100,
        previousQuantity: 0,
        resultingQuantity: 100,
        userId: admin.id,
        reason: 'Saldo de partida de la fixture',
      },
    ],
  })

  // Los cuatro clientes de la fixture. Todos arrancan en cero: el sistema
  // anterior no tenia cuenta corriente, asi que no hay deuda historica que
  // migrar y no se inventa ninguna. Ver el objetivo 27.
  const [cliente, clienteSinLimite, clienteBloqueado, clienteB] = await Promise.all([
    prisma.client.create({
      data: { branchId: branchA.id, name: 'Juan Pérez', phone: '11-5555-1234', creditLimit: 50000 },
    }),
    prisma.client.create({ data: { branchId: branchA.id, name: 'Marta Gómez' } }),
    prisma.client.create({
      data: { branchId: branchA.id, name: 'Raúl Sosa', creditLimit: 20000, isCreditEnabled: false },
    }),
    prisma.client.create({ data: { branchId: branchB.id, name: 'Cliente de la B' } }),
  ])

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
      barcode: '7790895000119',
    },
    productoB: {
      id: productoB.id,
      name: productoB.name,
      price: aMonto(productoB.price),
      barcode: '7792798000029',
    },
    productoPeso: {
      id: productoPeso.id,
      name: productoPeso.name,
      price: aMonto(productoPeso.price),
      barcode: '2000000000015',
    },
    productoCaja: {
      id: productoCaja.id,
      name: productoCaja.name,
      price: aMonto(productoCaja.price),
      barcode: '7790002000014',
    },
    proveedor: { id: proveedor.id, name: proveedor.name },
    proveedorInactivo: { id: proveedorInactivo.id, name: proveedorInactivo.name },
    categoryId: category.id,
    cliente: { id: cliente.id, name: cliente.name },
    clienteSinLimite: { id: clienteSinLimite.id, name: clienteSinLimite.name },
    clienteBloqueado: { id: clienteBloqueado.id, name: clienteBloqueado.name },
    clienteB: { id: clienteB.id, name: clienteB.name },
    porRol,
    turnoA: turnoA.id,
    turnoB: turnoB.id,
  }
}

/** Saldo de un cliente, como cadena decimal. Positivo = debe. */
export async function saldoDe(clientId: number): Promise<Monto> {
  const c = await prisma.client.findUnique({ where: { id: clientId } })
  return c === null ? '0.00' : aMonto(c.balance)
}

/**
 * Comprueba LA invariante del libro de cuenta corriente, para todos los
 * clientes.
 *
 *   para todo cliente:  suma(CustomerAccountMovement.amount) == Client.balance
 *
 * Se llama al final de los escenarios que mueven saldos. Si esa igualdad se
 * rompe, el sistema esta mintiendo: o el saldo se movio sin dejar movimiento, o
 * el movimiento dice una cosa y el saldo otra.
 *
 * Devuelve los descuadres en vez de lanzar, para que la prueba pueda mostrar
 * cuales son. Comparacion en CADENA con escala fija, igual que en el libro de
 * stock: dos `Decimal` con el mismo valor son objetos distintos, y pasarlos por
 * `Number` reintroduciria el error de punto flotante que el libro no tolera.
 */
export interface DescuadreDeCuenta {
  clientId: number
  name: string
  saldo: string
  libro: string
}

export async function descuadresDeCuenta(): Promise<DescuadreDeCuenta[]> {
  const [clientes, movimientos] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true, balance: true } }),
    prisma.customerAccountMovement.groupBy({ by: ['clientId'], _sum: { amount: true } }),
  ])

  const libroPorCliente = new Map<number, string>()
  for (const m of movimientos) {
    libroPorCliente.set(m.clientId, (m._sum.amount ?? new Prisma.Decimal(0)).toFixed(2))
  }

  const descuadres: DescuadreDeCuenta[] = []
  for (const c of clientes) {
    const libro = libroPorCliente.get(c.id) ?? '0.00'
    if (libro !== c.balance.toFixed(2)) {
      descuadres.push({ clientId: c.id, name: c.name, saldo: c.balance.toFixed(2), libro })
    }
  }
  return descuadres
}

/** El extracto de un cliente, del mas viejo al mas nuevo. */
export async function movimientosDeCuenta(clientId: number) {
  return prisma.customerAccountMovement.findMany({
    where: { clientId },
    orderBy: { id: 'asc' },
  })
}

/**
 * Saldo esperado del turno abierto de la sucursal.
 *
 * Es lo que TIENE que haber en el cajon: monto inicial mas los movimientos en
 * efectivo de ese turno. Distinto de `cashOf`, que es el acumulado historico.
 */
export async function expectedOfShift(branchId: number): Promise<Monto> {
  const turno = await prisma.cashShift.findFirst({ where: { branchId, status: 'open' } })
  if (!turno) return '0.00'
  const efectivo = await prisma.cashRegisterMovement.aggregate({
    where: { shiftId: turno.id, paymentMethod: MEDIO_EFECTIVO },
    _sum: { amount: true },
  })
  return aMonto(sumar(turno.openingAmount, sumaODefecto(efectivo._sum.amount)))
}

/**
 * Deja un producto con la cantidad indicada, SIN romper el libro.
 *
 * Las pruebas necesitan preparar escenarios --"que haya tres unidades"-- y
 * hacerlo con un `update` sobre `BranchStock` deja el saldo en tres y el libro
 * en diez. Despues la prueba de integridad falla por culpa de la preparacion y
 * no del codigo, que es la peor clase de falso positivo: parece un hallazgo.
 *
 * Escribe el ajuste como `MANUAL_ADJUSTMENT`, igual que lo haria un recuento.
 */
export async function ponerStock(
  branchId: number,
  productId: number,
  cantidad: number | string,
  userId: number,
): Promise<void> {
  const actual = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId, productId } },
    select: { quantity: true },
  })
  const antes = actual?.quantity ?? new Prisma.Decimal(0)
  const objetivo = new Prisma.Decimal(cantidad)
  const delta = objetivo.minus(antes)

  await prisma.branchStock.upsert({
    where: { branchId_productId: { branchId, productId } },
    update: { quantity: objetivo },
    create: { branchId, productId, quantity: objetivo },
  })

  if (delta.isZero()) return

  await prisma.stockMovement.create({
    data: {
      branchId,
      productId,
      type: 'MANUAL_ADJUSTMENT',
      quantity: delta,
      previousQuantity: antes,
      resultingQuantity: objetivo,
      userId,
      reason: 'Preparacion del escenario de prueba',
    },
  })
}

/**
 * Stock actual de un producto, como NUMERO.
 *
 * Sigue devolviendo `number` a proposito: las pruebas comparan contra literales
 * --`expect(await stockOf(...)).toBe(8)`-- y devolver un `Decimal` obligaria a
 * escribir `.toString()` en doscientas aserciones sin ganar nada. La precision
 * que importa la comprueban `stockExacto` y `descuadresDelLibro`.
 */
export async function stockOf(branchId: number, productId: number): Promise<number> {
  const row = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId, productId } },
  })
  return row === null ? 0 : row.quantity.toNumber()
}

/**
 * Una cantidad de la base, como numero, para compararla contra un literal.
 *
 * Existe SOLO para las aserciones. `expect(m.quantity).toBe(-2)` falla desde
 * que las cantidades son `Decimal`, y el mensaje de vitest dice "expected -2 to
 * be -2", que no ayuda a nadie. Escribir `expect(num(m.quantity)).toBe(-2)` deja
 * la prueba legible sin aflojar nada: la exactitud decimal la comprueban
 * `exactamente`, `stockExacto` y `descuadresDelLibro`, que trabajan con cadenas.
 *
 * NO se usa en codigo de produccion: ahi la regla es que una cantidad no se
 * convierte a numero, y hay una regla de ESLint que lo hace cumplir.
 */
export function num(d: Prisma.Decimal | number | null | undefined): number {
  if (d === null || d === undefined) return 0
  return typeof d === 'number' ? d : d.toNumber()
}

/** La misma cantidad como cadena con tres decimales. Para lo que si importa. */
export function exactamente(d: Prisma.Decimal | null | undefined): string {
  return (d ?? new Prisma.Decimal(0)).toFixed(3)
}

/**
 * Stock actual como CADENA decimal, con su escala.
 *
 * Para lo que `stockOf` no puede comprobar: que 0,425 sea exactamente 0,425 y
 * no 0,42500000000000004. Es la version que usan las pruebas de venta por peso.
 */
export async function stockExacto(branchId: number, productId: number): Promise<string> {
  const row = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId, productId } },
  })
  return row === null ? '0.000' : row.quantity.toFixed(3)
}

/** Saldo de caja de la sucursal, como cadena decimal. */
export async function cashOf(branchId: number): Promise<Monto> {
  const b = await prisma.branch.findUnique({ where: { id: branchId } })
  return b === null ? '0.00' : aMonto(b.currentCash)
}

/**
 * Comprueba LA invariante del libro de inventario, para todos los productos.
 *
 *   para todo producto:  suma(StockMovement.quantity) == BranchStock.quantity
 *
 * Se llama al final de los escenarios que mueven stock. Si esa igualdad se
 * rompe, el sistema esta mintiendo en algun lado: o el saldo se movio sin
 * dejar movimiento, o el movimiento dice una cosa y el saldo otra.
 *
 * Devuelve los descuadres en vez de lanzar, para que la prueba pueda mostrar
 * cuales son.
 */
export interface Descuadre {
  branchId: number
  productId: number
  /** Cadena con tres decimales, para que el mensaje del fallo se pueda leer. */
  saldo: string
  libro: string
}

export async function descuadresDelLibro(): Promise<Descuadre[]> {
  const [stocks, movimientos] = await Promise.all([
    prisma.branchStock.findMany({ select: { branchId: true, productId: true, quantity: true } }),
    prisma.stockMovement.groupBy({
      by: ['branchId', 'productId'],
      _sum: { quantity: true },
    }),
  ])

  // La comparacion se hace en CADENA con escala fija, no con `===` sobre
  // numeros ni con identidad de objetos `Decimal`. Dos `Decimal` con el mismo
  // valor son objetos distintos, y pasarlos por `Number` reintroduciria
  // exactamente el error de punto flotante que el libro no tolera.
  const libroPorClave = new Map<string, string>()
  for (const m of movimientos) {
    libroPorClave.set(
      `${m.branchId}:${m.productId}`,
      (m._sum.quantity ?? new Prisma.Decimal(0)).toFixed(3),
    )
  }

  const descuadres: Descuadre[] = []

  for (const s of stocks) {
    const libro = libroPorClave.get(`${s.branchId}:${s.productId}`) ?? '0.000'
    if (libro !== s.quantity.toFixed(3)) {
      descuadres.push({
        branchId: s.branchId,
        productId: s.productId,
        saldo: s.quantity.toFixed(3),
        libro,
      })
    }
    libroPorClave.delete(`${s.branchId}:${s.productId}`)
  }

  // Lo que quedo en el mapa son movimientos de productos SIN fila de stock.
  // Solo cuadran si suman cero; si no, hay un movimiento huerfano.
  for (const [clave, libro] of libroPorClave) {
    if (libro === '0.000') continue
    const [branchId, productId] = clave.split(':').map(Number)
    descuadres.push({ branchId: branchId ?? 0, productId: productId ?? 0, saldo: '0.000', libro })
  }

  return descuadres
}

/** Movimientos de un producto, del mas viejo al mas nuevo. */
export async function movimientosDe(branchId: number, productId: number) {
  return prisma.stockMovement.findMany({
    where: { branchId, productId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

/**
 * El dia de HOY en la zona del NEGOCIO. Ni en UTC ni en la de la maquina.
 *
 * `new Date().toISOString().slice(0, 10)` da el dia UTC, que en Argentina
 * cambia a las nueve de la noche: a partir de esa hora una prueba escrita asi
 * pide el reporte de MANANA y no encuentra las ventas que acaba de hacer.
 *
 * Es la misma confusion que tenia el reporte hasta la Fase 3C --el rango se
 * armaba con la `Z` final-- y el motivo de que las pruebas no la detectaran:
 * usaban su misma convencion equivocada. Ver `reporteDeVentas`.
 *
 * FASE 5A.1: hasta ahora esto leia la zona de la MAQUINA
 * (`d.getFullYear()`...), que acierta en una computadora argentina y se
 * equivoca en cualquier otra. CI corre en UTC y no exporta `TZ`, asi que ahi
 * fallaba entre la medianoche y las tres de la manana --tres horas por dia--
 * sin que nadie lo relacionara con la hora. Ahora pregunta por la zona del
 * negocio, que es la unica que usan los reportes.
 */
export function hoyLocal(): string {
  return hoyEn(ZONA_POR_DEFECTO)
}

/**
 * El dia a `n` dias de hoy, en la misma zona.
 *
 * Con `n` negativo, hacia atras. Existe para que las pruebas de vencimientos no
 * calculen fechas sumandole 86.400.000 milisegundos a un instante: eso se
 * equivoca el dia que el dia dura 23 o 25 horas, y ademas arrastra la hora.
 */
export function diaLocal(n: number): string {
  return sumarDias(hoyLocal(), n)
}
