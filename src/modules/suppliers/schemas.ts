/**
 * Validacion de entrada de proveedores.
 *
 * Se mudo desde `@/modules/catalog/schemas`, que lo decia en su propio
 * comentario: "cuando proveedores crezca --con condiciones de compra, listas
 * de precios y cuenta corriente-- se muda a su propio modulo". Con ordenes de
 * compra y recepciones, creció.
 *
 * Ver docs/SUPPLIER_MODEL.md.
 */

import { z } from 'zod'
import { idSchema, optionalText, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/**
 * El correo se comprueba SI VIENE, y una cadena vacia se guarda como NULL.
 *
 * Un `""` en la columna significaria "tiene correo, y es la cadena vacia", que
 * es distinto de "no tiene correo" y hace que cualquier filtro por "sin
 * correo" se equivoque.
 */
const emailOpcional = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Correo invalido')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

/**
 * Identificacion fiscal. Digitos, guiones y espacios.
 *
 * NO se valida el digito verificador del CUIT: el sistema todavia no emite
 * nada fiscal, y rechazar datos que no se usan para nada solo estorba a quien
 * carga un proveedor a las siete de la mañana. Cuando llegue ARCA se valida.
 */
const taxIdOpcional = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === '' || /^[\d\s.-]+$/.test(v), 'Solo números, guiones y espacios')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

/**
 * Los campos comunes al alta y a la edicion.
 *
 * El nombre es lo UNICO obligatorio, y es la decision central del modelo: un
 * almacen muchas veces conoce "Distribuidora Pepe" y un telefono. Exigir CUIT
 * o direccion obligaria a inventarlos.
 */
const camposDeProveedor = {
  name: shortText(200),
  legalName: optionalText(200),
  taxId: taxIdOpcional,
  phone: optionalText(50),
  email: emailOpcional,
  address: optionalText(300),
  contactName: optionalText(200),
  notes: optionalText(1000),
}

export const crearProveedorSchema = z.object(camposDeProveedor).strict()

export const editarProveedorSchema = z
  .object({ ...camposDeProveedor, name: shortText(200).optional() })
  .strict()

/** Activar y desactivar es su propia operacion, no un campo mas de la edicion. */
export const estadoDeProveedorSchema = z.object({ isActive: z.boolean() }).strict()

export const listarProveedoresSchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  /** Sin el parametro se ven todos: la lista es corta y esconder la mitad confunde. */
  activos: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
})

// ----------------------------------------------------------- productos

/**
 * Vinculo producto/proveedor.
 *
 * `isPreferred` no viaja: promover a principal es su propia operacion. Si
 * fuera un campo mas, guardar la ficha de un proveedor alternativo con la
 * casilla marcada por descuido cambiaria a quien se le compra normalmente.
 */
export const vincularProveedorSchema = z
  .object({
    supplierId: idSchema,
    supplierCode: optionalText(64),
  })
  .strict()

export type CrearProveedorInput = z.infer<typeof crearProveedorSchema>
export type EditarProveedorInput = z.infer<typeof editarProveedorSchema>
export type EstadoDeProveedorInput = z.infer<typeof estadoDeProveedorSchema>
export type ListarProveedoresQuery = z.infer<typeof listarProveedoresSchema>
export type VincularProveedorInput = z.infer<typeof vincularProveedorSchema>
