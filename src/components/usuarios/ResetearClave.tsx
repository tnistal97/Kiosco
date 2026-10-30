'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, aviso } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { UsuarioDTO } from '@/modules/users/dto'
import { CLAVE_TEMPORAL_MIN } from '@/modules/users/schemas'

/**
 * Restablecer la contrasena de un empleado.
 *
 * El administrador escribe una temporal sencilla y se la dice. La API puede
 * generarla, pero esa clave hay que anotarla y dictarla: escribirla uno es lo
 * mas simple para quien esta atendiendo el local.
 *
 * Restablecer cierra en el acto las sesiones abiertas de esa persona, y al
 * entrar tiene que elegir una nueva. Al cerrar el dialogo, lo escrito se borra
 * del estado.
 */
export function ResetearClave({
  usuario,
  onCerrar,
}: {
  usuario: UsuarioDTO | null
  onCerrar: () => void
}) {
  const abierto = usuario !== null
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setClave('')
    setRepetida('')
    setEnviando(false)
    setError(null)
  }, [abierto, usuario?.id])

  const noCoincide = repetida.length > 0 && clave !== repetida
  const valido = clave.length >= CLAVE_TEMPORAL_MIN && clave === repetida

  async function confirmar() {
    if (!usuario || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/users/${String(usuario.id)}/password`, {
        method: 'POST',
        body: { claveNueva: clave, claveConfirmacion: repetida },
        parse: () => null,
      })
      aviso.ok('Contraseña restablecida. El usuario deberá elegir una nueva al ingresar.')
      onCerrar()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo restablecer la contraseña.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title="Contraseña temporal"
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!valido}
            onClick={() => void confirmar()}
          >
            Restablecer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" title="No se restableció">
            {error}
          </Alert>
        )}

        <p className="text-sm text-ink-muted">
          Elegí una contraseña para <strong className="text-ink">{usuario?.name}</strong> y
          decísela. La va a usar una sola vez: al entrar elige una nueva.
        </p>

        <Field
          label="Nueva contraseña temporal"
          required
          hint={`Al menos ${String(CLAVE_TEMPORAL_MIN)} caracteres.`}
        >
          <Input
            type="password"
            name="claveNueva"
            autoComplete="new-password"
            value={clave}
            disabled={enviando}
            onChange={(e) => {
              setClave(e.target.value)
            }}
          />
        </Field>

        <Field
          label="Repetir contraseña"
          required
          error={noCoincide ? 'No coincide con la anterior.' : null}
        >
          <Input
            type="password"
            name="claveConfirmacion"
            autoComplete="new-password"
            value={repetida}
            disabled={enviando}
            onChange={(e) => {
              setRepetida(e.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
