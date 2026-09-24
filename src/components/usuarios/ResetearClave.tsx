'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, RadioGroup, aviso } from '@/components/ui'
import { apiRequest, esObjeto, mensajeDeError } from '@/lib/api-client'
import type { UsuarioDTO } from '@/modules/users/dto'
import { PASSWORD_MIN } from '@/modules/users/schemas'

type Modo = 'generar' | 'escribir'

/** La respuesta del reseteo. La clave solo viene si la genero el servidor. */
function parseReseteo(raw: unknown): { claveTemporal: string | null } {
  const clave = esObjeto(raw) ? raw.claveTemporal : undefined
  return { claveTemporal: typeof clave === 'string' ? clave : null }
}

/**
 * Reseteo de la contrasena de un empleado.
 *
 * Dos pasos en el mismo dialogo: confirmar, y despues mostrar la clave
 * temporal UNA vez. Al cerrarse, la clave se borra del estado: no queda en
 * ningun lado de la pantalla.
 *
 * El reseteo cierra en el acto las sesiones abiertas de esa persona.
 */
export function ResetearClave({
  usuario,
  onCerrar,
}: {
  usuario: UsuarioDTO | null
  onCerrar: () => void
}) {
  const abierto = usuario !== null
  const [modo, setModo] = useState<Modo>('generar')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState(false)
  const [temporal, setTemporal] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setModo('generar')
    setClave('')
    setEnviando(false)
    setError(null)
    setHecho(false)
    setTemporal(null)
  }, [abierto, usuario?.id])

  function cerrar() {
    // La clave no sobrevive al dialogo.
    setTemporal(null)
    setClave('')
    onCerrar()
  }

  const valido = modo === 'generar' || clave.length >= PASSWORD_MIN

  async function confirmar() {
    if (!usuario || enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      const r = await apiRequest(`/api/users/${usuario.id}/password`, {
        method: 'POST',
        body: modo === 'escribir' ? { claveNueva: clave } : {},
        parse: parseReseteo,
      })
      setTemporal(r.claveTemporal)
      setClave('')
      setHecho(true)
      aviso.ok('Contraseña reseteada. Sus sesiones abiertas se cerraron.')
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo resetear la contraseña.'))
    } finally {
      setEnviando(false)
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      aviso.ok('Contraseña copiada.')
    } catch {
      aviso.atencion('El navegador no permitió copiar. Anotala a mano.')
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={cerrar}
      title={usuario ? `Resetear la contraseña de ${usuario.name}` : 'Resetear contraseña'}
      size="md"
      dismissible={!enviando}
      footer={
        hecho ? (
          <Button variant="primary" onClick={cerrar}>
            Listo
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={cerrar} disabled={enviando}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={enviando}
              disabled={!valido}
              onClick={() => void confirmar()}
            >
              Resetear
            </Button>
          </>
        )
      }
    >
      {hecho ? (
        <div className="flex flex-col gap-4">
          {temporal ? (
            <>
              <p className="text-sm text-ink-muted">
                Contraseña temporal de <strong className="text-ink">@{usuario?.username}</strong>:
              </p>
              <div className="flex items-center gap-2">
                <code
                  data-testid="clave-temporal"
                  className="flex-1 rounded-md border border-line bg-sunken px-3 py-2 text-center font-mono text-lg tracking-wide text-ink select-all"
                >
                  {temporal}
                </code>
                <Button variant="secondary" onClick={() => void copiar(temporal)}>
                  Copiar
                </Button>
              </div>
              <Alert tone="warning" title="No se vuelve a mostrar">
                Anotala o copiala ahora. Dásela en persona y pedile que la cambie en Configuración
                apenas entre.
              </Alert>
            </>
          ) : (
            <Alert tone="success" title="Contraseña cambiada">
              Dásela en persona y pedile que la cambie en Configuración apenas entre.
            </Alert>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && (
            <Alert tone="danger" title="No se reseteó">
              {error}
            </Alert>
          )}

          <p className="text-sm text-ink-muted">
            La contraseña actual deja de funcionar y se cierran en el acto las sesiones abiertas de{' '}
            <strong className="text-ink">{usuario?.name}</strong>. Queda registrado en la bitácora.
          </p>

          <RadioGroup<Modo>
            legend="Nueva contraseña"
            name="modo-reseteo"
            value={modo}
            onChange={setModo}
            options={[
              {
                value: 'generar',
                label: 'Generar una temporal',
                description: 'La crea el sistema y se muestra una sola vez.',
              },
              {
                value: 'escribir',
                label: 'Escribirla yo',
                description: `Al menos ${PASSWORD_MIN} caracteres.`,
              },
            ]}
          />

          {modo === 'escribir' && (
            <Field label="Contraseña nueva" required hint={`Al menos ${PASSWORD_MIN} caracteres.`}>
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
          )}
        </div>
      )}
    </Dialog>
  )
}
