import { handler } from '@/server/http/handler'
import { invalid } from '@/server/http/errors'
import { editarUsuarioSchema } from '@/modules/users/schemas'
import { editarUsuario } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Modificacion de un usuario: nombre, rol, alta y baja.
 *
 * La contrasena NO se cambia por aca. Cambiarla es una operacion distinta y
 * mezclarla con la edicion del perfil permitiria cambiarla sin conocer la
 * anterior. Queda pendiente para la fase siguiente.
 */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'users.manage',
    body: editarUsuarioSchema,
    audit: 'PUT /api/users/:id',
  },
  ({ session, body, params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw invalid('Identificador de usuario invalido')
    return editarUsuario(session, id, body)
  },
)
