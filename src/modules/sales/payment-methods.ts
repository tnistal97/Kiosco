/**
 * Medios de pago.
 *
 * Un unico vocabulario para toda la aplicacion. Hasta la Fase 2 convivian dos
 * --`efectivo | tarjeta | mercado_pago` en `CashRegisterMovement`, y una lista
 * distinta en la pantalla de cobro-- y esa desincronizacion es exactamente lo
 * que hacia que una venta apareciera como "Sin registrar" en el reporte.
 *
 * Este modulo NO importa Prisma: lo usan el servidor y el navegador.
 */

/**
 * Los codigos que se guardan.
 *
 * `CARD` existe solo para los datos HISTORICOS. Hasta la Fase 3 el sistema
 * guardaba "tarjeta" sin distinguir debito de credito, y no hay forma de saber
 * cual era. Convertir esas filas a `DEBIT_CARD` seria inventar un dato; usar
 * `OTHER` seria perder uno. Se conserva tal cual era y no se ofrece en el POS.
 */
export const MEDIOS_DE_PAGO = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
  'OTHER',
  'CARD',
  /**
   * A cuenta. La parte de la venta que NO se cobro. Fase 4A.
   *
   * Es un medio de pago en el sentido de que CUBRE parte del total --y por eso
   * la invariante `suma(pagos) == total` sigue valiendo con fiado-- pero no es
   * plata que entro. Va al libro del cliente y no al cajon.
   *
   * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
   */
  'ACCOUNT',
] as const

export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number]

/** Los que se pueden elegir al cobrar. `CARD` queda afuera a proposito. */
export const MEDIOS_COBRABLES = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
  'OTHER',
  'ACCOUNT',
] as const

export type MedioCobrable = (typeof MEDIOS_COBRABLES)[number]

/**
 * Los que pueden aparecer en un movimiento de caja.
 *
 * Todos menos `ACCOUNT`, y esa exclusion es una regla del sistema y no un
 * detalle de validacion: un cargo a cuenta NO genera movimiento de caja porque
 * no es plata que cambio de manos, es una promesa. Anotarlo en la caja --aunque
 * fuera con importe que no suma al efectivo-- haria que el listado del turno
 * mostrara dinero que nadie recibio.
 *
 * Cada linea de pago de una venta va a exactamente UNO de dos destinos: la caja
 * o el libro del cliente. Y hay una reconciliacion por cada destino.
 */
export const MEDIOS_DE_CAJA = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
  'OTHER',
  'CARD',
] as const

export type MedioDeCaja = (typeof MEDIOS_DE_CAJA)[number]

/** Los que se pueden usar para cobrarle a un cliente lo que debe. */
export const MEDIOS_DE_COBRANZA = [
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'TRANSFER',
  'OTHER',
] as const

export type MedioDeCobranza = (typeof MEDIOS_DE_COBRANZA)[number]

/**
 * Los que se pueden usar para PAGARLE a un proveedor. Fase 4B.
 *
 * Cuatro, y son distintos de los cuatro con los que se le cobra a un cliente.
 * Las dos diferencias son deliberadas:
 *
 *   · `CARD` en vez de `DEBIT_CARD` y `CREDIT_CARD`. Al proveedor se le paga
 *     con LA TARJETA DEL NEGOCIO, y quien registra el pago no siempre sabe --ni
 *     le importa-- cual de las dos era. `CARD` dice lo que se sabe. Del lado
 *     del cliente si se distinguen, porque ahi la tarjeta es del cliente y el
 *     debito y el credito acreditan distinto.
 *
 *   · sin `ACCOUNT`, igual que en la cobranza: pagarle la cuenta al proveedor
 *     con su propia cuenta no significa nada.
 *
 * `CARD` reaparece aca despues de haber quedado afuera del POS --donde existe
 * solo para los datos historicos-- y no es una contradiccion: alla se lo excluyo
 * porque el cajero SI sabe si el cliente paso debito o credito, y guardar
 * "tarjeta" a secas seria perder un dato que se tiene.
 */
export const MEDIOS_DE_PAGO_A_PROVEEDOR = ['CASH', 'TRANSFER', 'CARD', 'OTHER'] as const

export type MedioDePagoAProveedor = (typeof MEDIOS_DE_PAGO_A_PROVEEDOR)[number]

const ETIQUETAS: Record<MedioDePago, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Débito',
  CREDIT_CARD: 'Crédito',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
  CARD: 'Tarjeta',
  ACCOUNT: 'A cuenta',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un medio desconocido --uno viejo, o uno que llegue de una version futura--
 * se muestra tal cual en vez de desaparecer. Que en pantalla diga `SOMETHING`
 * es feo; que la fila quede vacia hace que nadie se entere.
 */
export function etiquetaDeMedio(medio: string): string {
  const conocido: string | undefined = esMedioValido(medio) ? ETIQUETAS[medio] : undefined
  return conocido ?? medio
}

/** El codigo del efectivo, para las consultas que filtran por el. */
export const MEDIO_EFECTIVO = 'CASH' satisfies MedioDePago

/**
 * Si el pago entra fisicamente al cajon.
 *
 * Es LA pregunta del modulo. Una venta de $30.000 cobrada $20.000 por
 * transferencia y $10.000 en efectivo aumenta la caja en $10.000, no en
 * $30.000. Toda la logica de turnos depende de esta funcion, y por eso vive
 * en un solo lugar en vez de repetirse como `=== 'efectivo'`.
 */
export function esEfectivo(medio: string): boolean {
  return medio === MEDIO_EFECTIVO
}

/** El codigo del fiado. */
export const MEDIO_CUENTA = 'ACCOUNT' satisfies MedioDePago

/**
 * Si el pago va al libro del cliente en vez de a la caja.
 *
 * La otra pregunta del modulo, y la contracara exacta de `esEfectivo`. Toda
 * linea de pago va a uno de dos destinos y a uno solo: `esCuenta` decide si
 * genera movimiento de cuenta corriente, y su negacion decide si genera
 * movimiento de caja.
 */
export function esCuenta(medio: string): boolean {
  return medio === MEDIO_CUENTA
}

export function esMedioValido(medio: string): medio is MedioDePago {
  return (MEDIOS_DE_PAGO as readonly string[]).includes(medio)
}

/**
 * Traduccion de los medios anteriores a la Fase 3.
 *
 * Solo la usa la migracion y el parseo defensivo de datos viejos. Se conserva
 * aca --y no dentro del SQL-- para que la equivalencia quede escrita una vez y
 * se pueda probar.
 *
 *   efectivo      → CASH
 *   tarjeta       → CARD           sin distinguir; ver arriba
 *   mercado_pago  → TRANSFER       con la referencia "Mercado Pago"
 */
export const MEDIOS_LEGACY: Record<string, MedioDePago> = {
  efectivo: 'CASH',
  tarjeta: 'CARD',
  mercado_pago: 'TRANSFER',
}

/** Normaliza un medio que puede venir en el vocabulario viejo. */
export function normalizarMedio(medio: string): MedioDePago {
  if (esMedioValido(medio)) return medio
  // `Record<string, …>` promete que toda clave existe, y no es cierto: el
  // acceso puede dar `undefined`. Se comprueba en vez de confiar en el tipo.
  const equivalente: MedioDePago | undefined = MEDIOS_LEGACY[medio]
  return equivalente ?? 'OTHER'
}
