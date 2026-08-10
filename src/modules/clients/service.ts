/**
 * Reglas de negocio de clientes.
 *
 * Tres invariantes:
 *
 *   1. Lo unico obligatorio es el nombre. "Juan Pérez" es un cliente valido.
 *   2. Un cliente CON ACTIVIDAD no se borra: se da de baja. Hay ventas y
 *      movimientos de cuenta que lo referencian.
 *   3. El SALDO no se toca desde aca. Lo mueve `applyAccountMovement`, y hay
 *      una regla de ESLint que impide escribirlo desde cualquier otro lado.
 *
 * A diferencia de los proveedores, los clientes SI son de una sucursal: la
 * cuenta corriente es una relacion de confianza entre un comercio y una
 * persona. Ver docs/CUSTOMER_MODEL.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import { CERO_D, aMonto, aMontoOpcional, dinero, esNegativo, maximo, restar } from '@/server/money'
import type {
  AltaRapidaInput,
  BuscarClientesQuery,
  CrearClienteInput,
  EditarClienteInput,
  ListarClientesQuery,
} from './schemas'

const CAMPOS_CLIENTE = {
  id: true,
  name: true,
  document: true,
  taxId: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  isActive: true,
  creditLimit: true,
  isCreditEnabled: true,
  balance: true,
} as const

type ClienteCrudo = Prisma.ClientGetPayload<{ select: typeof CAMPOS_CLIENTE }>

export interface ClienteListado {
  id: number
  name: string
  document: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  isCreditEnabled: boolean
  /** Positivo = debe. Negativo = tiene a favor. */
  balance: Monto
  /** Null = sin limite configurado. "0.00" = no se le fia. */
  creditLimit: Monto | null
  /**
   * Cuanto mas puede fiar. Null cuando no hay limite configurado.
   *
   * Se DERIVA de `creditLimit - balance` y nunca baja de cero: un cliente que
   * ya se paso --porque alguien autorizo el exceso-- tiene cero disponible, no
   * un disponible negativo, que se leeria como si le sobrara.
   */
  disponible: Monto | null
}

/**
 * Lo que hace falta para decidir si se le fia, y para mostrarlo ANTES.
 *
 * Es lo que pide el objetivo 23: no un 409 pelado, sino los cinco numeros con
 * los que quien atiende entiende la respuesta.
 */
export interface EstadoDeCredito extends ClienteListado {
  /** El saldo que quedaria si se cargara `monto`. */
  saldoResultante: Monto
  /** Si esa carga entra sin autorizacion. */
  entra: boolean
  /** Cuanto se pasa. `"0.00"` si entra. */
  excedente: Monto
  /** Por que no entra, en una frase. Null si entra. */
  motivo: string | null
}

function aListado(c: ClienteCrudo): ClienteListado {
  return {
    id: c.id,
    name: c.name,
    document: c.document,
    taxId: c.taxId,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    isActive: c.isActive,
    isCreditEnabled: c.isCreditEnabled,
    balance: aMonto(c.balance),
    creditLimit: aMontoOpcional(c.creditLimit),
    disponible:
      c.creditLimit === null ? null : aMonto(maximo(restar(c.creditLimit, c.balance), CERO_D)),
  }
}

/**
 * Un cliente por id, SIEMPRE acotado a la sucursal de la sesion.
 *
 * Mismo trato que en el resto del sistema: un cliente de otra sucursal se
 * comporta como si no existiera. No se confirma que exista en otro lado.
 */
export async function clientePorId(session: Session, id: number): Promise<ClienteCrudo> {
  const cliente = await prisma.client.findFirst({
    where: { id, branchId: session.branchId },
    select: CAMPOS_CLIENTE,
  })
  if (!cliente) throw notFound('El cliente no existe')
  return cliente
}

/**
 * Rechaza un nombre repetido DENTRO de la sucursal.
 *
 * No hay indice unico detras, y es deliberado: dos personas se pueden llamar
 * igual, y un almacen que tiene dos "Juan Perez" tiene que poder cargar a los
 * dos. Esto es una ADVERTENCIA convertida en conflicto para que no se dupliquen
 * por accidente al tipear; el alta rapida la saltea a proposito, porque en el
 * mostrador no hay tiempo de resolver una homonimia.
 */
