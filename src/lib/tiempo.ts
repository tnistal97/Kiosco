/**
 * El dia comercial.
 *
 * Un almacen que cierra a las 22 tiene un dia que va de 00:00 a 23:59 EN SU
 * HORA. El sistema guarda instantes --`DateTime` de PostgreSQL, siempre UTC--
 * y eso esta bien: un instante es un instante. Lo que hace falta es la regla
 * que traduce entre las dos cosas, y esa regla es la ZONA HORARIA DEL LOCAL.
 *
 * Por que un identificador IANA y no un desfase fijo:
 *
 *   `America/Argentina/Buenos_Aires`  es una REGLA. Sabe que en 2008 hubo
 *                                     horario de verano, sabe que hoy no lo
 *                                     hay, y sabra que pasa si vuelve.
 *   `UTC-3`                           es un NUMERO. El dia que cambie la
 *                                     regla, todas las fechas anteriores
 *                                     quedan mal calculadas hacia atras.
 *
 * Guardar el numero obliga a acertarle al futuro. Guardar la regla no.
 *
 * QUE PROBLEMA RESUELVE. Hasta la Fase 3C el rango del dia se armaba con
 * `new Date("2026-08-10T00:00:00.000Z")` --UTC-- mientras el navegador pedia
 * el dia local. En Argentina eso hacia que el "dia" fuera de las 21:00 de
 * ayer a las 20:59 de hoy, y **toda venta posterior a las 21:00 desaparecia
 * del dia**. La correccion de la 3C fue quitar la `Z`, que traslada la
 * decision a la zona horaria DEL PROCESO: correcto en el servidor del local,
 * incorrecto en cualquier otro. Este modulo la traslada a un dato del
 * negocio, que es donde tiene que estar.
 *
 * Sin dependencias nuevas: `Intl.DateTimeFormat` trae la base de datos IANA
 * completa en Node desde la version 14.
 */

/**
 * Fecha de calendario sin hora: `"2026-08-10"`.
 *
 * Alias de `string` para que viaje en JSON tal cual. Lo que garantiza la forma
 * es `esFechaLocal`, que es por donde entra todo lo que viene de afuera.
 */
export type FechaLocal = string

/** Zona horaria IANA: `"America/Argentina/Buenos_Aires"`. */
export type ZonaHoraria = string

/**
 * La zona del negocio mientras no se diga otra cosa.
 *
 * Es el valor por omision de `Branch.timeZone` y el unico lugar donde figura
 * escrito. Un almacen en otra provincia argentina usa esta misma: el pais
 * entero esta en una sola zona desde 2009.
 */
export const ZONA_POR_DEFECTO: ZonaHoraria = 'America/Argentina/Buenos_Aires'

const FORMA_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** `true` si el texto tiene forma de fecha y ademas existe en el calendario. */
export function esFechaLocal(texto: string): texto is FechaLocal {
  if (!FORMA_FECHA.test(texto)) return false
  const [a, m, d] = texto.split('-').map(Number) as [number, number, number]
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  // El 31 de febrero pasa las comprobaciones de rango. `Date.UTC` lo corre al
  // 3 de marzo, asi que se compara contra lo que devolvio.
  const prueba = new Date(Date.UTC(a, m - 1, d))
  return (
    prueba.getUTCFullYear() === a && prueba.getUTCMonth() === m - 1 && prueba.getUTCDate() === d
  )
}

/**
 * `true` si la zona existe en la base IANA.
 *
 * Se comprueba construyendo un formateador, que es lo unico que la plataforma
 * ofrece en todas las versiones: `Intl.supportedValuesOf` no esta en Node 16.
 * Un identificador desconocido lanza `RangeError`.
 *
 * Se rechazan ademas los desfases fijos --`"UTC-3"`, `"GMT+3"`, `"-03:00"`--
 * aunque alguno sea aceptado por la plataforma: el punto del modulo es que la
 * zona sea una regla. `"UTC"` si se acepta, porque es una zona de verdad y
 * sirve para las pruebas.
 */
export function esZonaValida(zona: string): zona is ZonaHoraria {
  if (zona !== 'UTC' && !zona.includes('/')) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona })
    return true
  } catch {
    return false
  }
}

/**
 * Un formateador por zona. Construirlo cuesta bastante mas que usarlo, y la
 * reconciliacion lo usa una vez por fila.
 */
const FORMATEADORES = new Map<string, Intl.DateTimeFormat>()

