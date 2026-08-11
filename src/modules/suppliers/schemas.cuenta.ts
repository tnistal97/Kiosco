/**
 * Validacion de entrada de las cuentas por pagar.
 *
 * Archivo aparte de `schemas.ts` --que valida la ficha del proveedor-- porque
 * son dos materias con dos permisos distintos. Ver docs/SUPPLIER_PAYMENT_FLOW.md.
 */

import { z } from 'zod'
import { amountSchema, idSchema, optionalText, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { esPositivo } from '@/lib/money'
import { MEDIOS_DE_PAGO_A_PROVEEDOR } from '@/modules/sales/payment-methods'
import { TIPOS_DE_PROVEEDOR } from './movement-types'

/**
 * Una linea de imputacion manual.
 *
 * `receiptId` y no `orderId`: la deuda es de la ENTREGA. Una orden con dos
 * entregas son dos obligaciones con dos vencimientos, y no habria forma de
 * saber contra cual imputar.
 */
export const imputacionSchema = z
  .object({
    receiptId: idSchema,
    amount: amountSchema.refine(esPositivo, 'Una imputación de cero no imputa nada'),
  })
  .strict()

/**
 * Pago a un proveedor.
 *
 * `supplierId` no esta: viene en la ruta. El saldo anterior y el resultante
 * tampoco: los calcula el libro. Si los mandara el navegador se podria declarar
 * un pago que deja un saldo que no corresponde.
 *
 * La IMPUTACION es una union discriminada y no dos campos sueltos, para que sea
 * imposible mandar `imputacion: 'automatica'` con una lista de allocations
 * adentro: serian dos ordenes contradictorias y alguien tendria que elegir
 * cual gana en silencio.
 */
export const pagarProveedorSchema = z
  .discriminatedUnion('imputacion', [
    z
      .object({
        imputacion: z.literal('automatica'),
        amount: amountSchema.refine(esPositivo, 'Un pago de cero no es un pago'),
        method: z.enum(MEDIOS_DE_PAGO_A_PROVEEDOR),
        reference: optionalText(120),
        notes: optionalText(300),
        /**
         * Confirmacion explicita de que el pago deja saldo a favor NUESTRO.
         *
         * Sin esto, un pago por mas de lo adeudado se rechaza con un 409 que
         * dice cuanto sobra. Ademas exige el permiso
         * `supplierAccounts.overpay`, que es mas estricto que el sobrepago del
         * cliente: alla la plata ya esta sobre el mostrador; aca somos nosotros
         * los que entregamos de mas, y eso es una decision.
         */
        acceptCredit: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        imputacion: z.literal('manual'),
        amount: amountSchema.refine(esPositivo, 'Un pago de cero no es un pago'),
        method: z.enum(MEDIOS_DE_PAGO_A_PROVEEDOR),
        reference: optionalText(120),
        notes: optionalText(300),
        acceptCredit: z.boolean().default(false),
        /**
         * El reparto. Puede estar vacio --un anticipo sin imputar es legitimo--
         * pero no puede repetir una entrega: dos lineas del mismo `receiptId`
         * serian dos imputaciones parciales que habria que sumar para leer una
         * sola cosa. La base tambien lo impide, con un indice unico.
         */
        allocations: z
          .array(imputacionSchema)
          .max(100)
          .default([])
          .refine(
            (lista) => new Set(lista.map((a) => a.receiptId)).size === lista.length,
            'Una entrega no puede aparecer dos veces en el reparto',
          ),
      })
      .strict(),
  ])
  .describe('Pago a proveedor')

/**
 * Nota de credito del proveedor.
 *
 * Exige MOTIVO --lo pide el objetivo 12 y lo hace cumplir un CHECK-- porque es
 * uno de los dos unicos movimientos del libro sin un hecho propio detras. Una
 * recepcion tiene remito; un pago tiene comprobante; esto tiene un papel que
 * dice que algo salio mal, y sin el motivo no queda registro de QUE.
 *
 * NO lleva `receiptId`: una nota de credito no cuelga de una entrega. El
 * proveedor la emite por un faltante que abarca dos, o por una bonificacion de
 * fin de mes que no corresponde a ninguna. Atarla a una obligaria a elegir una
 * arbitrariamente, y eso es inventar un dato. Ver el CHECK de origen en
 * 20260811130000_phase4b_supplier_accounts.
 */
export const notaDeCreditoSchema = z
  .object({
    amount: amountSchema.refine(esPositivo, 'Una nota de crédito de cero no registra nada'),
    reason: shortText(300),
    /** El numero del documento DEL PROVEEDOR. No se valida: no es nuestro. */
    reference: optionalText(120),
  })
  .strict()

/**
 * Ajuste manual de la cuenta de un proveedor.
 *
 * Se declara el DELTA, no el saldo final. Es la diferencia que hace que el
 * ajuste sea auditable: "sumale 80.000 por deuda anterior a la migracion" deja
 * un movimiento que se entiende dentro de dos anios; "poneme el saldo en
 * 80.000" no dice de donde salieron ni contra que saldo se estaba operando.
 *
 * Es ademas el camino previsto para cargar la deuda anterior a esta fase, que
 * la migracion NO inventa. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 */
export const ajustarProveedorSchema = z
  .object({
    /** Con signo: positivo aumenta lo que debemos, negativo lo reduce. */
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

/**
 * Cambiar el vencimiento de una obligacion.
 *
 * Es la UNICA columna de una recepcion que se puede corregir, y el disparador
 * de PostgreSQL lo hace cumplir comparando la fila entera menos esa. Se permite
 * porque el vencimiento no es un hecho sobre la mercaderia --no movio stock ni
 * cambio un costo-- sino una condicion comercial que se acuerda entre personas
 * y que puede cambiar sin que la entrega cambie.
 *
 * `null` es un valor valido: significa borrar la fecha, no "dejala como esta".
 * Exige motivo, y queda auditado con el antes y el despues (objetivo 33).
 */
export const cambiarVencimientoSchema = z
  .object({
    /** `YYYY-MM-DD` en el dia comercial de la sucursal, o `null` para quitarlo. */
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato AAAA-MM-DD')
      .nullable(),
    reason: shortText(300),
  })
  .strict()

/** Extracto de la cuenta, paginado. */
export const listarMovimientosProveedorQuerySchema = paginationQuerySchema.extend({
  tipo: z.enum(['todos', ...TIPOS_DE_PROVEEDOR]).default('todos'),
})

/**
 * Deudas del proveedor.
 *
 * `abiertas` por omision en `true`: la pregunta corriente es "que le falta
 * pagar", no "que le compramos alguna vez". Ver todo es un clic mas; que la
 * lista arranque con dos anios de entregas saldadas es ruido en el caso normal.
 */
export const listarDeudasQuerySchema = paginationQuerySchema.extend({
  abiertas: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Solo lo vencido. Es el filtro con el que se arma la lista de reclamos. */
  vencidas: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export type ImputacionInput = z.infer<typeof imputacionSchema>
export type PagarProveedorInput = z.infer<typeof pagarProveedorSchema>
export type NotaDeCreditoInput = z.infer<typeof notaDeCreditoSchema>
export type AjustarProveedorInput = z.infer<typeof ajustarProveedorSchema>
export type CambiarVencimientoInput = z.infer<typeof cambiarVencimientoSchema>
export type ListarMovimientosProveedorQuery = z.infer<typeof listarMovimientosProveedorQuerySchema>
export type ListarDeudasQuery = z.infer<typeof listarDeudasQuerySchema>
