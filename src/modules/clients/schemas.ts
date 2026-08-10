/**
 * Validacion de entrada del dominio de clientes y cuenta corriente.
 */

import { z } from 'zod'
import { amountSchema, idSchema, optionalText, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { esPositivo } from '@/lib/money'
import { MEDIOS_DE_COBRANZA } from '@/modules/sales/payment-methods'

/**
 * Alta de cliente.
 *
 * Lo unico obligatorio es el NOMBRE. "Juan Pérez" y nada mas tiene que ser un
 * alta valida: exigir DNI o telefono obligaria a inventarlos, y un documento
 * inventado es peor que ninguno porque parece un dato.
 *
 * `balance` NO se declara. No es un olvido: al no estar, `.strict()` hace que
 * la peticion se rechace si alguien lo manda. El saldo arranca en cero y solo
 * lo mueve el libro; darlo de alta con deuda es un ajuste manual, con su
 * permiso y su motivo.
 */
export const crearClienteSchema = z
  .object({
    name: shortText(120),
    document: optionalText(30),
    taxId: optionalText(20),
    phone: optionalText(40),
    // Se valida SI viene. Vacio es una respuesta valida.
    email: z
      .union([z.literal(''), z.string().trim().email('Correo inválido').max(120)])
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    address: optionalText(200),
    notes: optionalText(500),
    /**
     * Limite de credito. NULL y 0 son afirmaciones DISTINTAS:
     *
     *   null / ausente  sin limite configurado
     *   "0"             no se le fia
     *
     * Por eso es nullable y no `.default(0)`.
     */
    creditLimit: amountSchema.nullable().optional(),
    isCreditEnabled: z.boolean().optional(),
  })
  .strict()

/** Edicion. Todo opcional: lo que no viene, no se toca. */
export const editarClienteSchema = crearClienteSchema.partial().strict()

/**
 * Alta rapida desde el mostrador.
 *
 * Tres campos y ninguno administrativo. Es el formulario que se abre en medio
 * de una venta, y meterle limite de credito o direccion ahi convertiria un
 * paso de diez segundos en un tramite. Lo demas se completa despues, desde la
 * ficha.
 */
export const altaRapidaSchema = z
  .object({
    name: shortText(120),
    phone: optionalText(40),
    document: optionalText(30),
  })
  .strict()

/**
 * Listado con sus filtros.
 *
 * `estado` y `deuda` son dos ejes distintos a proposito: "dado de baja" y "debe
 * plata" son preguntas independientes, y un cliente puede cumplir las dos.
 */
export const listarClientesQuerySchema = paginationQuerySchema.extend({
  /** Nombre, telefono o documento. */
  q: z.string().trim().max(80).optional(),
  estado: z.enum(['activos', 'inactivos', 'todos']).default('activos'),
  deuda: z.enum(['todos', 'conDeuda', 'aFavor', 'sinDeuda']).default('todos'),
  /** Los que tienen el fiado cortado. */
  fiado: z.enum(['todos', 'habilitado', 'bloqueado']).default('todos'),
})

/**
 * Busqueda rapida para el punto de venta.
 *
 * Tope bajo y obligatorio: es un desplegable que se abre mientras alguien
 * espera en el mostrador, no un listado. Y NO descarga todos los clientes: sin
 * texto no devuelve nada.
 */
export const buscarClientesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80),
    limite: z.coerce.number().int().min(1).max(20).default(8),
  })
  .strict()

/** Habilitar o cortar el fiado. Su propia operacion, no un campo de la edicion. */
export const cambiarFiadoSchema = z
  .object({
    isCreditEnabled: z.boolean(),
    reason: optionalText(300),
  })
  .strict()

export const cambiarEstadoClienteSchema = z.object({ isActive: z.boolean() }).strict()

/**
 * Cobro a un cliente.
 *
 * `clientId` no esta: viene en la ruta. El saldo anterior y el resultante
 * tampoco: los calcula el libro. Si los mandara el cliente se podria declarar
 * un cobro que deja un saldo que no corresponde.
 */
export const registrarPagoSchema = z
  .object({
    amount: amountSchema.refine(esPositivo, 'Un pago de cero no es un pago'),
    method: z.enum(MEDIOS_DE_COBRANZA),
    reference: optionalText(120),
    notes: optionalText(300),
    /**
     * Confirmacion explicita de que el pago deja saldo a favor.
     *
     * Sin esto, un cobro por mas de lo adeudado se rechaza con un 409 que dice
     * cuanto sobra. El sobrepago se permite --pasa: el cliente redondea para
     * arriba-- pero nunca en silencio: quien cobra tiene que haber visto que
     * esos $2.000 quedan a favor. Es el mismo mecanismo que la autorizacion de
     * una diferencia de arqueo.
     */
    aceptarSaldoAFavor: z.boolean().default(false),
  })
  .strict()

/**
 * Ajuste manual de cuenta.
 *
 * Se declara el DELTA, no el saldo final. Es la diferencia que hace que el
 * ajuste sea auditable: "sumale 2.000 por deuda anterior a la migracion" deja
 * un movimiento que se entiende; "poneme el saldo en 7.000" no dice de donde
 * salieron los 2.000 ni contra que saldo se estaba operando.
 */
export const ajustarCuentaSchema = z
  .object({
    /** Con signo: positivo aumenta la deuda, negativo la reduce. */
    delta: z
      .union([z.string(), z.number()])
      .superRefine((valor, ctx) => {
        if (typeof valor === 'number' && !Number.isFinite(valor)) {
          ctx.addIssue({ code: 'custom', message: 'Importe invalido' })
          return
        }
        const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
        if (!/^-?\d+(\.\d{1,2})?$/.test(texto)) {
          ctx.addIssue({
            code: 'custom',
            message: 'El importe debe ser un numero con dos decimales como maximo',
          })
          return
        }
        if (Number(texto) === 0) {
          ctx.addIssue({ code: 'custom', message: 'Un ajuste de cero no registra nada' })
          return
        }
        if (Math.abs(Number(texto)) > 1_000_000_000) {
          ctx.addIssue({ code: 'custom', message: 'Importe fuera de rango' })
        }
      })
      .transform((valor): string => (typeof valor === 'number' ? valor.toString() : valor.trim())),
    /** Obligatorio. Un ajuste sin motivo no se puede auditar despues. */
    reason: shortText(300),
  })
  .strict()

/** Extracto de la cuenta, paginado. */
export const listarMovimientosCuentaQuerySchema = paginationQuerySchema.extend({
  tipo: z
    .enum(['todos', 'SALE_CHARGE', 'PAYMENT', 'SALE_CANCEL', 'MANUAL_ADJUSTMENT'])
    .default('todos'),
})

/** Las ventas y los pagos de un cliente, paginados por separado. */
export const listarDelClienteQuerySchema = paginationQuerySchema

export const clienteIdSchema = z.object({ clientId: idSchema })

export type CrearClienteInput = z.infer<typeof crearClienteSchema>
export type EditarClienteInput = z.infer<typeof editarClienteSchema>
export type AltaRapidaInput = z.infer<typeof altaRapidaSchema>
export type ListarClientesQuery = z.infer<typeof listarClientesQuerySchema>
export type BuscarClientesQuery = z.infer<typeof buscarClientesQuerySchema>
export type CambiarFiadoInput = z.infer<typeof cambiarFiadoSchema>
export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>
export type AjustarCuentaInput = z.infer<typeof ajustarCuentaSchema>
export type ListarMovimientosCuentaQuery = z.infer<typeof listarMovimientosCuentaQuerySchema>
