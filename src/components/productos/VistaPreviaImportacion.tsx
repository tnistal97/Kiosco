'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, MetricCard, Spinner, cn } from '@/components/ui'
import type { AccionDeFila, FilaDeVistaPrevia, VistaPrevia } from '@/modules/importacion/dto'
import { ETIQUETA_DE_ACCION, textoDeCambio } from './importacion-formato'

/** De a cuantas filas se muestra la lista. Diez mil de una vez no se leen. */
const DE_A = 50

type Filtro = AccionDeFila | 'todas'

const FILTROS: ReadonlyArray<{ valor: Filtro; texto: string }> = [
  { valor: 'error', texto: 'Con error' },
  { valor: 'crear', texto: 'Nuevos' },
  { valor: 'actualizar', texto: 'Se actualizan' },
  { valor: 'sin-cambios', texto: 'Sin cambios' },
  { valor: 'omitir', texto: 'Se omiten' },
  { valor: 'todas', texto: 'Todas' },
]

function numero(n: number): string {
  return n.toLocaleString('es-AR')
}

function cuantas(vista: VistaPrevia, filtro: Filtro): number {
  const t = vista.totales
  switch (filtro) {
    case 'error':
      return t.conErrores
    case 'crear':
      return t.crear
    case 'actualizar':
      return t.actualizar
    case 'sin-cambios':
      return t.sinCambios
    case 'omitir':
      return t.omitir
    case 'todas':
      return t.filas
  }
}

/**
 * "En el archivo hay 4 filas: 2 productos nuevos, 1 ya en el catálogo y 1 con
 * errores." Sin concordancias rotas: cada parte lleva su propio numero.
 */
function composicion(t: VistaPrevia['totales']): string {
  const partes = [
    `${numero(t.nuevos)} ${t.nuevos === 1 ? 'producto nuevo' : 'productos nuevos'}`,
    `${numero(t.existentes)} ya en el catálogo`,
    ...(t.conErrores > 0 ? [`${numero(t.conErrores)} con errores`] : []),
  ]
  const ultima = partes.pop() ?? ''
  const filas = `${numero(t.filas)} ${t.filas === 1 ? 'fila' : 'filas'}`
  return `En el archivo hay ${filas}: ${partes.join(', ')} y ${ultima}.`
}

/** La primera pestaña que tiene algo: primero lo que hay que mirar. */
function filtroInicial(vista: VistaPrevia): Filtro {
  return FILTROS.find((f) => f.valor !== 'todas' && cuantas(vista, f.valor) > 0)?.valor ?? 'todas'
}

/**
 * El resumen y la lista de filas de la vista previa.
 *
 * Lo que se ve primero son los numeros --cuantos nuevos, cuantos cambian,
 * cuantos con error--, y despues las filas de a cincuenta, arrancando por las
 * que tienen error: son las que hay que resolver antes de confirmar.
 */
export function VistaPreviaImportacion({
  vista,
  revisando,
}: {
  vista: VistaPrevia
  revisando: boolean
}) {
  const [filtro, setFiltro] = useState<Filtro>(() => filtroInicial(vista))
  const [visibles, setVisibles] = useState(DE_A)

  const filas = useMemo(
    () => (filtro === 'todas' ? vista.filas : vista.filas.filter((f) => f.accion === filtro)),
    [vista, filtro],
  )

  const t = vista.totales

  return (
    <div
      className={cn('mt-4 flex flex-col gap-4', revisando && 'opacity-60')}
      aria-busy={revisando}
    >
      {revisando && (
        <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
          <Spinner /> Actualizando la vista previa…
        </p>
      )}

      <p className="text-sm text-ink-muted">{composicion(t)}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Se agregan" value={numero(t.crear)} tone="success" />
        <MetricCard label="Se actualizan" value={numero(t.actualizar)} />
        <MetricCard label="Sin cambios" value={numero(t.sinCambios)} />
        <MetricCard label="Se omiten" value={numero(t.omitir)} />
        <MetricCard
          label="Con errores"
          value={numero(t.conErrores)}
          tone={t.conErrores > 0 ? 'danger' : 'neutral'}
          detail={t.conErrores > 0 ? 'No se importan' : undefined}
        />
      </div>

      {(vista.categoriasNuevas.length > 0 || t.conStock > 0) && (
        <ul className="flex flex-col gap-1 text-sm text-ink">
          {vista.categoriasNuevas.length > 0 && (
            <li>
              Categorías nuevas que se crean: {vista.categoriasNuevas.slice(0, 12).join(', ')}
              {vista.categoriasNuevas.length > 12 &&
                ` y ${numero(vista.categoriasNuevas.length - 12)} más`}
              .
            </li>
          )}
          {t.conStock > 0 && (
            <li>El stock cambia en {numero(t.conStock)} productos, siempre con su movimiento.</li>
          )}
        </ul>
      )}

      <div role="group" aria-label="Qué filas mostrar" className="flex flex-wrap gap-2">
        {FILTROS.map((f) => {
          const n = cuantas(vista, f.valor)
          const activo = filtro === f.valor
          return (
            <Button
              key={f.valor}
              size="sm"
              variant={activo ? 'primary' : 'secondary'}
              aria-pressed={activo}
              disabled={n === 0 && f.valor !== 'todas'}
              onClick={() => {
                setFiltro(f.valor)
                setVisibles(DE_A)
              }}
            >
              {f.texto} ({numero(n)})
            </Button>
          )
        })}
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {filas.slice(0, visibles).map((f) => (
          <FilaDeLaVista key={f.fila} fila={f} />
        ))}
        {filas.length === 0 && (
          <li className="p-3 text-sm text-ink-muted">No hay filas de este tipo.</li>
        )}
      </ul>

      {filas.length > visibles && (
        <Button
          variant="secondary"
          onClick={() => {
            setVisibles((v) => v + DE_A)
          }}
        >
          Mostrar {numero(Math.min(DE_A, filas.length - visibles))} más (quedan{' '}
          {numero(filas.length - visibles)})
        </Button>
      )}
    </div>
  )
}

function FilaDeLaVista({ fila }: { fila: FilaDeVistaPrevia }) {
  const accion = ETIQUETA_DE_ACCION[fila.accion]
  // En un alta el nombre y el codigo ya estan en el titulo de la fila.
  const cambios =
    fila.accion === 'crear'
      ? fila.cambios.filter((c) => c.campo !== 'nombre' && c.campo !== 'codigo')
      : fila.cambios
  return (
    <li className="flex flex-col gap-1 p-3 sm:flex-row sm:gap-4">
      <div className="flex shrink-0 items-center gap-2 sm:w-40 sm:flex-col sm:items-start">
        <span className="text-xs text-ink-faint">Fila {fila.fila}</span>
        <Badge tone={accion.tono}>{accion.texto}</Badge>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {fila.nombre === '' ? 'Sin nombre' : fila.nombre}
          {fila.codigo !== null && (
            <span className="ml-2 font-normal text-ink-faint">{fila.codigo}</span>
          )}
        </p>
        {cambios.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-muted">
            {cambios.map((c) => (
              <li key={c.campo}>{textoDeCambio(c, fila.unidad)}</li>
            ))}
          </ul>
        )}
        {fila.errores.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-danger">
            {fila.errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {fila.avisos.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-warning">
            {fila.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        {fila.motivo !== null && <p className="mt-1 text-sm text-ink-faint">{fila.motivo}</p>}
      </div>
    </li>
  )
}
