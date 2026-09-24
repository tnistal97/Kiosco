/**
 * Piezas puras de las contrasenas: la clave temporal y la regla que impide
 * resetear la clave de alguien con mas permisos que uno.
 */

import { describe, it, expect } from 'vitest'
import { generarClaveTemporal, permisosQueFaltan } from '@/modules/users/claves'
import { permissionsForRole } from '@/server/authz/permissions'
import { PASSWORD_MIN } from '@/modules/users/schemas'

describe('generarClaveTemporal', () => {
  it('tres grupos de cuatro, sin caracteres ambiguos', () => {
    for (let i = 0; i < 200; i++) {
      const clave = generarClaveTemporal()
      expect(clave).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
      expect(clave).not.toMatch(/[01ilo]/)
    }
  })

  it('cumple la politica de largo minimo', () => {
    expect(generarClaveTemporal().length).toBeGreaterThanOrEqual(PASSWORD_MIN)
  })

  it('la del alta de una instancia lleva cuatro grupos', () => {
    expect(generarClaveTemporal(4)).toMatch(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/)
  })

  it('no se repite', () => {
    const vistas = new Set(Array.from({ length: 500 }, () => generarClaveTemporal()))
    expect(vistas.size).toBe(500)
  })
})

describe('permisosQueFaltan', () => {
  it('un administrador puede resetear a un cajero', () => {
    expect(permisosQueFaltan(permissionsForRole('admin'), 'cajero')).toEqual([])
  })

  it('entre duenio y admin no falta nada: los dos tienen todo', () => {
    expect(permisosQueFaltan(permissionsForRole('admin'), 'duenio')).toEqual([])
    expect(permisosQueFaltan(permissionsForRole('duenio'), 'admin')).toEqual([])
  })

  it('alguien con menos permisos no alcanza a quien tiene mas', () => {
    const faltan = permisosQueFaltan(permissionsForRole('encargado'), 'duenio')
    expect(faltan.length).toBeGreaterThan(0)
    expect(faltan).toContain('users.manage')
  })

  it('un rol desconocido no tiene permisos, asi que no falta nada', () => {
    expect(permisosQueFaltan(permissionsForRole('cajero'), 'rol-inventado')).toEqual([])
  })
})
