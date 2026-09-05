import { aCentavos, compararMontos, desdeCentavos, type Monto } from '@/lib/money'

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
