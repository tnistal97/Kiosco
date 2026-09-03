/**
 * Cambia la contrasena de un usuario de la aplicacion, desde el servidor.
 *
 * Existe para el caso en que nadie puede entrar --la clave se perdio, o se
 * quemo al quedar escrita en algun lado-- y hay que poder volver a entrar sin
 * tocar la base a mano ni inventar un hash.
 *
 * La contrasena se lee por ENTRADA ESTANDAR, nunca por argumento ni por
 * variable de entorno. Un argumento queda en `ps` para cualquiera con una
 * sesion en la maquina, y en el historial del shell para siempre.
 *
 * No la imprime, no la registra y no la devuelve.
 *
 * Uso (el `read -rs` no muestra lo que se teclea, y al ser una variable del
 * shell tampoco queda en el historial):
 *
 *   read -rs NUEVA
 *   printf '%s' "$NUEVA" | npx tsx scripts/establecer-clave.ts admin
 *   unset NUEVA
 */
import './entorno'
import { createInterface } from 'node:readline'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

/** El mismo coste que usa el alta de usuarios (src/modules/users/service.ts). */
const RONDAS = 12

/** Mínimo razonable. Corta las claves que no resisten un intento serio. */
const MINIMO = 12

/**
 * Lee la contrasena de la entrada estandar.
 *
 * Se leyo todo lo que venga y se le quita UN salto de linea final, el que
 * agrega el shell. Nada mas: los espacios de los extremos pueden ser parte de
 * la clave y recortarlos la cambiaria en silencio.
 *
 * Ocultar el tecleo es trabajo del shell (`read -rs`), no de este guion. Se
 * intento al reves --interceptar `process.stdout.write` durante la pregunta--
 * y es fragil: depende de como readline emita cada tecla. El shell ya sabe
 * hacerlo bien, y ademas evita que la clave viaje por el argumento.
 */
async function leerDeEntradaEstandar(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false })
  const lineas: string[] = []
  for await (const linea of rl) lineas.push(linea)

  return lineas.join('\n')
}

async function main(): Promise<void> {
  const usuario = process.argv[2]
  if (!usuario) {
    throw new Error('Falta el nombre de usuario. Uso: npx tsx scripts/establecer-clave.ts admin')
  }

  const existente = await prisma.user.findUnique({
    where: { username: usuario },
    select: { id: true, name: true },
  })
  if (!existente) throw new Error(`No existe el usuario "${usuario}".`)

  const clave = await leerDeEntradaEstandar()
  if (clave.length < MINIMO) {
    throw new Error(`Muy corta: ${String(clave.length)} caracteres, el minimo es ${String(MINIMO)}.`)
  }

  const hash = await bcrypt.hash(clave, RONDAS)
  await prisma.user.update({ where: { id: existente.id }, data: { password: hash } })

  console.log(`Listo. La contrasena de "${usuario}" quedo cambiada.`)
  console.log('No se imprimio ni se guardo en ningun lado.')
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
