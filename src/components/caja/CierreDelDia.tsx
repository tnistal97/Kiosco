'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Money,
  PageHeader,
  SkeletonRows,
  cn,
  tonoPorSigno,
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esCero, esNegativo } from '@/lib/money'
import { parseCierreDelDia, type CierreDelDiaDTO } from '@/modules/cash/dto.cierre'
import { AreaDeImpresion } from '@/components/impresion/AreaDeImpresion'
import { CierreImpreso, type DatosDeCierreImpreso } from '@/components/impresion/Ticket'
import { fechaCorta } from './MovimientoRow'

/**
 * Cierre del dia. V1 comercial.
 *
 * Tres bloques, en el orden en que el dueño pregunta: cuanto vendi, como me
 * pagaron, cuanto tiene que haber en el cajon. Sin graficos: son renglones
 * con un numero grande cada uno, para leerlos de parado y con la persiana a
 * medio bajar.
 *
 * NINGUN numero se calcula aca. Todo viene de `/api/cash/cierre`, que a su
 * vez reutiliza el reporte de ventas y el turno de caja. Si dos pantallas
 * dijeran dos cosas distintas, esta es la que estaria mal, y por eso no
 * suma nada por su cuenta.
 *
 * La distincion que la pantalla tiene que hacer imposible de confundir:
 * "Ventas" suma todos los medios, incluido lo fiado; "Debería haber" suma
 * SOLO el efectivo, y arranca en la caja inicial.
 */
