/**
 * Validacion de entrada de la consulta de la bitacora.
 */

import { z } from 'zod'
import { fechaLocalSchema, idSchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/** Tablas sobre las que se registran eventos. Lista blanca para el filtro. */
export const TABLAS_AUDITADAS = [
  'User',
  'Product',
  'BranchStock',
  'StockMovement',
  'Sale',
  'CashRegisterMovement',
  'CashCount',
  'CashShift',
  'Branch',
  'Category',
  'Supplier',
  // Compras. Estaban auditadas desde la Fase 3C pero no figuraban aca, asi que
  // el filtro de la pantalla no las ofrecia: los eventos existian y no habia
  // forma de buscarlos.
  'PurchaseOrder',
  'PurchaseReceipt',
  'PurchaseReceiptItem',
  // Clientes y cuenta corriente. Fase 4A.
  //
  // `CustomerAccountMovement` figura por UN solo caso: el ajuste manual, que
  // es el unico movimiento del libro que no tiene una venta ni un cobro
  // detras. Los otros tres tipos NO se auditan por separado --la venta y el
  // cobro ya se auditan enteros, y emitir una entrada por cada movimiento
  // duplicaria en la bitacora lo que el libro ya guarda mejor--.
  //
  // Cada tabla tiene una responsabilidad distinta: `CustomerAccountMovement`
  // es la HISTORIA FINANCIERA --con sus saldos, su continuidad y su
  // inmutabilidad--; `AuditLog` es QUIEN hizo la accion.
  'Client',
  'CustomerAccountMovement',
  'CustomerPayment',
  // Cuentas por pagar. Fase 4B, y el mismo reparto de responsabilidades: el
  // libro es la historia financiera; la bitacora es quien hizo la accion.
  //
  // `SupplierAccountMovement` figura por DOS casos --la nota de credito y el
  // ajuste manual--, que son los unicos movimientos sin una entrega ni un pago
  // detras. El cargo de una recepcion NO se audita aparte: ya se audita la
  // recepcion entera, con el importe, el vencimiento y los dos saldos adentro.
  //
  // Lo agrego la prueba `auditoria-coherente`, que compara lo que se audita
  // contra lo que se puede filtrar. Sin ella los dos eventos habrian quedado
  // escritos y sin forma de buscarlos, que es exactamente lo que le paso a
  // compras en la Fase 3C.
  'SupplierAccountMovement',
  'SupplierPayment',
  // Anticipos y devoluciones. Fase 4C.
  //
  // `SupplierPaymentAllocation` figura por UN solo caso: la imputacion
  // DIFERIDA, que es una decision propia --a que entrega se aplica un anticipo
  // que se entrego meses antes-- y que no queda registrada en ningun otro lado.
  // El reparto que ocurre AL PAGAR no se audita aparte: ya esta dentro de la
  // entrada del pago, con sus lineas y sus importes.
  //
  // `PurchaseReturn` cubre los cuatro eventos de una devolucion --crearla,
  // editarla, cancelarla y confirmarla-- y la confirmacion lleva adentro el
  // credito generado y lo que salio del deposito. Ni `StockMovement` ni
  // `SupplierAccountMovement` se duplican: el libro de inventario y el de la
  // cuenta ya guardan esos hechos mejor de lo que podria la bitacora.
  'SupplierPaymentAllocation',
  'PurchaseReturn',
  // Lotes e inventario fisico. Fase 4D.
  //
  // `ProductLot` cubre el alta de una partida y la correccion de su
  // vencimiento, que es el unico campo editable de un lote con historial y la
  // decision que hay que poder explicar: cambia si la mercaderia se vende o se
  // tira.
  //
  // `LotAssignment` es atribuir stock EXISTENTE a una partida. No mueve
  // mercaderia --por eso no esta en el libro de inventario-- y por eso mismo es
  // lo unico que registra quien decidio que esas ocho unidades son de ese lote.
  //
  // `InventoryCountSession` cubre los cinco momentos de un inventario: armarlo,
  // cerrarlo, aplicarlo, cancelarlo y el intento rechazado. Los conteos linea
  // por linea NO se auditan aparte --serian miles de entradas que dicen lo
  // mismo que la propia linea, que ya guarda quien conto y cuando-- ni se
  // duplican los `INVENTORY_COUNT`, que el libro de inventario guarda mejor.
  'ProductLot',
  'LotAssignment',
  'InventoryCountSession',
  'Authorization',
] as const

export const ACCIONES_AUDITADAS = [
  'create',
  'update',
  'delete',
  'cancel',
  'login',
  'login_failed',
  'logout',
  'deny',
  // Abrir y cerrar un turno no son "crear" y "actualizar": un cierre con
  // diferencia es el evento que despues se busca, y buscarlo como "update de
  // CashShift" no lo distingue de nada.
  'open',
  'close',
] as const

export const consultarAuditoriaQuerySchema = paginationQuerySchema.extend({
  tabla: z.enum(TABLAS_AUDITADAS).optional(),
  accion: z.enum(ACCIONES_AUDITADAS).optional(),
  usuarioId: idSchema.optional(),
  resultado: z.enum(['todos', 'success', 'failure']).default('todos'),
  /** Rastrea una peticion concreta a partir del codigo que vio el usuario. */
  requestId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9-]{8,64}$/, 'Identificador de peticion invalido')
    .optional(),
  /**
   * Dias, no instantes. El servidor los convierte con la zona de la sucursal.
   *
   * Hasta la Fase 3D la pantalla mandaba `2026-08-10T00:00:00.000Z`, o sea
   * medianoche UTC: en Argentina, las 21:00 del dia anterior. La bitacora de
   * un dia empezaba tres horas antes de que ese dia existiera.
   * Ver docs/TIMEZONE_POLICY.md.
   */
  desde: fechaLocalSchema.optional(),
  hasta: fechaLocalSchema.optional(),
})

export type ConsultarAuditoriaQuery = z.infer<typeof consultarAuditoriaQuerySchema>
