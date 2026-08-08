'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, Field, Input, Textarea } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import type { ProveedorDTO } from '@/modules/suppliers/dto'

/**
 * Alta y edicion de un proveedor.
 *
 * LO UNICO OBLIGATORIO ES EL NOMBRE, y el formulario lo dice: los demas campos
 * no llevan asterisco y no bloquean el boton. Un almacen muchas veces conoce
 * "Distribuidora Pepe" y un telefono, y eso tiene que poder guardarse sin
 * inventar un CUIT.
 *
 * Ver docs/SUPPLIER_MODEL.md.
 */

interface Campos {
  name: string
  legalName: string
  taxId: string
  phone: string
  email: string
  address: string
  contactName: string
  notes: string
}

const VACIO: Campos = {
  name: '',
  legalName: '',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  contactName: '',
  notes: '',
}

function desde(p: ProveedorDTO | null): Campos {
  if (!p) return VACIO
  return {
    name: p.name,
    legalName: p.legalName ?? '',
    taxId: p.taxId ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    address: p.address ?? '',
    contactName: p.contactName ?? '',
    notes: p.notes ?? '',
  }
}

export function DialogoProveedor({
  abierto,
  proveedor,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  /** `null` es un alta. */
  proveedor: ProveedorDTO | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [campos, setCampos] = useState<Campos>(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setCampos(desde(proveedor))
    setError(null)
    setEnviando(false)
  }, [abierto, proveedor])

  const set = (clave: keyof Campos) => (valor: string) => {
    setCampos((c) => ({ ...c, [clave]: valor }))
  }

  const nombreOk = campos.name.trim().length > 0
  // El correo se comprueba solo si se escribio algo: vacio es una respuesta
  // valida y no un error a corregir.
  const correoOk = campos.email.trim() === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campos.email)
  const valido = nombreOk && correoOk

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(proveedor ? `/api/suppliers/${String(proveedor.id)}` : '/api/suppliers', {
        method: proveedor ? 'PUT' : 'POST',
        body: {
          name: campos.name.trim(),
          legalName: campos.legalName.trim(),
          taxId: campos.taxId.trim(),
          phone: campos.phone.trim(),
          email: campos.email.trim(),
          address: campos.address.trim(),
          contactName: campos.contactName.trim(),
          notes: campos.notes.trim(),
        },
        parse: () => null,
      })
      onGuardado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el proveedor.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={proveedor ? `Editar ${proveedor.name}` : 'Nuevo proveedor'}
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
            {proveedor ? 'Guardar cambios' : 'Crear proveedor'}
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
              placeholder="Distribuidora Pepe"
              onChange={(e) => {
                set('name')(e.target.value)
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social" hint="Si difiere del nombre de fantasía">
              <Input
                value={campos.legalName}
                disabled={enviando}
                onChange={(e) => {
                  set('legalName')(e.target.value)
                }}
              />
            </Field>

            <Field label="CUIT" hint="Números, guiones y espacios">
              <Input
                value={campos.taxId}
                disabled={enviando}
                inputMode="numeric"
                placeholder="30-12345678-9"
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
            <Field label="Con quién se habla">
              <Input
                value={campos.contactName}
                disabled={enviando}
                placeholder="Pepe"
                onChange={(e) => {
                  set('contactName')(e.target.value)
                }}
              />
            </Field>

            <Field label="Teléfono">
              <Input
                value={campos.phone}
                disabled={enviando}
                inputMode="tel"
                placeholder="11-4567-8900"
                onChange={(e) => {
                  set('phone')(e.target.value)
                }}
              />
            </Field>
          </div>

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

        <Field label="Notas" hint="“Pasa los martes”, “no entrega los feriados”">
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
