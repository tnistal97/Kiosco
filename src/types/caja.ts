/**
 * Compatibilidad.
 *
 * La forma real de un movimiento de caja vive en `@/modules/cash/dto`, junto
 * a la funcion que la valida al recibirla del servidor. Aca solo quedan los
 * alias para no tocar todos los imports de golpe.
 */

export type {
  MovimientoDTO as CashMovement,
  ItemMovimientoDTO as CashSaleItem,
} from '@/modules/cash/dto'
