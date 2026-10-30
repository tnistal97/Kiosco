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
import { normalizeUsername } from './username'

/** Longitud minima de contrasena. Documentada aca y usada en un solo lugar. */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200

/**
 * La que elige el administrador para un empleado. Mas corta a proposito: se
 * dice de palabra, sirve para un solo ingreso y el login limita los intentos.
 * La definitiva, la que elige cada persona, sigue siendo `PASSWORD_MIN`.
 */
export const CLAVE_TEMPORAL_MIN = 8

/** Sale siempre en su forma canonica: ver `./username`. */
export const usernameSchema = z
  .string()
  .overwrite(normalizeUsername)
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(50)
  .regex(/^[a-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo')

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX)

export const claveTemporalSchema = z
  .string()
  .min(
    CLAVE_TEMPORAL_MIN,
    `La contraseña temporal debe tener al menos ${CLAVE_TEMPORAL_MIN} caracteres`,
  )
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
    password: claveTemporalSchema,
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
    username: usernameSchema.optional(),
    roleId: idSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'No hay ningun campo para modificar')

/**
 * Cambio de la contrasena propia.
 *
 * Pide la actual aunque la sesion este abierta: una pestania que quedo abierta
 * en el mostrador no alcanza para quedarse con la cuenta de otro. La
 * confirmacion se compara en el servidor y no solo en el formulario, porque es
 * el servidor el que no puede dejar a alguien afuera por un error de tipeo.
 *
 * Los campos empiezan con `clave` a proposito: es lo que tacha
 * `src/server/http/redaccion.ts` si un cuerpo serializado llega a un log.
 */
export const cambiarMiClaveSchema = z
  .object({
    claveActual: z.string().min(1, 'Falta la contraseña actual').max(PASSWORD_MAX),
    claveNueva: passwordSchema,
    claveConfirmacion: z.string().max(PASSWORD_MAX),
  })
  .strict()
  .refine((v) => v.claveNueva === v.claveConfirmacion, {
    message: 'La confirmación no coincide con la contraseña nueva',
    path: ['claveConfirmacion'],
  })
  .refine((v) => v.claveNueva !== v.claveActual, {
    message: 'La contraseña nueva tiene que ser distinta de la actual',
    path: ['claveNueva'],
  })

/**
 * Salir de una contrasena temporal: la primera pantalla de quien recien entro.
 *
 * No pide la actual porque la acaba de escribir para iniciar esta sesion. Ver
 * `elegirClaveDefinitiva`.
 */
export const elegirClaveSchema = z
  .object({
    claveNueva: passwordSchema,
    claveConfirmacion: z.string().max(PASSWORD_MAX),
  })
  .strict()
  .refine((v) => v.claveNueva === v.claveConfirmacion, {
    message: 'Las dos contraseñas no coinciden',
    path: ['claveConfirmacion'],
  })

/**
 * Reseteo de la contrasena de otro usuario, por quien administra el personal.
 *
 * Sin `claveNueva`, el servidor genera una temporal y la devuelve UNA vez. Con
 * `claveNueva`, se usa esa y no se devuelve nada: quien la escribio ya la
 * conoce. La confirmacion, si viene, se compara aca y no solo en el formulario:
 * un error de tipeo dejaria a la persona afuera.
 */
export const resetearClaveSchema = z
  .object({
    claveNueva: claveTemporalSchema.optional(),
    claveConfirmacion: z.string().max(PASSWORD_MAX).optional(),
  })
  .strict()
  .refine((v) => v.claveConfirmacion === undefined || v.claveNueva === v.claveConfirmacion, {
    message: 'Las dos contraseñas no coinciden',
    path: ['claveConfirmacion'],
  })

export const listarUsuariosQuerySchema = paginationQuerySchema.extend({
  /** Por defecto se listan todos; `activos` filtra las bajas logicas. */
  estado: z.enum(['todos', 'activos', 'inactivos']).default('todos'),
})

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>
export type ListarUsuariosQuery = z.infer<typeof listarUsuariosQuerySchema>
export type CambiarMiClaveInput = z.infer<typeof cambiarMiClaveSchema>
export type ElegirClaveInput = z.infer<typeof elegirClaveSchema>
export type ResetearClaveInput = z.infer<typeof resetearClaveSchema>
