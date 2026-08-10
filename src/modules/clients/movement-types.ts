/**
 * Vocabulario del libro de cuenta corriente.
 *
 * Un unico catalogo de tipos para el servidor, el navegador y la base. Los tres
 * tienen que decir lo mismo: la restriccion CHECK de PostgreSQL replica
 * exactamente la tabla de signos de este archivo, y hay una prueba que comprueba
 * que no se separen.
 *
 * Este modulo NO importa Prisma: lo usa la ficha del cliente.
 * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
 */

export const TIPOS_DE_CUENTA = [
  /** Se le fio. Lo emite la venta con una linea de pago `ACCOUNT`. */
  'SALE_CHARGE',
  /** Pago del cliente. Lo emite `CustomerPayment`, y nada mas. */
  'PAYMENT',
  /** Se anulo una venta que se le habia fiado. */
  'SALE_CANCEL',
  /** Correccion administrativa. Exige motivo y permiso propio. */
  'MANUAL_ADJUSTMENT',
] as const

export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number]

/**
 * Signo obligatorio de cada tipo.
 *
 *   'debe'  el delta tiene que ser positivo: aumenta lo que el cliente debe
 *   'haber' el delta tiene que ser negativo: reduce lo que el cliente debe
 *   'ambos' cualquiera menos cero
 *
 * LA CONVENCION, y no admite ambiguedad:
 *
 *   saldo POSITIVO -> el cliente DEBE
 *   saldo NEGATIVO -> el cliente tiene plata A FAVOR
 *
 * Se eligio asi y no al reves porque es como se habla en el mostrador: "Juan
 * debe 20.000" es el caso corriente, y el caso corriente tiene que ser el que
 * se lee sin signo.
 *
 * Un pago que aumente la deuda no es un error que haya que buscar: es una fila
 * que PostgreSQL rechaza.
 */
export const SIGNO_DE_CUENTA: Record<TipoDeCuenta, 'debe' | 'haber' | 'ambos'> = {
  SALE_CHARGE: 'debe',
  PAYMENT: 'haber',
  SALE_CANCEL: 'haber',
  MANUAL_ADJUSTMENT: 'ambos',
}

const ETIQUETAS: Record<TipoDeCuenta, string> = {
  SALE_CHARGE: 'Venta a cuenta',
  PAYMENT: 'Pago',
  SALE_CANCEL: 'Anulación de venta',
  MANUAL_ADJUSTMENT: 'Ajuste',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un tipo desconocido --uno de una version futura-- se muestra tal cual en vez
 * de desaparecer: que en pantalla diga `SOMETHING` es feo; que la fila quede
 * vacia hace que nadie se entere.
 */
export function etiquetaDeCuenta(tipo: string): string {
  const conocido: string | undefined = esTipoDeCuenta(tipo) ? ETIQUETAS[tipo] : undefined
  return conocido ?? tipo
}

export function esTipoDeCuenta(tipo: string): tipo is TipoDeCuenta {
  return (TIPOS_DE_CUENTA as readonly string[]).includes(tipo)
}
