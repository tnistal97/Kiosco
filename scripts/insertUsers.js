import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();
async function main() {
    const adminRole = await prisma.role.upsert({
        where: { name: 'admin' },
        update: {},
        create: { name: 'admin' },
    });
    const sellerRole = await prisma.role.upsert({
        where: { name: 'vendedor' },
        update: {},
        create: { name: 'vendedor' },
    });
    const branch = await prisma.branch.upsert({
        where: { name: 'Sucursal Central' },
        update: {},
        create: {
            name: 'Sucursal Central',
            address: 'Av. Principal 123',
        },
    });
    const password1 = await bcrypt.hash('admin123', 10);
    const password2 = await bcrypt.hash('vendedor123', 10);
    await prisma.user.create({
        data: {
            username: 'admin',
            name: 'Administrador',
            password: password1,
            roleId: adminRole.id,
            branchId: branch.id,
        },
    });
    await prisma.user.create({
        data: {
            username: 'vendedor',
            name: 'Juan Vendedor',
            password: password2,
            roleId: sellerRole.id,
            branchId: branch.id,
        },
    });
    console.log('✅ Usuarios creados con éxito.');
}
main()
    .then(() => prisma.$disconnect())
    .catch((e) => {
    console.error(e);
    prisma.$disconnect();
});
