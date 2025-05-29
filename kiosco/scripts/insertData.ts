import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  await prisma.role.createMany({
    data: [
      { name: 'Admin' },
      { name: 'Atendedor' },
    ],
    skipDuplicates: true,
  })

  const branch = await prisma.branch.upsert({
    where: { name: 'Sucursal Centro' },
    update: {},
    create: {
      name: 'Sucursal Centro',
      address: 'Av. Siempreviva 123',
      phone: '12345678',
      email: 'centro@kiosco.com',
    },
  })

  const supplier = await prisma.supplier.upsert({
    where: { name: 'Distribuidora Sur' },
    update: {},
    create: {
      name: 'Distribuidora Sur',
      contact: 'contacto@sur.com',
    },
  })

  const category = await prisma.category.upsert({
    where: { name: 'Golosinas' },
    update: {},
    create: {
      name: 'Golosinas',
    },
  })

  const product = await prisma.product.upsert({
    where: {
      barcode: "1234567890123"  // ESTE CAMPO ES @unique en tu modelo
    },
    update: {},
    create: {
      name: "Chicle Bazooka",
      barcode: "1234567890123",
      description: "Chicle clásico",
      price: 50,
      categoryId: 1,
      supplierId: 1
    }
  })


  await prisma.branchStock.upsert({
    where: {
      branchId_productId: {
        branchId: branch.id,
        productId: product.id,
      },
    },
    update: { quantity: 100 },
    create: {
      branchId: branch.id,
      productId: product.id,
      quantity: 100,
    },
  })

  console.log('✔ Datos insertados correctamente.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
