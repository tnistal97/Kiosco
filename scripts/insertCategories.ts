import { PrismaClient } from '@prisma/client'
import { exigirBaseDeDesarrollo } from './solo-desarrollo'

exigirBaseDeDesarrollo('scripts/insertCategories.ts')

const prisma = new PrismaClient()

async function main() {
  const categories = ['Golosinas', 'Bebidas', 'Snacks', 'Limpieza', 'Panificados']

  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    })
  }

  console.log('✅ Categorías insertadas')
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect())
