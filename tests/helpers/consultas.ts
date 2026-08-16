/**
 * Contar las consultas SQL que hace el codigo bajo prueba.
 *
 * Es la herramienta que detecta un N+1: si el numero de sentencias crece con la
 * cantidad de filas, hay una consulta por fila. Nada mas mide eso --ni el
 * tiempo, que depende de la maquina, ni el plan, que solo mira UNA consulta--.
 *
 * Mide sobre el MISMO cliente Prisma que usan las rutas. Antes de la Fase 5A.2
 * las mediciones se hacian con un `PrismaClient` propio del archivo de pruebas,
 * que abre otra conexion y no ve una sola de las consultas de la aplicacion:
 * las guardias decian "no mas de dos consultas" y estaban observando cero. Ver
 * `src/lib/prisma.ts` y docs/QUALITY_STRATEGY.md.
 *
 * Las dos propiedades que hacen que esto sirva:
 *
 *   1. Si no puede medir, ABORTA. No devuelve cero.
 *   2. Espera a que el motor entregue los eventos antes de contar, con una
 *      barrera que se comprueba a si misma.
 */

import { clienteObservable } from '@/lib/prisma'

const observable = clienteObservable()

if (observable === null) {
  throw new Error(
    'No se pueden contar consultas: el cliente Prisma se construyo sin eventos. ' +
      'Falta PRISMA_QUERY_EVENTS=1, que pone tests/setup.ts. Se aborta a proposito: ' +
      'medir cero y darlo por bueno es peor que no medir.',
  )
}

const cliente = observable

/**
 * El estado va en un OBJETO y no en dos variables sueltas.
 *
 * `require-atomic-updates` --con razon-- desconfia de una variable que se
 * reasigna despues de un `await`: entre el await y la asignacion pudo pasar
 * cualquier cosa. Aca no hay dos mediciones en vuelo --`medir` lo impide-- y
 * un campo de objeto expresa mejor lo que es: un estado compartido con nombre.
 */
const captura: { activa: boolean; sentencias: string[] } = { activa: false, sentencias: [] }

cliente.$on('query', (evento) => {
  if (captura.activa) captura.sentencias.push(evento.query)
})

/**
 * Los cambios de estado, SINCRONOS y con nombre.
 *
 * No es decoracion: `require-atomic-updates` marca --con razon-- cualquier
 * asignacion que ocurra despues de un `await`, porque entre el await y la
 * asignacion pudo correr otra cosa. Encerrarlos en funciones sincronas deja el
 * cambio en un solo turno del bucle de eventos, que es lo que la regla pide.
 */
function abrirCaptura(): void {
  captura.activa = true
  captura.sentencias = []
}

function vaciarCaptura(): void {
  captura.sentencias = []
}

function cerrarCaptura(): string[] {
  captura.activa = false
  return [...captura.sentencias]
}

function quitarBarrera(marca: string): void {
  captura.sentencias = captura.sentencias.filter((s) => !s.includes(marca))
}

/**
 * Lo que el motor manda por su cuenta y no es trabajo de la aplicacion.
 *
 * `BEGIN`/`COMMIT` acompanian a cada transaccion y `DEALLOCATE` a las
 * sentencias preparadas: contarlos haria que una venta "hiciera mas consultas"
 * por envolverse en una transaccion, que es justo lo contrario de lo que se
 * quiere premiar.
 */
const RUIDO = /^\s*(BEGIN|COMMIT|ROLLBACK|DEALLOCATE|SET|SAVEPOINT|RELEASE)\b/i

export interface Medicion {
  /** Todas las sentencias capturadas, en orden, incluido el ruido. */
  todas: string[]
  /** Las que leen o escriben datos. Es el numero que delata un N+1. */
  consultas: number
  /** Solo las lecturas. Un N+1 clasico es una lectura por fila. */
  lecturas: number
}

let contadorDeBarreras = 0

/**
 * Espera a que lleguen los eventos de todo lo que ya se ejecuto.
 *
 * El registro de consultas viaja por un canal aparte del de los resultados, asi
 * que el `await` de la ultima consulta NO garantiza que su evento ya haya
 * llegado. Se manda una sentencia reconocible y se espera a VERLA en la lista:
 * como los eventos llegan en orden, cuando aparece la barrera ya llegaron todos
 * los anteriores.
 *
 * Se comprueba a si misma: si la barrera no aparece, lanza. Nunca devuelve un
 * conteo incompleto haciendolo pasar por completo.
 */
