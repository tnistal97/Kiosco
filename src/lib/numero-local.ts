/**
 * Numeros escritos por una persona, en castellano rioplatense.
 *
 * UN solo lugar donde se decide que significa lo que alguien tipeo. Antes esa
 * decision estaba repartida en catorce formularios, cada uno con su propia
 * version: `Number(monto.replace(',', '.'))` en el movimiento de caja,
 * `/^\d+(\.\d{1,2})?$/` en los cuatro dialogos de cuenta corriente, el texto
 * crudo en el conteo de inventario. Tres interpretaciones distintas del mismo
 * "1.500", y ninguna era la que esperaba quien lo escribio.
 *
 * La division es la que importa:
 *
 *   LEER    acepta variantes --"0", "0,00", "1.500", "$ 1.500,00"--
 *   ESCRIBIR produce UNA sola forma, la oficial
 *
 * Leer es tolerante porque del otro lado hay alguien apurado con un cliente
 * enfrente. Escribir es estricto porque la pantalla tiene que decir siempre lo
 * mismo. Lo que sale de aca es la cadena canonica --`"1500.25"`, punto decimal
 * y sin miles-- que es la que entienden `@/lib/money`, `@/lib/cantidad` y el
 * servidor. Este modulo no cambia ninguna regla: solo traduce.
 *
 * ---------------------------------------------------------------------------
 * EL "1.500" Y POR QUE NO SIGNIFICA LO MISMO EN LOS DOS CAMPOS
 * ---------------------------------------------------------------------------
 *
 * En es-AR el punto es separador de MILES y la coma es DECIMAL: `1.500,25` son
 * mil quinientos con veinticinco. El problema es el punto solo, sin coma, con
 * tres digitos detras. `1.500` puede ser mil quinientos --leido como se lee en
 * pantalla-- o uno coma cinco --tecleado como lo escupe una balanza--.
 *
 * No hay una respuesta unica, asi que hay dos, y las decide el CAMPO:
 *
 *   DINERO      `1.500` son mil quinientos. Nadie cobra 1,5 pesos, y `15.000`
 *               tecleado en la caja es quince mil todos los dias. Un importe
 *               no tiene tres decimales: la lectura de miles no le quita
 *               ninguna posibilidad valida.
 *
 *   CANTIDAD    `1.500` es uno y medio. La escala de una cantidad son
 *               exactamente tres decimales --un gramo dentro de un kilo-- y la
 *               balanza y el teclado numerico escriben `1.500` para kilo y
 *               medio. Un almacen que vende mil quinientas unidades de algo en
 *               una linea no existe; medio kilo de queso, todos los dias.
 *
 * Con la coma presente no hay ambiguedad y las dos leen igual: `1.500,25` es
 * mil quinientos coma veinticinco en los dos campos.
 *
 * La consecuencia practica, y es deliberada: lo que un campo ESCRIBE, ese
 * mismo campo lo puede volver a LEER sin cambiar de valor. Por eso el formato
 * de edicion de las cantidades no lleva punto de miles.
 */

/** Por que no se pudo leer. Cada motivo tiene su mensaje; ver `mensajeDeNumeroInvalido`. */
export type MotivoNumeroInvalido =
  'no-es-numero' | 'demasiados-decimales' | 'negativo' | 'fuera-de-rango'

/**
 * El resultado de leer un campo.
 *
 * Tres estados y no dos: "todavia no escribi nada" NO es lo mismo que "escribi
 * algo que no es un numero", y tampoco es un cero. Un cero silencioso en un
 * arqueo significa "conte cero pesos", que es una afirmacion muy distinta de
 * un campo vacio.
 */
export type LecturaNumerica =
  | { estado: 'vacio' }
  | { estado: 'invalido'; motivo: MotivoNumeroInvalido }
  | { estado: 'ok'; valor: string }

export interface ReglasDeLectura {
  /** Decimales que admite el destino. Dinero 2, cantidad 3, costo 4. */
  decimales: number
  /** Si un punto solo con tres digitos detras es separador de miles. */
  puntoEsMiles: boolean
  /** Si se admite el signo menos. Lo decide el campo, no el parser. */
  negativos?: boolean
}

/** Importes: dos decimales, `1.500` son mil quinientos, el signo lo permite el campo. */
export const REGLAS_DE_DINERO: ReglasDeLectura = {
  decimales: 2,
  puntoEsMiles: true,
  negativos: true,
}

/** Cantidades: tres decimales, `1.500` es uno y medio, nunca negativas. */
export const REGLAS_DE_CANTIDAD: ReglasDeLectura = {
  decimales: 3,
  puntoEsMiles: false,
  negativos: false,
}

/** Costo unitario: como el dinero pero con cuatro decimales, que es como se guarda. */
export const REGLAS_DE_COSTO: ReglasDeLectura = {
  decimales: 4,
  puntoEsMiles: true,
  negativos: false,
}

