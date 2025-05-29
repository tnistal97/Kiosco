import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const roleAdmin = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin' }
  })

  const roleEmpleado = await prisma.role.upsert({
    where: { name: 'empleado' },
    update: {},
    create: { name: 'empleado' }
  })

  const branch = await prisma.branch.upsert({
    where: { name: 'Sucursal Central' },
    update: {},
    create: {
      name: 'Sucursal Central',
      address: 'Av. Principal 123',
      phone: '123456789',
      email: 'central@sucursal.com'
    }
  })

  const hashedPassword = await bcrypt.hash('admin123', 10)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      name: 'Administrador',
      password: hashedPassword,
      roleId: roleAdmin.id,
      branchId: branch.id
    }
  })

  const supplier = await prisma.supplier.upsert({
    where: { name: 'Distribuidora Sur' },
    update: {},
    create: {
      name: 'Distribuidora Sur',
      contact: 'contacto@sur.com'
    }
  })

  const catAlimentos = await prisma.category.upsert({
    where: { name: 'Alimentos' },
    update: {},
    create: { name: 'Alimentos' }
  })

  const catBebidas = await prisma.category.upsert({
    where: { name: 'Bebidas' },
    update: {},
    create: { name: 'Bebidas' }
  })

  const producto1 = await prisma.product.upsert({
    where: { barcode: '123456789' },
    update: {},
    create: {
      name: 'Galletitas Oreo',
      barcode: '123456789',
      description: 'Paquete de galletitas Oreo',
      price: 250,
      categoryId: catAlimentos.id,
      supplierId: supplier.id
    }
  })

  const producto2 = await prisma.product.upsert({
    where: { barcode: '987654321' },
    update: {},
    create: {
      name: 'Coca-Cola 500ml',
      barcode: '987654321',
      description: 'Botella de Coca-Cola 500ml',
      price: 300,
      categoryId: catBebidas.id,
      supplierId: supplier.id
    }
  })

  await prisma.branchStock.upsert({
    where: {
      branchId_productId: {
        branchId: branch.id,
        productId: producto1.id
      }
    },
    update: { quantity: 100 },
    create: {
      branchId: branch.id,
      productId: producto1.id,
      quantity: 100
    }
  })

  await prisma.branchStock.upsert({
    where: {
      branchId_productId: {
        branchId: branch.id,
        productId: producto2.id
      }
    },
    update: { quantity: 60 },
    create: {
      branchId: branch.id,
      productId: producto2.id,
      quantity: 60
    }
  })

  console.log('✅ Datos iniciales insertados correctamente.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
