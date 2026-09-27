/**
 * Por que no se pudo leer una planilla.
 *
 * Un motivo por cada cosa que puede salir mal ANTES de mirar una sola fila, y
 * un mensaje por motivo que dice que hacer. "Archivo invalido" no le sirve a
 * nadie: el almacenero que exporto la lista desde el sistema del proveedor
 * necesita saber si tiene que guardarla de otra forma, sacarle la contraseña o
 * partirla en dos.
 *
 * Este modulo NO importa Prisma: la planilla se lee en el navegador.
 */

export type MotivoPlanilla =
  | 'vacio'
  | 'demasiado-grande'
  | 'demasiadas-filas'
  | 'xls-antiguo'
  | 'macros'
  | 'ods'
  | 'protegido'
  | 'no-es-planilla'
  | 'no-soportado'
  | 'corrupto'
  | 'sin-hojas'
  | 'sin-datos'
  | 'navegador'

export class ErrorDePlanilla extends Error {
  readonly motivo: MotivoPlanilla

  constructor(motivo: MotivoPlanilla, detalle?: string) {
    super(
      detalle === undefined ? mensajeDePlanilla(motivo) : `${mensajeDePlanilla(motivo)} ${detalle}`,
    )
    this.name = 'ErrorDePlanilla'
    this.motivo = motivo
  }
}

/** El mensaje para quien subio el archivo. Dice que pasa y como se arregla. */
export function mensajeDePlanilla(motivo: MotivoPlanilla): string {
  switch (motivo) {
    case 'vacio':
      return 'El archivo está vacío.'
    case 'demasiado-grande':
      return 'El archivo pesa más de 10 MB. Partilo en dos o guardalo como .csv, que pesa menos.'
    case 'demasiadas-filas':
      return 'La planilla tiene más de 10.000 productos. Partila en dos archivos e importalos por separado.'
    case 'xls-antiguo':
      return (
        'No es un .xlsx: parece un Excel antiguo (.xls) o una planilla con contraseña. ' +
        'Abrila en Excel y guardala como "Libro de Excel (.xlsx)" sin contraseña, o como .csv.'
      )
    case 'macros':
      return 'La planilla tiene macros. Guardala como "Libro de Excel (.xlsx)" común, sin macros, o como .csv.'
    case 'ods':
      return 'Es una planilla de LibreOffice (.ods). Guardala como .xlsx o como .csv.'
    case 'protegido':
      return 'La planilla está protegida con contraseña. Sacale la contraseña y volvé a subirla.'
    case 'no-es-planilla':
      return 'Ese archivo no es una planilla. Subí un .xlsx o un .csv.'
    case 'no-soportado':
      return 'No se puede leer este .xlsx. Abrilo en Excel y guardalo de nuevo, o guardalo como .csv.'
    case 'corrupto':
      return 'El archivo está dañado o incompleto. Volvé a exportarlo y subilo de nuevo.'
    case 'sin-hojas':
      return 'La planilla no tiene hojas con datos.'
    case 'sin-datos':
      return 'La planilla no tiene filas con datos.'
    case 'navegador':
      return 'Este navegador no puede abrir archivos .xlsx. Usá Chrome o Edge actualizados, o guardá la planilla como .csv.'
  }
}