/**
 * Espacios de todo tipo.
 *
 * `\s` en JavaScript ya incluye el espacio duro y el fino que mete `Intl`
 * delante del simbolo, que son los dos que llegan al pegar un importe copiado
 * de otra pantalla.
 */
const ESPACIOS = /\s/g

/** Quince cifras enteras: mas que eso no lo representa un entero exacto. */
const MAXIMO_DE_ENTEROS = 15

function invalido(motivo: MotivoNumeroInvalido): LecturaNumerica {
  return { estado: 'invalido', motivo }
}

/**
 * Lo que alguien escribio, convertido a cadena canonica.
 *
 * Acepta, en cualquier combinacion: espacios sobrantes, el simbolo `$`
 * --pegar `$ 1.500,00` desde otra pantalla tiene que funcionar--, coma o punto
 * decimal, separador de miles, ceros de relleno, el separador colgando al
 * final mientras se escribe (`"1,"`) y sin parte entera (`",50"`).
 *
 * NO acepta en silencio nada que sea ambiguo: `1,2,3`, `1..2`, `abc` y `--`
 * devuelven el motivo, no un cero.
 */
export function leerNumeroLocal(entrada: string, reglas: ReglasDeLectura): LecturaNumerica {
  // El `−` es el signo menos tipografico: lo escribe Word y lo escupe
  // cualquier copiar y pegar desde una planilla.
  const limpio = entrada.replace(ESPACIOS, '').replace(/\$/g, '').replace(/−/g, '-')
  if (limpio === '') return { estado: 'vacio' }

  const negativo = limpio.startsWith('-')
  const sinSigno = limpio.replace(/^[+-]/, '')
  if (sinSigno === '' || !/^[0-9.,]+$/.test(sinSigno)) return invalido('no-es-numero')
  if (negativo && reglas.negativos !== true) return invalido('negativo')

  const partido = separar(sinSigno, reglas.puntoEsMiles)
  if (partido === null) return invalido('no-es-numero')

  const { enteros, decimales } = partido
  if (decimales.length > reglas.decimales) return invalido('demasiados-decimales')

  const sinCeros = enteros.replace(/^0+(?=\d)/, '')
  if (sinCeros.length > MAXIMO_DE_ENTEROS) return invalido('fuera-de-rango')

  const relleno = (decimales + '0'.repeat(reglas.decimales)).slice(0, reglas.decimales)
  const cuerpo = reglas.decimales === 0 ? sinCeros : `${sinCeros}.${relleno}`

  // Un cero no tiene signo: "-0,00" y "0" son el mismo importe, y dejarlo
  // pasar como "-0.00" haria que dos campos iguales se vean distintos.
  const esCero = /^0*(\.0*)?$/.test(cuerpo)
  return { estado: 'ok', valor: negativo && !esCero ? `-${cuerpo}` : cuerpo }
}

/**
 * Solo el valor canonico, o `null`.
 *
 * Para los sitios que ya saben que hacer con el vacio y con lo invalido --que
 * son casi todos: el boton se deshabilita y el campo se marca-- y solo quieren
 * el numero.
 */
export function valorNumerico(
  entrada: string | null | undefined,
  reglas: ReglasDeLectura,
): string | null {
  if (entrada === null || entrada === undefined) return null
  const lectura = leerNumeroLocal(entrada, reglas)
  return lectura.estado === 'ok' ? lectura.valor : null
}

/**
 * Parte entera y decimal, resolviendo quien es el separador decimal.
 *
 * El orden de las preguntas ES la regla:
 *
 *   1. estan los dos → el ULTIMO es el decimal y el otro es de miles. Cubre
 *      `1.500,25` y tambien `1,500.25`, que es lo que sale de pegar algo
 *      formateado en ingles.
 *   2. solo comas → la coma es decimal SIEMPRE. Dos comas no son un numero.
 *   3. solo puntos → depende del campo, que es la decision de arriba.
 *
 * Devuelve `null` cuando lo escrito no es un numero.
 */
