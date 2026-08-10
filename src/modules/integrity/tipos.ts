/**
 * Lo que una comprobacion de integridad puede decir.
 *
 * Un modulo aparte y sin dependencias para que lo puedan importar tanto el
 * servicio como el guion de linea de comandos sin arrastrar Prisma.
 */

/** Una fila que no cumple una regla. */
export interface Inconsistencia {
  /** Que fila es, en palabras: `Venta #482`, `Coca Cola 2,25 L`. */
  entidad: string
  /** La regla que no se cumple, escrita como se cumple: `total = suma de pagos`. */
  regla: string
  esperado: string
  encontrado: string
  /** La resta, cuando los dos lados son numeros. */
  diferencia: string | null
  /** Lo que haga falta para poder ir a mirar: fechas, ids, contexto. */
  detalle?: string
}

/** El resultado de una comprobacion. */
export interface Comprobacion {
  /** Como se llama en la salida: `Ventas`, `Turnos de caja`. */
  nombre: string
  /** Cuantas filas se miraron. Un `OK 0` no es lo mismo que un `OK 482`. */
  revisadas: number
  inconsistencias: Inconsistencia[]
}

export interface Informe {
  comprobaciones: Comprobacion[]
  /** Suma de todas las inconsistencias. Cero es el unico resultado aceptable. */
  total: number
  /** Cuanto tardo, en milisegundos. */
  duracionMs: number
}

export function totalDeInconsistencias(comprobaciones: Comprobacion[]): number {
  return comprobaciones.reduce((suma, c) => suma + c.inconsistencias.length, 0)
}
