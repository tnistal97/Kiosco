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
] as const

export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number]

/** Los que se pueden elegir al cobrar. `CARD` queda afuera a proposito. */
export const MEDIOS_COBRABLES = ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER'] as const

export type MedioCobrable = (typeof MEDIOS_COBRABLES)[number]

const ETIQUETAS: Record<MedioDePago, string> = {
  CASH: 'Efectivo',
  DEBIT_CARD: 'Débito',
  CREDIT_CARD: 'Crédito',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
  CARD: 'Tarjeta',
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