function formateador(zona: ZonaHoraria): Intl.DateTimeFormat {
  const existente = FORMATEADORES.get(zona)
  if (existente) return existente

  const nuevo = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  FORMATEADORES.set(zona, nuevo)
  return nuevo
}

interface ParedDeReloj {
  anio: number
  mes: number
  dia: number
  hora: number
  minuto: number
  segundo: number
}

/** Que marcaba el reloj de pared de esa zona en ese instante. */
function relojEn(instante: Date, zona: ZonaHoraria): ParedDeReloj {
  const partes = formateador(zona).formatToParts(instante)
  const leer = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const parte = partes.find((p) => p.type === tipo)
    return parte === undefined ? 0 : Number(parte.value)
  }
  // `hour12: false` devuelve 24 para la medianoche en algunas versiones de
  // ICU. Es la unica rareza del formateador y hay que normalizarla.
  const hora = leer('hour')
  return {
    anio: leer('year'),
    mes: leer('month'),
    dia: leer('day'),
    hora: hora === 24 ? 0 : hora,
    minuto: leer('minute'),
    segundo: leer('second'),
  }
}

/**
 * Desfase de la zona en ese instante, en milisegundos.
 *
 * Positivo al este de Greenwich. Para Buenos Aires da -10.800.000, o sea tres
 * horas. Cambia con el horario de verano, que es exactamente el motivo de
 * calcularlo por instante en lugar de guardarlo.
 */
function desfase(instante: Date, zona: ZonaHoraria): number {
  const r = relojEn(instante, zona)
  const comoSiFueraUtc = Date.UTC(r.anio, r.mes - 1, r.dia, r.hora, r.minuto, r.segundo)
  // Los milisegundos no los devuelve el formateador; se recuperan del instante,
  // que los tiene intactos porque ningun desfase del mundo es fraccion de
  // segundo desde 1972.
  return comoSiFueraUtc - (instante.getTime() - instante.getMilliseconds())
}

/**
 * El instante en que esa zona marcaba esa hora de pared.
 *
 * DOS CANDIDATOS, y despues se COMPRUEBA cual sirve.
 *
 * El primero supone que el desfase es el que rige en el instante equivocado
 * --el que resultaria de leer la hora local como si fuera UTC-- y con eso se
 * acerca; el segundo lo recalcula ya sobre el instante del primero. Sin el
 * segundo, una fecha del otro lado de un cambio de horario sale corrida una
 * hora.
 *
 * PERO EL SEGUNDO NO SIEMPRE ES EL BUENO, y esa es la parte que hay que
 * comprobar en vez de suponer. Cuando la hora pedida cae dentro de un salto de
 * horario --el reloj va de 23:59 a 01:00 y las 00:00 no ocurrieron nunca--, el
 * segundo candidato aterriza ANTES del salto, o sea todavia en el dia
 * anterior. Sin comprobarlo, el dia siguiente empezaba una hora antes de que
 * terminara el anterior y esa hora quedaba contada DOS VECES: una venta hecha
 * ahi aparecia en los dos dias.
 *
 * Los dos casos sin respuesta unica, y como se resuelven:
 *
 *   HORA QUE NO EXISTE. Ningun candidato marca esa hora de pared. Se devuelve
 *   el mas TARDIO, que es el instante en que ese dia empezo de verdad. Es lo
 *   que un comercio entenderia por "desde que abrio el dia".
 *
 *   HORA QUE OCURRE DOS VECES. Los dos candidatos valen. Se devuelve el mas
 *   TEMPRANO, que hace el dia mas largo y no deja ninguna venta afuera. Un dia
 *   de 25 horas es raro; una venta que no figura en ningun dia es un error.
 */
function instanteDe(pared: ParedDeReloj, ms: number, zona: ZonaHoraria): Date {
  const supuesto = Date.UTC(
    pared.anio,
    pared.mes - 1,
    pared.dia,
    pared.hora,
    pared.minuto,
    pared.segundo,
    ms,
  )

  const primera = supuesto - desfase(new Date(supuesto), zona)
  const segunda = supuesto - desfase(new Date(primera), zona)

  const validos = [primera, segunda].filter((t) => marcaLaHora(new Date(t), pared, zona))
  if (validos.length > 0) return new Date(Math.min(...validos))
  return new Date(Math.max(primera, segunda))
}

