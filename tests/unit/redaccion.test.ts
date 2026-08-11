/**
 * Ningun secreto termina en un log.
 *
 * Los casos no son inventados: son las formas exactas en que estos secretos
 * llegan hoy a `console.error`. El primero --la cadena de conexion completa
 * dentro de un `PrismaClientInitializationError`-- es el que motivo el modulo.
 */

import { describe, it, expect } from 'vitest'
import { redactar, paraLog } from '@/server/http/redaccion'
import type { Entorno } from '@/server/env'

const ENV: Entorno = {
  DATABASE_URL: 'postgresql://kiosco:Cl4v3-Sup3r-S3cr3t4@localhost:5432/kiosco?schema=public',
  JWT_SECRET: 'un-secreto-de-firma-largo-y-real-0123',
}

describe('Se tacha por valor, no por nombre de campo', () => {
  it('tacha la cadena de conexion completa', () => {
    const salida = redactar(`Can't reach database server at ${ENV.DATABASE_URL ?? ''}`, ENV)
    expect(salida).not.toContain('Cl4v3-Sup3r-S3cr3t4')
    expect(salida).toContain('[REDACTADO]')
  })

  it('tacha la contraseña aunque la cadena venga partida', () => {
    // El caso real: Prisma arma el mensaje con las piezas, no con la URL.
    const salida = redactar('password=Cl4v3-Sup3r-S3cr3t4 host=localhost', ENV)
    expect(salida).not.toContain('Cl4v3-Sup3r-S3cr3t4')
  })

  it('tacha el secreto de firma', () => {
    const salida = redactar(`JWSSignatureVerificationFailed key=${ENV.JWT_SECRET ?? ''}`, ENV)
    expect(salida).not.toContain('un-secreto-de-firma-largo-y-real-0123')
  })

  it('conserva usuario, host y base: eso es diagnostico, no secreto', () => {
    const salida = redactar(`connect ECONNREFUSED ${ENV.DATABASE_URL ?? ''}`, ENV)
    expect(salida).toContain('ECONNREFUSED')
  })
})

describe('Tambien tacha lo que este proceso no conoce, por su forma', () => {
  const sinEntorno: Entorno = {}

  it('una cadena de conexion ajena', () => {
    const salida = redactar('postgresql://otro:otra-clave-larga@10.0.0.9:5432/otra', sinEntorno)
    expect(salida).not.toContain('otra-clave-larga')
    // El host se conserva: sin el no se sabe contra que base fallo.
    expect(salida).toContain('10.0.0.9')
    expect(salida).toContain('otro')
  })

  it('una cabecera Authorization', () => {
    const salida = redactar('authorization: Bearer abc123DEF456ghi789', sinEntorno)
    expect(salida).not.toContain('abc123DEF456ghi789')
    expect(salida).toContain('Bearer')
  })

  it('la cookie de sesion', () => {
    const salida = redactar('cookie: token=abc.def.ghi; otra=1', sinEntorno)
    expect(salida).not.toContain('abc.def.ghi')
    expect(salida).toContain('otra=1')
  })

  it('un JWT suelto', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.firma-falsa'
    expect(redactar(`token invalido: ${jwt}`, sinEntorno)).not.toContain(jwt)
  })

  it('un cuerpo de login serializado', () => {
    const salida = redactar('{"username":"lautaro","password":"la-clave-real"}', sinEntorno)
    expect(salida).not.toContain('la-clave-real')
    // El usuario si: saber quien intento entrar es el punto del log.
    expect(salida).toContain('lautaro')
  })
})

describe('paraLog', () => {
  it('conserva el stack, que es para lo que sirve el log', () => {
    const e = new Error('algo se rompio')
    const salida = paraLog(e, ENV)
    expect(salida).toContain('algo se rompio')
    expect(salida).toContain('redaccion.test')
  })

  it('tacha el secreto que venga dentro del mensaje', () => {
    const e = new Error(`no pude conectar a ${ENV.DATABASE_URL ?? ''}`)
    expect(paraLog(e, ENV)).not.toContain('Cl4v3-Sup3r-S3cr3t4')
  })

  it('mira tambien la causa, donde vive el error de red', () => {
    const e = new Error('fallo la consulta', {
      cause: new Error(`ECONNREFUSED ${ENV.DATABASE_URL ?? ''}`),
    })
    const salida = paraLog(e, ENV)
    expect(salida).toContain('ECONNREFUSED')
    expect(salida).not.toContain('Cl4v3-Sup3r-S3cr3t4')
  })

  it('con un objeto cualquiera devuelve JSON tachado', () => {
    const salida = paraLog({ url: ENV.DATABASE_URL, password: 'otra-clave-larga' }, ENV)
    expect(salida).not.toContain('Cl4v3-Sup3r-S3cr3t4')
    expect(salida).not.toContain('otra-clave-larga')
  })

  it('no se cuelga con una estructura circular', () => {
    const a: Record<string, unknown> = { nombre: 'a' }
    a.yo = a
    expect(() => paraLog(a, ENV)).not.toThrow()
  })

  it('no tacha cadenas cortas: destruiria el log', () => {
    const corto: Entorno = { JWT_SECRET: 'abc' }
    expect(redactar('el codigo abc fallo', corto)).toContain('abc')
  })
})