async function avisarSiSeRepite(branchId: number, name: string, exceptoId?: number): Promise<void> {
  const existente = await prisma.client.findFirst({
    where: {
      branchId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptoId === undefined ? {} : { id: { not: exceptoId } }),
    },
    select: { id: true, name: true },
  })
  if (existente) {
    throw conflict(
      `Ya hay un cliente llamado "${existente.name}". Si es otra persona, agregale algo que ` +
        'los distinga (el apellido, la calle, "el del taller").',
      { code: 'DUPLICATE_CLIENT' },
    )
  }
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/** El `where` de los filtros del listado. Aparte para poder probarlo solo. */
export function filtroDeClientes(
  branchId: number,
  query: ListarClientesQuery,
): Prisma.ClientWhereInput {
  return {
    branchId,
    ...(query.estado === 'todos' ? {} : { isActive: query.estado === 'activos' }),
    ...(query.fiado === 'todos' ? {} : { isCreditEnabled: query.fiado === 'habilitado' }),
    // Los tres filtros de saldo son excluyentes y se leen tal cual: debe,
    // tiene a favor, no debe nada.
    ...(query.deuda === 'conDeuda' ? { balance: { gt: 0 } } : {}),
    ...(query.deuda === 'aFavor' ? { balance: { lt: 0 } } : {}),
    ...(query.deuda === 'sinDeuda' ? { balance: 0 } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q, mode: 'insensitive' as const } },
            { document: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }
}

export async function listarClientes(
  session: Session,
  query: ListarClientesQuery,
): Promise<
  Paginated<ClienteListado & { ultimaCompra: Date | null; ultimaActividad: Date | null }>
> {
  const where = filtroDeClientes(session.branchId, query)

  const [total, clientes] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      select: {
        ...CAMPOS_CLIENTE,
        // La ultima compra y el ultimo movimiento, en la MISMA consulta.
        // Resolverlos despues, de a uno, seria una consulta por fila: el N+1
        // que la paginacion no arregla. Ver docs/CUSTOMER_MODEL.md.
        sales: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
        movements: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
      // Activos primero: un listado que arranca con los dados de baja hace
      // pensar que no hay clientes con los que trabajar.
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = clientes.map(({ sales, movements, ...c }) => ({
    ...aListado(c),
    ultimaCompra: sales[0]?.date ?? null,
    ultimaActividad: movements[0]?.createdAt ?? null,
  }))

  return paginado(data, total, query)
}

/**
 * Busqueda para el mostrador. Devuelve poco y solo con texto.
 *
 * NO descarga todos los clientes: sin `q` el esquema rechaza la peticion. Con
 * diez mil clientes, un desplegable que los trae todos deja de abrirse.
 */
export async function buscarClientes(
  session: Session,
  query: BuscarClientesQuery,
): Promise<ClienteListado[]> {
  const clientes = await prisma.client.findMany({
    where: {
      branchId: session.branchId,
      isActive: true,
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q, mode: 'insensitive' } },
        { document: { contains: query.q, mode: 'insensitive' } },
      ],
    },
    select: CAMPOS_CLIENTE,
    orderBy: { name: 'asc' },
    take: query.limite,
  })
  return clientes.map(aListado)
}

/**
 * Que pasaria si se le cargaran `monto` pesos a este cliente.
 *
 * Se calcula en el servidor y con las MISMAS tres condiciones que aplica el
 * libro, para que la pantalla no tenga que replicarlas. Es una PREVISUALIZACION
 * y no una reserva: entre esto y el cobro puede entrar otra venta, y por eso la
 * comprobacion que decide sigue estando dentro de la transaccion.
 */
export async function estadoDeCredito(
  session: Session,
  clientId: number,
  monto: Monto,
): Promise<EstadoDeCredito> {
  const cliente = await clientePorId(session, clientId)
  const cargo = dinero(monto)
  const resultante = cliente.balance.plus(cargo)
  const limite = cliente.creditLimit

  const excedente = limite === null ? CERO_D : maximo(restar(resultante, limite), CERO_D)

  const motivo = !cliente.isActive
    ? `${cliente.name} está dado de baja.`
    : !cliente.isCreditEnabled
      ? `${cliente.name} tiene el fiado deshabilitado.`
      : limite !== null && excedente.greaterThan(CERO_D)
        ? `Llegaría a ${aMonto(resultante)} y su límite es ${aMonto(limite)}: ` +
          `se pasa por ${aMonto(excedente)}.`
        : null

  return {
    ...aListado(cliente),
    saldoResultante: aMonto(resultante),
    entra: motivo === null,
    excedente: aMonto(excedente),
    motivo,
  }
}

