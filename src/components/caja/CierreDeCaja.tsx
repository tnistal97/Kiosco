'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Field,
  Kbd,
  Money,
  MoneyInput,
  PageHeader,
  Skeleton,
  StatusBadge,
  Textarea,
  aviso,
  problemaDeImporte,
  tonoPorSigno,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { notificarCambioDeCaja } from '@/components/shell/EstadoCaja'
import { apiRequest, esObjeto, mensajeDeError, numero } from '@/lib/api-client'
import {
  CERO,
  absMonto,
  compararMontos,
  esCero,
  esNegativo,
  esPositivo,
  montoDesdeTexto,
  restarMontos,
  sumarMontos,
  type Monto,
} from '@/lib/money'
import {
  parseEstadoDeCaja,
  parseMovimientos,
  type EstadoDeCajaDTO,
  type MovimientoDTO,
  type TurnoDTO,
} from '@/modules/cash/dto'
import { etiquetaDeMedio } from '@/modules/sales/payment-methods'
import { fechaCorta } from './MovimientoRow'

/**
 * Cerrar la caja. UX V2, Fase 2.
 *
 * Tres pasos a la vista, en orden, y una sola pregunta de verdad:
 *
 *   1. que paso en el turno: inicial, ventas, entradas y salidas, y cuanto
 *      TIENE QUE HABER. Los cuatro renglones que la suma necesita para
 *      cerrar a la vista (auditoria, H-12);
 *   2. cuanto HAY: se cuenta el cajon y se escribe;
 *   3. la diferencia, dicha con todas las letras --cuadra, falta, sobra--
 *      mientras se escribe, con una pista de por que suele pasar.
 *
 * El esperado y la diferencia los calcula el servidor: aca se previsualizan
 * con la misma aritmetica de centavos enteros, para no hacer viajar un cierre
 * que se sabe que se va a rechazar. Cuando la diferencia supera el umbral de
 * la sucursal, el servidor pide autorizacion y esta pantalla la ofrece como
 * un SEGUNDO clic distinto: firmar un faltante no puede ser el mismo boton
 * que cerrar una caja que cuadra.
 */

/**
 * Las ventas del turno por medio de pago, desde los movimientos de caja.
 *
 * El turno trae solo lo que entra al cajon --las ventas en efectivo--. Para
 * decir tambien "3 con debito, 1 por transferencia" se leen los movimientos
 * desde que se abrio. Es informacion de lectura: el esperado no sale de aca.
 * Con mas de cien ventas en el turno la lista queda corta y se dice cuantas
 * son, sin inventar un desglose parcial.
 */
interface ResumenDeVentas {
  cuantas: number
  porMedio: Array<{ medio: string; cuantas: number; total: Monto }>
  /** Si el desglose abarca todas las ventas del turno. */
  completo: boolean
}

function resumirVentas(
  movimientos: MovimientoDTO[],
  desde: string,
  total: number,
): ResumenDeVentas {
  const delTurno = movimientos.filter((m) => m.type === 'sale' && m.date >= desde)
  const porMedio = new Map<string, { cuantas: number; total: Monto }>()
  for (const m of delTurno) {
    const actual = porMedio.get(m.paymentMethod) ?? { cuantas: 0, total: CERO }
    porMedio.set(m.paymentMethod, {
      cuantas: actual.cuantas + 1,
      total: sumarMontos(actual.total, m.amount),
    })
  }
  return {
    cuantas: delTurno.length,
    porMedio: [...porMedio.entries()]
      .map(([medio, v]) => ({ medio, ...v }))
      .sort((a, b) => compararMontos(b.total, a.total)),
    completo: total <= movimientos.length,
  }
}

