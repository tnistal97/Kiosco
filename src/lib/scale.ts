/**
 * Balanza: la interfaz, y nada mas que la interfaz.
 *
 * LO QUE ESTE ARCHIVO NO HACE, y es a proposito:
 *
 *   · no conecta ningun hardware;
 *   · no usa WebSerial ni ninguna otra API del navegador;
 *   · no agrega ninguna dependencia;
 *   · no simula una balanza que no existe.
 *
 * `balanzaActual()` devuelve `null` hoy y va a seguir devolviendo `null` hasta
 * que alguien registre una implementacion de verdad. El dialogo de peso lo
 * consulta y, al recibir `null`, se comporta exactamente como se comporta hoy:
 * entrada manual.
 *
 * Entonces, ¿para que existe? Para que el dialogo NO quede casado con la
 * entrada manual. Sin esto, el dia que llegue la balanza habria que abrir el
 * dialogo, meterle un estado nuevo, un efecto, un manejo de errores y una
 * segunda forma de confirmar; con esto, hay que escribir un objeto que cumpla
 * `ScaleProvider` y llamar a `registrarBalanza`. El dialogo no se toca.
 *
 * La integracion real es Fase 4 o mas adelante. Esto es la puerta, cerrada.
 */

import type { TextoCantidad } from '@/lib/cantidad'
import type { UnidadDeVenta } from '@/modules/products/units'

/** Una lectura de la balanza. */
export interface LecturaDeBalanza {
  /** El peso, en la unidad que declare `unit`. */
  weight: TextoCantidad
  /**
   * En que unidad pesa este aparato. Casi siempre `KG`.
   *
   * Se declara en vez de asumirse: una balanza configurada en gramos que
   * devuelva `425` no es lo mismo que una en kilos que devuelva `425`, y la
   * diferencia entre las dos es cuatrocientos veinticinco kilos de queso.
   */
  unit: UnidadDeVenta
  /**
   * Si el plato dejo de moverse.
   *
   * Una lectura inestable NO se puede cobrar: el peso todavia esta cambiando.
   * Quien consuma esta interfaz tiene que mirarlo antes de confirmar.
   */
  estable: boolean
}

export interface ScaleProvider {
  /** Como se llama, para poder decirlo en pantalla. */
  readonly nombre: string
  /** Si esta conectada y respondiendo AHORA. */
  disponible(): boolean
  /** Una lectura puntual. */
  leer(): Promise<LecturaDeBalanza>
  /**
   * Lecturas continuas, si el aparato las emite. Devuelve como cancelar.
   *
   * Opcional porque no todas las balanzas lo permiten: algunas solo responden
   * cuando se les pregunta. Quien no la implemente sigue sirviendo para el
   * caso normal --apoyar, leer, confirmar-- y el dialogo lo tiene en cuenta.
   */
  suscribir?(alLeer: (lectura: LecturaDeBalanza) => void): () => void
}

let registrada: ScaleProvider | null = null

/**
 * Registra la balanza del equipo.
 *
 * Se llamaria una vez al arrancar la aplicacion, desde el codigo que sepa que
 * hay conectado. Hoy no lo llama nadie.
 */
export function registrarBalanza(proveedor: ScaleProvider | null): void {
  registrada = proveedor
}

/**
 * La balanza disponible, o `null`.
 *
 * `null` no es un error ni un estado degradado: es el estado normal de un
 * mostrador que pesa con una balanza que no esta conectada al sistema y que
 * tipea el numero a mano. Es como funciona hoy y como va a seguir funcionando
 * en la mayoria de los locales.
 */
export function balanzaActual(): ScaleProvider | null {
  return registrada !== null && registrada.disponible() ? registrada : null
}
