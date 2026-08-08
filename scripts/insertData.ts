import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  await prisma.role.createMany({
    data: [{ name: 'Admin' }, { name: 'Atendedor' }],
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
      // `contact` quedo congelada en la Fase 3C. Ver docs/SUPPLIER_MODEL.md.
      contactName: 'Ventas',
      email: 'contacto@sur.com',
    },
  })

  const category = await prisma.category.upsert({
    where: { name: 'Golosinas' },
    update: {},
    create: {
      name: 'Golosinas',
    },
  })

  // Los codigos de barras viven en `ProductBarcode` desde la Fase 3B, y
  // `Product.barcode` se borro en la 3C. El upsert ya no puede buscar por el
  // codigo --no es una clave de `Product`--, asi que se resuelve en dos pasos:
  // buscar el codigo y, si no esta, crear el producto con el.
  // Ver docs/PHASE3_BARCODES.md.
  const CODIGO = '1234567890123'

  const existente = await prisma.productBarcode.findUnique({
    where: { code: CODIGO },
    select: { productId: true },
  })

  const product =
    existente === null
      ? await prisma.product.create({
          data: {
            name: 'Chicle Bazooka',
            description: 'Chicle clásico',
            price: 50,
            categoryId: category.id,
            branchId: branch.id,
            barcodes: { create: [{ code: CODIGO, isPrimary: true }] },
            // El vinculo con el proveedor vive en `ProductSupplier` desde la
            // Fase 3C. Ver docs/SUPPLIER_MODEL.md.
            suppliers: { create: [{ supplierId: supplier.id, isPreferred: true }] },
          },
        })
      : { id: existente.productId }

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