export function CierreDeCaja() {
  const puedeAutorizar = usePermiso('cash.shift.authorize')
  const puedeAbrir = usePermiso('cash.shift.open')

  const [estado, setEstado] = useState<EstadoDeCajaDTO | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)
  const [ventas, setVentas] = useState<ResumenDeVentas | null>(null)

  const [contado, setContado] = useState('')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Se enciende cuando el servidor pide autorizacion. */
  const [pideAutorizacion, setPideAutorizacion] = useState(false)
  const [cerrado, setCerrado] = useState<{ turno: TurnoDTO; contado: Monto } | null>(null)
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

  const turno = estado?.turno ?? null

  // Las ventas por medio, aparte y sin frenar la pantalla: si fallan, el
  // cierre sigue funcionando con lo que trae el turno.
  useEffect(() => {
    if (turno === null) return
    let vivo = true
    void apiRequest('/api/cash?dias=3&pageSize=100&tipo=sale', {
      parse: (raw) => {
        const lista = parseMovimientos(raw)
        const p = esObjeto(raw) && esObjeto(raw.pagination) ? raw.pagination : null
        return { lista, total: p ? numero(p.total) : lista.length }
      },
    })
      .then(({ lista, total }) => {
        if (vivo) setVentas(resumirVentas(lista, turno.openedAt, total))
      })
      .catch(() => {
        if (vivo) setVentas(null)
      })
    return () => {
      vivo = false
    }
  }, [turno])

  useEffect(() => {
    if (turno !== null) campo.current?.focus()
  }, [turno])

  const importe = montoDesdeTexto(contado)
  const problema = problemaDeImporte(contado, { permitirCero: true })
  const valido = importe !== null && !esNegativo(importe) && problema === null
  const diferencia = useMemo(
    () => (importe === null || turno === null ? null : restarMontos(importe, turno.expectedAmount)),
    [importe, turno],
  )
  const umbral = estado?.politica.umbralDiferencia ?? CERO
  const superaUmbral =
    diferencia !== null && esPositivo(umbral) && compararMontos(absMonto(diferencia), umbral) > 0

  async function cerrar(autorizar: boolean) {
    if (enviando || !valido || turno === null) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(`/api/cash/shift/${String(turno.id)}/close`, {
        method: 'POST',
        body: {
          countedAmount: importe,
          notes: nota.trim() === '' ? undefined : nota.trim(),
          autorizar,
        },
        parse: () => null,
      })
      notificarCambioDeCaja()
      aviso.ok('Caja cerrada')
      setCerrado({ turno, contado: importe })
    } catch (err) {
      const mensaje = mensajeDeError(err, 'No se pudo cerrar la caja.')
      // El servidor es el que decide si hace falta autorizacion: la pantalla
      // solo la anticipa. Si llega el rechazo, se muestra el segundo paso.
      if (/autoric/i.test(mensaje) && puedeAutorizar) setPideAutorizacion(true)
      setError(mensaje)
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
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (cerrado !== null) {
    const dif = restarMontos(cerrado.contado, cerrado.turno.expectedAmount)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Caja cerrada"
          status={<StatusBadge tone="neutral">Cerrada</StatusBadge>}
          description="El turno quedó registrado. No se puede reabrir."
        />
        <Card>
          <dl className="flex flex-col gap-2 text-sm">
            <Renglon etiqueta="Tenía que haber">
              <Money amount={cerrado.turno.expectedAmount} size="md" />
            </Renglon>
            <Renglon etiqueta="Se contó">
              <Money amount={cerrado.contado} size="md" />
            </Renglon>
            <Renglon etiqueta="Diferencia" destacado>
              {esCero(dif) ? (
                <span className="font-medium text-success">Cuadra</span>
              ) : (
                <Money amount={dif} signed size="lg" tone={tonoPorSigno(dif)} />
              )}
            </Renglon>
          </dl>
        </Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <ButtonLink href="/caja" variant="secondary" size="lg">
            Ver la caja
          </ButtonLink>
          {puedeAbrir && (
            <ButtonLink href="/caja/abrir" variant="primary" size="lg">
              Abrir una caja nueva
            </ButtonLink>
          )}
        </div>
      </div>
    )
  }

  if (turno === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="No hay una caja abierta"
          status={<StatusBadge tone="warning">Cerrada</StatusBadge>}
          description="No hay nada que cerrar."
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          {puedeAbrir && (
            <ButtonLink href="/caja/abrir" variant="primary" size="lg">
              Abrir caja
            </ButtonLink>
          )}
          <ButtonLink href="/caja" variant="secondary" size="lg">
            Ver la caja
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
        void cerrar(pideAutorizacion)
      }}
    >
      <PageHeader
        title="Cerrar la caja"
        status={<StatusBadge tone="success">Abierta</StatusBadge>}
        description={`Abierta por ${turno.openedBy.name} a las ${fechaCorta(turno.openedAt)}. Contá la plata y confirmá si cierra.`}
      />

      {error && (
        <Alert tone={pideAutorizacion ? 'warning' : 'danger'} title="No se cerró">
          {error}
        </Alert>
      )}

      {/* 1. Que paso en el turno */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-ink-faint uppercase">
          1 · El turno
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <Renglon etiqueta="Efectivo inicial">
            <Money amount={turno.openingAmount} size="sm" tone="muted" />
          </Renglon>
          <Renglon
            etiqueta={`Ventas en efectivo${turno.cantidadDeVentas > 0 ? ` (${String(turno.cantidadDeVentas)})` : ''}`}
          >
            <Money amount={turno.ventasEnEfectivo} size="sm" tone="muted" />
          </Renglon>
          <Renglon etiqueta="Ingresos al cajón">
            <Money amount={turno.ingresos} size="sm" tone="muted" />
          </Renglon>
          <Renglon etiqueta="Retiros y depósitos">
            <span className="text-ink-muted" data-numeric="">
              {esPositivo(turno.egresos) && <span aria-hidden="true">− </span>}
              <Money amount={turno.egresos} size="sm" tone="muted" />
            </span>
          </Renglon>
          <Renglon etiqueta="Tiene que haber" destacado>
            <Money amount={turno.expectedAmount} size="lg" />
          </Renglon>
        </dl>

        {ventas !== null && ventas.cuantas > 0 && (
          <div className="mt-4 border-t border-line pt-3 text-sm">
            <p className="text-ink-muted">
              {ventas.completo
                ? `${String(ventas.cuantas)} ${ventas.cuantas === 1 ? 'venta' : 'ventas'} en el turno`
                : `Más de ${String(ventas.cuantas)} ventas en el turno`}
              {ventas.completo && ventas.porMedio.length > 0 && ':'}
            </p>
            {ventas.completo && (
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
                {ventas.porMedio.map((v) => (
                  <li key={v.medio} className="flex items-baseline gap-1.5">
                    <span>
                      {String(v.cuantas)} {etiquetaDeMedio(v.medio).toLowerCase()}
                    </span>
                    <Money amount={v.total} size="sm" tone="muted" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-ink-faint">
              Solo el efectivo entra al cajón. Débito, crédito y transferencias no cuentan para lo
              que tiene que haber.
            </p>
          </div>
        )}
      </Card>

      {/* 2. Cuanto hay */}
      <Card>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-ink-faint uppercase">
          2 · Contá el efectivo
        </h2>
        <MoneyInput
          ref={campo}
          label="Efectivo contado"
          labelVisible
          size="xl"
          placeholder="0,00"
          value={contado}
          disabled={enviando}
          onChange={setContado}
          // Enter cierra (o autoriza, si el servidor ya lo pidio). Explicito
          // y no por el envio implicito del formulario.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void cerrar(pideAutorizacion)
            }
          }}
          aria-describedby="cierre-ayuda"
        />
        <p
          id="cierre-ayuda"
          role={problema === null ? undefined : 'alert'}
          className={problema === null ? 'mt-2 text-sm text-ink-muted' : 'mt-2 text-sm font-medium text-danger'} // prettier-ignore
        >
          {problema ?? 'Billetes y monedas que hay ahora en el cajón, todo junto.'}
        </p>

        {/* 3. La diferencia, mientras se escribe */}
        {diferencia !== null && (
          <Diferencia diferencia={diferencia} umbral={umbral} superaUmbral={superaUmbral} />
        )}
      </Card>

      <Field
        label="Observación"
        hint={
          diferencia !== null && !esCero(diferencia)
            ? 'Contá qué pasó: es lo que se va a leer mañana.'
            : 'Opcional.'
        }
      >
        <Textarea
          rows={2}
          value={nota}
          disabled={enviando}
          onChange={(e) => {
            setNota(e.target.value)
          }}
        />
      </Field>

      {pideAutorizacion && !puedeAutorizar && (
        <Alert tone="danger" title="Hace falta un encargado">
          La diferencia supera el límite y solo un encargado puede autorizar el cierre.
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <ButtonLink href="/caja" variant="secondary" size="lg">
          Volver
        </ButtonLink>
        {pideAutorizacion && puedeAutorizar ? (
          <Button type="submit" variant="danger" size="lg" loading={enviando} disabled={!valido}>
            Autorizar y cerrar
          </Button>
        ) : (
          <Button
            type="submit"
            variant="confirm"
            size="lg"
            loading={enviando}
            disabled={!valido || (pideAutorizacion && !puedeAutorizar)}
          >
            Cerrar caja
            <Kbd>Enter</Kbd>
          </Button>
        )}
      </div>
    </form>
  )
}

function Renglon({
  etiqueta,
  destacado = false,
  children,
}: {
  etiqueta: string
  destacado?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={
        destacado
          ? 'mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2'
          : 'flex items-baseline justify-between gap-3'
      }
    >
      <dt className={destacado ? 'font-medium text-ink' : 'text-ink-muted'}>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Cuadra, falta o sobra, con todas las letras y en grande.
 *
 * No se esconde ni se suaviza: un faltante se lee desde el otro lado del
 * mostrador. Y se ayuda a entenderlo, porque el motivo mas comun de cada
 * signo es conocido y quien cierra lo puede revisar antes de firmar.
 */
function Diferencia({
  diferencia,
  umbral,
  superaUmbral,
}: {
  diferencia: Monto
  umbral: Monto
  superaUmbral: boolean
}) {
  if (esCero(diferencia)) {
    return (
      <div
        role="status"
        className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success-quiet px-4 py-3"
      >
        <span className="text-lg font-semibold text-success">✓ Cuadra</span>
        <span className="text-sm text-ink-muted">Lo contado es exactamente lo esperado.</span>
      </div>
    )
  }

  const falta = esNegativo(diferencia)
  return (
    <div
      role="status"
      className={
        falta
          ? 'mt-4 rounded-lg border border-danger/40 bg-danger-quiet px-4 py-3'
          : 'mt-4 rounded-lg border border-warning/45 bg-warning-quiet px-4 py-3'
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={falta ? 'text-lg font-semibold text-danger' : 'text-lg font-semibold text-warning'} // prettier-ignore
        >
          {falta ? 'Falta' : 'Sobra'}
        </span>
        <Money amount={absMonto(diferencia)} size="xl" tone={falta ? 'out' : 'in'} />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {falta
          ? 'Se contó menos de lo que tiene que haber. Revisá vueltos mal dados y retiros sin anotar.'
          : 'Se contó más de lo que tiene que haber. Suele ser una venta cobrada sin registrar o un vuelto que no se dio.'}
      </p>
      {superaUmbral && (
        <p className="mt-2 text-sm font-medium text-ink">
          Supera el límite de <Money amount={umbral} size="sm" /> y necesita la autorización de un
          encargado para cerrar.
        </p>
      )}
    </div>
  )
}
