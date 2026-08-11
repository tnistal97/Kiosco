/**
 * Vocabulario del libro de cuenta con proveedores.
 *
 * Un unico catalogo de tipos para el servidor, el navegador y la base. Los tres
 * tienen que decir lo mismo: la restriccion CHECK de PostgreSQL replica
 * exactamente la tabla de signos de este archivo, y hay una prueba que comprueba
 * que no se separen.
 *
 * SOBRE LOS NOMBRES. El objetivo 1 pedia evaluar si habia mejores. Se
 * conservaron los cuatro propuestos, y la razon es que ya encajan: son el espejo
 * exacto de los del libro de clientes --`SALE_CHARGE` / `PURCHASE_CHARGE`,
 * `PAYMENT` / `PAYMENT`, `MANUAL_ADJUSTMENT` / `MANUAL_ADJUSTMENT`-- y esa
 * simetria vale mas que cualquier mejora marginal. Quien leyo un extracto de
 * cliente lee uno de proveedor sin aprender nada nuevo.
 *
 * El unico que no tiene espejo es `PURCHASE_CREDIT`, y tampoco se renombro:
 * "nota de credito" es como se llama el papel que manda el proveedor, y el
 * codigo tiene que decir lo que dice el papel. `SUPPLIER_CREDIT` habria sido
 * redundante --todo este libro es de proveedores-- y `PURCHASE_RETURN` habria
 * mentido: una nota de credito no siempre viene de una devolucion. Ver
 * docs/SUPPLIER_ACCOUNT_LEDGER.md.
 *
 * Este modulo NO importa Prisma: lo usa la ficha del proveedor.
 */

export const TIPOS_DE_PROVEEDOR = [
  /** Llego mercaderia y hay que pagarla. Lo emite `PurchaseReceipt`, y nada mas. */
  'PURCHASE_CHARGE',
  /** Le pagamos. Lo emite `SupplierPayment`, y nada mas. */
  'PAYMENT',
  /** El proveedor emitio una nota de credito a favor nuestro. Exige motivo. */
  'PURCHASE_CREDIT',
  /** Correccion administrativa. Exige motivo y permiso propio. */
  'MANUAL_ADJUSTMENT',
] as const

export type TipoDeProveedor = (typeof TIPOS_DE_PROVEEDOR)[number]

/**
 * Signo obligatorio de cada tipo.
 *
 *   'debe'  el delta tiene que ser positivo: aumenta lo que le debemos
 *   'haber' el delta tiene que ser negativo: reduce lo que le debemos
 *   'ambos' cualquiera menos cero
 *
 * LA CONVENCION, y no admite ambiguedad:
 *
 *   saldo POSITIVO -> LE DEBEMOS al proveedor
 *   saldo NEGATIVO -> tenemos credito NUESTRO con el (nota de credito a favor)
 *
 * Es la misma direccion que en el libro de clientes --positivo es "hay una
 * deuda"-- y esa coincidencia es deliberada: la alternativa, hacer que el
 * proveedor se lea al reves porque "es plata que sale", obligaria a recordar
 * cual de los dos libros se esta mirando antes de interpretar un signo. Un
 * sistema en el que el mismo simbolo significa dos cosas segun la pantalla es
 * un sistema en el que alguien va a leer mal un numero.
 *
 * Un pago que aumente la deuda no es un error que haya que buscar: es una fila
 * que PostgreSQL rechaza.
 */
export const SIGNO_DE_PROVEEDOR: Record<TipoDeProveedor, 'debe' | 'haber' | 'ambos'> = {
  PURCHASE_CHARGE: 'debe',
  PAYMENT: 'haber',
  PURCHASE_CREDIT: 'haber',
  MANUAL_ADJUSTMENT: 'ambos',
}

const ETIQUETAS: Record<TipoDeProveedor, string> = {
  PURCHASE_CHARGE: 'Recepción',
  PAYMENT: 'Pago',
  PURCHASE_CREDIT: 'Nota de crédito',
  MANUAL_ADJUSTMENT: 'Ajuste',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un tipo desconocido --uno de una version futura-- se muestra tal cual en vez
 * de desaparecer: que en pantalla diga `PURCHASE_RETURN` es feo; que la fila
 * quede vacia hace que nadie se entere.
 */
export function etiquetaDeProveedor(tipo: string): string {
  const conocido: string | undefined = esTipoDeProveedor(tipo) ? ETIQUETAS[tipo] : undefined
  return conocido ?? tipo
}

export function esTipoDeProveedor(tipo: string): tipo is TipoDeProveedor {
  return (TIPOS_DE_PROVEEDOR as readonly string[]).includes(tipo)
}

/**
 * Estado de una obligacion, derivado. Nunca se guarda.
 *
 * El objetivo 20 lo pide explicitamente y tiene razon: un booleano `vencida`
 * guardado en la fila es verdadero hasta que pasa la medianoche, y a partir de
 * ahi miente hasta que algo lo recalcule. La fecha ya esta y el pendiente ya se
 * sabe; el estado es una funcion de los dos y de HOY.
 *
 *   'PAGADA'    no queda nada pendiente
 *   'PARCIAL'   se pago algo y falta
 *   'VENCIDA'   queda pendiente y la fecha ya paso
 *   'PENDIENTE' queda pendiente y todavia no vencio (o no tiene fecha)
 *
 * 'VENCIDA' gana sobre 'PARCIAL' a proposito: lo que hay que mirar primero de
 * una deuda vencida a medio pagar es que esta vencida.
 */
export const ESTADOS_DE_DEUDA = ['PENDIENTE', 'PARCIAL', 'VENCIDA', 'PAGADA'] as const
export type EstadoDeDeuda = (typeof ESTADOS_DE_DEUDA)[number]

const ETIQUETAS_DE_ESTADO: Record<EstadoDeDeuda, string> = {
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcialmente pagada',
  VENCIDA: 'Vencida',
  PAGADA: 'Pagada',
}

export function etiquetaDeEstadoDeDeuda(estado: EstadoDeDeuda): string {
  return ETIQUETAS_DE_ESTADO[estado]
}
