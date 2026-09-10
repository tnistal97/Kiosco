import { aCentavos, compararMontos, desdeCentavos, type Monto } from '@/lib/money'
import type { MedioCobrable } from '@/modules/sales/payment-methods'

/**
 * Si el cajero DIJO como se paga, o si el dialogo lo esta suponiendo. UX V3.
 *
 * El cobro se abre con efectivo por el total: es lo mas comun, y suponerlo
 * ahorra teclas. Pero suponerlo no es lo mismo que declararlo, y hasta la V3
 * la pantalla no distinguia las dos cosas: el campo "paga con" mostraba el
 * total en gris --un placeholder-- y Enter cobraba igual. Dos Enter seguidos
 * desde el buscador registraban una venta sin que nadie hubiera dicho un
 * importe (auditoria V3, problema 4).
 *
 * Declarar es cualquiera de estas cosas, todas deliberadas:
 *
 *   - escribir un importe en "paga con";
 *   - escribir el importe de un renglon del pago dividido;
 *   - tocar "Justo" o uno de los billetes sugeridos --escriben el importe--;
 *   - elegir un medio que no sea el que venia puesto.
 *
 * `medioElegidoAMano` cubre el caso de volver a efectivo despues de haber
 * mirado otro medio: fue una eleccion, aunque el valor termine siendo el de
 * arranque.
 *
 * ESTO NO CAMBIA NINGUNA REGLA DE NEGOCIO. Lo que se puede cobrar lo sigue
 * decidiendo `puedeCobrar` --que los pagos cuadren, que haya cliente si se
 * fia, que el credito entre-- y, en serio, el servidor. Esto solo decide si
 * la tecla Enter alcanza para confirmar.
 */
export interface RenglonDePago {
  method: MedioCobrable
  importe: string
  recibido: string
}

export function pagoDeclarado(
  pagos: readonly RenglonDePago[],
  medioElegidoAMano: boolean,
  medioPorOmision: MedioCobrable = 'CASH',
): boolean {
  if (medioElegidoAMano) return true
  return pagos.some(
    (p) => p.importe.trim() !== '' || p.recibido.trim() !== '' || p.method !== medioPorOmision,
  )
}

/**
 * Importes rapidos para "paga con". UX V2, Fase 1.
 *
 * Con un total de $ 24.850 lo que suele entregar el cliente es $ 25.000,
 * $ 30.000 o $ 50.000: el billete o la suma redonda inmediatamente superior.
 * Se proponen hasta tres, todas por encima del total y sin repetir; la
 * pantalla agrega "Justo" por su cuenta.
 *
 * Los pasos son los que existen en un cajon argentino. Un total de $ 800 da
 * $ 1.000, $ 5.000 y $ 10.000; uno de $ 24.850, $ 25.000, $ 30.000 y
 * $ 40.000. Nunca se propone un importe menor al total: no es un vuelto lo que
 * se esta calculando, es con cuanto paga.
 */
const PASOS_EN_PESOS = [1000, 5000, 10000, 20000, 50000, 100000] as const

export function sugerenciasDeRecibido(total: Monto, maximo = 3): Monto[] {
  const centavos = aCentavos(total)
  if (centavos <= 0) return []

  const vistos = new Set<number>()
  const salida: Monto[] = []
  for (const paso of PASOS_EN_PESOS) {
    const pasoEnCentavos = paso * 100
    const redondeado = Math.ceil(centavos / pasoEnCentavos) * pasoEnCentavos
    if (redondeado <= centavos || vistos.has(redondeado)) continue
    vistos.add(redondeado)
    salida.push(desdeCentavos(redondeado))
    if (salida.length === maximo) break
  }
  return salida.sort(compararMontos)
}