function separar(
  texto: string,
  puntoEsMiles: boolean,
): { enteros: string; decimales: string } | null {
  const ultimaComa = texto.lastIndexOf(',')
  const ultimoPunto = texto.lastIndexOf('.')

  if (ultimaComa === -1 && ultimoPunto === -1) {
    return { enteros: texto, decimales: '' }
  }

  let corte: number
  let miles: string | null

  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    corte = Math.max(ultimaComa, ultimoPunto)
    miles = ultimaComa > ultimoPunto ? '.' : ','
  } else if (ultimaComa !== -1) {
    if (texto.indexOf(',') !== ultimaComa) return null
    corte = ultimaComa
    miles = null
  } else {
    const agrupado = /^\d{1,3}(\.\d{3})+$/.test(texto)
    if (puntoEsMiles && agrupado) return { enteros: texto.replace(/\./g, ''), decimales: '' }
    if (texto.indexOf('.') !== ultimoPunto) return null
    corte = ultimoPunto
    miles = null
  }

  const cabeza = texto.slice(0, corte)
  const cola = texto.slice(corte + 1)

  // Un separador solo --"," o "."-- no es un numero. Colgando al final de un
  // numero, si: se acepta "1," mientras se escribe.
  if (cabeza === '' && cola === '') return null
  if (!/^\d*$/.test(cola)) return null

  const enteros = miles === null ? cabeza : quitarMiles(cabeza, miles)
  if (enteros === null || !/^\d*$/.test(enteros)) return null

  return { enteros: enteros === '' ? '0' : enteros, decimales: cola }
}

/** La parte entera sin sus puntos de miles, o `null` si la agrupacion no cierra. */
function quitarMiles(cabeza: string, separador: string): string | null {
  if (!cabeza.includes(separador)) return cabeza
  const sep = separador === '.' ? '\\.' : separador
  if (!new RegExp(`^\\d{1,3}(${sep}\\d{3})+$`).test(cabeza)) return null
  return cabeza.split(separador).join('')
}

export interface ReglasDeEscritura {
  /** Decimales como maximo. */
  decimales: number
  /** Decimales que se muestran aunque sean cero. Dinero: 2. */
  decimalesMinimos?: number
  /** Separador de miles. Se apaga para escribir dentro de un campo de cantidad. */
  miles?: boolean
}

/**
 * La cadena canonica, escrita como se lee en es-AR.
 *
 * `"1500.25"` → `"1.500,25"`. Sin simbolo: el `$` es del componente, no del
 * valor, y meterlo dentro del texto de un campo obliga a limpiarlo despues.
 *
 * Se hace por cadena y no con `Intl` sobre un `number` a proposito: lo que
 * entra ya es exacto y pasarlo por punto flotante seria devolverle el error
 * que todo el modulo del dinero existe para no tener.
 */
export function textoLocalDeNumero(canonico: string, reglas: ReglasDeEscritura): string {
  const { decimales, decimalesMinimos = 0, miles = true } = reglas

  const negativo = canonico.trim().startsWith('-')
  const sinSigno = canonico.trim().replace(/^[+-]/, '')
  const [enteros = '0', crudos = ''] = sinSigno.split('.')

  let parteDecimal = (crudos + '0'.repeat(decimales)).slice(0, decimales)
  while (parteDecimal.length > decimalesMinimos && parteDecimal.endsWith('0')) {
    parteDecimal = parteDecimal.slice(0, -1)
  }

  const parteEntera = enteros.replace(/^0+(?=\d)/, '')
  const agrupada = miles ? parteEntera.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : parteEntera

  const cuerpo = parteDecimal === '' ? agrupada : `${agrupada},${parteDecimal}`
  return negativo && !/^0(,0*)?$/.test(cuerpo) ? `-${cuerpo}` : cuerpo
}

/**
 * El mensaje para quien lo escribio.
 *
 * Dice que pasa y como se arregla, sin nombrar a Zod, a Decimal ni a la escala
 * de la columna. "Ingresa un numero valido" con un ejemplo al lado se entiende
 * de una sola leida.
 */
export function mensajeDeNumeroInvalido(
  motivo: MotivoNumeroInvalido,
  que: 'importe' | 'cantidad' = 'importe',
): string {
  switch (motivo) {
    case 'demasiados-decimales':
      return que === 'importe'
        ? 'Los importes van con dos decimales como máximo: 1.500,50.'
        : 'Las cantidades van con tres decimales como máximo: 1,250.'
    case 'negativo':
      return que === 'importe' ? 'El importe no puede ser negativo.' : 'La cantidad no puede ser negativa.' // prettier-ignore
    case 'fuera-de-rango':
      return 'El número es demasiado grande.'
    case 'no-es-numero':
      return 'Ingresá un número válido.'
  }
}

/**
 * Lo que se deja tipear en un campo numerico.
 *
 * Filtra, no valida: mientras se escribe hay estados que todavia no son un
 * numero --"1,", ",", ""-- y cortarlos ahi haria imposible escribir. Lo unico
 * que saca son los caracteres que no pueden formar parte de ninguno.
 */
export function filtrarTecleoNumerico(texto: string, opciones?: { negativos?: boolean }): string {
  const cuerpo = texto.replace(opciones?.negativos === true ? /[^0-9.,-]/g : /[^0-9.,]/g, '')
  if (opciones?.negativos !== true) return cuerpo
  // El menos, solo adelante y uno solo.
  const negativo = cuerpo.startsWith('-')
  return (negativo ? '-' : '') + cuerpo.replace(/-/g, '')
}
