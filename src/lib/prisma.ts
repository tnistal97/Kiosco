/**
 * El cliente Prisma de la aplicacion. Uno solo, compartido.
 *
 * Se construye a traves de una fabrica --y no con un `new` suelto-- por un
 * motivo concreto que aparecio en la Fase 5A.2: las pruebas de rendimiento
 * necesitan CONTAR las consultas que hace una ruta, y contar consultas exige
 * pedirle al motor que emita un evento por cada una. Esa opcion solo se puede
 * dar en el constructor: no hay forma de encenderla despues.
 *
 * Hasta esta fase las pruebas resolvian eso creando un `PrismaClient` aparte y
 * escuchandolo. No funcionaba, y de la peor manera posible: ese cliente abre su
 * propia conexion, no ve NADA de lo que hace la aplicacion, y las aserciones
 * del estilo "esta ruta no hizo mas de dos consultas" se cumplian con cero.
 * Cinco guardias contra el N+1 que en realidad no miraban nada.
 *
 * La instrumentacion se pide por variable de entorno y NUNCA se enciende en
 * produccion. Sin la variable, `new PrismaClient()` recibe exactamente los
 * mismos argumentos que antes de esta fase: sin opciones.
 */

import { PrismaClient } from '@prisma/client'

/**
 * El mismo cliente, tipado para poder escuchar sus consultas.
 *
 * `$on('query', ...)` solo existe en el tipo cuando el generico declara el
 * evento. La aplicacion no lo usa nunca; lo usan las pruebas.
 */
export type ClienteObservable = PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }>

/**
 * Si hay que construir el cliente con el registro de consultas encendido.
 *
 * Pura y exportada para poder probarla: lo que se quiere garantizar es que en
 * produccion devuelva `false` aunque la variable este puesta. Un servidor con
 * `PRISMA_QUERY_EVENTS=1` heredada de una copia de `.env` pagaria el costo de
 * serializar cada sentencia y podria dejar parametros en el log.
 */
export function pideInstrumentacion(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') return false
  return env.PRISMA_QUERY_EVENTS === '1'
}

const CON_EVENTOS = pideInstrumentacion(process.env)

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  /** Si el cliente guardado en el global se construyo con eventos. */
  prismaConEventos?: boolean
}

function crear(): PrismaClient {
  if (!CON_EVENTOS) return new PrismaClient()
  // El generico cambia la firma de `$on`, no el comportamiento. El resto de la
  // aplicacion ve siempre el mismo tipo; el ancho se recupera en
  // `clienteObservable()`.
  return new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
}

const cacheado = globalForPrisma.prisma
export const prisma: PrismaClient = cacheado ?? crear()

/**
 * Si el objeto exportado ARRIBA emite eventos. No si alguien los pidio.
 *
 * La diferencia importa cuando el cliente ya estaba en el global: en ese caso
 * lo construyo otra evaluacion del modulo, quiza sin la variable puesta, y
 * devolverlo como observable seria volver a contar cero creyendo que se mide.
 */
const EMITE_EVENTOS =
  cacheado === undefined ? CON_EVENTOS : globalForPrisma.prismaConEventos === true

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaConEventos = EMITE_EVENTOS
}

/**
 * El cliente de la aplicacion, listo para escuchar sus consultas.
 *
 * Devuelve `null` --y no un cliente mudo-- cuando la instrumentacion no esta
 * encendida, para que quien mide pueda ABORTAR en vez de medir cero. Esa
 * distincion es todo el arreglo de la Fase 5A.2.
 */
export function clienteObservable(): ClienteObservable | null {
  return EMITE_EVENTOS ? prisma : null
}

export default prisma
