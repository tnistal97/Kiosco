/**
 * Libro de cuenta con proveedores.
 *
 * ES LA UNICA PUERTA. Ninguna otra parte de `src/` escribe sobre
 * `Supplier.balance`: hay una regla de ESLint que lo impide, y este archivo es
 * su unica excepcion declarada.
 *
 * La regla que gobierna el modulo, la misma que la del libro de clientes: el
 * saldo no se modifica, se MUEVE. Cada cambio deja una fila con el saldo
 * anterior, el delta y el saldo resultante, y la suma del libro tiene que dar
 * siempre el saldo:
 *
 *   para todo proveedor:  suma(SupplierAccountMovement.amount) == Supplier.balance
 *
 * SIGNOS: positivo = le debemos. Ver `movement-types.ts`.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
 */

import type { Prisma } from '@prisma/client'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import {
  CERO_D,
  aMonto,
  absoluto,
  esCero,
  esNegativo,
  esPositivo,
  minimo,
  negar,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'
import { SIGNO_DE_PROVEEDOR, esTipoDeProveedor, type TipoDeProveedor } from './movement-types'

/** Cliente de una transaccion. El servicio NO acepta el cliente global. */
export type TxClient = Prisma.TransactionClient

export interface EntradaDeProveedor {
  branchId: number
  supplierId: number
  type: TipoDeProveedor
  /** Delta CON SIGNO. Una recepcion de $120.000 manda +120000; un pago, -40000. */
  amount: Dinero
  userId: number
  reason?: string | null
  reference?: string | null
  receiptId?: number | null
  paymentId?: number | null
  /**
   * Quien autoriza dejar el saldo NEGATIVO, es decir pagar de mas.
   *
   * Cuando viene, la comprobacion de sobrepago NO se aplica y el id queda
   * guardado en la fila del libro. Que sea un id y no un booleano es
   * deliberado, igual que en el libro de clientes: "se autorizo" sin decir
   * quien no sirve para nada.
   */
  authorizedById?: number | null
}

export interface ResultadoDeProveedor {
  movementId: number
  previousBalance: Dinero
  resultingBalance: Dinero
  /**
   * Cuanto de este cargo se absorbio con credito que ya teniamos con el
   * proveedor.
   *
   * Cero salvo que el saldo previo fuera negativo. Es lo que permite decir "de
   * los $50.000 de esta entrega, $5.000 salen de la nota de credito que nos
   * habia hecho y $45.000 pasan a deberse". El libro ya hizo la resta; esto la
   * explica.
   */
  creditoAplicado: Dinero
}

/**
 * Comprueba tipo y signo antes de tocar la base.
 *
 * La base es la garantia --tiene la misma tabla de signos en una restriccion
 * CHECK-- y esto es el mensaje legible. Sin esto el usuario recibiria el texto
 * crudo de PostgreSQL, que menciona el nombre de la restriccion y de la tabla.
 */
function validarMovimiento(entrada: EntradaDeProveedor): void {
  const { type, amount } = entrada

  if (!esTipoDeProveedor(type)) {
    throw invalid(`Tipo de movimiento de proveedor desconocido: ${String(type)}`)
  }

  if (esCero(amount)) {
    throw invalid('Un movimiento de cero pesos no registra nada')
  }

  const signo = SIGNO_DE_PROVEEDOR[type]
  if (signo === 'debe' && esNegativo(amount)) {
    throw invalid('Una recepción no puede reducir la deuda con el proveedor')
  }
  if (signo === 'haber' && esPositivo(amount)) {
    throw invalid(
      type === 'PAYMENT'
        ? 'Un pago no puede aumentar la deuda con el proveedor'
        : 'Una nota de crédito no puede aumentar la deuda con el proveedor',
    )
  }

  // Los dos tipos SIN un hecho propio detras. Una recepcion tiene mercaderia y
  // un remito; un pago tiene un comprobante. Estos dos no tienen nada mas que
  // lo que se escriba aca.
  if (
    (type === 'MANUAL_ADJUSTMENT' || type === 'PURCHASE_CREDIT') &&
    !(entrada.reason ?? '').trim()
  ) {
    throw invalid(
      type === 'PURCHASE_CREDIT'
        ? 'El motivo de la nota de crédito es obligatorio'
        : 'El motivo del ajuste es obligatorio',
    )
  }
}

/** El nombre del proveedor, para el mensaje de error. Se lee solo si algo falla. */
async function nombreDe(tx: TxClient, supplierId: number): Promise<string> {
  const s = await tx.supplier.findUnique({ where: { id: supplierId }, select: { name: true } })
  return s?.name ?? `#${supplierId}`
}

/**
 * Aplica un movimiento de cuenta de proveedor. LA funcion del modulo.
 *
 * Exige `tx` --el cliente de una transaccion, no el global-- porque el cambio
 * de saldo y la fila del libro tienen que confirmarse juntos o no confirmarse.
 * No hay forma de llamarla fuera de una transaccion.
 *
 * El corazon es UNA sentencia, y es la misma idea que en el libro de clientes y
 * en el de stock: aplicar el delta, comprobar la politica y devolver el saldo
 * anterior y el resultante EN LA MISMA SENTENCIA.
 *
 * Eso es lo que cierra la ventana del objetivo 34. La version ingenua --leer el
 * saldo, comparar en JavaScript, escribir-- deja un hueco: con dos personas
 * pagandole $40.000 al mismo proveedor al que se le deben $50.000, las dos leen
 * "entra", las dos deciden "entra" y terminamos pagando $80.000 por una deuda
 * de $50.000. Ese hueco no se cierra con mas comprobaciones: se cierra no
 * teniendolo. PostgreSQL toma el bloqueo de la fila y REEVALUA la condicion
 * despues de esperarlo, asi que la segunda ve el saldo ya bajado.
 *
 * La condicion es el espejo del limite de credito del cliente. Alla el tope era
 * `balance + delta <= creditLimit`; aca es `balance + delta >= 0`, que dice
 * exactamente lo mismo mirado del otro lado: no pagues mas de lo que debes sin
 * que alguien lo autorice.
 */
export async function applySupplierAccountMovement(
  tx: TxClient,
  entrada: EntradaDeProveedor,
): Promise<ResultadoDeProveedor> {
  const { branchId, supplierId, type, amount, userId } = entrada

  validarMovimiento(entrada)

  // El delta viaja a PostgreSQL como CADENA canonica con un cast explicito, no
  // como objeto ni como numero. Una cadena `"-40000.00"` con `::numeric` no
  // puede perder nada por el camino; un `number` de JavaScript ya la habria
  // perdido antes de salir.
  const delta = aMonto(amount)

  // Solo lo que REDUCE la deuda puede dejar el saldo negativo, y solo eso hay
  // que vigilar. Una recepcion o un ajuste que aumenta lo que debemos no puede
  // producir un sobrepago por definicion.
  const bajaLaDeuda = esNegativo(amount)
  const conAutorizacion = entrada.authorizedById != null

  // NO se comprueba `isActive`, a diferencia del libro de clientes, y es
  // deliberado: a un proveedor dado de baja se le puede seguir DEBIENDO, y hay
  // que poder pagarle. Bloquear el libro por la baja atraparia la deuda dentro
  // del sistema sin forma de saldarla. Lo que si esta cerrado es comprarle: eso
  // lo comprueba `exigirProveedorActivo` en la orden y en la recepcion, que es
  // donde corresponde.
  const filas = await (bajaLaDeuda && !conAutorizacion
    ? tx.$queryRaw<Array<{ previo: Dinero; resultante: Dinero }>>`
        UPDATE "Supplier"
           SET "balance" = "balance" + ${delta}::numeric
         WHERE "id" = ${supplierId}
           AND "balance" + ${delta}::numeric >= 0
        RETURNING ("balance" - ${delta}::numeric)::numeric(14,2) AS previo,
                  "balance"::numeric(14,2)                       AS resultante
      `
    : tx.$queryRaw<Array<{ previo: Dinero; resultante: Dinero }>>`
        UPDATE "Supplier"
           SET "balance" = "balance" + ${delta}::numeric
         WHERE "id" = ${supplierId}
        RETURNING ("balance" - ${delta}::numeric)::numeric(14,2) AS previo,
                  "balance"::numeric(14,2)                       AS resultante
      `)

  const saldos = filas[0]
  if (!saldos) {
    // Camino de error, no camino caliente: recien aca se paga por averiguar por
    // que no se aplico. Los dos motivos posibles dan dos mensajes distintos,
    // porque "no se pudo" obliga a quien opera a adivinar.
    const proveedor = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true, balance: true },
    })

    if (!proveedor) throw notFound('El proveedor no existe')

    const resultante = sumar(proveedor.balance, amount)
    const sobrante = absoluto(resultante)
    throw conflict(
      `A ${proveedor.name} se le deben ${aMonto(proveedor.balance)} y esto lo dejaría en ` +
        `${aMonto(resultante)}: quedarían ${aMonto(sobrante)} a favor nuestro. ` +
        'Confirmá para registrarlo así.',
      { code: 'SUPPLIER_PAYMENT_LEAVES_CREDIT' },
    )
  }

  // Los saldos salen del RETURNING, no de una lectura posterior. Entre la
  // escritura y una segunda lectura otra transaccion puede mover la cuenta, y
  // la fila del libro diria un numero que nunca existio.
  const movimiento = await tx.supplierAccountMovement.create({
    data: {
      branchId,
      supplierId,
      type,
      amount,
      previousBalance: saldos.previo,
      resultingBalance: saldos.resultante,
      receiptId: entrada.receiptId ?? null,
      paymentId: entrada.paymentId ?? null,
      userId,
      reason: entrada.reason?.trim() ?? null,
      reference: entrada.reference?.trim() ?? null,
      authorizedById: entrada.authorizedById ?? null,
    },
    select: { id: true },
  })

  return {
    movementId: movimiento.id,
    previousBalance: saldos.previo,
    resultingBalance: saldos.resultante,
    creditoAplicado: creditoAplicadoEn(saldos.previo, saldos.resultante),
  }
}

