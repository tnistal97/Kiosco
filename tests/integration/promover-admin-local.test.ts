/**
 * `scripts/lib/promover-admin-local.ts`: le cambia el rol a una persona y nada
 * mas. Es la operacion de produccion sobre un usuario real, con su contrasena
 * vigente y su sesion abierta.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { promoverAdminLocal } from '../../scripts/lib/promover-admin-local'

let fx: Fixture

const opciones = () => ({
  usuario: 'CAJERO1',
  sucursal: fx.branchA.id,
  autor: fx.admin.id,
  aplicar: true,
})

async function fila() {
  return prisma.user.findUniqueOrThrow({
    where: { id: fx.cajero.id },
    include: { role: true },
  })
}

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Promover a administrador del local', () => {
  it('cambia el rol y no toca la contrasena, la sesion ni el cambio obligatorio', async () => {
    const antes = await fila()

    const r = await promoverAdminLocal(prisma, opciones())
    expect(r).toMatchObject({ rolAntes: 'cajero', rolDespues: 'admin_local', yaEstaba: false })

    const despues = await fila()
    expect(despues.role.name).toBe('admin_local')
    expect(despues.password).toBe(antes.password)
    expect(despues.sessionVersion).toBe(antes.sessionVersion)
    expect(despues.mustChangePassword).toBe(antes.mustChangePassword)
    expect(despues.isActive).toBe(true)
    expect(despues.branchId).toBe(antes.branchId)
  })

  it('crea los roles del local si la instancia no los tiene', async () => {
    const { admin_local: al, empleado: em } = fx.porRol
    if (!al || !em) throw new Error('La fixture no trae los roles del local')
    await prisma.user.deleteMany({ where: { id: { in: [al.id, em.id] } } })
    await prisma.role.deleteMany({ where: { name: { in: ['admin_local', 'empleado'] } } })

    const r = await promoverAdminLocal(prisma, opciones())

    expect(r.rolesCreados.sort()).toEqual(['admin_local', 'empleado'])
    expect((await fila()).role.name).toBe('admin_local')
  })

  it('la segunda vez no hace nada ni deja rastro', async () => {
    await promoverAdminLocal(prisma, opciones())
    const entradas = await prisma.auditLog.count()

    const r = await promoverAdminLocal(prisma, opciones())

    expect(r.yaEstaba).toBe(true)
    expect(await prisma.auditLog.count()).toBe(entradas)
  })

  it('deja en la bitacora quien lo hizo y el cambio de rol', async () => {
    await promoverAdminLocal(prisma, opciones())

    const e = await prisma.auditLog.findFirst({
      where: { tableName: 'User', recordId: fx.cajero.id, actionType: 'role_change' },
    })
    expect(e?.userId).toBe(fx.admin.id)
    expect(JSON.stringify(e?.changes)).toContain('admin_local')
    expect(JSON.stringify(e)).not.toContain('$2b$')
  })

  it('el ensayo no escribe nada', async () => {
    const r = await promoverAdminLocal(prisma, { ...opciones(), aplicar: false })

    expect(r.aplicado).toBe(false)
    expect((await fila()).role.name).toBe('cajero')
    expect(await prisma.auditLog.count({ where: { actionType: 'role_change' } })).toBe(0)
  })

  it('se niega a un usuario de otra sucursal, a uno desactivado y a un autor que no es administrador', async () => {
    await expect(promoverAdminLocal(prisma, { ...opciones(), usuario: 'cajero2' })).rejects.toThrow(
      /no es de la sucursal/,
    )
    await expect(promoverAdminLocal(prisma, { ...opciones(), usuario: 'baja1' })).rejects.toThrow(
      /desactivado/,
    )
    await expect(
      promoverAdminLocal(prisma, { ...opciones(), autor: fx.cajero.id }),
    ).rejects.toThrow(/no es un administrador/)
    await expect(promoverAdminLocal(prisma, { ...opciones(), usuario: 'nadie' })).rejects.toThrow(
      /No existe/,
    )
  })
})
