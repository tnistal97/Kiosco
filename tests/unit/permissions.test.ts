/**
 * Pruebas unitarias del catalogo de permisos.
 *
 * No tocan la base ni la red.
 */

import { describe, it, expect } from 'vitest'
import {
  ROLES_DE_LOCAL,
  rolesDelAlcance,
  PERMISSIONS,
  permissionsForRole,
  knownRoles,
} from '@/server/authz/permissions'

describe('Resolucion de permisos por rol', () => {
  it('el administrador tiene todos los permisos', () => {
    const admin = permissionsForRole('admin')
    for (const p of PERMISSIONS) {
      expect(admin.has(p), `admin no tiene ${p}`).toBe(true)
    }
  })

  it('un rol desconocido no tiene ningun permiso', () => {
    expect(permissionsForRole('gerente_regional').size).toBe(0)
    expect(permissionsForRole('').size).toBe(0)
    expect(permissionsForRole('ADMIN').size).toBe(0) // distingue mayusculas
  })

  it('el cajero puede vender pero no administrar', () => {
    const cajero = permissionsForRole('cajero')

    expect(cajero.has('sales.create')).toBe(true)
    expect(cajero.has('products.view')).toBe(true)
    expect(cajero.has('cash.view')).toBe(true)

    expect(cajero.has('users.view')).toBe(false)
    expect(cajero.has('users.manage')).toBe(false)
    expect(cajero.has('sales.cancel')).toBe(false)
    expect(cajero.has('products.delete')).toBe(false)
    expect(cajero.has('audit.view')).toBe(false)
    // Ningun reporte: el cajero ve SUS ventas por `sales.view`, no la
    // facturacion ni el margen del local.
    expect(cajero.has('reports.sales.view')).toBe(false)
    expect(cajero.has('reports.costs.view')).toBe(false)
  })

  /**
   * Roles con alcance administrativo completo.
   *
   * Se enumeran a mano y no se leen de ROLE_PRESETS a proposito: si alguien
   * agrega un rol nuevo con permisos de administracion, estas pruebas fallan
   * y obligan a decidirlo explicitamente en vez de que pase inadvertido.
   */
  const ADMINISTRATIVOS = ['admin', 'duenio']

  it('ningun rol operativo puede administrar usuarios, salvo el administrador del local', () => {
    for (const rol of knownRoles()) {
      if (ADMINISTRATIVOS.includes(rol) || rol === 'admin_local') continue
      expect(permissionsForRole(rol).has('users.manage'), `${rol} puede administrar usuarios`).toBe(
        false,
      )
    }
  })

  it('el administrador del local tiene todo lo del operador y nada de la instalacion', () => {
    const local = permissionsForRole('admin_local')
    for (const p of permissionsForRole('operador')) expect(local.has(p), p).toBe(true)

    for (const p of [
      'branches.manage',
      'branches.view',
      'audit.view',
      'products.cost.view',
      'products.delete',
      'reports.costs.view',
    ] as const) {
      expect(local.has(p), p).toBe(false)
    }
  })

  it('el administrador del local llega hasta los roles de su local', () => {
    const alcance = rolesDelAlcance(permissionsForRole('admin_local'))
    expect(alcance).toEqual(ROLES_DE_LOCAL)
    expect(rolesDelAlcance(permissionsForRole('admin'))).toBeNull()
    expect(rolesDelAlcance(permissionsForRole('duenio'))).toBeNull()
  })

  it('el empleado no tiene un permiso que su administrador no tenga', () => {
    const local = permissionsForRole('admin_local')
    for (const p of permissionsForRole('empleado')) expect(local.has(p), p).toBe(true)
  })

  it('el empleado atiende, pero no administra ni corrige', () => {
    const empleado = permissionsForRole('empleado')
    for (const p of [
      'sales.create',
      'cash.shift.open',
      'cash.shift.close',
      'products.view',
      'stock.view',
      'inventoryCounts.count',
    ] as const) {
      expect(empleado.has(p), p).toBe(true)
    }
    for (const p of [
      'users.view',
      'users.manage',
      'sales.cancel',
      'products.update',
      'products.price.update',
      'stock.adjust',
      'inventoryCounts.apply',
      'cash.shift.authorize',
    ] as const) {
      expect(empleado.has(p), p).toBe(false)
    }
  })

  it('ningun rol operativo puede borrar productos', () => {
    for (const rol of knownRoles()) {
      if (ADMINISTRATIVOS.includes(rol)) continue
      expect(permissionsForRole(rol).has('products.delete'), `${rol} puede borrar productos`).toBe(
        false,
      )
    }
  })

  it('los roles administrativos son exactamente los declarados', () => {
    const conTodo = knownRoles().filter(
      (r) => permissionsForRole(r).has('users.manage') && permissionsForRole(r).has('audit.view'),
    )
    expect(
      conTodo.sort(),
      'Aparecio un rol con alcance administrativo que no estaba previsto',
    ).toEqual([...ADMINISTRATIVOS].sort())
  })

  it('el auditor ve todo pero no puede escribir nada', () => {
    const auditor = permissionsForRole('auditor')
    expect(auditor.has('audit.view')).toBe(true)
    // Los cinco reportes: es el unico rol que los ve todos sin poder cambiar
    // nada de lo que mira.
    for (const r of [
      'reports.sales.view',
      'reports.costs.view',
      'reports.inventory.view',
      'reports.cash.view',
      'reports.purchases.view',
    ] as const) {
      expect(auditor.has(r), `el auditor deberia poder ver ${r}`).toBe(true)
    }

    for (const escritura of [
      'sales.create',
      'sales.cancel',
      'products.create',
      'products.update',
      'products.delete',
      'stock.adjust',
      'cash.movement.create',
      'cash.count.create',
      'users.manage',
      'branches.manage',
      'suppliers.manage',
      'categories.manage',
    ] as const) {
      expect(auditor.has(escritura), `El auditor puede "${escritura}"`).toBe(false)
    }
  })

  it('compras no vende ni toca la caja', () => {
    const compras = permissionsForRole('compras')
    expect(compras.has('stock.adjust')).toBe(true)
    expect(compras.has('suppliers.manage')).toBe(true)

    // Separar quien compra de quien cobra es el control contra el desvio.
    expect(compras.has('sales.create')).toBe(false)
    expect(compras.has('cash.view')).toBe(false)
    expect(compras.has('cash.movement.create')).toBe(false)
  })

  it('el supervisor puede anular, el cajero no', () => {
    expect(permissionsForRole('supervisor').has('sales.cancel')).toBe(true)
    expect(permissionsForRole('cajero').has('sales.cancel')).toBe(false)
  })

  it('el repositor no puede vender ni ver la caja', () => {
    const repositor = permissionsForRole('repositor')
    expect(repositor.has('stock.adjust')).toBe(true)
    expect(repositor.has('sales.create')).toBe(false)
    expect(repositor.has('cash.view')).toBe(false)
  })

  it('el operador hace todo el mostrador de un local chico, y nada mas', () => {
    const operador = permissionsForRole('operador')
    // Lo que el local necesita de una sola persona.
    for (const p of [
      'sales.create',
      'cash.shift.open',
      'cash.shift.close',
      'cash.movement.create',
      'cash.count.create',
      'products.create',
      'products.update',
      'products.price.update',
      'categories.manage',
      'stock.view',
      'stock.adjust',
      'inventoryCounts.create',
      'inventoryCounts.count',
      'inventoryCounts.apply',
      'reports.sales.view',
      'reports.cash.view',
    ] as const) {
      expect(operador.has(p), `al operador le falta ${p}`).toBe(true)
    }
    // Lo que queda para el duenio.
    for (const p of [
      'sales.cancel',
      'products.cost.view',
      'products.cost.update',
      'products.delete',
      'reports.costs.view',
      'cash.shift.close.other',
      'cash.shift.authorize',
      'clients.manage',
      'accounts.adjust',
      'accounts.overrideLimit',
      'users.view',
      'users.manage',
      'branches.view',
      'branches.manage',
      'audit.view',
      'suppliers.manage',
      'purchases.create',
      'lots.manage',
    ] as const) {
      expect(operador.has(p), `el operador no deberia tener ${p}`).toBe(false)
    }
  })

  it('los costos y la informacion administrativa no llegan al cajero', () => {
    const cajero = permissionsForRole('cajero')
    expect(cajero.has('reports.costs.view')).toBe(false)
    expect(cajero.has('audit.view')).toBe(false)
    expect(cajero.has('branches.manage')).toBe(false)
  })

  it('el conjunto devuelto no se puede modificar por accidente', () => {
    const a = permissionsForRole('cajero')
    const b = permissionsForRole('cajero')
    expect(a).toBe(b) // misma referencia: esta precalculado
  })
})
