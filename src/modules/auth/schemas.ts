/**
 * Validacion de entrada del dominio de autenticacion.
 */

import { z } from 'zod'
import { normalizeUsername } from '@/modules/users/username'

/**
 * Credenciales.
 *
 * Los limites de longitud existen por dos motivos. El de arriba evita que
 * bcrypt tenga que procesar una cadena de megabytes, que es una forma barata
 * de consumir CPU del servidor. El de abajo solo descarta el vacio: aca no se
 * valida el formato de la contrasena, porque las de los usuarios existentes
 * no tienen por que cumplir las reglas actuales y rechazarlas en el login
 * los dejaria afuera.
 *
 * El usuario sale en su forma canonica: "Franco" y " FRANCO " son la misma
 * persona, y el limite de intentos los cuenta juntos.
 */
export const loginSchema = z
  .object({
    username: z.string().overwrite(normalizeUsername).min(1).max(50),
    password: z.string().min(1).max(200),
  })
  .strict()

export type LoginInput = z.infer<typeof loginSchema>
