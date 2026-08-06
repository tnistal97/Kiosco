/**
 * Validacion de entrada del dominio de usuarios.
 *
 * `.strict()` no es cosmetico aca: es lo que cierra la escalada de
 * privilegios. La version anterior hacia `create({ data: { ...body } })`, de
 * modo que cualquier campo del cuerpo llegaba a la base; bastaba con mandar
 * el `roleId` del rol admin, o un `branchId` ajeno, para crearse un
 * administrador de otra sucursal.
 */

import { z } from 'zod'
import { idSchema, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/** Longitud minima de contrasena. Documentada aca y usada en un solo lugar. */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, numeros, punto, guion y guion bajo')

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `La contrasena debe tener al menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX)

/**
 * Alta de usuario.
 *
 * No declara `branchId`: la sucursal la fija el servidor con la de la sesion.
 * Mandarla hace fallar la peticion entera, que es lo que se quiere --fallar
 * es mas seguro que ignorarla en silencio, porque avisa de que alguien lo
 * intento.
 */
export const crearUsuarioSchema = z
  .object({
    username: usernameSchema,
    name: shortText(100),
    password: passwordSchema,
    roleId: idSchema,
  })
  .strict()

/**
 * Modificacion de usuario.
 *
 * `password` no esta: cambiar la contrasena es una operacion aparte, con su
 * propia comprobacion. Mezclarla con la edicion del perfil permitiria
 * cambiarla sin conocer la anterior.
 */
export const editarUsuarioSchema = z
  .object({
    name: shortText(100).optional(),
    roleId: idSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'No hay ningun campo para modificar')

export const listarUsuariosQuerySchema = paginationQuerySchema.extend({
  /** Por defecto se listan todos; `activos` filtra las bajas logicas. */
  estado: z.enum(['todos', 'activos', 'inactivos']).default('todos'),
})

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>
export type ListarUsuariosQuery = z.infer<typeof listarUsuariosQuerySchema>
