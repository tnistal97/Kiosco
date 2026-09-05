/**
 * Los nombres con los que se llega a la aplicacion.
 *
 * La auditoria UX (H-40) encontro que la lista fija de hosts locales dejaba
 * afuera a `next dev` (3000), a la suite de extremo a extremo (3101) y a
 * `pwa:check` (3100): los tres recibian "Host no reconocido". Esto comprueba
 * que la propia maquina se acepte en cualquier puerto y que un nombre
 * inventado se siga rechazando.
 */

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

function pedir(host: string, ruta = '/login') {
  return middleware(new NextRequest(`http://127.0.0.1:3099${ruta}`, { headers: { host } }))
}

describe('Hosts locales', () => {
  it('acepta la propia maquina en cualquier puerto', async () => {
    for (const host of [
      '127.0.0.1:3099',
      'localhost:3000',
      '127.0.0.1:3101',
      'localhost:3100',
      'localhost',
    ]) {
      const res = await pedir(host)
      expect(res.status, host).toBe(200)
    }
  })

  it('sigue rechazando un nombre que no es de los nuestros', async () => {
    const res = await pedir('evil.example.com')
    expect(res.status).toBe(421)
    expect(await res.text()).toBe('Host no reconocido')
  })

  it('un nombre publico con puerto raro tampoco pasa', async () => {
    const res = await pedir('luchandopormas.com.evil.net')
    expect(res.status).toBe(421)
  })
})
