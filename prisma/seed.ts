import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // Wipe data (order: children → parents)
  await prisma.stockCheck.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.cashRegisterMovement.deleteMany()
  await prisma.cashCount.deleteMany()
  await prisma.branchStock.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.role.deleteMany()
  await prisma.branch.deleteMany()

  // Roles
  const [adminRole] = await Promise.all([
    prisma.role.create({ data: { name: 'admin' } }),
    prisma.role.create({ data: { name: 'vendedor' } }),
  ])

  // Branch
  const branch = await prisma.branch.create({
    data: {
      name: 'Sucursal Central',
      address: 'Av. Principal 123',
      email: 'central@kiosco.com',
      phone: '0000-0000',
    },
  })

  // Category + Supplier
  const category = await prisma.category.create({ data: { name: 'General' } })
  const supplier = await prisma.supplier.create({
    // `contact` quedo congelada en la Fase 3C. Ver docs/SUPPLIER_MODEL.md.
    data: { name: 'Default Supplier', email: 'default@supplier.com' },
  })

  // User: lautaro / Lkiosco123
  const passwordHash = await bcrypt.hash('Lkiosco123', 10)
  const user = await prisma.user.create({
    data: {
      username: 'lautaro',
      name: 'Lautaro',
      password: passwordHash,
      roleId: adminRole.id, // change to sellerRole.id if you prefer
      branchId: branch.id,
    },
  })

  // Product + stock + audit
  // Los codigos viven en `ProductBarcode` y el proveedor en `ProductSupplier`.
  // `Product.barcode` se borro en la Fase 3C y `Product.supplierId` quedo
  // congelada. Ver docs/PHASE3_BARCODES.md y docs/SUPPLIER_MODEL.md.
  const product = await prisma.product.create({
    data: {
      name: 'Producto de Prueba',
      description: 'Producto creado por seed minimalista',
      price: 100,
      categoryId: category.id,
      branchId: branch.id,
      barcodes: { create: [{ code: '1234567890123', isPrimary: true }] },
      suppliers: { create: [{ supplierId: supplier.id, isPreferred: true }] },
    },
  })

  const stock = await prisma.branchStock.create({
    data: { branchId: branch.id, productId: product.id, quantity: 10 },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      tableName: 'Product',
      recordId: product.id,
      actionType: 'CREATE',
      changes: { before: null, after: product },
      origin: 'seed-script',
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      tableName: 'BranchStock',
      recordId: stock.id,
      actionType: 'CREATE',
      changes: { before: null, after: stock },
      origin: 'seed-script',
    },
  })

  console.log('✅ Seed listo.')
  console.log('👤 Usuario: lautaro / 🔑 Lkiosco123')
  console.log(`🧪 Producto: ${product.name} (stock: ${stock.quantity.toString()})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