export function CierreDelDia() {
  const { hoy, puede, comercio } = useSession()
  const puedeCerrarCaja = puede('cash.shift.close')

  const [fecha, setFecha] = useState(() => hoy())
  const [cierre, setCierre] = useState<CierreDelDiaDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [impreso, setImpreso] = useState<DatosDeCierreImpreso | null>(null)

  const cargar = useCallback(async (dia: string) => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({ fecha: dia })
      setCierre(
        await apiRequest(`/api/cash/cierre?${params.toString()}`, { parse: parseCierreDelDia }),
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo calcular el cierre.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar(fecha)
  }, [cargar, fecha])

  const titulo = cierre?.esHoy === false ? `Cierre del ${fechaLarga(fecha)}` : 'Cierre del día'

  return (
    <div className="flex flex-col gap-4" data-cierre-del-dia="">
      <PageHeader
        title={titulo}
        description="Cuánto vendiste, cómo te pagaron y cuánto tiene que haber en el cajón."
        actions={
          <>
            <Field label="Día" labelHidden>
              <Input
                type="date"
                value={fecha}
                max={hoy()}
                aria-label="Día del cierre"
                onChange={(e) => {
                  if (e.target.value !== '') setFecha(e.target.value)
                }}
              />
            </Field>
            <Button
              variant="secondary"
              onClick={() => {
                if (cierre !== null) setImpreso(cierreParaImprimir(cierre, comercio))
              }}
              disabled={cierre === null || impreso !== null}
            >
              Imprimir cierre
            </Button>
          </>
        }
      />

      {error !== null ? (
        <ErrorState
          title="No se pudo calcular"
          description={error}
          onRetry={() => void cargar(fecha)}
        />
      ) : cargando && cierre === null ? (
        <SkeletonRows rows={5} />
      ) : cierre === null ? null : (
        <>
          <AreaDeImpresion
            contenido={impreso === null ? null : <CierreImpreso datos={impreso} />}
            onTerminado={() => {
              setImpreso(null)
            }}
          />

          {cierre.avisos.map((a) => (
            <Alert key={a.codigo} tone={a.codigo === 'caja_de_otro_dia' ? 'danger' : 'warning'}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{a.texto}</span>
                {puedeCerrarCaja &&
                  (a.codigo === 'caja_abierta' || a.codigo === 'caja_de_otro_dia') && (
                    <ButtonLink href="/caja/cerrar" variant="primary" size="sm">
                      Cerrar la caja
                    </ButtonLink>
                  )}
              </div>
            </Alert>
          ))}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ---------------- VENTAS ---------------- */}
            <Card className="flex flex-col gap-4">
              <CardHeader
                title={cierre.esHoy ? 'Hoy' : fechaLarga(cierre.fecha)}
                description="Todo lo vendido, se haya cobrado como se haya cobrado."
              />
              <dl className="flex flex-col gap-4">
                {/* El importe del dia, solo en su renglon: a tamano de titular
                    no comparte fila con nada, o pisa a la columna de al lado. */}
                <Renglon etiqueta="Ventas" grande>
                  <Money amount={cierre.ventas.total} size="hero" />
                </Renglon>
                <div className="grid grid-cols-3 gap-4">
                  <Renglon etiqueta="Operaciones">
                    <span className="text-2xl font-semibold text-ink" data-numeric="">
                      {cierre.ventas.operaciones}
                    </span>
                  </Renglon>
                  <Renglon etiqueta="Ticket promedio">
                    <Money amount={cierre.ventas.ticketPromedio} size="md" tone="muted" />
                  </Renglon>
                  <Renglon etiqueta="Anuladas">
                    <span className="text-base text-ink-muted" data-numeric="">
                      {cierre.ventas.anuladas}
                    </span>
                  </Renglon>
                </div>
              </dl>

              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                  Medios de pago
                </h3>
                {cierre.porMedio.length === 0 ? (
                  <p className="text-sm text-ink-muted">No hubo ventas.</p>
                ) : (
                  <ul className="divide-y divide-line" data-testid="medios-de-pago">
                    {cierre.porMedio.map((m) => (
                      <li
                        key={m.medio}
                        className="flex items-baseline justify-between gap-3 py-2 text-base"
                      >
                        <span className="min-w-0">
                          <span className={cn('font-medium', m.esFiado && 'text-ink-muted')}>
                            {m.etiqueta}
                          </span>
                          <span className="ml-2 text-xs text-ink-faint" data-numeric="">
                            {m.operaciones} {m.operaciones === 1 ? 'pago' : 'pagos'}
                            {m.entraAlCajon ? ' · entra al cajón' : ''}
                            {m.esFiado ? ' · no es plata que entró' : ''}
                          </span>
                        </span>
                        <Money
                          amount={m.cobrado}
                          size="md"
                          tone={m.esFiado ? 'muted' : 'neutral'}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/* ---------------- CAJA ---------------- */}
            <Card className="flex flex-col gap-4">
              <CardHeader
                title="Caja"
                description="Solo el efectivo. Lo que se cobró por transferencia, Mercado Pago o tarjeta no está acá."
              />
              {cierre.caja.estado === 'sin_caja' ? (
                <p className="text-sm text-ink-muted">
                  {cierre.esHoy
                    ? 'No se abrió la caja hoy.'
                    : 'Ese día no se abrió la caja, así que no hay cuenta del cajón.'}
                </p>
              ) : (
                <dl className="flex flex-col" data-testid="cuenta-de-caja">
                  <Suma etiqueta="Caja inicial" monto={cierre.caja.cajaInicial} />
                  <Suma
                    etiqueta="Ventas en efectivo"
                    monto={cierre.caja.ventasEnEfectivo}
                    signo="+"
                  />
                  <Suma etiqueta="Ingresos" monto={cierre.caja.ingresos} signo="+" />
                  <Suma etiqueta="Egresos" monto={cierre.caja.egresos} signo="−" />
                  <Suma etiqueta="Debería haber" monto={cierre.caja.deberiaHaber} destacado />
                  <Suma
                    etiqueta="Contaste"
                    monto={cierre.caja.contado}
                    vacio={cierre.caja.estado === 'abierta' ? 'Caja abierta' : 'Sin cerrar'}
                  />
                  <Suma
                    etiqueta="Diferencia"
                    monto={cierre.caja.diferencia}
                    vacio="—"
                    destacado
                    signed
                    tono={
                      cierre.caja.diferencia === null
                        ? undefined
                        : tonoPorSigno(cierre.caja.diferencia)
                    }
                    explicacion={
                      cierre.caja.diferencia === null
                        ? undefined
                        : esCero(cierre.caja.diferencia)
                          ? 'Cuadra.'
                          : esNegativo(cierre.caja.diferencia)
                            ? 'Falta plata en el cajón.'
                            : 'Sobra plata en el cajón.'
                    }
                  />
                </dl>
              )}

              {cierre.turnos.length > 1 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">
                    Por turno
                  </h3>
                  <ul className="divide-y divide-line text-sm">
                    {cierre.turnos.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                      >
                        <span>
                          {fechaCorta(t.openedAt)} · {t.openedBy}
                          {t.status === 'open' ? ' · abierta' : ''}
                        </span>
                        <span className="flex gap-3">
                          <span className="text-ink-muted">
                            Debería <Money amount={t.expectedAmount} size="sm" />
                          </span>
                          {t.difference !== null && (
                            <Money
                              amount={t.difference}
                              size="sm"
                              signed
                              tone={tonoPorSigno(t.difference)}
                            />
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>

          <p className="text-xs text-ink-faint">
            "Ventas" suma todos los medios, incluido lo fiado. "Debería haber" es solo el efectivo
            del cajón: caja inicial más ventas en efectivo más ingresos, menos egresos.
          </p>
        </>
      )}
    </div>
  )
}

function Renglon({
  etiqueta,
  grande = false,
  children,
}: {
  etiqueta: string
  grande?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col', grande ? 'gap-1' : 'gap-0.5')}>
      <dt className={cn('text-ink-muted', grande ? 'text-sm font-medium' : 'text-xs')}>
        {etiqueta}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

function Suma({
  etiqueta,
  monto,
  signo,
  destacado = false,
  signed = false,
  tono,
  vacio = '—',
  explicacion,
}: {
  etiqueta: string
  monto: string | null
  signo?: '+' | '−'
  destacado?: boolean
  signed?: boolean
  tono?: 'neutral' | 'in' | 'out' | 'muted'
  vacio?: string
  explicacion?: string
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-2',
        destacado
          ? 'border-t border-line-strong mt-1 pt-3'
          : 'border-t border-line first:border-t-0',
      )}
    >
      <dt className={cn(destacado ? 'text-base font-semibold text-ink' : 'text-sm text-ink-muted')}>
        {signo && (
          <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-ink-faint">
            {signo}
          </span>
        )}
        {etiqueta}
        {explicacion && (
          <span className="ml-2 text-xs font-normal text-ink-muted">{explicacion}</span>
        )}
      </dt>
      <dd>
        {monto === null ? (
          <span className="text-sm text-ink-faint">{vacio}</span>
        ) : (
          <Money amount={monto} size={destacado ? 'xl' : 'md'} signed={signed} tone={tono} />
        )}
      </dd>
    </div>
  )
}

function cierreParaImprimir(c: CierreDelDiaDTO, comercio: string): DatosDeCierreImpreso {
  return {
    comercio,
    fecha: fechaLarga(c.fecha),
    impresoEn: new Date().toISOString(),
    ventas: c.ventas,
    porMedio: c.porMedio.map((m) => ({ etiqueta: m.etiqueta, cobrado: m.cobrado })),
    caja: { hay: c.caja.estado !== 'sin_caja', ...c.caja },
  }
}

function fechaLarga(fecha: string): string {
  const [a, m, d] = fecha.split('-')
  if (!a || !m || !d) return fecha
  return `${d}/${m}/${a}`
}
