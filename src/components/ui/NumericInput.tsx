'use client'

import { forwardRef, type FocusEvent, type InputHTMLAttributes } from 'react'
import { Input } from './Field'
import {
  REGLAS_DE_CANTIDAD,
  REGLAS_DE_COSTO,
  REGLAS_DE_DINERO,
  filtrarTecleoNumerico,
  leerNumeroLocal,
  mensajeDeNumeroInvalido,
  textoLocalDeNumero,
  type ReglasDeLectura,
} from '@/lib/numero-local'
import { aCentavos } from '@/lib/money'
import { aMilesimas } from '@/lib/cantidad'
import { motivoDeCantidadInvalida, politicaDe, type UnidadDeVenta } from '@/modules/products/units'

/**
 * EL campo numerico. Uno solo, para toda la aplicacion.
 *
 * Antes cada formulario armaba el suyo con un `<Input inputMode="decimal">` y
 * su propia idea de que era un numero: catorce pantallas, cuatro
 * interpretaciones distintas y dos que mandaban al servidor el texto crudo. El
 * resultado era el que se reporto: "0" no entraba donde la pantalla mostraba
 * "0,00".
 *
 * Las tres reglas de uso, y son las tres del pedido:
 *
 *   MIENTRAS SE ESCRIBE  no se reformatea nada. Escribir "1," y que el campo
 *                        conteste "1,00" mueve el cursor y hace imposible
 *                        seguir tipeando. Solo se filtra lo que no puede
 *                        formar parte de un numero.
 *
 *   AL SALIR             se normaliza y se muestra el formato oficial:
 *                        "1500" queda "1.500,00", "0" queda "0,00".
 *
 *   AL VOLVER A ENTRAR   se selecciona todo. Editar "1.500,00" con el cursor
 *                        en el medio es incomodo en cualquier formato; con
 *                        todo seleccionado, tipear lo reemplaza y las flechas
 *                        siguen dejando editar a mano.
 *
 * `type="number"` no se usa en ningun lado, y es a proposito: la coma decimal
 * depende del navegador y de la configuracion regional de la maquina --en un
 * Chrome en ingles, escribir "1,5" en un `number` da un campo vacio--, y las
 * flechitas nativas se tocan solas en una pantalla de mostrador. Va
 * `type="text"` con `inputMode`, que es lo que decide el teclado del telefono:
 * `decimal` donde hay decimales, `numeric` donde no.
 *
 * El valor que sale hacia afuera son DOS cosas: el texto tal cual, que es lo
 * que hay que guardar en el estado para no pelearse con el cursor, y el valor
 * canonico ya interpretado --`"1500.25"`-- o `null` si todavia no es un
 * numero. Ningun formulario vuelve a interpretar por su cuenta.
 */

export type ModoNumerico = 'dinero' | 'costo' | 'cantidad'

const REGLAS: Record<ModoNumerico, ReglasDeLectura> = {
  dinero: REGLAS_DE_DINERO,
  costo: REGLAS_DE_COSTO,
  cantidad: REGLAS_DE_CANTIDAD,
}

/** Como se escribe al salir del campo, segun el modo y la unidad. */
function formatoDeSalida(modo: ModoNumerico, unidad?: UnidadDeVenta) {
  if (modo === 'cantidad') {
    const decimales = unidad === undefined ? 3 : politicaDe(unidad).decimales
    return {
      decimales,
      // Sin unidad no hay una escala que declarar: "1" se queda "1" y "1,5" se
      // queda "1,5". Con unidad manda la unidad: 3 en kilos, 0 en unidades.
      decimalesMinimos: unidad === undefined ? 0 : decimales,
      // Nunca punto de miles en una cantidad: el propio campo lo volveria a
      // leer como decimal. Ver @/lib/numero-local.
      miles: false,
    }
  }
  return { decimales: modo === 'costo' ? 4 : 2, decimalesMinimos: 2, miles: true }
}

export interface NumericInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'inputMode' | 'onFocus' | 'onBlur'
> {
  /** Que se esta escribiendo. Decide decimales, miles y teclado. */
  modo: ModoNumerico
  /** Solo en `cantidad`: la unidad decide los decimales y el mensaje. */
  unidad?: UnidadDeVenta
  /** El texto escrito, tal cual. */
  value: string
  /**
   * El texto y, si ya es un numero, el valor canonico. `origen` dice si lo
   * escribio la persona o si es el formato que se aplica al salir del campo:
   * una pantalla que guarda al salir no tiene que tomar ese formato como algo
   * nuevo para guardar.
   */
  onChange: (texto: string, valor: string | null, origen: 'tecleo' | 'salida') => void
  /** El signo menos. Lo decide el campo: un precio no lo admite, un ajuste si. */
  negativos?: boolean
  /** Fuerza el estado de error; sin esto se marca solo cuando no es un numero. */
  invalid?: boolean
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
}

