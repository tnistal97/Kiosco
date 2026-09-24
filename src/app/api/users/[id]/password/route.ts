import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { invalid } from '@/server/http/errors'
import { resetearClaveSchema } from '@/modules/users/schemas'
import { resetearClave } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Reseteo de la contrasena de un usuario del personal.
 *
 * Reemplaza el `scripts/establecer-clave.ts` por SSH para el caso de todos los
 * dias: un empleado se olvido la clave. El guion sigue existiendo para cuando
 * nadie puede entrar.
 *
 * Si el cuerpo no trae `claveNueva`, el servidor genera una temporal y la
 * devuelve en esta respuesta, UNA vez. Por eso `no-store`: ni el navegador ni
 * un proxy intermedio deben guardarla.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'users.manage',
    body: resetearClaveSchema,
    audit: 'POST /api/users/:id/password',
  },
  async ({ session, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw invalid('Identificador de usuario invalido')

    const resultado = await resetearClave(session, id, body)

    const res = NextResponse.json({ success: true, ...resultado })
    res.headers.set('Cache-Control', 'no-store')
    return res
  },
)
