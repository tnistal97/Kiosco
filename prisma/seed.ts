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
  const [adminRole, sellerRole] = await Promise.all([
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
    data: { name: 'Default Supplier', contact: 'default@supplier.com' },
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
  const product = await prisma.product.create({
    data: {
      name: 'Producto de Prueba',
      barcode: '1234567890123',
      description: 'Producto creado por seed minimalista',
      price: 100,
      value: 50,
      categoryId: category.id,
      supplierId: supplier.id,
      branchId: branch.id,
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
  console.log(`🧪 Producto: ${product.name} (stock: ${stock.quantity})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