/**
 * Cuanto de un cargo se cubrio con credito que ya teniamos.
 *
 * Solo hay credito consumido cuando el saldo ARRANCA en negativo. Lo consumido
 * es lo que subio hasta cero, con tope en lo que habia:
 *
 *   -5.000 → +45.000   se usaron 5.000   (habia 5.000 a favor)
 *  -10.000 →  -4.000   se usaron 6.000   (habia 10.000, se uso parte)
 *        0 → +50.000   se usaron 0
 *
 * Es la misma funcion que `creditoAplicadoEn` del libro de clientes. Se repite
 * en vez de compartirse a proposito: son dos libros con dos vocabularios, y
 * unirlos en un helper generico obligaria a que los dos cambien juntos el dia
 * que uno de los dos necesite otra cosa. Las dos tienen su propia prueba.
 *
 * Se exporta para poder probarla sola, sin base de datos.
 */
export function creditoAplicadoEn(previo: Dinero, resultante: Dinero): Dinero {
  // Sin credito previo no hay nada que absorber.
  if (!esNegativo(previo)) return CERO_D

  const subida = restar(resultante, previo)
  if (!esPositivo(subida)) return CERO_D

  // El credito disponible era el saldo previo cambiado de signo. Se usa lo que
  // haya subido, con tope en lo que habia.
  return minimo(subida, negar(previo))
}