/** La ficha: datos, saldo y los tres numeros del resumen. */
export async function obtenerCliente(session: Session, id: number) {
  const cliente = await clientePorId(session, id)

  const [ultimaVenta, cuantasVentas, cuantosMovimientos, cuantosPagos] = await Promise.all([
    prisma.sale.findFirst({
      where: { clientId: id, branchId: session.branchId },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, total: true, status: true },
    }),
    prisma.sale.count({ where: { clientId: id } }),
    prisma.customerAccountMovement.count({ where: { clientId: id } }),
    prisma.customerPayment.count({ where: { clientId: id } }),
  ])

  // Cuantas ventas de este cliente todavia tienen parte sin cobrar. Se cuentan
  // las que llevaron una linea `ACCOUNT` y no fueron anuladas: no es "cuanto
  // debe" --eso es el saldo, y ya esta-- sino "de cuantas compras viene".
  const ventasACuenta = await prisma.sale.count({
    where: {
      clientId: id,
      status: 'completed',
      payments: { some: { method: 'ACCOUNT' } },
    },
  })

  return {
    ...aListado(cliente),
    resumen: {
      ventasACuenta,
      cuantasVentas,
      cuantosMovimientos,
      cuantosPagos,
      ultimaCompra: ultimaVenta
        ? {
            id: ultimaVenta.id,
            date: ultimaVenta.date,
            total: aMonto(ultimaVenta.total),
            status: ultimaVenta.status,
          }
        : null,
      /** Verdadero cuando el cliente tiene plata a favor. */
      tieneSaldoAFavor: esNegativo(cliente.balance),
    },
  }
}

// ---------------------------------------------------------------------------
// Escritura de la ficha. El saldo NO se toca aca.
// ---------------------------------------------------------------------------

export async function crearCliente(session: Session, input: CrearClienteInput) {
  await avisarSiSeRepite(session.branchId, input.name)

  return prisma.$transaction(async (tx) => {
    const creado = await tx.client.create({
      data: {
        branchId: session.branchId,
        name: input.name,
        document: input.document ?? null,
        taxId: input.taxId ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        creditLimit: input.creditLimit == null ? null : dinero(input.creditLimit),
        ...(input.isCreditEnabled === undefined ? {} : { isCreditEnabled: input.isCreditEnabled }),
      },
      select: CAMPOS_CLIENTE,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: creado.id,
      action: 'create',
      after: aListado(creado),
      origin: 'POST /api/clients',
    })

    return aListado(creado)
  })
}

/**
 * Alta rapida desde el checkout.
 *
 * Mismo camino que el alta normal salvo por dos cosas: solo tres campos, y NO
 * rechaza el nombre repetido. Lo segundo es deliberado: quien esta cobrando no
 * puede parar a resolver si "Juan Perez" es el mismo Juan Perez. El cliente
 * queda cargado y la duplicacion, si la hubo, se resuelve despues desde la
 * ficha, que es donde hay tiempo.
 */
export async function altaRapidaDeCliente(session: Session, input: AltaRapidaInput) {
  return prisma.$transaction(async (tx) => {
    const creado = await tx.client.create({
      data: {
        branchId: session.branchId,
        name: input.name,
        phone: input.phone ?? null,
        document: input.document ?? null,
      },
      select: CAMPOS_CLIENTE,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: creado.id,
      action: 'create',
      after: { ...aListado(creado), altaRapida: true },
      origin: 'POST /api/clients/rapido',
    })

    return aListado(creado)
  })
}

export async function editarCliente(session: Session, id: number, input: EditarClienteInput) {
  const antes = await clientePorId(session, id)
  if (input.name !== undefined && input.name !== antes.name) {
    await avisarSiSeRepite(session.branchId, input.name, id)
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.client.update({
      where: { id },
      // Cada campo entra solo si vino. `undefined` en Prisma significa "no
      // tocar"; `null` significa "borrar", y las dos cosas son pedidos
      // distintos que el esquema distingue. En `creditLimit` esa diferencia es
      // la que separa "no cambies el limite" de "sacale el limite".
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.document === undefined ? {} : { document: input.document }),
        ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.creditLimit === undefined
          ? {}
          : { creditLimit: input.creditLimit === null ? null : dinero(input.creditLimit) }),
        ...(input.isCreditEnabled === undefined ? {} : { isCreditEnabled: input.isCreditEnabled }),
      },
      select: CAMPOS_CLIENTE,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: id,
      action: 'update',
      before: aListado(antes),
      after: aListado(despues),
      origin: 'PUT /api/clients/:id',
    })

    return aListado(despues)
  })
}

