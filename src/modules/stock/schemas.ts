/**
 * Validacion de entrada del dominio de stock.
 *
 * Todo ajuste exige motivo. No es burocracia: el motivo es lo unico que
 * distingue, meses despues, un recuento de inventario de una rotura o de un
 * error de carga. Desde la Fase 3A ademas exige TIPO, que es lo que permite
 * preguntar cuanto se rompio en el mes sin leer texto libre.
 */

import { z } from 'zod'
import { shortText } from '@/server/http/validate'
import { STOCK_MAX } from '@/modules/products/schemas'
import { SIGNO_DE_TIPO, TIPOS_DE_AJUSTE, etiquetaDeTipo } from '@/modules/inventory/movement-types'

/** Motivo del ajuste. Obligatorio, con contenido real (shortText recorta). */
export const motivoSchema = shortText(200)

/** PUT: fija la cantidad exacta. Es el recuento de inventario. */
export const ajusteAbsolutoSchema = z
  .object({
    quantity: z.number().int().min(0).max(STOCK_MAX),
    reason: motivoSchema,
  })
  .strict()

/**
 * PATCH: suma o resta unidades. Entrada de mercaderia, rotura, faltante.
 *
 * El signo del delta tiene que coincidir con el tipo: una perdida no puede
 * sumar unidades. Se comprueba aca --con el mismo cuadro que usa el servicio y
 * que replica la restriccion de la base-- para dar un mensaje legible en vez
 * del texto crudo de PostgreSQL.
 *
 * La pantalla manda el signo ya resuelto: en "se rompieron 3" el usuario
 * escribe 3 y el dialogo envia -3. Aceptar un positivo y negarlo en el
 * servidor seria ambiguo --¿+3 es "entraron 3" o un error de tipeo?-- y eso en
 * inventario se paga caro.
 */
export const ajusteRelativoSchema = z
  .object({
    delta: z
      .number()
      .int('El ajuste debe ser un numero entero')
      .refine((n) => n !== 0, 'El ajuste no puede ser cero')
      .refine((n) => Math.abs(n) <= STOCK_MAX, 'Ajuste fuera de rango'),
    /**
     * Por omision, ajuste generico. Obligar a clasificar cada correccion de
     * carga como perdida seria mentir, y una etiqueta que se pone porque hay
     * que poner alguna deja de significar nada.
     */
    type: z.enum(TIPOS_DE_AJUSTE).default('MANUAL_ADJUSTMENT'),
    reason: motivoSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    const signo = SIGNO_DE_TIPO[v.type]
    if (signo === 'sale' && v.delta > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: `Un movimiento de tipo "${etiquetaDeTipo(v.type)}" resta unidades: mandá un número negativo`,
      })
    }
    if (signo === 'entra' && v.delta < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: `Un movimiento de tipo "${etiquetaDeTipo(v.type)}" suma unidades`,
      })
    }
  })

export type AjusteAbsolutoInput = z.infer<typeof ajusteAbsolutoSchema>
export type AjusteRelativoInput = z.infer<typeof ajusteRelativoSchema>
