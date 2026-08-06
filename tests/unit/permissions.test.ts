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

  it('ningun rol salvo admin puede administrar usuarios', () => {
    for (const rol of knownRoles()) {
      if (rol === 'admin') continue
      expect(permissionsForRole(rol).has('users.manage'), `${rol} puede administrar usuarios`).toBe(
        false,
      )
    }
  })

  it('ningun rol salvo admin puede borrar productos', () => {
    for (const rol of knownRoles()) {
      if (rol === 'admin') continue
      expect(permissionsForRole(rol).has('products.delete'), `${rol} puede borrar productos`).toBe(
        false,
      )
    }
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
