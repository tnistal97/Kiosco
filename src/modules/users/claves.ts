/**
 * Piezas puras del manejo de contrasenas: sin base, sin red.
 *
 * Viven aparte del servicio para que las use tambien el alta de una instancia
 * (`scripts/alta-instancia.ts`), que corre fuera de Next y no tiene sesion.
 */

import { randomInt } from 'node:crypto'
import { permissionsForRole, type Permission } from '@/server/authz/permissions'

/**
 * Sin caracteres que se confunden al dictarlos o al leerlos en papel: ni `0`
 * y `o`, ni `1`, `l` e `i`. Una clave temporal se entrega de palabra o
 * escrita a mano, y un caracter ambiguo es una llamada a soporte.
 */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'

/**
 * Clave aleatoria en grupos de cuatro: `k7mq-4tzp-w9ha`.
 *
 * `randomInt` y no `Math.random`: es el generador criptografico, y reparte
 * sin sesgo de modulo. Tres grupos son 12 caracteres de 31 posibles, unos 59
 * bits: sobra para una clave que vive hasta el primer ingreso, con el login
 * limitado a 8 intentos. El alta de una instancia pide cuatro (~79 bits)
 * porque esa es la del duenio y puede quedar mas tiempo.
 */
export function generarClaveTemporal(grupos = 3): string {
  const partes: string[] = []
  for (let g = 0; g < grupos; g++) {
    let parte = ''
    for (let i = 0; i < 4; i++) parte += ALFABETO.charAt(randomInt(ALFABETO.length))
    partes.push(parte)
  }
  return partes.join('-')
}

/**
 * Permisos del rol de destino que quien actua NO tiene.
 *
 * Resetear la clave de alguien es poder entrar como esa persona. Si esa
 * persona puede hacer cosas que quien resetea no puede, el reseteo es una
 * escalada de privilegios con un paso de mas. `admin_local` tiene
 * `users.manage` sin tener todos los permisos: esta regla es la segunda barrera
 * despues de su alcance (`rolesDelAlcance`), que ya deja afuera a esos usuarios.
 */
export function permisosQueFaltan(
  deQuienActua: ReadonlySet<Permission>,
  rolDestino: string,
): Permission[] {
  return [...permissionsForRole(rolDestino)].filter((p) => !deQuienActua.has(p)).sort()
}