async function esperarEventos(): Promise<void> {
  contadorDeBarreras += 1
  // El `_fin` no es decoracion: sin el, la marca `barrera_1` es PREFIJO de
  // `barrera_11`, y `includes()` da por llegada una barrera que todavia no
  // llego --o borra dos-- en cuanto el contador pasa de diez. El sintoma era
  // un conteo que se corria en uno, al azar, solo en corridas largas: la clase
  // de ruido que hace que nadie le crea a la guardia. Con el sufijo, ninguna
  // marca es prefijo de otra.
  const marca = `barrera_${String(contadorDeBarreras)}_fin`
  await cliente.$queryRawUnsafe(`SELECT 1 AS ${marca}`)

  const limite = performance.now() + 5_000
  while (!captura.sentencias.some((s) => s.includes(marca))) {
    if (performance.now() > limite) {
      throw new Error(
        `El registro de consultas no entrego el evento de barrera en 5 s. ` +
          'La medicion seria incompleta, asi que se aborta en vez de informarla.',
      )
    }
    await new Promise((r) => setTimeout(r, 1))
  }

  // La barrera es instrumental: no la hizo el codigo bajo prueba.
  quitarBarrera(marca)
}

/**
 * Cuenta las consultas que hace `fn`.
 *
 * No es reentrante a proposito: dos mediciones anidadas contarian lo mismo dos
 * veces y el numero no significaria nada. Se detecta y se aborta.
 */
export async function medir<T>(fn: () => Promise<T>): Promise<Medicion & { resultado: T }> {
  if (captura.activa) {
    throw new Error('Hay una medicion en curso: anidarlas daria un numero sin sentido')
  }

  // Lo que quedo pendiente de ANTES no es de esta medicion.
  abrirCaptura()
  await esperarEventos()
  vaciarCaptura()

  let resultado: T
  let todas: string[]
  try {
    resultado = await fn()
    await esperarEventos()
  } finally {
    todas = cerrarCaptura()
  }

  const utiles = todas.filter((s) => !RUIDO.test(s))
  return {
    resultado,
    todas,
    consultas: utiles.length,
    lecturas: utiles.filter((s) => /^\s*SELECT\b/i.test(s)).length,
  }
}

/** Solo el numero, para cuando el resultado no importa. */
export async function cuantasConsultas(fn: () => Promise<unknown>): Promise<number> {
  return (await medir(fn)).consultas
}

export interface Crecimiento {
  conPocas: number
  conMuchas: number
  /** Consultas de mas por cada fila agregada. Cero es lo que se busca. */
  porFila: number
}

/**
 * LA guardia contra el N+1.
 *
 * Corre el mismo escenario con dos volumenes y falla si el numero de consultas
 * crece con las filas. Es una funcion que LANZA, y no un `expect`, para que la
 * prueba negativa pueda comprobar que de verdad falla cuando tiene que fallar:
 * una guardia que nunca se vio fallar no es una guardia.
 *
 * `tolerancia` admite un crecimiento conocido y acotado --por ejemplo, una
 * escritura por linea de venta, que es trabajo real y no un N+1--. Por omision
 * es cero: el caso normal es que el numero no se mueva.
 */
export async function exigirQueNoCrezca(
  medirCon: (filas: number) => Promise<number>,
  opciones: { pocas: number; muchas: number; tolerancia?: number; que: string },
): Promise<Crecimiento> {
  const { pocas, muchas, tolerancia = 0, que } = opciones
  if (muchas <= pocas) throw new Error('El segundo volumen tiene que ser mayor que el primero')

  const conPocas = await medirCon(pocas)
  const conMuchas = await medirCon(muchas)
  const porFila = (conMuchas - conPocas) / (muchas - pocas)

  if (porFila > tolerancia) {
    throw new Error(
      `${que}: con ${String(pocas)} filas hizo ${String(conPocas)} consultas y con ` +
        `${String(muchas)} hizo ${String(conMuchas)}. Son ${porFila.toFixed(2)} consultas por ` +
        `fila y la tolerancia es ${String(tolerancia)}: el costo crece con los datos.`,
    )
  }

  return { conPocas, conMuchas, porFila }
}