/**
 * Habilitar o cortar el fiado.
 *
 * Su propia operacion y no un campo mas de la edicion, por el mismo motivo que
 * la baja de un proveedor: cortarle el fiado a alguien tiene una consecuencia
 * inmediata --la proxima venta a cuenta se rechaza-- y esconderla dentro de
 * "guardar cambios" haria que ocurra sin querer.
 *
 * NO da de baja al cliente: puede seguir comprando de contado. Son dos
 * preguntas distintas y tienen dos columnas distintas.
 */
export async function cambiarFiado(
  session: Session,
  id: number,
  isCreditEnabled: boolean,
  reason: string | null,
) {
  const antes = await clientePorId(session, id)
  if (antes.isCreditEnabled === isCreditEnabled) {
    return {
      ...aListado(antes),
      message: isCreditEnabled ? 'El fiado ya estaba habilitado' : 'El fiado ya estaba cortado',
    }
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.client.update({
      where: { id },
      data: { isCreditEnabled },
      select: CAMPOS_CLIENTE,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: id,
      action: 'update',
      reason,
      before: { isCreditEnabled: antes.isCreditEnabled },
      after: { isCreditEnabled },
      origin: 'PATCH /api/clients/:id/fiado',
    })

    return {
      ...aListado(despues),
      message: isCreditEnabled ? 'Fiado habilitado' : 'Fiado cortado',
    }
  })
}

export async function cambiarEstadoDeCliente(session: Session, id: number, isActive: boolean) {
  const antes = await clientePorId(session, id)
  if (antes.isActive === isActive) {
    return {
      ...aListado(antes),
      message: isActive ? 'Ya estaba activo' : 'Ya estaba dado de baja',
    }
  }

  // Dar de baja a alguien que DEBE plata no se impide, y es deliberado: pasa
  // --el cliente se mudo y quedo debiendo-- y prohibirlo obligaria a dejarlo
  // activo para siempre o a perdonarle la deuda para poder archivarlo. Lo que
  // si se hace es decirlo: la respuesta lleva el saldo pendiente para que
  // quien da la baja lo vea.
  const deudaPendiente = antes.balance.greaterThan(CERO_D) ? aMonto(antes.balance) : null

  return prisma.$transaction(async (tx) => {
    const despues = await tx.client.update({
      where: { id },
      data: { isActive },
      select: CAMPOS_CLIENTE,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: id,
      action: 'update',
      before: { isActive: antes.isActive, balance: aMonto(antes.balance) },
      after: { isActive, balance: aMonto(despues.balance) },
      origin: 'PATCH /api/clients/:id',
    })

    return {
      ...aListado(despues),
      deudaPendiente,
      message: isActive
        ? 'Cliente activado'
        : deudaPendiente === null
          ? 'Cliente dado de baja'
          : `Cliente dado de baja. Queda debiendo ${deudaPendiente}.`,
    }
  })
}

/**
 * Borrado fisico. Solo un cliente cargado por error.
 *
 * Se niega si tiene ventas, movimientos de cuenta o pagos. Los tres son la
 * misma condicion: tiene historial, y borrarlo lo destruiria.
 *
 * El caso para el que sirve es el unico que queda: alguien tipeo mal un nombre
 * en el alta rapida, se dio cuenta, y quiere que desaparezca en vez de convivir
 * con un cliente mal escrito y dado de baja para siempre.
 */
export async function eliminarCliente(session: Session, id: number) {
  const cliente = await clientePorId(session, id)

  const [ventas, movimientos, pagos] = await Promise.all([
    prisma.sale.count({ where: { clientId: id } }),
    prisma.customerAccountMovement.count({ where: { clientId: id } }),
    prisma.customerPayment.count({ where: { clientId: id } }),
  ])

  if (ventas > 0 || movimientos > 0 || pagos > 0) {
    const motivos = [
      ventas > 0 ? `${ventas} venta(s)` : null,
      movimientos > 0 ? `${movimientos} movimiento(s) de cuenta` : null,
      pagos > 0 ? `${pagos} pago(s)` : null,
    ].filter(Boolean)

    throw conflict(
      `No se puede eliminar a "${cliente.name}": tiene ${motivos.join(', ')}. ` +
        'Borrarlo destruiría ese historial. Dalo de baja en su lugar.',
      { code: 'CLIENT_HAS_HISTORY' },
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.delete({ where: { id } })
    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Client',
      recordId: id,
      action: 'delete',
      before: { id, name: cliente.name },
      origin: 'DELETE /api/clients/:id',
    })
  })

  return { ok: true, message: 'Cliente eliminado' }
}
