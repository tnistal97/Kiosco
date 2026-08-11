/**
 * Las variables sin las que la aplicacion NO debe arrancar.
 *
 * MOTIVO: hasta ahora cada variable se comprobaba donde se usaba. El efecto
 * real, medido en el servidor: con `JWT_SECRET` puesto en `change-me` la
 * aplicacion arrancaba, servia el login, y recien fallaba al firmar el token
 * --con un error 500 sin explicacion para quien estaba en el mostrador--.
 * Media aplicacion levantada es peor que ninguna: parece que anda.
 *
 * Este modulo junta las reglas en un solo lugar y las corre al arrancar. Si
 * algo falta o es debil, el proceso muere con un mensaje que dice exactamente
 * que variable y por que. PM2 lo reintenta, vuelve a morir, y el estado
 * `errored` es visible en `pm2 list`: un fallo ruidoso y diagnosticable.
 *
 * NO valida en el build. `next build` no tiene --ni debe tener-- los secretos
 * de produccion, y hacerlo fallar ahi obligaria a inventar valores falsos en
 * el CI, que es como se terminan filtrando.
 */

/**
 * Un entorno cualquiera.
 *
 * No `NodeJS.ProcessEnv`: ese tipo declara `NODE_ENV` como obligatorio, asi que
 * las pruebas no podrian armar un entorno a mano sin incluirlo --y probar la
 * ausencia de una variable es justamente lo que hay que probar--. `process.env`
 * es asignable a esto.
 */
export type Entorno = Record<string, string | undefined>

/** Minimo del secreto de sesion. Coincide con el que exige `auth/token.ts`. */
export const MIN_JWT_SECRET = 32

export interface ProblemaDeEntorno {
  variable: string
  detalle: string
}

/** Nombres de las variables obligatorias. Sin valores: esto se documenta. */
export const VARIABLES_REQUERIDAS = ['DATABASE_URL', 'JWT_SECRET'] as const

/**
 * Comprueba el entorno recibido y devuelve la lista de problemas.
 *
 * Devuelve en vez de lanzar para poder probarla, y para que quien la llama
 * decida: al arrancar se muere, en el endpoint de salud se informa.
 *
 * Ningun mensaje incluye el VALOR de la variable. Un error de arranque termina
 * en los logs de PM2, y los logs de PM2 los lee mas gente que la que deberia
 * ver el secreto.
 */
export function problemasDeEntorno(env: Entorno = process.env): ProblemaDeEntorno[] {
  const problemas: ProblemaDeEntorno[] = []

  const url = env.DATABASE_URL
  if (!url || url.trim() === '') {
    problemas.push({ variable: 'DATABASE_URL', detalle: 'ausente o vacia' })
  } else if (!/^postgres(ql)?:\/\//.test(url)) {
    problemas.push({
      variable: 'DATABASE_URL',
      detalle: 'no parece una URL de PostgreSQL (deberia empezar con postgresql://)',
    })
  }

  const secreto = env.JWT_SECRET
  if (!secreto || secreto.trim() === '') {
    problemas.push({ variable: 'JWT_SECRET', detalle: 'ausente o vacia' })
  } else if (secreto.length < MIN_JWT_SECRET) {
    problemas.push({
      variable: 'JWT_SECRET',
      detalle:
        `tiene ${String(secreto.length)} caracteres y el minimo es ${String(MIN_JWT_SECRET)}. ` +
        'Generar uno con: openssl rand -base64 48',
    })
  }

  return problemas
}

/**
 * Lo mismo, pero muriendo. Es lo que se llama al arrancar.
 *
 * `process.exit(1)` y no `throw`: una excepcion en el arranque de Next puede
 * quedar atrapada por un manejador de arriba y dejar el proceso vivo a medias,
 * que es exactamente lo que esto viene a evitar.
 */
export function exigirEntorno(env: Entorno = process.env): void {
  const problemas = problemasDeEntorno(env)
  if (problemas.length === 0) return

  const detalle = problemas.map((p) => `  - ${p.variable}: ${p.detalle}`).join('\n')
  // El arranque no tiene otro canal: esto va a los logs de PM2.
  console.error(
    `\nLa aplicacion no puede arrancar. Variables de entorno invalidas:\n${detalle}\n\n` +
      'Ver .env.example y docs/RELEASE_INVENTORY.md.\n',
  )
  process.exit(1)
}
