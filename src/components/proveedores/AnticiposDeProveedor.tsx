'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  Money,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { CERO, esPositivo, sumarMontos, type Monto } from '@/lib/money'
import {
  parsePaginaAnticipos,
  type AnticipoDTO,
  type PaginaAnticipos,
} from '@/modules/purchases/dto.returns'
import { parsePaginaDeudas, type DeudaDTO } from '@/modules/suppliers/dto.cuenta'

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * Los pagos con saldo sin imputar, y el diálogo para aplicarlos. Objetivo 5.
 *
 * "Anticipo" es el nombre corriente, pero la lista no distingue: un pago que se
 * hizo como anticipo y uno que sobró después de cubrir todo lo pendiente son la
 * misma cosa --plata entregada sin aplicar-- y se imputan igual.
 *
 * IMPUTAR NO MUEVE EL SALDO del proveedor, y el diálogo lo dice: el saldo bajó
 * cuando se entregó la plata. Lo que cambia es qué entrega figura como saldada.
 */
export function AnticiposDeProveedor({
  supplierId,
  puedeImputar,
  onImputado,
}: {
  supplierId: number
  puedeImputar: boolean
  onImputado: () => void
}) {
  const [pagina, setPagina] = useState<PaginaAnticipos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<AnticipoDTO | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setPagina(
        await apiRequest(`/api/suppliers/${String(supplierId)}/anticipos?pageSize=25`, {
          parse: parsePaginaAnticipos,
        }),
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los anticipos.'))
    } finally {
      setCargando(false)
    }
  }, [supplierId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const anticipos = pagina?.data ?? []
  const disponible = anticipos.reduce((t, a) => sumarMontos(t, a.unallocatedAmount), CERO)

  return (
    <Card className="p-4">
      <CardHeader
        title="Pagos sin imputar"
        description="Plata ya entregada que todavía no se aplicó a ninguna entrega"
      />

      {cargando && pagina === null ? (
        <SkeletonRows rows={3} />
      ) : error !== null ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : anticipos.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="No hay anticipos"
          description="Todo lo que se le pagó está aplicado a entregas concretas."
        />
      ) : (
        <>
          <Alert tone="info" className="mt-3">
            Hay <Money amount={disponible} /> disponibles. Imputarlos{' '}
            <strong>no cambia el saldo</strong>: la plata ya se entregó. Lo que cambia es qué
            entrega figura como saldada.
          </Alert>

          <TableWrap className="mt-3">
            <Table>
              <THead>
                <TR>
                  <TH>Comprobante</TH>
                  <TH>Fecha</TH>
                  <TH className="text-right">Importe</TH>
                  <TH className="text-right">Ya imputado</TH>
                  <TH className="text-right">Disponible</TH>
                  {puedeImputar && <TH className="sr-only">Acciones</TH>}
                </TR>
              </THead>
              <TBody>
                {anticipos.map((a) => (
                  <TR key={a.paymentId}>
                    <TD>
                      <Link
                        href={`/comprobantes/proveedor/${String(a.paymentId)}`}
                        className="font-medium text-ink hover:text-primary"
                        data-numeric=""
                      >
                        {a.number}
                      </Link>
                      <div className="text-xs text-ink-faint">{a.methodLabel}</div>
                    </TD>
                    <TD className="text-ink-muted" data-numeric="">
                      {fechaCorta(a.paidAt)}
                    </TD>
                    <TD className="text-right">
                      <Money amount={a.amount} />
                    </TD>
                    <TD className="text-right">
                      <Money amount={a.allocatedAmount} />
                    </TD>
                    <TD className="text-right">
                      <Badge tone="primary">
                        <Money amount={a.unallocatedAmount} />
                      </Badge>
                    </TD>
                    {puedeImputar && (
                      <TD className="text-right">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setElegido(a)
                          }}
                        >
                          Imputar
                        </Button>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </>
      )}

      {elegido !== null && (
        <DialogoImputacion
          supplierId={supplierId}
          pago={elegido}
          onCerrar={() => {
            setElegido(null)
          }}
          onImputado={() => {
            setElegido(null)
            void cargar()
            onImputado()
          }}
        />
      )}
    </Card>
  )
}

/**
 * Repartir un pago entre obligaciones abiertas.
 *
 * Propone el FIFO --lo que le falta a cada entrega, de la mas urgente hacia
 * abajo, hasta agotar el disponible-- y deja cambiarlo. La propuesta es una
 * comodidad, no una decision: el servidor revalida todo dentro de la
 * transaccion y bajo bloqueo, asi que lo que se ve aca puede haber cambiado.
 */
function DialogoImputacion({
  supplierId,
  pago,
  onCerrar,
  onImputado,
}: {
  supplierId: number
  pago: AnticipoDTO
  onCerrar: () => void
  onImputado: () => void
}) {
  const [deudas, setDeudas] = useState<DeudaDTO[]>([])
  const [importes, setImportes] = useState<Record<number, string>>({})
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void apiRequest(`/api/suppliers/${String(supplierId)}/deudas?abiertas=true&pageSize=50`, {
      parse: parsePaginaDeudas,
    })
      .then((lista) => {
        if (!vivo) return
        setDeudas(lista.data)

        // La propuesta FIFO: a cada obligacion, lo menor entre lo que le falta y
        // lo que queda del pago. La lista ya viene en orden de vencimiento.
        let resto = Number(pago.unallocatedAmount)
        const propuesta: Record<number, string> = {}
        for (const d of lista.data) {
          if (resto <= 0) break
          const cuanto = Math.min(resto, Number(d.pendiente))
          if (cuanto <= 0) continue
          propuesta[d.receiptId] = cuanto.toFixed(2)
          resto -= cuanto
        }
        setImportes(propuesta)
        setCargando(false)
      })
      .catch((err: unknown) => {
        if (!vivo) return
        setError(mensajeDeError(err, 'No se pudieron cargar las deudas.'))
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [supplierId, pago.unallocatedAmount])

  const elegidas = deudas
    .map((d) => ({ deuda: d, importe: (importes[d.receiptId] ?? '').trim() }))
    .filter((x) => x.importe !== '' && Number(x.importe) > 0)

  const total: Monto = elegidas.reduce((t, x) => sumarMontos(t, x.importe), CERO)

  const seExcede = Number(total) > Number(pago.unallocatedAmount)
  const excedeAlguna = elegidas.find((x) => Number(x.importe) > Number(x.deuda.pendiente))
  const puedeGuardar = elegidas.length > 0 && !seExcede && excedeAlguna === undefined && !enviando

  async function guardar() {
    if (!puedeGuardar) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest(
        `/api/suppliers/${String(supplierId)}/pagos/${String(pago.paymentId)}/imputar`,
        {
          method: 'POST',
          body: {
            allocations: elegidas.map((x) => ({
              receiptId: x.deuda.receiptId,
              amount: x.importe,
            })),
          },
          parse: () => null,
        },
      )
      aviso.ok(`${pago.number} imputado`)
      onImputado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo imputar.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onCerrar}
      title={`Imputar ${pago.number}`}
      description={`Disponible: ${pago.unallocatedAmount}`}
      dismissible={!enviando}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!puedeGuardar}
            onClick={() => void guardar()}
          >
            Imputar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null && (
          <Alert tone="danger" title="No se imputó">
            {error}
          </Alert>
        )}

        <Alert tone="info">
          El saldo del proveedor <strong>no cambia</strong>: bajó cuando se entregó la plata. Esto
          solo dice a qué entrega se aplica.
        </Alert>

        {cargando ? (
          <SkeletonRows rows={3} />
        ) : deudas.length === 0 ? (
          <EmptyState
            title="No hay entregas abiertas"
            description="Este anticipo se va a poder imputar cuando llegue mercadería."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Entrega</TH>
                  <TH>Vence</TH>
                  <TH className="text-right">Pendiente</TH>
                  <TH className="text-right">Imputar</TH>
                </TR>
              </THead>
              <TBody>
                {deudas.map((d) => (
                  <TR key={d.receiptId}>
                    <TD>
                      <span className="font-medium text-ink" data-numeric="">
                        {d.orderNumber}
                      </span>
                      <span className="ml-1 text-xs text-ink-faint" data-numeric="">
                        entrega #{d.receiptId}
                      </span>
                      {esPositivo(d.devuelto) && (
                        <div className="text-xs text-ink-muted">
                          <Money amount={d.devuelto} /> devueltos
                        </div>
                      )}
                    </TD>
                    <TD className="text-ink-muted" data-numeric="">
                      {d.dueDate === null ? 'Sin fecha' : fechaCorta(d.dueDate)}
                    </TD>
                    <TD className="text-right">
                      <Money amount={d.pendiente} />
                    </TD>
                    <TD className="text-right">
                      <Field label={`Importe para ${d.orderNumber}`} labelHidden>
                        <Input
                          value={importes[d.receiptId] ?? ''}
                          inputMode="decimal"
                          className="w-28 text-right"
                          disabled={enviando}
                          onChange={(e) => {
                            setImportes((prev) => ({ ...prev, [d.receiptId]: e.target.value }))
                          }}
                        />
                      </Field>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}

        {seExcede && (
          <Alert tone="warning">
            El reparto suma <Money amount={total} /> y al pago le quedan{' '}
            <Money amount={pago.unallocatedAmount} />.
          </Alert>
        )}
        {excedeAlguna !== undefined && (
          <Alert tone="warning">
            A la entrega #{excedeAlguna.deuda.receiptId} le faltan{' '}
            <Money amount={excedeAlguna.deuda.pendiente} />.
          </Alert>
        )}

        <div className="flex justify-between rounded-lg bg-surface-2 p-3">
          <span className="text-ink-muted">A imputar</span>
          <span className="text-lg font-semibold text-ink" data-numeric="">
            <Money amount={total} />
          </span>
        </div>
      </div>
    </Dialog>
  )
}
