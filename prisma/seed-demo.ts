/**
 * Datos ficticios representativos para desarrollo y capturas.
 *
 * Nada de esto sale de la realidad: nombres, precios, usuarios y ventas estan
 * inventados. Sirve para ver las pantallas con volumen suficiente como para
 * que se noten los problemas de diseno — una tabla con un solo producto no
 * revela nada.
 *
 * Se distingue de `seed.ts`, que crea el minimo indispensable para arrancar.
 *
 * Uso:
 *   DATABASE_URL='...kiosco_dev...' npm run seed:demo
 *
 * Se niega a correr si la base no termina en `_dev`. Es la misma guarda que
 * usan los tests: impide vaciar por accidente algo que no sea descartable.
 */
// Carga `.env.local` al importarse, como los demas guiones que corren fuera de
// Next. Sin esto, `npm run seed:demo` en una terminal recien abierta no ve
// `DATABASE_URL` y la guarda del `_dev` rechaza una base "(vacio)" — un mensaje
// que hace pensar en la guarda cuando el problema es el entorno.
import '../scripts/entorno'
import { Prisma, PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const CLAVE_DEMO = 'Demo1234!'

/**
 * Todo se sitúa relativo a AHORA.
 *
 * Es la hora real, no una fecha fija: con una fecha fija, al día siguiente el
 * panel muestra "0 ventas hoy" y la caja "sin movimientos", que es justo lo
 * que el seed viene a evitar.
 */
const AHORA = new Date()
function haceHoras(h: number): Date {
  return new Date(AHORA.getTime() - h * 3_600_000)
}
function haceDias(d: number): Date {
  return haceHoras(d * 24)
}

/**
 * Mueve stock y deja la fila en el libro, con fecha propia.
 *
 * El seed no puede usar `applyStockMovement` --ese servicio fecha todo AHORA,
 * y aca las ventas son de hace horas o dias-- pero si tiene que respetar la
 * misma invariante:
 *
 *   para todo producto:  suma(StockMovement.quantity) == BranchStock.quantity
 *
 * Y la misma regla dura: si el movimiento dejaria el saldo negativo, corta.
 * La version anterior descontaba sin comprobar y dejaba productos en -1, que
 * es como se descubrio el problema al migrar. Fallar ruidosamente en un seed
 * es barato; descubrirlo dos anios despues, no.
 */
async function moverStock(m: {
  branchId: number
  productId: number
  type: 'SALE' | 'SALE_CANCEL' | 'PURCHASE_RECEIPT' | 'PURCHASE_RETURN'
  delta: number
  userId: number
  /** A que apunta: una venta, una RECEPCION o una DEVOLUCION. Nunca la orden. */
  referenceType?: 'Sale' | 'PurchaseReceipt' | 'PurchaseReturn'
  referenceId: number
  reason?: string
  fecha: Date
}): Promise<void> {
  const actual = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId: m.branchId, productId: m.productId } },
    select: { quantity: true },
  })
  // Desde la Fase 3B las cantidades son `Decimal`. La aritmetica se hace con
  // `Decimal` y no convirtiendo a number: es exactamente la regla que el resto
  // del sistema hace cumplir con una regla de ESLint.
  const antes = actual?.quantity ?? new Prisma.Decimal(0)
  const despues = antes.plus(m.delta)

  if (despues.isNegative()) {
    throw new Error(
      `El seed dejaria el producto ${String(m.productId)} en ${despues.toString()}: ` +
        `hay ${antes.toString()} y el movimiento pide ${String(m.delta)}. ` +
        'Revisá el stock declarado en PRODUCTOS o las líneas de VENTAS.',
    )
  }

  await prisma.branchStock.update({
    where: { branchId_productId: { branchId: m.branchId, productId: m.productId } },
    data: { quantity: despues },
  })

  await prisma.stockMovement.create({
    data: {
      branchId: m.branchId,
      productId: m.productId,
      type: m.type,
      quantity: m.delta,
      previousQuantity: antes,
      resultingQuantity: despues,
      referenceType: m.referenceType ?? 'Sale',
      referenceId: m.referenceId,
      userId: m.userId,
      reason: m.reason ?? null,
      createdAt: m.fecha,
    },
  })
}

/**
 * Mueve la cuenta de un proveedor, igual que `applySupplierAccountMovement`.
 *
 * Hace exactamente lo mismo que el servicio y en el mismo orden: lee el saldo,
 * lo mueve, y escribe la fila del libro con el anterior y el resultante. Si el
 * seed se apartara, la reconciliacion lo marcaria --que es la unica forma de
 * que un seed sirva para probar algo--.
 *
 * No se llama al servicio de verdad porque el seed no tiene sesion HTTP y usa
 * su propio `PrismaClient`; lo que se copia es la regla, no el codigo.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
 */
async function moverCuentaDeProveedor(m: {
  /** La sucursal DESDE LA QUE se opero. Informativa, pero no puede ser falsa. */
  branchId: number
  supplierId: number
  type: 'PURCHASE_CHARGE' | 'PAYMENT' | 'PURCHASE_CREDIT' | 'MANUAL_ADJUSTMENT'
  /** CON SIGNO. Positivo aumenta lo que le debemos. */
  monto: number
  userId: number
  receiptId?: number
  paymentId?: number
  /** La devolucion que genero este credito. Fase 4C. */
  returnId?: number
  reason?: string
  reference?: string
  fecha: Date
}): Promise<void> {
  const proveedor = await prisma.supplier.findUniqueOrThrow({
    where: { id: m.supplierId },
    select: { balance: true },
  })
  const antes = proveedor.balance
  const despues = antes.plus(m.monto)

  await prisma.supplier.update({
    where: { id: m.supplierId },
    data: { balance: despues },
  })

  await prisma.supplierAccountMovement.create({
    data: {
      branchId: m.branchId,
      supplierId: m.supplierId,
      type: m.type,
      amount: m.monto,
      previousBalance: antes,
      resultingBalance: despues,
      receiptId: m.receiptId ?? null,
      paymentId: m.paymentId ?? null,
      returnId: m.returnId ?? null,
      userId: m.userId,
      reason: m.reason ?? null,
      reference: m.reference ?? null,
      createdAt: m.fecha,
    },
  })
}

type SemillaProducto = {
  nombre: string
  barcode: string
  /** Codigos adicionales. El lector encuentra el producto con cualquiera. */
  alternativos?: string[]
  categoria: string
  proveedor: string
  precio: number
  costo: number
  stock: number
  /** Unidad de venta. Por omision UNIT, que es como se vende casi todo. */
  unidad?: 'UNIT' | 'KG' | 'G' | 'L' | 'ML'
  /**
   * Como se COMPRA, cuando no coincide con como se vende.
   *
   * La gaseosa es el ejemplo del circuito de compras: entra por caja de ocho y
   * sale de a botellas. Sin al menos un producto asi, la conversion de la Fase
   * 3C no se puede ver funcionando en la base de demostracion.
   */
  unidadCompra?: 'UNIT' | 'KG' | 'G' | 'L' | 'ML' | 'PACK' | 'BOX'
  porUnidadDeCompra?: number
  descripcion?: string
  /** Dado de baja: no aparece en la caja, si en el catalogo y en el historial. */
  inactivo?: boolean
}

const CATEGORIAS = [
  'Almacen',
  'Bebidas',
  'Lacteos',
  'Panificados',
  'Limpieza',
  'Perfumeria',
  'Fiambreria',
  'Congelados',
]

/**
 * Proveedores de demostracion.
 *
 * `contact` quedo congelada en la Fase 3C: el texto libre se repartio entre
 * `contactName`, `phone` y `email`. Uno queda a proposito con el nombre solo y
 * nada mas --que es lo que de verdad se sabe de la mitad de los proveedores de
 * un almacen-- y otro dado de baja, para que la pantalla muestre los dos
 * estados sin tener que tocar nada. Ver docs/SUPPLIER_MODEL.md.
 */
const PROVEEDORES = [
  {
    name: 'Distribuidora del Norte',
    legalName: 'Distribuidora del Norte S.R.L.',
    taxId: '30-71234567-4',
    contactName: 'Marisa',
    phone: '11-4567-8900',
    email: 'pedidos@dist-norte.example',
  },
  {
    name: 'Bebidas Andinas',
    taxId: '30-70987654-1',
    contactName: 'Julio',
    phone: '11-4321-7788',
    email: 'ventas@andinas.example',
    // Es el proveedor del circuito de compras de la demostracion, y el unico
    // con plazo pactado: 30 dias. Con esto las entregas nacen con vencimiento y
    // la pantalla de cuentas por pagar muestra algo. Los demas quedan en NULL,
    // que es la verdad de casi todos: nadie declaro el plazo.
    defaultPaymentTermDays: 30,
  },
  { name: 'Lacteos La Pradera', contactName: 'Don Alberto', phone: '11-6789-1234' },
  {
    name: 'Mayorista Central',
    email: 'mayorista@central.example',
    notes: 'Pasa los martes. No entrega los feriados.',
  },
  { name: 'Fiambres del Oeste', phone: '11-2233-4455', isActive: false },
]