/**
 * Resuelve la autorizacion de sobrepago: devuelve el id que va a la fila, o null.
 *
 * Separado de `applySupplierAccountMovement` a proposito: la funcion del libro
 * no conoce la sesion --recibe un `userId` y nada mas-- y mezclar la
 * autorizacion adentro obligaria a pasarle permisos a una funcion que solo
 * tiene que saber de saldos.
 *
 * LA AUTORIZACION LA DECIDE EL CONSENTIMIENTO, NO EL SALDO LEIDO, y esa
 * distincion es un error que esta version corrige. La primera version ataba el
 * autorizante a "y ademas, segun la lectura previa, sobra": con dos pagos
 * simultaneos de $40.000 sobre una deuda de $50.000, ninguno de los dos sobraba
 * segun SU lectura, asi que ninguno viajaba autorizado, y el segundo se
 * rechazaba con un 409 aunque quien pagaba hubiera confirmado explicitamente
 * que aceptaba dejar saldo a favor. La lectura previa sirve para redactar un
 * mensaje; no para decidir si hubo consentimiento.
 *
 * `sobraSegunLaLectura` sigue entrando, y para una sola cosa: exigir el permiso
 * POR ADELANTADO cuando ya se sabe que hace falta. Sin eso, alguien sin el
 * permiso que manda `acceptCredit` en un pago que no sobrepaga --porque el
 * navegador lo mando por costumbre-- recibiria un 403 que no le corresponde.
 * Cuando no se sabe, no se exige: el movimiento viaja sin autorizar y la
 * condicion `balance + delta >= 0` lo frena igual. Falla cerrado.
 */
export function autorizanteDelSobrepago(
  session: { userId: number; permissions: ReadonlySet<string> },
  consintio: boolean,
  sobraSegunLaLectura: boolean,
): number | null {
  const puede = session.permissions.has('supplierAccounts.overpay')

  if (consintio && sobraSegunLaLectura && !puede) {
    throw forbidden('No tiene permiso para pagarle a un proveedor más de lo que se le debe')
  }

  return consintio && puede ? session.userId : null
}

/**
 * Reconstruye el saldo de un proveedor sumando su libro.
 *
 * Es la comprobacion de integridad hecha consulta: lo que devuelve tiene que
 * ser identico a `Supplier.balance`. La usan las pruebas y esta disponible para
 * cuando haga falta explicarle a alguien de donde salio su saldo.
 */
export async function reconstruirSaldoDeProveedor(
  tx: TxClient,
  supplierId: number,
): Promise<Dinero> {
  const suma = await tx.supplierAccountMovement.aggregate({
    where: { supplierId },
    _sum: { amount: true },
  })
  return suma._sum.amount ?? CERO_D
}

/** El nombre del proveedor. Se usa en los mensajes de las capas de arriba. */
export { nombreDe as nombreDeProveedor }
