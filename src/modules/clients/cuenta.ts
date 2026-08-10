/**
 * Libro de cuenta corriente.
 *
 * ES LA UNICA PUERTA. Ninguna otra parte de `src/` escribe sobre
 * `Client.balance`: hay una regla de ESLint que lo impide, y este archivo es su
 * unica excepcion declarada.
 *
 * La regla que gobierna el modulo: el saldo no se modifica, se MUEVE. Cada
 * cambio deja una fila en el libro con el saldo anterior, el delta y el saldo
 * resultante, y la suma del libro tiene que dar siempre el saldo:
 *
 *   para todo cliente:  suma(CustomerAccountMovement.amount) == Client.balance
 *
 * SIGNOS: positivo = el cliente debe. Ver `movement-types.ts`.
 *
 * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
 */

import type { Prisma } from '@prisma/client'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import {
  CERO_D,
  aMonto,
  esCero,
  esNegativo,
  esPositivo,
  minimo,
  negar,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'
import { SIGNO_DE_CUENTA, esTipoDeCuenta, type TipoDeCuenta } from './movement-types'

/** Cliente de una transaccion. El servicio NO acepta el cliente global. */
export type TxClient = Prisma.TransactionClient

export interface EntradaDeCuenta {
  branchId: number
  clientId: number
  type: TipoDeCuenta
  /** Delta CON SIGNO. Un fiado de $20.000 manda +20000; un pago, -8000. */
  amount: Dinero
  userId: number
  reason?: string | null
  saleId?: number | null
  paymentId?: number | null
  /**
   * Quien autoriza pasar por encima del limite de credito.
   *
   * Cuando viene, la comprobacion del limite NO se aplica y el id queda
   * guardado en la fila del libro. Que sea un id y no un booleano es
   * deliberado: "se autorizo" sin decir quien no sirve para nada.
   *
   * NO desactiva la comprobacion de fiado deshabilitado: un cliente con el
   * fiado cortado esta cortado, y reabrirlo es cambiar esa politica y no
   * saltearla en una venta suelta.
   */
  authorizedById?: number | null
}

export interface ResultadoDeCuenta {
  movementId: number
  previousBalance: Dinero
  resultingBalance: Dinero
  /**
   * Cuanto de este cargo se absorbio con saldo A FAVOR que el cliente ya tenia.
   *
   * Cero salvo que el saldo previo fuera negativo. Es lo que permite decirle a
   * quien atiende "de los $5.000, $2.000 salen del saldo a favor y $3.000 pasan
   * a deber" sin que haga falta una segunda entidad ni un segundo medio de
   * pago: el libro ya hizo la resta, y esto la explica.
   *
   * Ver docs/CUSTOMER_ACCOUNT_LEDGER.md, seccion "usar el saldo a favor".
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
function validarMovimiento(entrada: EntradaDeCuenta): void {
  const { type, amount } = entrada

  if (!esTipoDeCuenta(type)) {
    throw invalid(`Tipo de movimiento de cuenta desconocido: ${String(type)}`)
  }

  if (esCero(amount)) {
    throw invalid('Un movimiento de cero pesos no registra nada')
  }

  const signo = SIGNO_DE_CUENTA[type]
  if (signo === 'debe' && esNegativo(amount)) {
    throw invalid('Una venta a cuenta no puede reducir la deuda')
  }
  if (signo === 'haber' && esPositivo(amount)) {
    throw invalid(
      type === 'PAYMENT'
        ? 'Un pago no puede aumentar la deuda'
        : 'Una anulacion no puede aumentar la deuda',
    )
  }

  if (type === 'MANUAL_ADJUSTMENT' && !(entrada.reason ?? '').trim()) {
    throw invalid('El motivo del ajuste es obligatorio')
  }
}

/** El nombre del cliente, para el mensaje de error. Se lee solo si algo falla. */
async function nombreDe(tx: TxClient, clientId: number): Promise<string> {
  const c = await tx.client.findUnique({ where: { id: clientId }, select: { name: true } })
  return c?.name ?? `#${clientId}`
}

/**
 * Aplica un movimiento de cuenta corriente. LA funcion del modulo.
 *
 * Exige `tx` --el cliente de una transaccion, no el global-- porque el cambio
 * de saldo y la fila del libro tienen que confirmarse juntos o no confirmarse.
 * No hay forma de llamarla fuera de una transaccion.
 *
 * El corazon es UNA sentencia, y es la misma idea que en el libro de stock:
 * aplicar el delta, comprobar la politica de credito y devolver el saldo
 * anterior y el resultante EN LA MISMA SENTENCIA.
 *
 * Eso es lo que cierra la ventana del objetivo 33. La version ingenua --leer el
 * saldo, comparar contra el limite en JavaScript, escribir-- deja un hueco: con
 * dos cajas fiandole $8.000 al mismo cliente que tiene $40.000 sobre un limite
 * de $50.000, las dos leen "hay lugar", las dos deciden "entra" y el saldo
 * termina en $56.000. Ese hueco no se cierra con mas comprobaciones: se cierra
 * no teniendolo. PostgreSQL toma el bloqueo de la fila y REEVALUA la condicion
 * despues de esperarlo, asi que la segunda ve el saldo ya cargado.
 */
export async function applyAccountMovement(
  tx: TxClient,
  entrada: EntradaDeCuenta,
): Promise<ResultadoDeCuenta> {
  const { branchId, clientId, type, amount, userId } = entrada

  validarMovimiento(entrada)

  // El delta viaja a PostgreSQL como CADENA canonica con un cast explicito, no
  // como objeto ni como numero. Una cadena `"-8000.00"` con `::numeric` no
  // puede perder nada por el camino; un `number` de JavaScript ya la habria
  // perdido antes de salir.
  const delta = aMonto(amount)

  // Un cargo tiene que respetar la politica de credito; un pago, una anulacion
  // o un ajuste que REDUCE la deuda no. Es importante: si el limite frenara los
  // pagos, un cliente que se paso del limite no podria salir de ahi.
  const esCargo = esPositivo(amount)
  const conAutorizacion = entrada.authorizedById != null

  // La condicion de credito se arma aparte para que la sentencia se lea. Las
  // tres partes:
  //
  //   · el fiado tiene que estar habilitado --y esto NO lo saltea el override,
  //     a proposito: cortarle el fiado a alguien es una decision, no un tope--;
  //   · sin limite configurado (NULL) no hay tope que comprobar;
  //   · con limite, el saldo RESULTANTE tiene que caber.
  //
  // `Prisma.sql` no hace falta: son fragmentos fijos elegidos por un booleano
  // del servidor, no texto que venga de afuera.
  const filas = await (esCargo && !conAutorizacion
    ? tx.$queryRaw<Array<{ previo: Dinero; resultante: Dinero }>>`
        UPDATE "Client"
           SET "balance" = "balance" + ${delta}::numeric
         WHERE "id" = ${clientId}
           AND "branchId" = ${branchId}
           AND "isActive" = true
           AND "isCreditEnabled" = true
           AND ("creditLimit" IS NULL OR "balance" + ${delta}::numeric <= "creditLimit")
        RETURNING ("balance" - ${delta}::numeric)::numeric(14,2) AS previo,
                  "balance"::numeric(14,2)                       AS resultante
      `
    : tx.$queryRaw<Array<{ previo: Dinero; resultante: Dinero }>>`
        UPDATE "Client"
           SET "balance" = "balance" + ${delta}::numeric
         WHERE "id" = ${clientId}
           AND "branchId" = ${branchId}
           AND ("isActive" = true OR ${!esCargo})
           AND ("isCreditEnabled" = true OR ${!esCargo})
        RETURNING ("balance" - ${delta}::numeric)::numeric(14,2) AS previo,
                  "balance"::numeric(14,2)                       AS resultante
      `)

  const saldos = filas[0]
  if (!saldos) {
    // Camino de error, no camino caliente: recien aca se paga por averiguar por
    // que no se aplico. Los tres motivos posibles dan tres mensajes distintos,
    // porque "no se pudo" obliga a quien atiende a adivinar.
    const cliente = await tx.client.findFirst({
      where: { id: clientId, branchId },
      select: {
        name: true,
        isActive: true,
        isCreditEnabled: true,
        creditLimit: true,
        balance: true,
      },
    })

    // Mismo trato que "no existe": no se confirma que el cliente exista en otra
    // sucursal.
    if (!cliente) throw notFound('El cliente no existe')

    if (!cliente.isActive) {
      throw conflict(`${cliente.name} está dado de baja.`, { code: 'CLIENT_INACTIVE' })
    }

    if (!cliente.isCreditEnabled) {
      throw conflict(`${cliente.name} tiene el fiado deshabilitado.`, {
        code: 'CLIENT_CREDIT_DISABLED',
      })
    }

    const limite = cliente.creditLimit
    if (limite !== null) {
      const resultante = sumar(cliente.balance, amount)
      const excedente = restar(resultante, limite)
      throw conflict(
        `${cliente.name} llegaría a ${aMonto(resultante)} y su límite es ${aMonto(limite)}: ` +
          `se pasa por ${aMonto(excedente)}.`,
        { code: 'CREDIT_LIMIT_EXCEEDED' },
      )
    }

    // No deberia llegar aca: las tres condiciones de la sentencia estan
    // cubiertas arriba. Si llega, es que alguien agrego una cuarta y se olvido
    // de explicarla, y decirlo es mejor que devolver un 500 mudo.
    throw conflict(`No se pudo mover la cuenta de ${cliente.name}.`, { code: 'ACCOUNT_NOT_MOVED' })
  }

  // Los saldos salen del RETURNING, no de una lectura posterior. Entre la
  // escritura y una segunda lectura otra transaccion puede mover la cuenta, y
  // la fila del libro diria un numero que nunca existio.
  const movimiento = await tx.customerAccountMovement.create({
    data: {
      branchId,
      clientId,
      type,
      amount,
      previousBalance: saldos.previo,
      resultingBalance: saldos.resultante,
      saleId: entrada.saleId ?? null,
      paymentId: entrada.paymentId ?? null,
      userId,
      reason: entrada.reason?.trim() ?? null,
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
 * Cuanto de un cargo se pago con saldo a favor previo.
 *
 * Solo hay credito consumido cuando el saldo ARRANCA en negativo. Lo consumido
 * es lo que subio hasta cero, con tope en lo que habia:
 *
 *   -2.000 → +3.000   se usaron 2.000   (habia 2.000 a favor)
 *   -5.000 → -1.000   se usaron 4.000   (habia 5.000, se uso parte)
 *        0 → +5.000   se usaron 0
 *
 * Se exporta para poder probarla sola, sin base de datos.
 */
export function creditoAplicadoEn(previo: Dinero, resultante: Dinero): Dinero {
  // Sin saldo a favor previo no hay nada que absorber.
  if (!esNegativo(previo)) return CERO_D

  const subida = restar(resultante, previo)
  if (!esPositivo(subida)) return CERO_D

  // El credito disponible era el saldo previo cambiado de signo. Se usa lo que
  // haya subido, con tope en lo que habia.
  return minimo(subida, negar(previo))
}

/**
 * Comprueba que quien opera pueda pasar por encima del limite, y devuelve su id.
 *
 * Separado de `applyAccountMovement` a proposito: la funcion del libro no
 * conoce la sesion --recibe un `userId` y nada mas-- y mezclar la autorizacion
 * adentro obligaria a pasarle permisos a una funcion que solo tiene que saber
 * de saldos.
 */
export function autorizanteDelLimite(
  session: { userId: number; permissions: ReadonlySet<string> },
  pidioSaltearLimite: boolean,
): number | null {
  if (!pidioSaltearLimite) return null
  if (!session.permissions.has('accounts.overrideLimit')) {
    throw forbidden('No tiene permiso para autorizar una venta por encima del límite de crédito')
  }
  return session.userId
}

/**
 * Reconstruye el saldo de un cliente sumando su libro.
 *
 * Es la comprobacion de integridad hecha consulta: lo que devuelve tiene que
 * ser identico a `Client.balance`. La usan las pruebas y esta disponible para
 * cuando haga falta explicarle a alguien de donde salio su saldo.
 */
export async function reconstruirSaldo(tx: TxClient, clientId: number): Promise<Dinero> {
  const suma = await tx.customerAccountMovement.aggregate({
    where: { clientId },
    _sum: { amount: true },
  })
  return suma._sum.amount ?? CERO_D
}

/** El nombre del cliente. Se usa en los mensajes de las capas de arriba. */
export { nombreDe as nombreDeCliente }