const PRODUCTOS: SemillaProducto[] = [
  // Almacen
  { nombre: 'Yerba mate 1 kg', barcode: '7790001000011', alternativos: ['7790001099911'], categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 4850, costo: 3200, stock: 24 }, // prettier-ignore
  { nombre: 'Azucar 1 kg', barcode: '7790001000028', categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 1450, costo: 980, stock: 40 }, // prettier-ignore
  { nombre: 'Arroz largo fino 1 kg', barcode: '7790001000035', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 1780, costo: 1190, stock: 31 }, // prettier-ignore
  { nombre: 'Fideos guiseros 500 g', barcode: '7790001000042', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 1120, costo: 720, stock: 55 }, // prettier-ignore
  { nombre: 'Aceite de girasol 900 ml', barcode: '7790001000059', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 3290, costo: 2450, stock: 18 }, // prettier-ignore
  { nombre: 'Harina 000 1 kg', barcode: '7790001000066', categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 1290, costo: 850, stock: 4, descripcion: 'Reponer: rota rapido los fines de semana' }, // prettier-ignore
  { nombre: 'Pure de tomate 520 g', barcode: '7790001000073', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 1390, costo: 940, stock: 27 }, // prettier-ignore
  { nombre: 'Atun al natural 170 g', barcode: '7790001000080', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 2680, costo: 1990, stock: 12 }, // prettier-ignore
  { nombre: 'Cafe molido 250 g', barcode: '7790001000097', categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 5900, costo: 4300, stock: 9 }, // prettier-ignore
  { nombre: 'Galletitas dulces 300 g', barcode: '7790001000103', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 1850, costo: 1240, stock: 33 }, // prettier-ignore
  { nombre: 'Mermelada frutilla 420 g', barcode: '7790001000110', categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 2150, costo: 1480, stock: 0, descripcion: 'Agotado: pedido en camino' }, // prettier-ignore
  { nombre: 'Sal fina 500 g', barcode: '7790001000127', categoria: 'Almacen', proveedor: 'Mayorista Central', precio: 690, costo: 410, stock: 48 }, // prettier-ignore

  // Bebidas
  { nombre: 'Gaseosa cola 2.25 L', barcode: '7790002000014', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 3450, costo: 2500, stock: 36, unidadCompra: 'BOX', porUnidadDeCompra: 8, descripcion: 'Se compra por caja de 8 y se vende por botella' }, // prettier-ignore
  { nombre: 'Gaseosa lima limon 1.5 L', barcode: '7790002000021', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 2490, costo: 1750, stock: 22 }, // prettier-ignore
  { nombre: 'Agua mineral sin gas 2 L', barcode: '7790002000038', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 1490, costo: 950, stock: 44 }, // prettier-ignore
  { nombre: 'Cerveza rubia lata 473 ml', barcode: '7790002000045', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 2190, costo: 1560, stock: 60 }, // prettier-ignore
  { nombre: 'Jugo naranja 1 L', barcode: '7790002000052', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 1980, costo: 1340, stock: 3, descripcion: 'Stock bajo' }, // prettier-ignore
  { nombre: 'Vino tinto malbec 750 ml', barcode: '7790002000069', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 7400, costo: 5200, stock: 15 }, // prettier-ignore
  { nombre: 'Soda sifon 1.5 L', barcode: '7790002000076', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 1290, costo: 820, stock: 28 }, // prettier-ignore

  // Lacteos
  { nombre: 'Leche entera 1 L', barcode: '7790003000017', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 1690, costo: 1180, stock: 30 }, // prettier-ignore
  { nombre: 'Yogur bebible 900 g', barcode: '7790003000024', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 2890, costo: 2050, stock: 16 }, // prettier-ignore
  { nombre: 'Manteca 200 g', barcode: '7790003000031', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 2450, costo: 1780, stock: 11 }, // prettier-ignore
  { nombre: 'Queso cremoso', barcode: '7790003000048', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 9800, costo: 7200, stock: 6, unidad: 'KG', descripcion: 'Se vende por peso' }, // prettier-ignore
  { nombre: 'Dulce de leche 400 g', barcode: '7790003000055', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 2790, costo: 1950, stock: 19 }, // prettier-ignore

  // Panificados
  { nombre: 'Pan lactal 500 g', barcode: '7790004000010', categoria: 'Panificados', proveedor: 'Distribuidora del Norte', precio: 2350, costo: 1620, stock: 14 }, // prettier-ignore
  { nombre: 'Facturas x 6', barcode: '7790004000027', categoria: 'Panificados', proveedor: 'Distribuidora del Norte', precio: 3600, costo: 2400, stock: 8 }, // prettier-ignore
  { nombre: 'Prepizza x 2', barcode: '7790004000034', categoria: 'Panificados', proveedor: 'Distribuidora del Norte', precio: 2100, costo: 1420, stock: 0, descripcion: 'Agotado' }, // prettier-ignore

  // Limpieza
  { nombre: 'Lavandina 1 L', barcode: '7790005000013', categoria: 'Limpieza', proveedor: 'Mayorista Central', precio: 1350, costo: 880, stock: 26 }, // prettier-ignore
  { nombre: 'Detergente 750 ml', barcode: '7790005000020', categoria: 'Limpieza', proveedor: 'Mayorista Central', precio: 2280, costo: 1590, stock: 21 }, // prettier-ignore
  { nombre: 'Jabon en polvo 800 g', barcode: '7790005000037', categoria: 'Limpieza', proveedor: 'Mayorista Central', precio: 4150, costo: 2980, stock: 13 }, // prettier-ignore
  { nombre: 'Rollo de cocina x 3', barcode: '7790005000044', categoria: 'Limpieza', proveedor: 'Mayorista Central', precio: 3290, costo: 2310, stock: 17 }, // prettier-ignore
  { nombre: 'Esponja multiuso', barcode: '7790005000051', categoria: 'Limpieza', proveedor: 'Mayorista Central', precio: 780, costo: 440, stock: 52 }, // prettier-ignore

  // Perfumeria
  { nombre: 'Shampoo 400 ml', barcode: '7790006000016', categoria: 'Perfumeria', proveedor: 'Distribuidora del Norte', precio: 5200, costo: 3700, stock: 10 }, // prettier-ignore
  { nombre: 'Jabon de tocador x 3', barcode: '7790006000023', categoria: 'Perfumeria', proveedor: 'Distribuidora del Norte', precio: 2450, costo: 1690, stock: 23 }, // prettier-ignore
  { nombre: 'Papel higienico x 4', barcode: '7790006000030', categoria: 'Perfumeria', proveedor: 'Mayorista Central', precio: 4890, costo: 3500, stock: 29 }, // prettier-ignore
  { nombre: 'Pasta dental 90 g', barcode: '7790006000047', categoria: 'Perfumeria', proveedor: 'Distribuidora del Norte', precio: 2190, costo: 1480, stock: 2, descripcion: 'Stock critico' }, // prettier-ignore

  // Fiambreria
  { nombre: 'Jamon cocido x kg', barcode: '7790007000019', categoria: 'Fiambreria', proveedor: 'Lacteos La Pradera', precio: 12400, costo: 9100, stock: 5 }, // prettier-ignore
  { nombre: 'Salame milan x kg', barcode: '7790007000026', categoria: 'Fiambreria', proveedor: 'Lacteos La Pradera', precio: 15900, costo: 11800, stock: 4 }, // prettier-ignore
  { nombre: 'Queso de maquina x kg', barcode: '7790007000033', categoria: 'Fiambreria', proveedor: 'Lacteos La Pradera', precio: 11200, costo: 8300, stock: 7 }, // prettier-ignore

  // Congelados
  { nombre: 'Hamburguesas x 4', barcode: '7790008000012', categoria: 'Congelados', proveedor: 'Mayorista Central', precio: 5400, costo: 3900, stock: 18 }, // prettier-ignore
  { nombre: 'Papas bastón 1 kg', barcode: '7790008000029', categoria: 'Congelados', proveedor: 'Mayorista Central', precio: 4300, costo: 3050, stock: 12 }, // prettier-ignore
  { nombre: 'Helado 1 L', barcode: '7790008000036', categoria: 'Congelados', proveedor: 'Mayorista Central', precio: 6800, costo: 4900, stock: 0, descripcion: 'Agotado: freezer en reparacion' }, // prettier-ignore

  // Dado de baja: el proveedor lo discontinuo. Sirve para ver que no aparece
  // en la caja pero si en el catalogo, con su estado.
  { nombre: 'Gaseosa naranja 2 L (discontinuada)', barcode: '7790002000083', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 2990, costo: 2100, stock: 2, descripcion: 'El proveedor dejo de traerla', inactivo: true }, // prettier-ignore
]

const USUARIOS = [
  { username: 'admin', name: 'Ana Duarte', rol: 'admin' },
  { username: 'duenio', name: 'Hector Rivas', rol: 'duenio' },
  { username: 'encargado', name: 'Marina Sosa', rol: 'encargado' },
  { username: 'supervisor', name: 'Pablo Ferrer', rol: 'supervisor' },
  { username: 'cajero', name: 'Lucia Bravo', rol: 'cajero' },
  { username: 'repositor', name: 'Tomas Aguirre', rol: 'repositor' },
  { username: 'compras', name: 'Delia Moran', rol: 'compras' },
  { username: 'auditor', name: 'Ivan Peralta', rol: 'auditor' },
  { username: 'exempleado', name: 'Rocio Vega', rol: 'cajero', activo: false },
]

