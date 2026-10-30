'use client'

import { useState, type FormEvent } from 'react'
import { Alert, Button, Card, CardHeader, Field, Input, aviso } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { PASSWORD_MIN } from '@/modules/users/schemas'

/**
 * Cambio de la contrasena propia, en Configuracion.
 *
 * Pide la actual, la nueva y la confirmacion. El formulario solo habilita el
 * boton cuando las tres tienen sentido; la regla que vale es la del servidor,
 * que vuelve a comprobar todo.
 *
 * Al cambiarla se cierran las sesiones de la persona en OTROS equipos. En
 * este sigue adentro: el servidor le devuelve una cookie nueva.
 */
export function CambiarMiClave() {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noCoincide = confirmacion.length > 0 && nueva !== confirmacion
  const igualALaActual = nueva.length > 0 && nueva === actual
  const valido =
    actual.length > 0 && nueva.length >= PASSWORD_MIN && nueva === confirmacion && !igualALaActual

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest('/api/auth/password', {
        method: 'POST',
        body: { claveActual: actual, claveNueva: nueva, claveConfirmacion: confirmacion },
        parse: () => null,
      })
      setActual('')
      setNueva('')
      setConfirmacion('')
      aviso.ok('Contraseña cambiada. Se cerró tu sesión en los otros equipos.')
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cambiar la contraseña.'))
    } finally {
      setEnviando(false)
    }
  }

  const formulario = (
    <form className="flex flex-col gap-4" onSubmit={(e) => void guardar(e)} noValidate>
      {error && (
        <Alert tone="danger" title="No se cambió">
          {error}
        </Alert>
      )}

      <Field label="Contraseña actual" required>
        <Input
          type="password"
          name="claveActual"
          autoComplete="current-password"
          value={actual}
          disabled={enviando}
          onChange={(e) => {
            setActual(e.target.value)
          }}
        />
      </Field>

      <Field
        label="Contraseña nueva"
        required
        hint={`Al menos ${PASSWORD_MIN} caracteres.`}
        error={igualALaActual ? 'Tiene que ser distinta de la actual.' : null}
      >
        <Input
          type="password"
          name="claveNueva"
          autoComplete="new-password"
          value={nueva}
          disabled={enviando}
          onChange={(e) => {
            setNueva(e.target.value)
          }}
        />
      </Field>

      <Field
        label="Repetí la contraseña nueva"
        required
        error={noCoincide ? 'No coincide con la nueva.' : null}
      >
        <Input
          type="password"
          name="claveConfirmacion"
          autoComplete="new-password"
          value={confirmacion}
          disabled={enviando}
          onChange={(e) => {
            setConfirmacion(e.target.value)
          }}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={enviando} disabled={!valido}>
          Cambiar contraseña
        </Button>
      </div>
    </form>
  )

  return (
    <Card>
      <CardHeader
        title="Contraseña"
        description="Cambiarla cierra tu sesión en los otros equipos. En este seguís adentro."
      />
      {formulario}
    </Card>
  )
}
