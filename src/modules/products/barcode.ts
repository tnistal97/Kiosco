/**
 * Politica de codigos de barras.
 *
 * UNA sola definicion para las dos puntas, igual que `units.ts`: el esquema de
 * Zod valida con esto, la caja decide con esto si un codigo puede llegar a
 * existir, y el modal de alta rapida comprueba con esto antes de mandar nada.
 *
 * La distincion que motiva el modulo es la de la Fase 5A.1: **no encontrado**
 * y **invalido** no son lo mismo, y hasta ahora la caja los mostraba igual.
 *
 *   `7791234567890`  valido y no registrado  -> se puede crear
 *   `77912 34567`    invalido                -> no hay nada que crear
 *
 * Ofrecer "crear producto" para el segundo seria ofrecer un camino que el
 * servidor va a rechazar; no ofrecerlo para el primero es el callejon sin
 * salida que esta fase viene a cerrar.
 *
 * Este modulo NO importa Prisma ni Zod: lo usan los componentes del punto de
 * venta. Ver docs/POS_QUICK_PRODUCT_CREATE.md.
 */

/** Tope de la columna `ProductBarcode.code`. */
export const LARGO_MAXIMO_CODIGO = 64

/**
 * Caracteres aceptados.
 *
 * Digitos, letras y guion. Cubre EAN-13, UPC, Code 128 y los codigos internos
 * que imprime una balanza. Deja afuera el espacio --que casi siempre es una
 * lectura partida-- y los simbolos, que ningun lector emite.
 */
const CARACTERES = /^[0-9A-Za-z-]+$/

/**
 * Limpieza del codigo tal como llego.
 *
 * **Solo se recorta.** No se pasa a mayusculas: para un lector, dos codigos que
 * difieren en mayusculas son dos codigos distintos, y normalizarlos dejaria un
 * producto inalcanzable con su propia etiqueta. Y NUNCA se convierte a numero:
 * `Number('0750123')` da `750123` y pierde el cero inicial, que en un codigo
 * de balanza es informacion.
 *
 * Es exactamente lo que hace `codigoSchema`, extraido para que el navegador
 * pueda aplicar la misma regla sin arrastrar Zod.
 */
export function normalizarCodigo(crudo: string): string {
  return crudo.trim()
}

/**
 * Por que este codigo no puede existir, o `null` si podria.
 *
 * Devolver el MOTIVO y no un booleano es deliberado: el mensaje que ve el
 * cajero sale de aca, asi que la razon y la comprobacion no pueden separarse.
 */
export function motivoDeCodigoInvalido(crudo: string): string | null {
  const codigo = normalizarCodigo(crudo)

  if (codigo === '') return 'El código está vacío'
  if (codigo.length > LARGO_MAXIMO_CODIGO) {
    return `El código tiene más de ${LARGO_MAXIMO_CODIGO} caracteres`
  }
  if (!CARACTERES.test(codigo)) {
    // El espacio se nombra aparte porque es el caso frecuente --una lectura
    // que se partio en dos-- y "caracteres no permitidos" no ayudaria a
    // entender que hay que volver a pasar el producto.
    return codigo.includes(' ')
      ? 'El código tiene espacios: probablemente la lectura salió partida'
      : 'El código tiene caracteres que ningún lector emite'
  }
  return null
}

/** Atajo legible. La razon vive en `motivoDeCodigoInvalido`. */
export function esCodigoValido(crudo: string): boolean {
  return motivoDeCodigoInvalido(crudo) === null
}