/** Si el reloj de esa zona marcaba exactamente esa hora de pared. */
function marcaLaHora(instante: Date, pared: ParedDeReloj, zona: ZonaHoraria): boolean {
  const r = relojEn(instante, zona)
  return (
    r.anio === pared.anio &&
    r.mes === pared.mes &&
    r.dia === pared.dia &&
    r.hora === pared.hora &&
    r.minuto === pared.minuto &&
    r.segundo === pared.segundo
  )
}

function partirFecha(fecha: FechaLocal): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number]
  return { anio, mes, dia }
}

/**
 * El instante en que empieza ese dia en esa zona: las 00:00:00.000.
 *
 * Inclusivo. Es el `gte` de todo filtro por fecha.
 */
export function inicioDelDia(fecha: FechaLocal, zona: ZonaHoraria): Date {
  const { anio, mes, dia } = partirFecha(fecha)
  return instanteDe({ anio, mes, dia, hora: 0, minuto: 0, segundo: 0 }, 0, zona)
}

/**
 * El ultimo instante de ese dia en esa zona.
 *
 * Se DEFINE como un milisegundo antes de que empiece el siguiente, y no como
 * "las 23:59:59.999 de este". La diferencia importa: calculado por separado,
 * un dia con cambio de horario podia terminar despues de que empezara el
 * siguiente --y esa hora quedaba contada dos veces-- o antes, dejando un hueco
 * en el que una venta no pertenecia a ningun dia.
 *
 * Asi los dias EMBALDOSAN la linea de tiempo: sin huecos y sin solapes, por
 * construccion y no por suerte.
 *
 * Inclusivo, y por eso el milisegundo y no las 00:00 del siguiente: con `lte`
 * los dos extremos se leen igual, y una venta a las 23:59:59.500 --que existe,
 * porque `date` guarda milisegundos-- entra en su dia.
 */
export function finDelDia(fecha: FechaLocal, zona: ZonaHoraria): Date {
  return new Date(inicioDelDia(sumarDias(fecha, 1), zona).getTime() - 1)
}

/** El dia comercial al que pertenece un instante. */
export function diaDe(instante: Date, zona: ZonaHoraria): FechaLocal {
  const r = relojEn(instante, zona)
  return `${String(r.anio).padStart(4, '0')}-${String(r.mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`
}

/** Hoy, en la zona del negocio. Nunca en la del servidor. */
export function hoyEn(zona: ZonaHoraria, ahora: Date = new Date()): FechaLocal {
  return diaDe(ahora, zona)
}

/** La fecha `dias` dias despues (o antes, con negativo) de la dada. */
export function sumarDias(fecha: FechaLocal, dias: number): FechaLocal {
  const { anio, mes, dia } = partirFecha(fecha)
  // La aritmetica de dias de calendario se hace en UTC A PROPOSITO: sumar 24
  // horas a un instante local se equivoca el dia que ese dia dura 23 o 25.
  const movido = new Date(Date.UTC(anio, mes - 1, dia + dias))
  return `${String(movido.getUTCFullYear()).padStart(4, '0')}-${String(movido.getUTCMonth() + 1).padStart(2, '0')}-${String(movido.getUTCDate()).padStart(2, '0')}`
}

export interface RangoDeDias {
  /** Inclusivo: 00:00:00.000 del primer dia. */
  desde: Date
  /** Inclusivo: 23:59:59.999 del ultimo. */
  hasta: Date
}

/**
 * El rango de instantes que cubren esos dias en esa zona.
 *
 * Es LA funcion del modulo: todo filtro por fecha del sistema --ventas,
 * caja, compras, bitacora, reportes-- pasa por aca y por ningun otro lado.
 */
export function rangoDeDias(desde: FechaLocal, hasta: FechaLocal, zona: ZonaHoraria): RangoDeDias {
  return { desde: inicioDelDia(desde, zona), hasta: finDelDia(hasta, zona) }
}

/**
 * Cuantos dias de calendario cubre el rango, contando los dos extremos.
 *
 * Se cuenta en DIAS DE CALENDARIO y no dividiendo milisegundos: un rango que
 * cruza un cambio de horario de verano tiene un dia de 23 horas, y la division
 * devolveria 30,96 dias para un mes de 31.
 */
export function cantidadDeDias(desde: FechaLocal, hasta: FechaLocal): number {
  const a = partirFecha(desde)
  const b = partirFecha(hasta)
  const uno = Date.UTC(a.anio, a.mes - 1, a.dia)
  const dos = Date.UTC(b.anio, b.mes - 1, b.dia)
  return Math.round((dos - uno) / 86_400_000) + 1
}
