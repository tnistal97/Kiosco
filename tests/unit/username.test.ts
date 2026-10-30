/**
 * El nombre de usuario canonico y los dos esquemas que lo aplican.
 */

import { describe, it, expect } from 'vitest'
import { normalizeUsername } from '@/modules/users/username'
import { usernameSchema } from '@/modules/users/schemas'
import { loginSchema } from '@/modules/auth/schemas'

describe('normalizeUsername', () => {
  it.each([
    ['Franco', 'franco'],
    ['franco', 'franco'],
    ['FRANCO', 'franco'],
    [' Franco ', 'franco'],
    ['FrAnCo', 'franco'],
    ['\tjuan.perez\n', 'juan.perez'],
  ])('%j -> %j', (escrito, canonico) => {
    expect(normalizeUsername(escrito)).toBe(canonico)
  })

  it('aplicarla dos veces da lo mismo', () => {
    expect(normalizeUsername(normalizeUsername('  FrAnCo '))).toBe('franco')
  })
})

describe('Los esquemas devuelven la forma canonica', () => {
  it('el alta', () => {
    expect(usernameSchema.parse(' Juan_Perez ')).toBe('juan_perez')
  })

  it('el alta sigue rechazando lo que no es un nombre de usuario', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
    expect(usernameSchema.safeParse('con espacio').success).toBe(false)
    expect(usernameSchema.safeParse('ñandu').success).toBe(false)
  })

  it('el login', () => {
    const r = loginSchema.parse({ username: ' FRANCO ', password: 'x' })
    expect(r.username).toBe('franco')
  })

  it('el login no toca la contrasena', () => {
    const r = loginSchema.parse({ username: 'franco', password: ' Clave ' })
    expect(r.password).toBe(' Clave ')
  })
})
