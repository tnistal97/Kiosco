'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Money,
  Select,
  Textarea,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  CERO,
  compararMontos,
  esPositivo,
  minMonto,
  restarMontos,
  sumarMontos,
  type Monto,
} from '@/lib/money'
import { MEDIOS_DE_PAGO_A_PROVEEDOR, etiquetaDeMedio } from '@/modules/sales/payment-methods'
import { etiquetaDeEstadoDeDeuda } from '@/modules/suppliers/movement-types'
import {
  parsePaginaDeudas,
  parsePagoAProveedor,
  type DeudaDTO,
  type ResumenDeCuentaDTO,
} from '@/modules/suppliers/dto.cuenta'

function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * El reparto FIFO, calculado en el navegador SOLO PARA MOSTRARLO.
 *
 * La imputacion de verdad la hace el servidor, dentro de la transaccion y
 * contra el pendiente real de cada obligacion. Esto es la vista previa: sin
 * ella, quien paga confirma a ciegas y se entera de que se imputo despues.
 *
 * El orden viene YA RESUELTO del servidor --las deudas llegan ordenadas por
 * vencimiento-- para que las dos partes no puedan discrepar. Reordenar aca
 * seria una segunda implementacion de la misma regla, y dos implementaciones de
 * una regla es una que se va a olvidar de cambiar.
 */
function repartoAutomatico(deudas: DeudaDTO[], importe: Monto): Map<number, Monto> {
  const reparto = new Map<number, Monto>()
  let resto = importe

  for (const d of deudas) {
    if (!esPositivo(resto)) break
    const cuanto = minMonto(resto, d.pendiente)
    if (!esPositivo(cuanto)) continue
    reparto.set(d.receiptId, cuanto)
    resto = restarMontos(resto, cuanto)
  }

  return reparto
}

/**
 * Pagarle a un proveedor.
 *
 * Tres cosas que la pantalla dice ANTES de confirmar, y las tres importan:
 *
 *   · si la plata sale del cajon. Efectivo si; transferencia no. Sin esto,
 *     quien cierra el turno no entiende por que la caja no bajo.
 *   · a que obligaciones se imputa. La vista previa del reparto es lo que
 *     convierte "pague 50.000" en "cancele la entrega del 12 y parte de la
 *     del 14".
 *   · si el pago deja SALDO A FAVOR nuestro. El servidor lo rechaza con un 409
 *     si nadie lo confirmo, y este aviso evita que ese rechazo sorprenda.
 *
 * Ver docs/SUPPLIER_PAYMENT_FLOW.md.
 */
