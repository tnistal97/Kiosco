'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Textarea } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { ClienteDTO } from '@/modules/clients/dto'

/**
 * Alta y edicion de un cliente.
 *
 * LO UNICO OBLIGATORIO ES EL NOMBRE, y el formulario lo dice: los demas campos
 * no llevan asterisco y no bloquean el boton. "Juan Pérez" tiene que poder
 * guardarse sin inventar un DNI.
 *
 * El LIMITE DE CREDITO es el campo delicado de esta pantalla, y por eso su
 * ayuda dice las dos cosas que se confunden: vacio es "sin limite configurado"
 * y cero es "no se le fia". Ver docs/CREDIT_POLICY.md.
 */

interface Campos {
  name: string
  document: string
  taxId: string
  phone: string
  email: string
  address: string
  notes: string
  creditLimit: string
}

const VACIO: Campos = {
  name: '',
  document: '',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  creditLimit: '',
}

function desde(c: ClienteDTO | null): Campos {
  if (!c) return VACIO
  return {
    name: c.name,
    document: c.document ?? '',
    taxId: c.taxId ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    creditLimit: c.creditLimit ?? '',
  }
}

export function DialogoCliente({
  abierto,
  cliente,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  /** `null` es un alta. */
  cliente: ClienteDTO | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [campos, setCampos] = useState<Campos>(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setCampos(desde(cliente))
    setError(null)
    setEnviando(false)
  }, [abierto, cliente])

  const set = (clave: keyof Campos) => (valor: string) => {
    setCampos((c) => ({ ...c, [clave]: valor }))
  }

  const nombreOk = campos.name.trim().length > 0
  const correoOk = campos.email.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campos.email)
  const limiteOk = campos.creditLimit.trim() === '' || /^\d+(\.\d{1,2})?$/.test(campos.creditLimit)
  const valido = nombreOk && correoOk && limiteOk

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      const limite = campos.creditLimit.trim()
      await apiRequest(cliente ? `/api/clients/${String(cliente.id)}` : '/api/clients', {
        method: cliente ? 'PUT' : 'POST',
        body: {
          name: campos.name.trim(),
          document: campos.document.trim(),
          taxId: campos.taxId.trim(),
          phone: campos.phone.trim(),
          email: campos.email.trim(),
          address: campos.address.trim(),
          notes: campos.notes.trim(),
          // El campo vacio manda `null`, que en el servidor significa "sin
          // limite configurado". NO manda `"0"`, que significa lo contrario.
          creditLimit: limite === '' ? null : limite,
        },
        parse: () => null,
      })
      onGuardado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el cliente.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={cliente ? `Editar ${cliente.name}` : 'Nuevo cliente'}
      size="lg"
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
            onClick={() => void guardar()}
          >
            {cliente ? 'Guardar cambios' : 'Crear cliente'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se guardó">
            {error}
          </Alert>
        )}

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-ink">Identificación</h3>

          <Field
            label="Nombre"
            required
            hint="Con esto alcanza. Todo lo demás es opcional."
            error={campos.name !== '' && !nombreOk ? 'El nombre no puede estar vacío' : null}
          >
            <Input
              value={campos.name}
              disabled={enviando}
              autoFocus
              placeholder="Juan Pérez"
              onChange={(e) => {
                set('name')(e.target.value)
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Documento" hint="DNI, o lo que se use para identificarlo">
              <Input
                value={campos.document}
                disabled={enviando}
                inputMode="numeric"
                onChange={(e) => {
                  set('document')(e.target.value)
                }}
              />
            </Field>

            <Field label="CUIT">
              <Input
                value={campos.taxId}
                disabled={enviando}
                inputMode="numeric"
                placeholder="20-12345678-9"
                onChange={(e) => {
                  set('taxId')(e.target.value)
                }}
              />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-ink">Contacto</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teléfono">
              <Input
                value={campos.phone}
                disabled={enviando}
                inputMode="tel"
                placeholder="11-5555-1234"
                onChange={(e) => {
                  set('phone')(e.target.value)
                }}
              />
            </Field>

            <Field
              label="Correo"
              error={campos.email !== '' && !correoOk ? 'No parece un correo válido' : null}
            >
              <Input
                value={campos.email}
                disabled={enviando}
                inputMode="email"
                onChange={(e) => {
                  set('email')(e.target.value)
                }}
              />
            </Field>
          </div>

          <Field label="Dirección">
            <Input
              value={campos.address}
              disabled={enviando}
              onChange={(e) => {
                set('address')(e.target.value)
              }}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-ink">Crédito</h3>

          <Field
            label="Límite de crédito"
            hint="Vacío: sin límite. Cero: no se le fía. No es lo mismo."
            error={!limiteOk ? 'Un importe con hasta dos decimales, o vacío' : null}
          >
            <Input
              value={campos.creditLimit}
              disabled={enviando}
              inputMode="decimal"
              placeholder="50000"
              onChange={(e) => {
                set('creditLimit')(e.target.value)
              }}
            />
          </Field>
        </section>

        <Field label="Notas" hint="“Pasa los viernes”, “el del taller de la esquina”">
          <Textarea
            value={campos.notes}
            disabled={enviando}
            rows={2}
            onChange={(e) => {
              set('notes')(e.target.value)
            }}
          />
        </Field>
      </div>
    </Dialog>
  )
}
