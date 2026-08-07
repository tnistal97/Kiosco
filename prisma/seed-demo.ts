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
import { PrismaClient } from '@prisma/client'
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

type SemillaProducto = {
  nombre: string
  barcode: string
  categoria: string
  proveedor: string
  precio: number
  costo: number
  stock: number
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

const PROVEEDORES = [
  { name: 'Distribuidora del Norte', contact: 'pedidos@dist-norte.example' },
  { name: 'Bebidas Andinas', contact: 'ventas@andinas.example' },
  { name: 'Lacteos La Pradera', contact: 'contacto@lapradera.example' },
  { name: 'Mayorista Central', contact: 'mayorista@central.example' },
]

const PRODUCTOS: SemillaProducto[] = [
  // Almacen
  { nombre: 'Yerba mate 1 kg', barcode: '7790001000011', categoria: 'Almacen', proveedor: 'Distribuidora del Norte', precio: 4850, costo: 3200, stock: 24 }, // prettier-ignore
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
  { nombre: 'Gaseosa cola 2.25 L', barcode: '7790002000014', categoria: 'Bebidas', proveedor: 'Bebidas Andinas', precio: 3450, costo: 2500, stock: 36 }, // prettier-ignore
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
  { nombre: 'Queso cremoso x kg', barcode: '7790003000048', categoria: 'Lacteos', proveedor: 'Lacteos La Pradera', precio: 9800, costo: 7200, stock: 6 }, // prettier-ignore
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
type MedioDePago = 'efectivo' | 'tarjeta' | 'mercado_pago'

const VENTAS: Array<{
  horas: number
  lineas: Array<[number, number]>
  medio: MedioDePago
  cajero: string
  anulada?: { motivo: string; horas: number; por: string }
}> = [
  { horas: 1, lineas: [[0, 1], [12, 2], [19, 1]], medio: 'efectivo', cajero: 'cajero' }, // prettier-ignore
  { horas: 2, lineas: [[15, 6], [9, 2]], medio: 'tarjeta', cajero: 'cajero' }, // prettier-ignore
  { horas: 3, lineas: [[24, 1], [19, 2], [3, 3]], medio: 'efectivo', cajero: 'cajero' }, // prettier-ignore
  { horas: 4, lineas: [[36, 1], [21, 1]], medio: 'tarjeta', cajero: 'supervisor' }, // prettier-ignore
  { horas: 5, lineas: [[13, 2], [29, 1], [31, 2]], medio: 'efectivo', cajero: 'cajero' }, // prettier-ignore
  { horas: 6, lineas: [[17, 1], [22, 1]], medio: 'mercado_pago', cajero: 'encargado' }, // prettier-ignore
  {
    horas: 7,
    lineas: [
      [1, 2],
      [4, 1],
    ],
    medio: 'efectivo',
    cajero: 'cajero',
    anulada: { motivo: 'El cliente se arrepintio antes de retirar', horas: 6, por: 'supervisor' },
  },
  { horas: 26, lineas: [[6, 2], [10, 1], [28, 1]], medio: 'efectivo', cajero: 'cajero' }, // prettier-ignore
  { horas: 28, lineas: [[14, 3], [33, 1]], medio: 'tarjeta', cajero: 'supervisor' }, // prettier-ignore
  { horas: 30, lineas: [[38, 1], [23, 1], [2, 2]], medio: 'efectivo', cajero: 'cajero' }, // prettier-ignore
  { horas: 50, lineas: [[7, 4]], medio: 'efectivo', cajero: 'encargado' }, // prettier-ignore
  { horas: 52, lineas: [[25, 2], [20, 1]], medio: 'mercado_pago', cajero: 'cajero' }, // prettier-ignore
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
  await prisma.stockCheck.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.cashRegisterMovement.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.cashCount.deleteMany()
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
  await prisma.user.create({
    data: {
      username: 'norte',
      name: 'Carla Ibanez',
      password: hash,
      roleId: roles.get('encargado') ?? 0,
      branchId: sucursalNorte.id,
    },
  })

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

  const productos: Array<{ id: number; precio: number }> = []
  for (const p of PRODUCTOS) {
    const creado = await prisma.product.create({
      data: {
        name: p.nombre,
        barcode: p.barcode,
        description: p.descripcion ?? null,
        price: p.precio,
        value: p.costo,
        categoryId: categorias.get(p.categoria) ?? 0,
        supplierId: proveedores.get(p.proveedor) ?? null,
        branchId: sucursal.id,
        isActive: p.inactivo !== true,
      },
    })
    await prisma.branchStock.create({
      data: { branchId: sucursal.id, productId: creado.id, quantity: p.stock },
    })
    productos.push({ id: creado.id, precio: p.precio })
  }

  const adminId = usuarios.get('admin') ?? 0
  let caja = 0

  // Apertura de caja del dia anterior.
  await prisma.cashRegisterMovement.create({
    data: {
      branchId: sucursal.id,
      userId: usuarios.get('encargado') ?? adminId,
      amount: 25_000,
      paymentMethod: 'efectivo',
      description: 'Fondo de caja inicial',
      type: 'ingreso',
      date: haceDias(3),
    },
  })
  caja += 25_000

  for (const v of VENTAS) {
    const fecha = haceHoras(v.horas)
    const userId = usuarios.get(v.cajero) ?? adminId
    const lineas = v.lineas.map(([indice, cantidad]) => {
      const prod = productos[indice]
      if (!prod) throw new Error(`indice de producto invalido: ${indice}`)
      return { productId: prod.id, quantity: cantidad, price: prod.precio }
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
        items: { create: lineas },
      },
    })

    // Descontar stock solo de las ventas vigentes.
    if (!v.anulada) {
      for (const l of lineas) {
        await prisma.branchStock.updateMany({
          where: { branchId: sucursal.id, productId: l.productId },
          data: { quantity: { decrement: l.quantity } },
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
    if (v.medio === 'efectivo') caja += total

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
      if (v.medio === 'efectivo') caja -= total

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
        paymentMethod: 'efectivo',
        description: m.desc,
        type: m.tipo,
        date: haceHoras(m.horas),
      },
    })
    caja += importe
  }

  await prisma.branch.update({ where: { id: sucursal.id }, data: { currentCash: caja } })

  // Arqueos: uno cuadrado y uno con diferencia.
  await prisma.cashCount.create({
    data: {
      branchId: sucursal.id,
      userId: usuarios.get('encargado') ?? adminId,
      amount: 118_400,
      notes: 'Cierre del turno tarde. Cuadra.',
      date: haceHoras(24),
    },
  })
  await prisma.cashCount.create({
    data: {
      branchId: sucursal.id,
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

  const totalProductos = await prisma.product.count()
  const totalVentas = await prisma.sale.count()
  console.log('Listo.')
  console.log(`  Sucursales: 2   Productos: ${totalProductos}   Ventas: ${totalVentas}`)
  console.log(`  Usuarios: ${USUARIOS.length + 1}   Clave para todos: ${CLAVE_DEMO}`)
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
