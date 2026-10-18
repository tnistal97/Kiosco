'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Field,
  Kbd,
  MoneyInput,
  PageHeader,
  Skeleton,
  StatusBadge,
  Textarea,
  aviso,
  problemaDeImporte,
} from '@/components/ui'
import { usePermiso, useSession } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, montoDesdeTexto } from '@/lib/money'
import { parseEstadoDeCaja, parseTurnoEnvuelto, type EstadoDeCajaDTO } from '@/modules/cash/dto'
import { fechaCorta } from './MovimientoRow'

/**
 * Abrir la caja. UX V2, Fase 2.
 *
 * Una pantalla, una pregunta: cuanto hay en el cajon. Lo demas --la sucursal
 * y quien abre-- ya lo sabe el sistema y se muestra para que quede claro que
 * turno se esta empezando, no para que se escriba.
 *
 * Es una pagina y no un dialogo porque desde la venta hay que poder llegar y
 * volver sin buscar nada: `?volver=/venta` la trae de vuelta al mostrador en
 * cuanto la caja queda abierta (auditoria, §6 08:00).
 *
 * El importe entra como se escribe --"25000", "25.000", "0"-- y se muestra
 * como se lee. El servidor decide todo lo demas: una sola caja abierta por
 * sucursal, quien puede abrirla y con que permiso.
 */
export function AperturaDeCaja({ volver }: { volver: string }) {
  const router = useRouter()
  const { session } = useSession()
  const puedeAbrir = usePermiso('cash.shift.open')

  const [estado, setEstado] = useState<EstadoDeCajaDTO | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)
  const [inicial, setInicial] = useState('')
  const [nota, setNota] = useState('')
  const [conNota, setConNota] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    void apiRequest('/api/cash/shift', { parse: parseEstadoDeCaja })
      .then((r) => {
        if (vivo) setEstado(r)
      })
      .catch((err: unknown) => {
        if (vivo) setErrorDeCarga(mensajeDeError(err, 'No se pudo consultar la caja.'))
      })
    return () => {
      vivo = false
    }
  }, [])

  // El foco arranca en el importe: es lo unico que hay que escribir.
  useEffect(() => {
    if (estado && estado.turno === null) campo.current?.focus()
  }, [estado])

  const importe = montoDesdeTexto(inicial)
  const problema = problemaDeImporte(inicial, { permitirCero: true })
  const valido = importe !== null && !esNegativo(importe) && problema === null

  async function abrir() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest('/api/cash/shift', {
        method: 'POST',
        body: { openingAmount: importe, notes: nota.trim() === '' ? undefined : nota.trim() },
        parse: parseTurnoEnvuelto,
      })
      notificarCambioDeCaja()
      aviso.ok('Caja abierta. Ya se puede cobrar.')
      router.push(volver)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo abrir la caja.'))
      setEnviando(false)
    }
  }

  if (errorDeCarga !== null) {
    return (
      <Alert tone="danger" title="No se pudo consultar la caja">
        {errorDeCarga}
      </Alert>
    )
  }

  if (estado === null) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (estado.turno !== null) {
    const t = estado.turno
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="La caja ya está abierta"
          status={<StatusBadge tone="success">Abierta</StatusBadge>}
          description={`La abrió ${t.openedBy.name} a las ${fechaCorta(t.openedAt)}. Se puede vender.`}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href="/venta" variant="primary" size="lg">
            Ir a vender
          </ButtonLink>
          <ButtonLink href="/caja" variant="secondary" size="lg">
            Ver la caja
          </ButtonLink>
        </div>
      </div>
    )
  }

  if (!puedeAbrir) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="La caja está cerrada"
          status={<StatusBadge tone="warning">Cerrada</StatusBadge>}
          description="Abrirla necesita un encargado. Hasta entonces se puede armar el ticket, pero no cobrar."
        />
        <div>
          <ButtonLink href={volver} variant="secondary">
            Volver
          </ButtonLink>
        </div>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void abrir()
      }}
    >
      <PageHeader
        title="Abrir la caja"
        status={<StatusBadge tone="warning">Cerrada</StatusBadge>}
        description="Contá la plata que hay en el cajón y abrí la caja."
      />

      {error && (
        <Alert tone="danger" title="No se abrió">
          {error}
        </Alert>
      )}

      <Card>
        <dl className="mb-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-faint">Sucursal</dt>
            <dd className="font-medium text-ink">{session?.branchName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Abre</dt>
            <dd className="font-medium text-ink">{session?.name ?? '—'}</dd>
          </div>
        </dl>

        <MoneyInput
          ref={campo}
          label="Efectivo inicial"
          labelVisible
          size="xl"
          placeholder="0,00"
          value={inicial}
          disabled={enviando}
          onChange={setInicial}
          // Enter abre. Explicito y no por el envio implicito del formulario:
          // asi no depende de como cada navegador sintetiza la tecla.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void abrir()
            }
          }}
          aria-describedby="apertura-ayuda"
        />
        <p
          id="apertura-ayuda"
          role={problema === null ? undefined : 'alert'}
          className={problema === null ? 'mt-2 text-sm text-ink-muted' : 'mt-2 text-sm font-medium text-danger'} // prettier-ignore
        >
          {problema ?? 'Billetes y monedas que hay ahora en el cajón. Puede ser cero.'}
        </p>

        {conNota ? (
          <Field label="Nota" hint="Opcional." className="mt-5">
            <Textarea
              rows={2}
              value={nota}
              disabled={enviando}
              autoFocus
              onChange={(e) => {
                setNota(e.target.value)
              }}
            />
          </Field>
        ) : (
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setConNota(true)
              }}
            >
              Agregar una nota
            </Button>
          </div>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href={volver} variant="secondary" size="lg">
          Volver
        </ButtonLink>
        <Button type="submit" variant="confirm" size="lg" loading={enviando} disabled={!valido}>
          Abrir caja
          <Kbd>Enter</Kbd>
        </Button>
      </div>
    </form>
  )
}