export function DialogoPagoProveedor({
  abierto,
  cuenta,
  puedeSobrepagar,
  puedeImputarAMano,
  onCerrar,
  onPagado,
}: {
  abierto: boolean
  cuenta: ResumenDeCuentaDTO
  puedeSobrepagar: boolean
  puedeImputarAMano: boolean
  onCerrar: () => void
  onPagado: () => void
}) {
  const router = useRouter()

  const [importe, setImporte] = useState('')
  const [medio, setMedio] = useState<string>('TRANSFER')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [automatica, setAutomatica] = useState(true)
  const [manual, setManual] = useState<Record<number, string>>({})
  const [deudas, setDeudas] = useState<DeudaDTO[]>([])
  const [cargandoDeudas, setCargandoDeudas] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargarDeudas = useCallback(async () => {
    setCargandoDeudas(true)
    try {
      const pagina = await apiRequest(
        `/api/suppliers/${String(cuenta.supplierId)}/deudas?abiertas=true&pageSize=50`,
        { parse: parsePaginaDeudas },
      )
      setDeudas(pagina.data)
    } catch {
      // Una lista de deudas que no carga NO impide pagar: el saldo sale del
      // libro y el pago lo baja igual. Lo unico que se pierde es la vista
      // previa del reparto, y el servidor imputa lo mismo sin ella.
      setDeudas([])
    } finally {
      setCargandoDeudas(false)
    }
  }, [cuenta.supplierId])

  useEffect(() => {
    if (!abierto) return
    // Se propone lo que se debe, que es lo que pasa la mayoria de las veces.
    // Con credito a favor no se propone nada: no hay nada que pagar.
    setImporte(esPositivo(cuenta.balance) ? cuenta.balance : '')
    setMedio('TRANSFER')
    setReferencia('')
    setNotas('')
    setAutomatica(true)
    setManual({})
    setError(null)
    setEnviando(false)
    void cargarDeudas()
  }, [abierto, cuenta.balance, cargarDeudas])

  const importeOk = /^\d+(\.\d{1,2})?$/.test(importe.trim()) && Number(importe) > 0
  const enEfectivo = medio === 'CASH'
  const importeLimpio: Monto = importeOk ? importe.trim() : CERO

  const reparto = useMemo(
    () => (automatica ? repartoAutomatico(deudas, importeLimpio) : new Map<number, Monto>()),
    [automatica, deudas, importeLimpio],
  )

  /** Lo imputado, venga del reparto automatico o de lo que se escribio a mano. */
  const imputado: Monto = useMemo(() => {
    if (automatica) return sumarMontos(...[...reparto.values()])
    const escritos = Object.values(manual).filter((v) => /^\d+(\.\d{1,2})?$/.test(v.trim()))
    return escritos.length === 0 ? CERO : sumarMontos(...escritos.map((v) => v.trim()))
  }, [automatica, reparto, manual])

  const sinImputar = restarMontos(importeLimpio, imputado)
  const seImputaDeMas = compararMontos(imputado, importeLimpio) > 0

  // Cuanto quedaria a favor NUESTRO. Se calcula aca solo para AVISAR: la
  // decision la toma el servidor dentro de la transaccion, con el saldo real.
  const sobra = importeOk ? restarMontos(importeLimpio, cuenta.balance) : CERO
  const dejaAFavor = importeOk && esPositivo(sobra)
  const saldoResultante = restarMontos(cuenta.balance, importeLimpio)

  const puedeConfirmar =
    importeOk && !seImputaDeMas && (!dejaAFavor || puedeSobrepagar) && !enviando

  async function pagar() {
    if (!puedeConfirmar) return
    setEnviando(true)
    setError(null)
    try {
      const cuerpo = {
        amount: importeLimpio,
        method: medio,
        reference: referencia.trim(),
        notes: notas.trim(),
        // Se manda lo que la pantalla MOSTRO: si el aviso estaba, quien
        // confirmo lo vio. Mandarlo siempre en true convertiria el aviso en un
        // adorno.
        acceptCredit: dejaAFavor,
        ...(automatica
          ? { imputacion: 'automatica' as const }
          : {
              imputacion: 'manual' as const,
              allocations: Object.entries(manual)
                .filter(([, v]) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0)
                .map(([receiptId, v]) => ({ receiptId: Number(receiptId), amount: v.trim() })),
            }),
      }

      const pago = await apiRequest(`/api/suppliers/${String(cuenta.supplierId)}/pagos`, {
        method: 'POST',
        body: cuerpo,
        parse: parsePagoAProveedor,
      })

      aviso.ok(`Pago ${pago.number} registrado`)
      onPagado()
      // Se abre el comprobante: es lo que se archiva junto a la factura.
      router.push(`/comprobantes/proveedor/${String(pago.id)}`)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar el pago.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={`Pagar a ${cuenta.name}`}
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
            disabled={!puedeConfirmar}
            onClick={() => void pagar()}
          >
            Registrar pago
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="No se registró">
            {error}
          </Alert>
        )}

        <div className="grid gap-3 rounded-lg bg-surface-2 p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-faint">Saldo</div>
            <div className="font-medium text-ink" data-numeric="">
              {esPositivo(cuenta.balance) ? (
                <Money amount={cuenta.balance} />
              ) : (
                <span className="text-ink-faint">Sin deuda</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">Vencido</div>
            <div className="font-medium text-ink" data-numeric="">
              {esPositivo(cuenta.vencido) ? (
                <Money amount={cuenta.vencido} tone="out" />
              ) : (
                <span className="text-ink-faint">Nada</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-faint">Saldo resultante</div>
            <div className="font-medium text-ink" data-numeric="">
              <Money amount={saldoResultante} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cuánto se paga"
            required
            error={importe !== '' && !importeOk ? 'Un importe mayor que cero' : null}
          >
            <Input
              value={importe}
              disabled={enviando}
              autoFocus
              inputMode="decimal"
              onChange={(e) => {
                setImporte(e.target.value)
              }}
            />
          </Field>

          <Field label="Medio">
            <Select
              value={medio}
              disabled={enviando}
              onChange={(e) => {
                setMedio(e.target.value)
              }}
            >
              {MEDIOS_DE_PAGO_A_PROVEEDOR.map((m) => (
                <option key={m} value={m}>
                  {etiquetaDeMedio(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/*
          Lo que pasa con la caja, dicho antes y no despues. Una transferencia
          que baja la deuda y no baja el cajon es correcta, pero si nadie lo
          dijo se lee como un error al cerrar el turno.
        */}
        <Alert tone="info">
          {enEfectivo
            ? 'Esta plata sale de la caja y resta del turno abierto.'
            : 'Este pago baja la deuda pero NO sale de la caja: no es efectivo.'}
        </Alert>

        {dejaAFavor && (
          <Alert
            tone={puedeSobrepagar ? 'warning' : 'danger'}
            title={
              puedeSobrepagar ? 'Va a quedar saldo a favor nuestro' : 'Es más de lo que se debe'
            }
          >
            {puedeSobrepagar ? (
              <>
                Este pago deja <Money amount={sobra} /> a favor nuestro con {cuenta.name}. Se va a
                descontar de la próxima entrega.
              </>
            ) : (
              <>
                Se le deben <Money amount={cuenta.balance} /> y el pago es de{' '}
                <Money amount={importeLimpio} />. No tenés permiso para pagar de más.
              </>
            )}
          </Alert>
        )}

        {/* ------------------------------------------------- imputación */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">Aplicación</span>
            {puedeImputarAMano && (
              <Checkbox
                checked={automatica}
                disabled={enviando}
                label="Automática (vencimiento más viejo primero)"
                onChange={(e) => {
                  setAutomatica(e.target.checked)
                }}
              />
            )}
          </div>

          {cargandoDeudas ? (
            <p className="mt-3 text-sm text-ink-muted">Buscando deudas abiertas…</p>
          ) : deudas.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No hay entregas pendientes contra las cuales imputar. El pago se registra igual y
              queda como saldo a favor.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {deudas.map((d) => {
                const auto = reparto.get(d.receiptId)
                return (
                  <li
                    key={d.receiptId}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-ink" data-numeric="">
                        {d.orderNumber} · entrega #{d.receiptId}
                      </div>
                      <div className="text-xs text-ink-faint">
                        Vence {fechaCorta(d.dueDate)} · {etiquetaDeEstadoDeDeuda(d.estado)} ·
                        pendiente <Money amount={d.pendiente} size="sm" />
                      </div>
                    </div>

                    {automatica ? (
                      <span className="text-sm font-medium text-ink" data-numeric="">
                        {auto === undefined ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <Money amount={auto} />
                        )}
                      </span>
                    ) : (
                      <Input
                        className="w-32"
                        value={manual[d.receiptId] ?? ''}
                        disabled={enviando}
                        inputMode="decimal"
                        aria-label={`Imputar a la entrega ${String(d.receiptId)}`}
                        onChange={(e) => {
                          setManual((m) => ({ ...m, [d.receiptId]: e.target.value }))
                        }}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {importeOk && (
            <p className="mt-3 text-xs text-ink-muted">
              Se imputan <Money amount={imputado} size="sm" />
              {esPositivo(sinImputar) && (
                <>
                  {' '}
                  · quedan <Money amount={sinImputar} size="sm" /> sin imputar
                </>
              )}
            </p>
          )}

          {seImputaDeMas && (
            <Alert tone="danger" className="mt-3">
              El reparto suma más que el pago. Bajá alguno de los importes.
            </Alert>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Referencia" hint="Número de operación, últimos dígitos del cupón">
            <Input
              value={referencia}
              disabled={enviando}
              onChange={(e) => {
                setReferencia(e.target.value)
              }}
            />
          </Field>

          <Field label="Notas">
            <Textarea
              value={notas}
              disabled={enviando}
              rows={2}
              onChange={(e) => {
                setNotas(e.target.value)
              }}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
