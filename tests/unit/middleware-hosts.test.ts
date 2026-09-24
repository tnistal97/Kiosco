/**
 * Los nombres con los que se llega a la aplicacion.
 *
 * La auditoria UX (H-40) encontro que la lista fija de hosts locales dejaba
 * afuera a `next dev` (3000), a la suite de extremo a extremo (3101) y a
 * `pwa:check` (3100): los tres recibian "Host no reconocido". Esto comprueba
 * que la propia maquina se acepte en cualquier puerto y que un nombre
 * inventado se siga rechazando.
 */

import { describe, it, expect, afterEach } from 'vitest'
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

/**
 * Los dominios de la instancia, desde el entorno (P0-A).
 *
 * Antes la lista estaba escrita en el codigo: la instancia de otro comercio,
 * con su dominio, recibia "Host no reconocido" en todas las pantallas hasta
 * que alguien editara el middleware y recompilara.
 */
describe('KIOSCO_HOSTS', () => {
  const antes = process.env.KIOSCO_HOSTS

  afterEach(() => {
    if (antes === undefined) delete process.env.KIOSCO_HOSTS
    else process.env.KIOSCO_HOSTS = antes
  })

  it('sin la variable, siguen valiendo los dominios de siempre', async () => {
    delete process.env.KIOSCO_HOSTS
    expect((await pedir('luchandopormas.com')).status).toBe(200)
    expect((await pedir('donpepe.example.com')).status).toBe(421)
  })

  it('con la variable, contesta por esos nombres y solo por esos', async () => {
    process.env.KIOSCO_HOSTS = 'DonPepe.example.com, www.donpepe.example.com'
    expect((await pedir('donpepe.example.com')).status).toBe(200)
    expect((await pedir('www.donpepe.example.com')).status).toBe(200)
    // La de otro comercio ya no: cada instancia contesta por los suyos.
    expect((await pedir('luchandopormas.com')).status).toBe(421)
  })

  it('la propia maquina se acepta igual, para el chequeo de salud', async () => {
    process.env.KIOSCO_HOSTS = 'donpepe.example.com'
    expect((await pedir('127.0.0.1:3099')).status).toBe(200)
  })

  it('vacia o con solo separadores cuenta como ausente', async () => {
    process.env.KIOSCO_HOSTS = ' , '
    expect((await pedir('luchandopormas.com')).status).toBe(200)
  })
})
