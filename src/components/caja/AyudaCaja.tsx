'use client'

import { useState, type ReactNode } from 'react'
import { Button, Dialog, Money } from '@/components/ui'
import { esPositivo, type Monto } from '@/lib/money'

/**
 * "Cómo funciona" la caja. UX V5.
 *
 * Cinco preguntas, con las palabras del mostrador y sin vocabulario contable:
 * que es abrir, cuando, que es cerrar, que revisar antes y que pasa si no
 * cuadra. Lo que dice sale de las reglas reales del sistema --si se puede
 * vender sin caja, el limite de diferencia del local--, no de un texto fijo.
 */
export function AyudaCaja({
  requiereTurno,
  umbralDiferencia,
}: {
  /** Si el local exige la caja abierta para cobrar. */
  requiereTurno: boolean
  /** Diferencia a partir de la cual un encargado tiene que autorizar el cierre. */
  umbralDiferencia: Monto
}) {
  const [abierta, setAbierta] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        data-ayuda-caja=""
        onClick={() => {
          setAbierta(true)
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs font-bold"
        >
          ?
        </span>
        Cómo funciona
      </Button>

      <Dialog
        open={abierta}
        onClose={() => {
          setAbierta(false)
        }}
        title="Cómo funciona la caja"
        description="La caja lleva la cuenta de la plata que tiene que haber en el cajón."
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                setAbierta(false)
              }}
            >
              Entendido
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5 text-base text-ink">
          <Pregunta titulo="¿Qué es abrir la caja?">
            <p>
              Es contar la plata que hay en el cajón al empezar y anotarla. Ese es el{' '}
              <strong>monto inicial</strong>. Desde ahí, el sistema suma cada venta en efectivo y
              cada ingreso, y resta cada egreso.
            </p>
          </Pregunta>

          <Pregunta titulo="¿Cuándo hay que abrirla?">
            <p>
              Al empezar el día o el turno, antes de la primera venta. Si cambia la persona que
              atiende, lo mejor es que una cierre y la otra abra con su propio conteo.
            </p>
            <p className="mt-1 text-ink-muted">
              {requiereTurno
                ? 'En este local no se puede cobrar con la caja cerrada.'
                : 'En este local se puede vender con la caja cerrada, pero entonces no hay contra qué comparar al contar.'}
            </p>
          </Pregunta>

          <Pregunta titulo="¿Qué es cerrar la caja?">
            <p>
              Es contar el efectivo al terminar y compararlo con lo que{' '}
              <strong>tiene que haber</strong> (el saldo esperado). Una caja cerrada queda guardada
              con su conteo y ya no se modifica.
            </p>
          </Pregunta>

          <Pregunta titulo="¿Qué revisar antes de cerrar?">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>Que no quede ninguna venta a medio cobrar.</li>
              <li>
                Que estén anotados los ingresos y egresos del día: cambio que se trajo, pagos a
                proveedores, retiros.
              </li>
              <li>
                Contá solo el <strong>efectivo</strong>. Transferencias, Mercado Pago y tarjetas no
                están en el cajón.
              </li>
              <li>Contá billetes y monedas con calma, mejor dos veces.</li>
            </ul>
          </Pregunta>

          <Pregunta titulo="¿Y si hay diferencia?">
            <p>
              Si contaste menos de lo esperado, <strong>falta</strong> plata; si contaste más,{' '}
              <strong>sobra</strong>. Volvé a contar y fijate si quedó algún ingreso o egreso sin
              anotar.
            </p>
            <p className="mt-1">
              Si la diferencia sigue, cerrá igual y escribí en la observación qué pasó: queda
              registrada con tu nombre y se ve en Reportes.
              {esPositivo(umbralDiferencia) && (
                <>
                  {' '}
                  Si es mayor a <Money amount={umbralDiferencia} size="sm" />, un encargado tiene
                  que autorizar el cierre.
                </>
              )}
            </p>
          </Pregunta>
        </div>
      </Dialog>
    </>
  )
}

function Pregunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-base font-semibold text-ink">{titulo}</h3>
      {children}
    </section>
  )
}
