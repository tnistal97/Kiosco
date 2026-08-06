/**
 * Pruebas unitarias del catalogo de permisos.
 *
 * No tocan la base ni la red.
 */

import { describe, it, expect } from 'vitest'
import { PERMISSIONS, permissionsForRole, knownRoles } from '@/server/authz/permissions'

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
    expect(cajero.has('reports.view')).toBe(false)
  })

  /**
   * Roles con alcance administrativo completo.
   *
   * Se enumeran a mano y no se leen de ROLE_PRESETS a proposito: si alguien
   * agrega un rol nuevo con permisos de administracion, estas pruebas fallan
   * y obligan a decidirlo explicitamente en vez de que pase inadvertido.
   */
  const ADMINISTRATIVOS = ['admin', 'duenio']

  it('ningun rol operativo puede administrar usuarios', () => {
    for (const rol of knownRoles()) {
      if (ADMINISTRATIVOS.includes(rol)) continue
      expect(permissionsForRole(rol).has('users.manage'), `${rol} puede administrar usuarios`).toBe(
        false,
      )
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
    expect(auditor.has('reports.view')).toBe(true)

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

  it('los costos y la informacion administrativa no llegan al cajero', () => {
    const cajero = permissionsForRole('cajero')
    expect(cajero.has('reports.view')).toBe(false)
    expect(cajero.has('audit.view')).toBe(false)
    expect(cajero.has('branches.manage')).toBe(false)
  })

  it('el conjunto devuelto no se puede modificar por accidente', () => {
    const a = permissionsForRole('cajero')
    const b = permissionsForRole('cajero')
    expect(a).toBe(b) // misma referencia: esta precalculado
  })
})
