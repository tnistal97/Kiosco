/**
 * Limite de intentos de inicio de sesion.
 *
 * Hoy /api/auth/login acepta intentos ilimitados: con la lista de usuarios
 * (que ademas era publica) se puede probar contrasenas hasta acertar.
 *
 * Alcance de esta implementacion: memoria del proceso. Alcanza para un
 * almacen con una sola instancia de la aplicacion, que es el despliegue
 * actual (un unico proceso PM2). Si en algun momento hay varias instancias
 * detras de un balanceador, este contador deja de ser global y hay que
 * moverlo a la base o a Redis. Queda anotado en docs/SECURITY_AUDIT.md.
 */

const MAX_INTENTOS = 8
const VENTANA_MS = 15 * 60 * 1000 // 15 minutos
const BLOQUEO_MS = 15 * 60 * 1000

interface Registro {
  fallos: number
  primerFallo: number
  bloqueadoHasta: number
}

const registros = new Map<string, Registro>()

/**
 * Se cuenta por usuario Y por origen. Contar solo por IP permitiria a un
 * atacante detras de un CGNAT bloquear a todo el local; contar solo por
 * usuario permitiria bloquear al encargado a proposito.
 */
function clave(username: string, ip: string): string {
  return `${username.toLowerCase()}|${ip}`
}

function limpiarVencidos(ahora: number): void {
  for (const [k, reg] of registros) {
    if (reg.bloqueadoHasta < ahora && ahora - reg.primerFallo > VENTANA_MS) {
      registros.delete(k)
    }
  }
}

/** true si el intento debe rechazarse sin siquiera comprobar la contrasena. */
export function estaBloqueado(username: string, ip: string): boolean {
  const ahora = Date.now()
  limpiarVencidos(ahora)

  const reg = registros.get(clave(username, ip))
  if (!reg) return false
  return reg.bloqueadoHasta > ahora
}

export function registrarFallo(username: string, ip: string): void {
  const ahora = Date.now()
  const k = clave(username, ip)
  const reg = registros.get(k)

  if (!reg || ahora - reg.primerFallo > VENTANA_MS) {
    registros.set(k, { fallos: 1, primerFallo: ahora, bloqueadoHasta: 0 })
    return
  }

  reg.fallos += 1
  if (reg.fallos >= MAX_INTENTOS) {
    reg.bloqueadoHasta = ahora + BLOQUEO_MS
  }
}

export function registrarExito(username: string, ip: string): void {
  registros.delete(clave(username, ip))
}

/**
 * Direccion de origen. Detras de nginx llega en X-Forwarded-For.
 *
 * La cabecera puede venir vacia o como ", 10.0.0.1" si un proxy la
 * concatena mal, y en ese caso el primer elemento es una cadena vacia. Se
 * descarta: usar "" como parte de la clave de bloqueo juntaria en un mismo
 * contador a todos los clientes cuyo proxy este mal configurado.
 */
export function origenDe(req: Request): string {
  const primero = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (primero) return primero
  return req.headers.get('x-real-ip')?.trim() ?? 'desconocido'
}

/** Solo para los tests: vacia el estado entre casos. */
export function __resetLoginAttempts(): void {
  registros.clear()
}