export const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(function NumericInput(
  { modo, unidad, value, onChange, negativos = false, invalid, onFocus, onBlur, ...rest },
  ref,
) {
  const reglas: ReglasDeLectura = { ...REGLAS[modo], negativos }
  const lectura = leerNumeroLocal(value, reglas)
  const malo = invalid ?? lectura.estado === 'invalido'

  return (
    <Input
      ref={ref}
      type="text"
      inputMode={reglas.decimales === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      data-numeric=""
      invalid={malo}
      value={value}
      onChange={(e) => {
        const texto = filtrarTecleoNumerico(e.target.value, { negativos })
        const leido = leerNumeroLocal(texto, reglas)
        onChange(texto, leido.estado === 'ok' ? leido.valor : null, 'tecleo')
      }}
      onFocus={(e) => {
        e.currentTarget.select()
        onFocus?.(e)
      }}
      onBlur={(e) => {
        // Se normaliza SOLO al salir. Mientras se escribe, el texto es de quien
        // escribe.
        if (lectura.estado === 'ok') {
          const formateado = textoLocalDeNumero(lectura.valor, formatoDeSalida(modo, unidad))
          if (formateado !== value) onChange(formateado, lectura.valor, 'salida')
        }
        onBlur?.(e)
      }}
      {...rest}
    />
  )
})

/**
 * Que le pasa a este importe, dicho para quien lo escribio.
 *
 * `null` cuando esta bien --o cuando todavia no se escribio nada, que no es un
 * error--. El campo vacio se marca con `required`, no con un mensaje rojo
 * antes de tiempo.
 */
export function problemaDeImporte(
  texto: string,
  opciones?: { permitirCero?: boolean; negativos?: boolean },
): string | null {
  const lectura = leerNumeroLocal(texto, {
    ...REGLAS_DE_DINERO,
    negativos: opciones?.negativos ?? false,
  })
  if (lectura.estado === 'vacio') return null
  if (lectura.estado === 'invalido') return mensajeDeNumeroInvalido(lectura.motivo, 'importe')
  if (opciones?.permitirCero !== true && aCentavos(lectura.valor) === 0) {
    return 'El importe tiene que ser mayor que cero.'
  }
  return null
}

/**
 * Lo mismo para una cantidad.
 *
 * Con `unidad`, ademas de la forma comprueba la POLITICA DE LA UNIDAD, que es
 * la misma tabla que aplica el servidor --no una copia--: `1,5` en un producto
 * que se vende por unidad no es un problema de formato, es media unidad.
 */
export function problemaDeCantidad(
  texto: string,
  opciones?: { unidad?: UnidadDeVenta; permitirCero?: boolean },
): string | null {
  const lectura = leerNumeroLocal(texto, REGLAS_DE_CANTIDAD)
  if (lectura.estado === 'vacio') return null
  if (lectura.estado === 'invalido') return mensajeDeNumeroInvalido(lectura.motivo, 'cantidad')

  const milesimas = aMilesimas(lectura.valor)
  if (milesimas === 0) {
    return opciones?.permitirCero === false ? 'La cantidad tiene que ser mayor que cero.' : null
  }

  const unidad = opciones?.unidad
  if (unidad === undefined) return null

  const politica = politicaDe(unidad)
  if (politica.decimales === 0 && milesimas % 1000 !== 0) return ENTEROS[unidad] ?? null
  return motivoDeCantidadInvalida(unidad, lectura.valor)
}

/**
 * El mensaje de las unidades que no se parten.
 *
 * La REGLA es la del servidor --`motivoDeCantidadInvalida`, la misma tabla-- y
 * no se toca; lo que cambia es como se cuenta. "unidad: la cantidad debe ser un
 * numero entero" es el motivo escrito para un log; esto es lo que se le dice a
 * quien acaba de tipear "1,5".
 */
const ENTEROS: Partial<Record<UnidadDeVenta, string>> = {
  UNIT: 'Las unidades van enteras: 1, 2, 3.',
  G: 'Los gramos van enteros: 100, 250, 500.',
  ML: 'Los mililitros van enteros: 100, 250, 500.',
}
