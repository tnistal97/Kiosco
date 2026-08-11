/**
 * Las variables sin las que la aplicacion no debe arrancar.
 *
 * La regla que se comprueba no es "existe la funcion" sino "que deja pasar y
 * que no": un entorno a medias arranca, sirve el login, y falla recien al
 * firmar el token. Eso es lo que paso en el servidor con `change-me`.
 */

import { describe, it, expect } from 'vitest'
import { problemasDeEntorno, MIN_JWT_SECRET, VARIABLES_REQUERIDAS } from '@/server/env'

const VALIDO: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://usuario:clave@localhost:5432/kiosco?schema=public',
  JWT_SECRET: 'x'.repeat(MIN_JWT_SECRET),
}

function con(cambios: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...VALIDO, ...cambios }
}

function variables(env: NodeJS.ProcessEnv): string[] {
  return problemasDeEntorno(env).map((p) => p.variable)
}

describe('Entorno requerido', () => {
  it('un entorno completo no tiene problemas', () => {
    expect(problemasDeEntorno(VALIDO)).toEqual([])
  })

  it('rechaza DATABASE_URL ausente', () => {
    expect(variables(con({ DATABASE_URL: undefined }))).toContain('DATABASE_URL')
  })

  it('rechaza DATABASE_URL vacia o con solo espacios', () => {
    expect(variables(con({ DATABASE_URL: '   ' }))).toContain('DATABASE_URL')
  })

  it('rechaza una DATABASE_URL que no es de PostgreSQL', () => {
    expect(variables(con({ DATABASE_URL: 'mysql://usuario@localhost/kiosco' }))).toContain(
      'DATABASE_URL',
    )
  })

  it('acepta las dos formas del esquema: postgres:// y postgresql://', () => {
    expect(problemasDeEntorno(con({ DATABASE_URL: 'postgres://u:c@h:5432/d' }))).toEqual([])
    expect(problemasDeEntorno(con({ DATABASE_URL: 'postgresql://u:c@h:5432/d' }))).toEqual([])
  })

  it('rechaza JWT_SECRET ausente', () => {
    expect(variables(con({ JWT_SECRET: undefined }))).toContain('JWT_SECRET')
  })

  it('rechaza el placeholder que quedo en el servidor', () => {
    // 9 caracteres. Es el valor real medido en produccion el 11-ago-2026.
    expect(variables(con({ JWT_SECRET: 'change-me' }))).toContain('JWT_SECRET')
  })

  it('rechaza un secreto de exactamente un caracter menos que el minimo', () => {
    expect(variables(con({ JWT_SECRET: 'x'.repeat(MIN_JWT_SECRET - 1) }))).toContain('JWT_SECRET')
  })

  it('acepta uno de exactamente el minimo', () => {
    expect(problemasDeEntorno(con({ JWT_SECRET: 'x'.repeat(MIN_JWT_SECRET) }))).toEqual([])
  })

  it('informa las dos a la vez, no se detiene en la primera', () => {
    const faltan = variables(con({ DATABASE_URL: undefined, JWT_SECRET: undefined }))
    expect(faltan.sort()).toEqual(['DATABASE_URL', 'JWT_SECRET'])
  })

  it('ningun mensaje incluye el valor de la variable', () => {
    const secreto = 'este-secreto-no-debe-aparecer'
    const url = 'postgresql://usuario:contrasena-secreta@host/base'
    const texto = JSON.stringify(
      problemasDeEntorno(con({ JWT_SECRET: secreto, DATABASE_URL: url })),
    )

    expect(texto).not.toContain(secreto)
    expect(texto).not.toContain('contrasena-secreta')
    // Pero si dice cuanto medi­a, que es lo que hace accionable el aviso.
    expect(texto).toContain(String(secreto.length))
  })

  it('la lista publicada de variables requeridas coincide con lo que se valida', () => {
    const sinNada = variables({}).sort()
    expect(sinNada).toEqual([...VARIABLES_REQUERIDAS].sort())
  })

  it('.env.example nombra todas las requeridas', async () => {
    const { readFileSync } = await import('node:fs')
    const ejemplo = readFileSync('.env.example', 'utf8')
    for (const nombre of VARIABLES_REQUERIDAS) {
      expect(ejemplo).toMatch(new RegExp(`^${nombre}=`, 'm'))
    }
  })
})