/**
 * Ventas ficticias.
 *
 * Los medios de pago son los tres que acepta `paymentMethodSchema`. Poner
 * otro no fallaria al sembrar --el seed escribe directo en la base-- pero
 * dejaria datos que la aplicacion no sabe leer.
 */
/**
 * Los medios del vocabulario de la Fase 3.
 *
 * Antes eran 'efectivo' | 'tarjeta' | 'mercado_pago'. La base tiene ahora un
 * CHECK con estos codigos, asi que el seed escribe los mismos que escribe la
 * aplicacion. Ver src/modules/sales/payment-methods.ts.
 */
type MedioDePago = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'TRANSFER'

const VENTAS: Array<{
  horas: number
  lineas: Array<[number, number]>
  medio: MedioDePago
  cajero: string
  anulada?: { motivo: string; horas: number; por: string }
}> = [
  { horas: 1, lineas: [[0, 1], [12, 2], [19, 1]], medio: 'CASH', cajero: 'cajero' }, // prettier-ignore
  { horas: 2, lineas: [[15, 6], [9, 2]], medio: 'DEBIT_CARD', cajero: 'cajero' }, // prettier-ignore
  { horas: 3, lineas: [[24, 1], [19, 2], [3, 3]], medio: 'CASH', cajero: 'cajero' }, // prettier-ignore
  { horas: 4, lineas: [[36, 1], [21, 1]], medio: 'DEBIT_CARD', cajero: 'supervisor' }, // prettier-ignore
  { horas: 5, lineas: [[13, 2], [29, 1], [31, 2]], medio: 'CASH', cajero: 'cajero' }, // prettier-ignore
  { horas: 6, lineas: [[17, 1], [22, 1]], medio: 'TRANSFER', cajero: 'encargado' }, // prettier-ignore
  {
    horas: 7,
    lineas: [
      [1, 2],
      [4, 1],
    ],
    medio: 'CASH',
    cajero: 'cajero',
    anulada: { motivo: 'El cliente se arrepintio antes de retirar', horas: 6, por: 'supervisor' },
  },
  { horas: 26, lineas: [[6, 2], [10, 1], [28, 1]], medio: 'CASH', cajero: 'cajero' }, // prettier-ignore
  { horas: 28, lineas: [[14, 3], [33, 1]], medio: 'DEBIT_CARD', cajero: 'supervisor' }, // prettier-ignore
  { horas: 30, lineas: [[38, 1], [23, 1], [2, 2]], medio: 'CASH', cajero: 'cajero' }, // prettier-ignore
  { horas: 50, lineas: [[7, 4]], medio: 'CASH', cajero: 'encargado' }, // prettier-ignore
  { horas: 52, lineas: [[25, 2], [20, 1]], medio: 'TRANSFER', cajero: 'cajero' }, // prettier-ignore
]

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const nombreBase = url.split('/').pop()?.split('?')[0] ?? ''
  if (!nombreBase.endsWith('_dev')) {
    throw new Error(
      `Este seed solo corre contra una base terminada en "_dev". Recibido: "${nombreBase || '(vacio)'}".`,
    )
  }

  console.log('Vaciando la base de desarrollo...')

  // El libro se vacia con TRUNCATE y no con deleteMany: un DELETE sobre
  // StockMovement lo rechaza el disparador de inmutabilidad, y esta bien que
  // lo rechace. TRUNCATE no dispara disparadores de fila y es la unica puerta,
  // reservada para vaciar una base descartable.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "StockMovement" CASCADE')
  // El historial de costos tiene el mismo disparador de inmutabilidad y se
  // vacia por la misma puerta. Los codigos de barras van con el producto
  // (ON DELETE CASCADE), pero se limpian igual por claridad del orden.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "ProductCostHistory" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "ProductBarcode" CASCADE')
  // Las recepciones tambien son inmutables por disparador: mismo trato.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseReceiptItem" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseReceipt" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseOrderItem" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseOrder" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "ProductSupplier" CASCADE')
  await prisma.$executeRawUnsafe('ALTER SEQUENCE "PurchaseOrder_numero_seq" RESTART WITH 1')

  // El libro de cuenta corriente y los cobros tambien tienen disparador de
  // inmutabilidad, y TRUNCATE no dispara disparadores de fila. Van antes que
  // las ventas: los referencian.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "CustomerAccountMovement" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "CustomerPayment" CASCADE')
  await prisma.$executeRawUnsafe('ALTER SEQUENCE "CustomerPayment_numero_seq" RESTART WITH 1')

  // Y el libro de proveedores, con la misma precaucion: las tres tablas de la
  // Fase 4B tienen disparador de inmutabilidad. El orden importa --las
  // imputaciones referencian a los pagos-- aunque CASCADE lo resolveria igual.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "SupplierPaymentAllocation" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "SupplierAccountMovement" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "SupplierPayment" CASCADE')
  await prisma.$executeRawUnsafe('ALTER SEQUENCE "SupplierPayment_numero_seq" RESTART WITH 1')

  // Y las devoluciones de la Fase 4C.
  //
  // A esta altura ya estan vacias: el `TRUNCATE ... CASCADE` de las recepciones,
  // unas lineas mas arriba, las arrastro por la clave foranea. Se escriben igual
  // --y no se mueven arriba-- porque un truncado que depende de un CASCADE ajeno
  // es exactamente lo que deja de funcionar el dia que alguien reordena el
  // archivo, y porque la secuencia SI hay que reiniciarla a mano: un DV-
  // heredado haria que la primera devolucion real chocara contra el indice
  // unico. Es el error que la Fase 4A cometio con los recibos.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseReturnItem" CASCADE')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "PurchaseReturn" CASCADE')
  await prisma.$executeRawUnsafe('ALTER SEQUENCE "PurchaseReturn_numero_seq" RESTART WITH 1')

  await prisma.stockCheck.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.salePayment.deleteMany()
  await prisma.cashRegisterMovement.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.client.deleteMany()
  await prisma.cashCount.deleteMany()
  await prisma.cashShift.deleteMany()
  await prisma.branchStock.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.role.deleteMany()
  await prisma.branch.deleteMany()

  const sucursal = await prisma.branch.create({
    data: {
      name: 'Almacen Centro',
      address: 'Belgrano 1450',
      email: 'centro@almacen.example',
      phone: '11-5555-0100',
      currentCash: 0,
    },
  })

  const sucursalNorte = await prisma.branch.create({
    data: {
      name: 'Almacen Norte',
      address: 'Rivadavia 88',
      email: 'norte@almacen.example',
      phone: '11-5555-0200',
      currentCash: 42_500,
    },
  })

  const roles = new Map<string, number>()
  for (const nombre of [
    'duenio',
    'admin',
    'encargado',
    'supervisor',
    'cajero',
    'vendedor',
    'repositor',
    'compras',
    'auditor',
  ]) {
    const r = await prisma.role.create({ data: { name: nombre } })
    roles.set(nombre, r.id)
  }

  const hash = await bcrypt.hash(CLAVE_DEMO, 10)
  const usuarios = new Map<string, number>()
  for (const u of USUARIOS) {
    const creado = await prisma.user.create({
      data: {
        username: u.username,
        name: u.name,
        password: hash,
        roleId: roles.get(u.rol) ?? 0,
        branchId: sucursal.id,
        isActive: u.activo ?? true,
      },
    })
    usuarios.set(u.username, creado.id)
  }
  // Un usuario en la otra sucursal, para poder comprobar el aislamiento a mano.
  const norte = await prisma.user.create({
    data: {
      username: 'norte',
      name: 'Carla Ibanez',
      password: hash,
      roleId: roles.get('encargado') ?? 0,
      branchId: sucursalNorte.id,
    },
  })
  usuarios.set('norte', norte.id)

  const categorias = new Map<string, number>()
  for (const nombre of CATEGORIAS) {
    const c = await prisma.category.create({ data: { name: nombre } })
    categorias.set(nombre, c.id)
  }

  const proveedores = new Map<string, number>()
  for (const p of PROVEEDORES) {
    const s = await prisma.supplier.create({ data: p })
    proveedores.set(p.name, s.id)
  }

  // Cuantas unidades de cada producto se venden de verdad --sin contar la
  // venta anulada, que devuelve lo que se llevo--.
  //
  // Hace falta ANTES de crear los productos: el campo `stock` de PRODUCTOS es
  // el stock que se quiere ver AL FINAL, asi que el saldo de partida tiene que
  // ser ese numero MAS lo que se vendio. La version anterior cargaba `stock`
  // como saldo inicial y despues descontaba las ventas, y por eso la mermelada
  // --declarada en 0 y con una venta de 1-- terminaba en -1.
  const vendidasPorProducto = new Map<number, number>()

  for (const v of VENTAS) {
    if (v.anulada) continue
    for (const [indice, cantidad] of v.lineas) {
      vendidasPorProducto.set(indice, (vendidasPorProducto.get(indice) ?? 0) + cantidad)
    }
  }

  const adminId = usuarios.get('admin') ?? 0

  const productos: Array<{ id: number; precio: number; costo: number }> = []
  for (const p of PRODUCTOS) {
    const creado = await prisma.product.create({
      data: {
        name: p.nombre,
        description: p.descripcion ?? null,
        price: p.precio,
        // El costo va a `cost`, su columna, desde la Fase 3B. Antes se
        // escribia en `value`, que es una columna muerta de mayo de 2025 y no
        // significaba nada.
        cost: p.costo,
        saleUnit: p.unidad ?? 'UNIT',
        purchaseUnit: p.unidadCompra ?? p.unidad ?? 'UNIT',
        unitsPerPurchaseUnit: p.porUnidadDeCompra ?? 1,
        // Los codigos viven en `ProductBarcode`: `Product.barcode` quedo
        // congelada. Ver docs/PHASE3_BARCODES.md.
        barcodes: {
          create: [
            { code: p.barcode, isPrimary: true },
            ...(p.alternativos ?? []).map((code) => ({ code, isPrimary: false })),
          ],
        },
        categoryId: categorias.get(p.categoria) ?? 0,
        // El proveedor vive en `ProductSupplier` desde la Fase 3C:
        // `Product.supplierId` quedo congelada. Ver docs/SUPPLIER_MODEL.md.
        suppliers: {
          create: [{ supplierId: proveedores.get(p.proveedor) ?? 0, isPreferred: true }],
        },
        branchId: sucursal.id,
        isActive: p.inactivo !== true,
        // Minimo de reposicion, inventado como todo lo demas de este archivo.
        // Un quinto del stock, nunca menos de cuatro: con esta regla los dos
        // productos que la descripcion marca como "reponer" y "stock bajo"
        // salen efectivamente bajo minimo, y la pantalla de stock muestra la
        // alerta funcionando en vez de una columna de ceros.
        minimumStock: Math.max(4, Math.ceil(p.stock / 5)),
      },
    })
    const inicial = p.stock + (vendidasPorProducto.get(PRODUCTOS.indexOf(p)) ?? 0)

    await prisma.branchStock.create({
      data: { branchId: sucursal.id, productId: creado.id, quantity: inicial },
    })

    // El saldo de partida, en el libro. Sin esto la base de demostracion
    // arranca con el stock y el libro diciendo cosas distintas, que es
    // exactamente lo que el libro existe para impedir.
    if (inicial > 0) {
      await prisma.stockMovement.create({
        data: {
          branchId: sucursal.id,
          productId: creado.id,
          type: 'INITIAL',
          quantity: inicial,
          previousQuantity: 0,
          resultingQuantity: inicial,
          userId: adminId,
          reason: 'Carga inicial del catalogo de demostracion',
          createdAt: haceDias(30),
        },
      })
    }

    productos.push({ id: creado.id, precio: p.precio, costo: p.costo })
  }

  let caja = 0

  // La caja abierta. Antes esto era un movimiento de tipo "ingreso"
  // llamado "Fondo de caja inicial"; ahora es lo que de verdad es: el monto
  // con el que se abrio el turno. Ver docs/CASH_SHIFT_MODEL.md.
  const turno = await prisma.cashShift.create({
    data: {
      branchId: sucursal.id,
      openedById: usuarios.get('encargado') ?? adminId,
      openedAt: haceDias(3),
      openingAmount: 25_000,
      status: 'open',
      openingNotes: 'Fondo de caja inicial.',
    },
  })
  caja += 25_000

  // La otra sucursal tambien abre: sin turno no se puede vender, y el seed
  // tiene que dejar las dos listas para trabajar.
  await prisma.cashShift.create({
    data: {
      branchId: sucursalNorte.id,
      openedById: usuarios.get('norte') ?? adminId,
      openedAt: haceDias(1),
      openingAmount: 42_500,
      status: 'open',
    },
  })

  // -------------------------------------------------------------------------
  // El circuito de compras, entero
  //
  // Una orden con dos lineas, recibida en DOS entregas: primero una parte, y
  // dias despues el resto. Es el caso que da sentido a que la recepcion sea
  // una entidad aparte de la orden, y el que hay que poder mirar en pantalla.
  //
  // Todo respeta las mismas invariantes que la aplicacion: el numero sale de
  // la secuencia, el total lo calcula esta funcion linea por linea, el stock
  // entra por el libro y el costo deja historial apuntando a la RECEPCION.
  // -------------------------------------------------------------------------
  const compradorId = usuarios.get('compras') ?? adminId
  const proveedorCompra = proveedores.get('Distribuidora del Norte') ?? 0

  /** El siguiente numero de la secuencia, igual que el servicio real. */
  async function siguienteNumeroDeOrden(): Promise<string> {
    const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT nextval('"PurchaseOrder_numero_seq"') AS n
    `
    return `OC-${String(filas[0]?.n ?? 1).padStart(8, '0')}`
  }

  // Dos productos del catalogo, con su costo actual como costo pedido.
  const paraComprar = [0, 5]
    .map((i) => productos[i])
    .filter((x): x is { id: number; precio: number; costo: number } => x !== undefined)

  if (paraComprar.length === 2) {
    const lineasCompra = paraComprar.map((prod, i) => ({
      productId: prod.id,
      // Se piden 12 y 20 unidades. Compra por unidad: el factor es 1.
      orderedQuantity: i === 0 ? 12 : 20,
      unitCost: prod.costo,
    }))
    const totalOrden = lineasCompra.reduce(
      (acc, l) => acc + Math.round(l.orderedQuantity * l.unitCost * 100) / 100,
      0,
    )

    const orden = await prisma.purchaseOrder.create({
      data: {
        number: await siguienteNumeroDeOrden(),
        branchId: sucursal.id,
        supplierId: proveedorCompra,
        createdById: compradorId,
        status: 'PARTIALLY_RECEIVED',
        createdAt: haceDias(6),
        orderedAt: haceDias(6),
        notes: 'Reposicion semanal.',
        expectedTotal: totalOrden,
        items: {
          create: lineasCompra.map((l) => ({
            productId: l.productId,
            orderedQuantity: l.orderedQuantity,
            // La primera linea llego entera; la segunda, a medias.
            receivedQuantity: 0,
            purchaseUnit: 'UNIT',
            unitsPerPurchaseUnit: 1,
            unitCost: l.unitCost,
            subtotal: Math.round(l.orderedQuantity * l.unitCost * 100) / 100,
          })),
        },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    })

    /**
     * Una entrega: crea la recepcion, mueve el stock y actualiza el costo.
     *
     * Hace exactamente lo mismo que `recibirMercaderia`, en el mismo orden y
     * con las mismas reglas. Si el seed se apartara, la reconciliacion lo
     * marcaria --que es la unica forma de que un seed sirva para probar algo--.
     */
    async function recibir(
      entregas: Array<{ itemId: number; productId: number; cantidad: number; costo: number }>,
      cuando: Date,
      nota: string,
    ): Promise<void> {
      // El importe de la obligacion, al costo REAL. Se calcula ANTES de crear
      // la cabecera porque la fila es inmutable: `total` va en el INSERT.
      const totalDeLaEntrega = entregas.reduce(
        (acc, e) => acc + Math.round(e.cantidad * e.costo * 100) / 100,
        0,
      )

      const recepcion = await prisma.purchaseReceipt.create({
        data: {
          purchaseOrderId: orden.id,
          branchId: sucursal.id,
          receivedById: compradorId,
          receivedAt: cuando,
          notes: nota,
          total: totalDeLaEntrega,
          // 30 dias desde la entrega, que es el plazo del proveedor de la
          // demostracion. Congelado, como en el servicio.
          dueDate: new Date(cuando.getTime() + 30 * 24 * 60 * 60 * 1000),
          debtRecorded: true,
        },
      })

      // Y la deuda. En la DEMOSTRACION si se crea --el objetivo 36 dice "para
      // demo/tests si crear datos explicitos"-- porque aca la deuda es
      // inventada a proposito y se sabe. En produccion la migracion no genera
      // ninguna: una entrega de hace seis meses casi con seguridad ya se pago.
      await moverCuentaDeProveedor({
        branchId: sucursal.id,
        supplierId: proveedorCompra,
        type: 'PURCHASE_CHARGE',
        monto: totalDeLaEntrega,
        userId: compradorId,
        receiptId: recepcion.id,
        fecha: cuando,
      })

      for (const e of entregas) {
        await prisma.purchaseReceiptItem.create({
          data: {
            purchaseReceiptId: recepcion.id,
            purchaseOrderItemId: e.itemId,
            productId: e.productId,
            receivedQuantity: e.cantidad,
            purchaseUnit: 'UNIT',
            unitsPerPurchaseUnit: 1,
            unitCost: e.costo,
            expectedUnitCost: e.costo,
            stockQuantity: e.cantidad,
            stockUnitCost: e.costo,
          },
        })

        await prisma.purchaseOrderItem.update({
          where: { id: e.itemId },
          data: { receivedQuantity: { increment: e.cantidad } },
        })

        await moverStock({
          branchId: sucursal.id,
          productId: e.productId,
          type: 'PURCHASE_RECEIPT',
          delta: e.cantidad,
          userId: compradorId,
          referenceType: 'PurchaseReceipt',
          referenceId: recepcion.id,
          reason: `Recepcion de ${orden.number}`,
          fecha: cuando,
        })

        // El costo, solo si cambio. Politica: ultima recepcion recibida.
        const actual = await prisma.product.findUniqueOrThrow({
          where: { id: e.productId },
          select: { cost: true },
        })
        const nuevo = new Prisma.Decimal(e.costo)
        if (actual.cost === null || !actual.cost.equals(nuevo)) {
          await prisma.product.update({ where: { id: e.productId }, data: { cost: nuevo } })
          await prisma.productCostHistory.create({
            data: {
              productId: e.productId,
              previousCost: actual.cost,
              newCost: nuevo,
              supplierId: proveedorCompra,
              receiptId: recepcion.id,
              userId: compradorId,
              reason: `Recepcion de ${orden.number}`,
              createdAt: cuando,
            },
          })
        }
      }
    }

    const linea1 = orden.items[0]
    const linea2 = orden.items[1]

    if (linea1 && linea2) {
      // Lunes: llega la primera linea entera y la mitad de la segunda.
      const primero = paraComprar[0]
      const segundo = paraComprar[1]
      if (!primero || !segundo) throw new Error('faltan productos para la compra de demostracion')

      await recibir(
        [
          { itemId: linea1.id, productId: linea1.productId, cantidad: 12, costo: primero.costo },
          { itemId: linea2.id, productId: linea2.productId, cantidad: 10, costo: segundo.costo },
        ],
        haceDias(4),
        'Vino el camion sin la mitad de la harina.',
      )

      // Jueves: llega el resto, y MAS CARO. La diferencia queda registrada y
      // el costo del producto pasa a ser el nuevo.
      const costoNuevo = Math.round(segundo.costo * 1.08 * 100) / 100
      await recibir(
        [{ itemId: linea2.id, productId: linea2.productId, cantidad: 10, costo: costoNuevo }],
        haceDias(1),
        'Completan lo que faltaba. Aumento del 8%.',
      )

      // El estado se DERIVA de lo recibido, igual que en el servicio.
      await prisma.purchaseOrder.update({
        where: { id: orden.id },
        data: { status: 'RECEIVED' },
      })

      // Y UN PAGO PARCIAL, por transferencia. Fase 4B.
      //
      // Parcial a proposito: asi la pantalla de cuentas por pagar muestra los
      // tres estados a la vez --una entrega saldada, una a medias y el saldo
      // pendiente-- sin que haya que tocar nada. Y por transferencia, que es lo
      // normal con un proveedor y ademas deja ver la regla que mas se confunde:
      // baja la deuda y NO baja el cajon.
      const primeraEntrega = await prisma.purchaseReceipt.findFirstOrThrow({
        where: { purchaseOrderId: orden.id },
        orderBy: { id: 'asc' },
        select: { id: true, total: true },
      })

      const pago = await prisma.supplierPayment.create({
        data: {
          number: `PP-${String(1).padStart(8, '0')}`,
          branchId: sucursal.id,
          supplierId: proveedorCompra,
          amount: primeraEntrega.total,
          method: 'TRANSFER',
          paidById: compradorId,
          paidAt: haceDias(2),
          reference: 'Transferencia 0044-19822',
          notes: 'A cuenta de la entrega del lunes.',
          createdAt: haceDias(2),
        },
      })
      // La secuencia tiene que quedar donde termino el numero escrito a mano, o
      // el primer pago real desde la pantalla chocaria contra el indice unico.
      // Es el error que la Fase 4A cometio con los recibos y encontro el E2E.
      await prisma.$executeRawUnsafe(`SELECT setval('"SupplierPayment_numero_seq"', 1, true)`)

      await moverCuentaDeProveedor({
        branchId: sucursal.id,
        supplierId: proveedorCompra,
        type: 'PAYMENT',
        monto: -Number(primeraEntrega.total),
        userId: compradorId,
        paymentId: pago.id,
        fecha: haceDias(2),
      })

      // La imputacion: este pago cancela ESA entrega, entera.
      await prisma.supplierPaymentAllocation.create({
        data: {
          paymentId: pago.id,
          receiptId: primeraEntrega.id,
          amount: primeraEntrega.total,
          // Fase 4C: quien imputo. En la 4B era siempre quien pagaba, porque no
          // habia otro camino; ahora la columna existe y hay que decirlo.
          createdById: compradorId,
          createdAt: haceDias(2),
        },
      })
    }
  }

  // -------------------------------------------------------------------------
  // Fase 4C — dos casos que sin datos no se pueden mirar en pantalla
  //
  //   A) UN ANTICIPO que se aplica despues. $15.000 entregados sin nada que
  //      cancelar, una entrega posterior de $10.000, y $5.000 que siguen a
  //      favor. Es el circuito entero del objetivo 30 en tres pasos.
  //
  //   B) UNA DEVOLUCION sobre una entrega que ya estaba en el libro. Baja el
  //      stock, acredita al proveedor y corrige el saldo, sin tocar ni la
  //      recepcion ni el pago que ya existian.
  //
  // Todo con las mismas reglas del servicio: el numero sale de la secuencia, el
  // importe se calcula, el stock entra por el libro y el saldo por el suyo. Si
  // el seed se apartara, la reconciliacion lo marcaria.
  // -------------------------------------------------------------------------
  const proveedorAnticipo = proveedores.get('Bebidas Andinas') ?? 0
  const productoAnticipo = productos[3]

  if (proveedorAnticipo !== 0 && productoAnticipo !== undefined) {
    // A.1 — El anticipo. Sin recepcion y sin imputacion: nace suelto.
    const anticipo = await prisma.supplierPayment.create({
      data: {
        number: `PP-${String(2).padStart(8, '0')}`,
        branchId: sucursal.id,
        supplierId: proveedorAnticipo,
        amount: 15_000,
        method: 'TRANSFER',
        paidById: compradorId,
        paidAt: haceDias(9),
        reference: 'Transferencia 0051-33107',
        notes: 'Anticipo para asegurar la entrega de gaseosas.',
        createdAt: haceDias(9),
      },
    })
    await prisma.$executeRawUnsafe(`SELECT setval('"SupplierPayment_numero_seq"', 2, true)`)

    // El saldo queda NEGATIVO: le pagamos sin deberle nada.
    await moverCuentaDeProveedor({
      branchId: sucursal.id,
      supplierId: proveedorAnticipo,
      type: 'PAYMENT',
      monto: -15_000,
      userId: compradorId,
      paymentId: anticipo.id,
      fecha: haceDias(9),
    })

    // A.2 — La entrega posterior, de $10.000. Nace la obligacion.
    const cantidadAnticipo = 10
    const costoAnticipo = Math.round((10_000 / cantidadAnticipo) * 100) / 100
    const ordenAnticipo = await prisma.purchaseOrder.create({
      data: {
        number: await siguienteNumeroDeOrden(),
        branchId: sucursal.id,
        supplierId: proveedorAnticipo,
        createdById: compradorId,
        status: 'RECEIVED',
        createdAt: haceDias(7),
        orderedAt: haceDias(7),
        notes: 'Contra el anticipo de la semana pasada.',
        expectedTotal: 10_000,
        items: {
          create: [
            {
              productId: productoAnticipo.id,
              orderedQuantity: cantidadAnticipo,
              receivedQuantity: cantidadAnticipo,
              purchaseUnit: 'UNIT',
              unitsPerPurchaseUnit: 1,
              unitCost: costoAnticipo,
              subtotal: 10_000,
            },
          ],
        },
      },
      include: { items: true },
    })
    const lineaAnticipo = ordenAnticipo.items[0]

    if (lineaAnticipo) {
      const entregaAnticipo = await prisma.purchaseReceipt.create({
        data: {
          purchaseOrderId: ordenAnticipo.id,
          branchId: sucursal.id,
          receivedById: compradorId,
          receivedAt: haceDias(6),
          notes: 'Entregado completo.',
          total: 10_000,
          dueDate: new Date(haceDias(6).getTime() + 30 * 24 * 60 * 60 * 1000),
          debtRecorded: true,
        },
      })

      await moverCuentaDeProveedor({
        branchId: sucursal.id,
        supplierId: proveedorAnticipo,
        type: 'PURCHASE_CHARGE',
        monto: 10_000,
        userId: compradorId,
        receiptId: entregaAnticipo.id,
        fecha: haceDias(6),
      })

      await prisma.purchaseReceiptItem.create({
        data: {
          purchaseReceiptId: entregaAnticipo.id,
          purchaseOrderItemId: lineaAnticipo.id,
          productId: productoAnticipo.id,
          receivedQuantity: cantidadAnticipo,
          purchaseUnit: 'UNIT',
          unitsPerPurchaseUnit: 1,
          unitCost: costoAnticipo,
          expectedUnitCost: costoAnticipo,
          stockQuantity: cantidadAnticipo,
          stockUnitCost: costoAnticipo,
        },
      })

      await moverStock({
        branchId: sucursal.id,
        productId: productoAnticipo.id,
        type: 'PURCHASE_RECEIPT',
        delta: cantidadAnticipo,
        userId: compradorId,
        referenceType: 'PurchaseReceipt',
        referenceId: entregaAnticipo.id,
        reason: `Recepcion de ${ordenAnticipo.number}`,
        fecha: haceDias(6),
      })

      // A.3 — LA IMPUTACION DIFERIDA. Los $10.000 del anticipo se aplican a esta
      //       entrega, y NO se toca el saldo: ya habia bajado al entregarlos.
      //       Quedan $5.000 disponibles para la proxima compra.
      await prisma.supplierPaymentAllocation.create({
        data: {
          paymentId: anticipo.id,
          receiptId: entregaAnticipo.id,
          amount: 10_000,
          createdById: compradorId,
          createdAt: haceDias(6),
        },
      })
    }
  }

  // B — La devolucion, sobre la segunda entrega de la orden de arriba.
  //
  // Se elige la SEGUNDA a proposito: la primera esta paga y saldada, y devolver
  // de ella dejaria el caso "credito a favor por mercaderia ya pagada", que es
  // valioso pero mas dificil de leer en una demostracion. Sobre la segunda, que
  // esta pendiente, se ve lo que hay que ver: baja el stock, baja la deuda.
  const entregaADevolver = await prisma.purchaseReceipt.findFirst({
    where: { order: { supplierId: proveedorCompra } },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      branchId: true,
      items: { select: { id: true, productId: true, unitCost: true }, take: 1 },
    },
  })
  const renglonADevolver = entregaADevolver?.items[0]

  if (entregaADevolver && renglonADevolver) {
    const cantidadDevuelta = 2
    const importeDevuelto =
      Math.round(Number(renglonADevolver.unitCost) * cantidadDevuelta * 100) / 100

    const devolucion = await prisma.purchaseReturn.create({
      data: {
        number: `DV-${String(1).padStart(8, '0')}`,
        branchId: sucursal.id,
        supplierId: proveedorCompra,
        purchaseReceiptId: entregaADevolver.id,
        status: 'CONFIRMED',
        reason: 'DAMAGED',
        notes: 'Dos paquetes llegaron abiertos.',
        total: importeDevuelto,
        createdById: compradorId,
        createdAt: haceDias(1),
        confirmedById: compradorId,
        confirmedAt: haceDias(1),
        items: {
          create: [
            {
              productId: renglonADevolver.productId,
              purchaseReceiptItemId: renglonADevolver.id,
              quantity: cantidadDevuelta,
              purchaseUnit: 'UNIT',
              unitsPerPurchaseUnit: 1,
              stockQuantity: cantidadDevuelta,
              // EL COSTO DE LA RECEPCION, no el de hoy. Es el objetivo 10, y en
              // esta entrega se nota: llego con un aumento del 8 %.
              unitCost: renglonADevolver.unitCost,
              amount: importeDevuelto,
            },
          ],
        },
      },
    })
    await prisma.$executeRawUnsafe(`SELECT setval('"PurchaseReturn_numero_seq"', 1, true)`)

    // La mercaderia sale, por el libro de inventario.
    await moverStock({
      branchId: sucursal.id,
      productId: renglonADevolver.productId,
      type: 'PURCHASE_RETURN',
      delta: -cantidadDevuelta,
      userId: compradorId,
      referenceType: 'PurchaseReturn',
      referenceId: devolucion.id,
      reason: `Devolucion ${devolucion.number}`,
      fecha: haceDias(1),
    })

    // Y el credito, por el libro del proveedor. Con `returnId`: la
    // reconciliacion comprueba que el importe coincida con el de la devolucion.
    await moverCuentaDeProveedor({
      branchId: sucursal.id,
      supplierId: proveedorCompra,
      type: 'PURCHASE_CREDIT',
      monto: -importeDevuelto,
      userId: compradorId,
      returnId: devolucion.id,
      reason: `Devolución ${devolucion.number} · Llegó dañada`,
      reference: devolucion.number,
      fecha: haceDias(1),
    })
  }

  // Y una orden confirmada que todavia no llego: el panel tiene que mostrar
  // "compras esperando mercaderia" con algo adentro.
  const otroProducto = productos[2]
  if (otroProducto) {
    await prisma.purchaseOrder.create({
      data: {
        number: await siguienteNumeroDeOrden(),
        branchId: sucursal.id,
        supplierId: proveedores.get('Mayorista Central') ?? 0,
        createdById: compradorId,
        status: 'ORDERED',
        createdAt: haceDias(2),
        orderedAt: haceDias(2),
        notes: 'Entrega prometida para el viernes.',
        expectedTotal: Math.round(30 * otroProducto.costo * 100) / 100,
        items: {
          create: [
            {
              productId: otroProducto.id,
              orderedQuantity: 30,
              receivedQuantity: 0,
              purchaseUnit: 'UNIT',
              unitsPerPurchaseUnit: 1,
              unitCost: otroProducto.costo,
              subtotal: Math.round(30 * otroProducto.costo * 100) / 100,
            },
          ],
        },
      },
    })
  }

  for (const v of VENTAS) {
    const fecha = haceHoras(v.horas)
    const userId = usuarios.get(v.cajero) ?? adminId
    const lineas = v.lineas.map(([indice, cantidad]) => {
      const prod = productos[indice]
      if (!prod) throw new Error(`indice de producto invalido: ${indice}`)
      // `costAtSale` se congela igual que el precio: sin el, la rentabilidad
      // de estas ventas se recalcularia con el costo de hoy y cambiaria sola
      // cada vez que llega mercaderia. Ver docs/REPORTING_MODEL.md.
      return {
        productId: prod.id,
        quantity: cantidad,
        price: prod.precio,
        costAtSale: prod.costo,
      }
    })
    const total = lineas.reduce((acc, l) => acc + l.price * l.quantity, 0)

    const venta = await prisma.sale.create({
      data: {
        userId,
        branchId: sucursal.id,
        date: fecha,
        createdAt: fecha,
        status: v.anulada ? 'canceled' : 'completed',
        canceledAt: v.anulada ? haceHoras(v.anulada.horas) : null,
        canceledById: v.anulada ? (usuarios.get(v.anulada.por) ?? adminId) : null,
        cancelReason: v.anulada?.motivo ?? null,
        total,
        items: { create: lineas },
        // Un pago por venta: el seed no genera pagos combinados, pero la
        // entidad existe y la suma tiene que dar el total igual.
        payments: { create: [{ method: v.medio, amount: total, createdAt: fecha }] },
      },
    })

    // El stock, por el libro.
    //
    // TODA venta descuenta, incluida la anulada: eso fue lo que paso. La
    // anulacion agrega despues su movimiento inverso, y la suma de los dos da
    // cero. La version anterior salteaba la venta anulada y ademas descontaba
    // sin comprobar nada, y por eso dejaba stock negativo.
    for (const l of lineas) {
      await moverStock({
        branchId: sucursal.id,
        productId: l.productId,
        type: 'SALE',
        delta: -l.quantity,
        userId,
        referenceId: venta.id,
        fecha,
      })
    }

    if (v.anulada) {
      const anuladaPor = usuarios.get(v.anulada.por) ?? adminId
      for (const l of lineas) {
        await moverStock({
          branchId: sucursal.id,
          productId: l.productId,
          type: 'SALE_CANCEL',
          delta: l.quantity,
          userId: anuladaPor,
          referenceId: venta.id,
          reason: v.anulada.motivo,
          fecha: haceHoras(v.anulada.horas),
        })
      }
    }

    // `type: 'sale'` no es decorativo: es por donde el reporte de ventas
    // encuentra el medio de pago. Con otro tipo, la venta figura como
    // "sin registrar".
    await prisma.cashRegisterMovement.create({
      data: {
        branchId: sucursal.id,
        userId,
        amount: total,
        paymentMethod: v.medio,
        description: `Venta #${venta.id}`,
        type: 'sale',
        date: fecha,
        saleId: venta.id,
      },
    })
    // Solo el efectivo mueve el dinero del cajon, igual que en el servicio.
    if (v.medio === 'CASH') caja += total

    if (v.anulada) {
      await prisma.cashRegisterMovement.create({
        data: {
          branchId: sucursal.id,
          userId: usuarios.get(v.anulada.por) ?? adminId,
          // Contramovimiento con importe negativo, como lo escribe la
          // anulacion real. El original no se toca.
          amount: -total,
          paymentMethod: v.medio,
          description: `Anulacion de venta #${venta.id}: ${v.anulada.motivo}`,
          type: 'sale_cancel',
          date: haceHoras(v.anulada.horas),
          saleId: venta.id,
        },
      })
      if (v.medio === 'CASH') caja -= total

      await prisma.auditLog.create({
        data: {
          userId: usuarios.get(v.anulada.por) ?? adminId,
          branchId: sucursal.id,
          tableName: 'Sale',
          recordId: venta.id,
          actionType: 'CANCEL',
          changes: { before: { status: 'completed' }, after: { status: 'canceled' } },
          reason: v.anulada.motivo,
          origin: 'seed-demo',
          requestId: `demo-${venta.id.toString().padStart(8, '0')}`,
          result: 'success',
          timestamp: haceHoras(v.anulada.horas),
        },
      })
    }
  }

  /*
   * Movimientos manuales.
   *
   * Los tipos son los de `TIPOS_MOVIMIENTO` y el importe va con el signo que
   * les pone el servidor: negativo en los retiros.
   */
  const manuales: Array<{
    monto: number
    tipo: 'ingreso' | 'retiro' | 'deposito'
    desc: string
    horas: number
  }> = [
    { monto: 8_500, tipo: 'retiro', desc: 'Pago a proveedor de panificados', horas: 27 },
    { monto: 3_200, tipo: 'retiro', desc: 'Compra de bolsas', horas: 25 },
    { monto: 15_000, tipo: 'retiro', desc: 'Retiro de efectivo del turno', horas: 5 },
    { monto: 4_000, tipo: 'ingreso', desc: 'Devolucion de proveedor', horas: 29 },
  ]
  for (const m of manuales) {
    const importe = m.tipo === 'retiro' ? -m.monto : m.monto
    await prisma.cashRegisterMovement.create({
      data: {
        branchId: sucursal.id,
        userId: usuarios.get('encargado') ?? adminId,
        amount: importe,
        paymentMethod: 'CASH',
        description: m.desc,
        type: m.tipo,
        date: haceHoras(m.horas),
      },
    })
    caja += importe
  }

  await prisma.branch.update({ where: { id: sucursal.id }, data: { currentCash: caja } })

  // Los movimientos se crearon sueltos por comodidad; aca se enganchan todos
  // al turno de una sola vez. En la aplicacion real el `shiftId` lo pone el
  // servicio en el momento de crear cada uno.
  await prisma.cashRegisterMovement.updateMany({
    where: { branchId: sucursal.id, shiftId: null },
    data: { shiftId: turno.id },
  })

  // -------------------------------------------------------------------------
  // Un turno CERRADO, con su diferencia
  //
  // El turno abierto de arriba muestra la operacion del dia; este muestra como
  // queda un cierre. `expectedAmount` NO se inventa: se deriva de sus propios
  // movimientos, que es la invariante que comprueba `npm run integrity:check`.
  // -------------------------------------------------------------------------
  const APERTURA_CERRADO = 18_000
  const VENTA_CERRADO = 34_500
  const RETIRO_CERRADO = -12_000
  const esperadoCerrado = APERTURA_CERRADO + VENTA_CERRADO + RETIRO_CERRADO
  const CONTADO_CERRADO = esperadoCerrado - 850 // falto plata: pasa, y hay que verlo

  const turnoCerrado = await prisma.cashShift.create({
    data: {
      branchId: sucursal.id,
      openedById: usuarios.get('cajero') ?? adminId,
      closedById: usuarios.get('encargado') ?? adminId,
      openedAt: haceDias(5),
      closedAt: haceDias(5 - 1),
      openingAmount: APERTURA_CERRADO,
      expectedAmount: esperadoCerrado,
      countedAmount: CONTADO_CERRADO,
      difference: CONTADO_CERRADO - esperadoCerrado,
      status: 'closed',
      openingNotes: 'Turno de la manana.',
      closingNotes: 'Faltan $850. Se revisa el vuelto de la manana.',
    },
  })

  // Los dos movimientos que sostienen ese esperado. Sin ellos la derivacion no
  // daria, y la reconciliacion lo diria.
  await prisma.cashRegisterMovement.createMany({
    data: [
      {
        branchId: sucursal.id,
        userId: usuarios.get('cajero') ?? adminId,
        amount: VENTA_CERRADO,
        paymentMethod: 'CASH',
        description: 'Ventas del turno de la manana',
        type: 'ingreso',
        date: haceDias(5),
        shiftId: turnoCerrado.id,
      },
      {
        branchId: sucursal.id,
        userId: usuarios.get('encargado') ?? adminId,
        amount: RETIRO_CERRADO,
        paymentMethod: 'CASH',
        description: 'Retiro para deposito',
        type: 'retiro',
        date: haceDias(5),
        shiftId: turnoCerrado.id,
      },
    ],
  })

  // Arqueos: uno cuadrado y uno con diferencia.
  await prisma.cashCount.create({
    data: {
      branchId: sucursal.id,
      shiftId: turno.id,
      userId: usuarios.get('encargado') ?? adminId,
      amount: 118_400,
      notes: 'Cierre del turno tarde. Cuadra.',
      date: haceHoras(24),
    },
  })
  await prisma.cashCount.create({
    data: {
      branchId: sucursal.id,
      shiftId: turno.id,
      userId: usuarios.get('supervisor') ?? adminId,
      amount: 96_000,
      notes: 'Faltan 1.200. Se revisa el ticket de la tarde.',
      date: haceHoras(4),
    },
  })

  // Bitacora de ejemplo: alta de producto, cambio de precio, ajuste de stock,
  // login fallido y un rechazo por permiso.
  const primero = productos[0]
  if (primero) {
    await prisma.auditLog.createMany({
      data: [
        {
          userId: usuarios.get('compras') ?? adminId,
          branchId: sucursal.id,
          tableName: 'Product',
          recordId: primero.id,
          actionType: 'CREATE',
          changes: { before: null, after: { name: 'Yerba mate 1 kg', price: 4500 } },
          origin: 'seed-demo',
          requestId: 'demo-00000101',
          result: 'success',
          timestamp: haceDias(9),
        },
        {
          userId: usuarios.get('encargado') ?? adminId,
          branchId: sucursal.id,
          tableName: 'Product',
          recordId: primero.id,
          actionType: 'UPDATE',
          changes: { before: { price: 4500 }, after: { price: 4850 } },
          reason: 'Actualizacion de lista del proveedor',
          origin: 'seed-demo',
          requestId: 'demo-00000102',
          result: 'success',
          timestamp: haceDias(2),
        },
        {
          userId: usuarios.get('repositor') ?? adminId,
          branchId: sucursal.id,
          tableName: 'BranchStock',
          recordId: primero.id,
          actionType: 'UPDATE',
          changes: { before: { quantity: 30 }, after: { quantity: 24 } },
          reason: 'Rotura de mercaderia',
          origin: 'seed-demo',
          requestId: 'demo-00000103',
          result: 'success',
          timestamp: haceHoras(31),
        },
        {
          userId: usuarios.get('cajero') ?? adminId,
          branchId: sucursal.id,
          tableName: 'User',
          recordId: usuarios.get('cajero') ?? adminId,
          actionType: 'LOGIN_FAILED',
          // Sin `changes`: un intento fallido no tiene antes ni despues.
          origin: 'seed-demo',
          requestId: 'demo-00000104',
          result: 'failure',
          timestamp: haceHoras(9),
        },
        {
          userId: usuarios.get('repositor') ?? adminId,
          branchId: sucursal.id,
          tableName: 'Sale',
          recordId: null,
          actionType: 'deny',
          changes: { before: null, after: { permiso: 'sales.cancel' } },
          origin: 'seed-demo',
          requestId: 'demo-00000105',
          result: 'failure',
          timestamp: haceHoras(8),
        },
      ],
    })
  }

  // ---------------------------------------------------------------------------
  // Clientes y cuenta corriente
  //
  // El circuito completo de la Fase 4A, con los numeros del ejemplo del pedido:
  //
  //   Juan     venta $30.000 = $10.000 efectivo + $20.000 a cuenta
  //            paga $8.000 por transferencia          → saldo $12.000
  //            segunda venta fiada de $5.000          → saldo $17.000
  //   Marta    sin limite configurado, compra fiada y no debe nada todavia
  //   Raul     el fiado cortado. Sigue comprando de contado.
  //
  // Todo se escribe respetando LAS MISMAS invariantes que comprueba
  // `npm run integrity:check`: cada movimiento lleva sus dos saldos, la cadena
  // es continua, el fiado tiene su linea `ACCOUNT` en la venta y el cobro en
  // efectivo --que aca no lo hay-- entraria al cajon. Un seed que no cierra
  // haria fallar la comprobacion por culpa de los datos de ejemplo.
  // ---------------------------------------------------------------------------
  const cajeroId = usuarios.get('cajero') ?? adminId
  const encargadoId = usuarios.get('encargado') ?? adminId

  const [juan, marta, raul] = await Promise.all([
    prisma.client.create({
      data: {
        branchId: sucursal.id,
        name: 'Juan Pérez',
        phone: '11-5555-1234',
        document: '28.444.555',
        creditLimit: 50_000,
      },
    }),
    prisma.client.create({
      data: {
        branchId: sucursal.id,
        name: 'Marta Gómez',
        phone: '11-4444-9876',
        notes: 'Pasa los viernes.',
      },
    }),
    prisma.client.create({
      data: {
        branchId: sucursal.id,
        name: 'Raúl Sosa',
        phone: '11-3333-2211',
        creditLimit: 20_000,
        isCreditEnabled: false,
        notes: 'Fiado cortado desde marzo. Compra de contado.',
      },
    }),
  ])

  /**
   * El siguiente numero de comprobante, igual que el servicio real.
   *
   * Se pide a la SECUENCIA y no se escribe a mano. Escribirlo a mano fue el
   * primer intento y lo encontro la suite de extremo a extremo: el seed dejaba
   * `RC-00000001` en la tabla con la secuencia todavia en 1, y el primer cobro
   * de verdad chocaba contra el indice unico. La persona que cobra veia
   * "Ya existe un registro con esos datos" sin haber hecho nada mal.
   */
  async function siguienteNumeroDeRecibo(): Promise<string> {
    const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT nextval('"CustomerPayment_numero_seq"') AS n
    `
    return `RC-${String(filas[0]?.n ?? 1).padStart(8, '0')}`
  }

  /**
   * Escribe un movimiento de cuenta y deja el saldo del cliente al dia.
   *
   * Es el equivalente de `moverStock` para la cuenta corriente: el seed no
   * puede llamar a `applyAccountMovement` --vive en `src/` y trae toda la
   * aplicacion-- pero SI tiene que dejar la base como la dejaria esa funcion.
   */
  async function moverCuenta(m: {
    clientId: number
    type: 'SALE_CHARGE' | 'PAYMENT' | 'SALE_CANCEL' | 'MANUAL_ADJUSTMENT'
    amount: number
    userId: number
    saleId?: number
    paymentId?: number
    reason?: string
    createdAt: Date
  }): Promise<void> {
    const antes = await prisma.client.findUniqueOrThrow({
      where: { id: m.clientId },
      select: { balance: true },
    })
    const previo = Number(antes.balance)
    const resultante = previo + m.amount

    await prisma.client.update({
      where: { id: m.clientId },
      data: { balance: resultante },
    })

    await prisma.customerAccountMovement.create({
      data: {
        branchId: sucursal.id,
        clientId: m.clientId,
        type: m.type,
        amount: m.amount,
        previousBalance: previo,
        resultingBalance: resultante,
        saleId: m.saleId ?? null,
        paymentId: m.paymentId ?? null,
        userId: m.userId,
        reason: m.reason ?? null,
        createdAt: m.createdAt,
      },
    })
  }

  /**
   * Una venta con parte fiada. Devuelve el id.
   *
   * Lo fiado se DERIVA: `total - efectivo`. No se declara.
   *
   * Declararlo fue el primer intento y la reconciliacion lo encontro: los
   * importes inventados no sumaban el total de las lineas, y la comprobacion
   * "total = suma de los pagos" fallo sobre las tres ventas. Es exactamente lo
   * que tiene que pasar, y por eso el seed se arregla derivando en vez de
   * aflojando la comprobacion.
   */
  async function ventaFiada(opciones: {
    clientId: number
    lineas: Array<[number, number]>
    /** Cuanto se cobra ahora. Lo que reste queda a cuenta. */
    efectivo: number
    cajero: number
    horas: number
  }): Promise<{ id: number; total: number; aCuenta: number }> {
    const cuando = haceHoras(opciones.horas)
    const items = opciones.lineas.map(([indice, cantidad]) => {
      const producto = productos[indice]
      if (!producto) throw new Error(`Producto ${String(indice)} fuera de rango`)
      return { producto, cantidad }
    })
    const total = items.reduce((t, i) => t + i.producto.precio * i.cantidad, 0)
    const aCuenta = total - opciones.efectivo

    if (aCuenta <= 0) {
      throw new Error(
        `El efectivo (${String(opciones.efectivo)}) cubre el total (${String(total)}): ` +
          'esta venta no tendria nada a cuenta.',
      )
    }

    const venta = await prisma.sale.create({
      data: {
        userId: opciones.cajero,
        branchId: sucursal.id,
        clientId: opciones.clientId,
        date: cuando,
        createdAt: cuando,
        total,
        items: {
          create: items.map((i) => ({
            productId: i.producto.id,
            quantity: i.cantidad,
            price: i.producto.precio,
            // El costo CONGELADO al vender. Es lo que hace que la ganancia de
            // esta venta no cambie cuando llegue mercaderia mas cara.
            costAtSale: i.producto.costo,
          })),
        },
        payments: {
          create: [
            ...(opciones.efectivo > 0
              ? [{ method: 'CASH', amount: opciones.efectivo, createdAt: cuando }]
              : []),
            { method: 'ACCOUNT', amount: aCuenta, createdAt: cuando },
          ],
        },
      },
      select: { id: true },
    })

    for (const i of items) {
      await moverStock({
        branchId: sucursal.id,
        productId: i.producto.id,
        type: 'SALE',
        delta: -i.cantidad,
        userId: opciones.cajero,
        referenceType: 'Sale',
        referenceId: venta.id,
        fecha: cuando,
      })
    }

    // SOLO el efectivo genera movimiento de caja. Lo fiado no es plata que
    // cambio de manos: va al libro del cliente y a ningun lado mas.
    if (opciones.efectivo > 0) {
      await prisma.cashRegisterMovement.create({
        data: {
          branchId: sucursal.id,
          userId: opciones.cajero,
          amount: opciones.efectivo,
          paymentMethod: 'CASH',
          description: `Venta #${String(venta.id)}`,
          type: 'sale',
          saleId: venta.id,
          date: cuando,
          shiftId: turno.id,
        },
      })
      caja += opciones.efectivo
    }

    await moverCuenta({
      clientId: opciones.clientId,
      type: 'SALE_CHARGE',
      amount: aCuenta,
      userId: opciones.cajero,
      saleId: venta.id,
      createdAt: cuando,
    })

    return { id: venta.id, total, aCuenta }
  }

  // El caso del ejemplo: parte en efectivo y el resto a cuenta.
  const primeraDeJuan = await ventaFiada({
    clientId: juan.id,
    lineas: [
      [0, 2],
      [12, 3],
    ],
    efectivo: 10_000,
    cajero: cajeroId,
    horas: 30,
  })

  // Juan paga $8.000 por transferencia: el saldo baja y la caja NO sube.
  const reciboJuan = await prisma.customerPayment.create({
    data: {
      number: await siguienteNumeroDeRecibo(),
      branchId: sucursal.id,
      clientId: juan.id,
      amount: 8_000,
      method: 'TRANSFER',
      receivedById: encargadoId,
      reference: 'Transferencia 4471',
      createdAt: haceHoras(20),
    },
  })
  await moverCuenta({
    clientId: juan.id,
    type: 'PAYMENT',
    amount: -8_000,
    userId: encargadoId,
    paymentId: reciboJuan.id,
    createdAt: haceHoras(20),
  })

  // Segunda compra, esta enteramente fiada. Queda dentro de su limite.
  const segundaDeJuan = await ventaFiada({
    clientId: juan.id,
    lineas: [[19, 1]],
    efectivo: 0,
    cajero: cajeroId,
    horas: 4,
  })

  // Marta compra fiada sin limite configurado. Con NULL no hay tope, que no es
  // lo mismo que un limite de cero.
  const ventaDeMarta = await ventaFiada({
    clientId: marta.id,
    lineas: [[3, 2]],
    efectivo: 0,
    cajero: cajeroId,
    horas: 3,
  })

  // Y un cobro en EFECTIVO, que si entra al cajon: es la otra mitad del
  // objetivo 29, y sin el la comprobacion "Cobros a clientes" solo veria el
  // caso de la transferencia.
  // Marta paga la MITAD de lo suyo, en efectivo. El importe se deriva de lo
  // que de verdad debe: inventarlo fue el error que encontro la reconciliacion.
  const pagaMarta = Math.round(ventaDeMarta.aCuenta / 2)
  const reciboMarta = await prisma.customerPayment.create({
    data: {
      number: await siguienteNumeroDeRecibo(),
      branchId: sucursal.id,
      clientId: marta.id,
      amount: pagaMarta,
      method: 'CASH',
      cashShiftId: turno.id,
      receivedById: cajeroId,
      createdAt: haceHoras(2),
    },
  })
  await moverCuenta({
    clientId: marta.id,
    type: 'PAYMENT',
    amount: -pagaMarta,
    userId: cajeroId,
    paymentId: reciboMarta.id,
    createdAt: haceHoras(2),
  })
  await prisma.cashRegisterMovement.create({
    data: {
      branchId: sucursal.id,
      userId: cajeroId,
      amount: pagaMarta,
      paymentMethod: 'CASH',
      description: `Cobro ${reciboMarta.number} · ${marta.name}`,
      type: 'customer_payment',
      customerPaymentId: reciboMarta.id,
      date: haceHoras(2),
      shiftId: turno.id,
    },
  })
  caja += pagaMarta

  // Raul tiene el fiado cortado y una deuda vieja cargada por ajuste manual: es
  // el caso que muestra por que `accounts.adjust` es un permiso aparte.
  await moverCuenta({
    clientId: raul.id,
    type: 'MANUAL_ADJUSTMENT',
    amount: 14_200,
    userId: adminId,
    reason: 'Deuda anterior a la puesta en marcha del sistema',
    createdAt: haceDias(30),
  })

  await prisma.branch.update({ where: { id: sucursal.id }, data: { currentCash: caja } })

  const totalProductos = await prisma.product.count()
  const totalVentas = await prisma.sale.count()
  const totalClientes = await prisma.client.count()
  // El saldo se LEE de la base, no se anuncia de memoria: un mensaje que dice
  // un numero distinto del real es peor que no decir nada.
  const saldoJuan = await prisma.client.findUniqueOrThrow({
    where: { id: juan.id },
    select: { balance: true },
  })

  console.log('Listo.')
  console.log(`  Sucursales: 2   Productos: ${totalProductos}   Ventas: ${totalVentas}`)
  console.log(`  Usuarios: ${USUARIOS.length + 1}   Clave para todos: ${CLAVE_DEMO}`)
  console.log(
    `  Clientes: ${totalClientes}   ${juan.name} debe ${saldoJuan.balance.toFixed(2)} ` +
      `(fiados ${String(primeraDeJuan.aCuenta + segundaDeJuan.aCuenta)}, pagó 8.000)`,
  )
  console.log(`  Caja de "${sucursal.name}": ${caja.toLocaleString('es-AR')}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
