'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  Field,
  Input,
  Select,
  Spinner,
  aviso,
  cn,
} from '@/components/ui'
import { ApiError, apiRequest, mensajeDeError } from '@/lib/api-client'
import { aCentavos, formatearMonto } from '@/lib/money'
import { REGLAS_DE_DINERO, leerNumeroLocal, mensajeDeNumeroInvalido } from '@/lib/numero-local'
import { parseCategorias, type CategoriaDTO } from '@/modules/products/dto'
import { parsePaginaProveedores, type ProveedorDTO } from '@/modules/suppliers/dto'
import {
  NOMBRE_DE_OPERACION,
  NOMBRE_DE_REDONDEO,
  OPERACIONES,
  REDONDEOS,
  describirCriterio,
  esPorcentaje,
  motivoDeCriterioInvalido,
  type CriterioDePrecio,
  type Operacion,
  type Redondeo,
} from '@/modules/products/precios'
import {
  parseResultadoDeDeshacer,
  parseResultadoDePrecios,
  parseUltimoCambioMasivo,
  parseVistaDePrecios,
  type ItemDePrecio,
  type ResultadoDeDeshacer,
  type UltimoCambioMasivo,
  type VistaDePrecios,
} from '@/modules/products/precios-dto'

/**
 * Productos → Cambiar precios. Fase P0-B.
 *
 *   que productos → que cambio → vista previa → confirmar → aplicar
 *
 * Nada cambia hasta confirmar. La vista previa muestra "antes → despues" de
 * cada producto y deja destildar los que no van; el servidor recalcula al
 * aplicar y se niega si algo cambio en el medio. El ultimo cambio masivo se
 * puede deshacer mientras nadie haya vuelto a tocar esos precios.
 */

/** Porcentaje: dos decimales y el punto es decimal, "10.5" es diez y medio. */
const REGLAS_DE_PORCENTAJE = { decimales: 2, puntoEsMiles: false, negativos: false }

/** De a cuantos productos se lista. */
const DE_A = 100

function numero(n: number): string {
  return n.toLocaleString('es-AR')
}

/** Para mostrar: "+10,3 %". En centavos enteros, como todo el dinero. */
function variacionDe(item: ItemDePrecio): string {
  if (item.despues === null) return ''
  const antes = aCentavos(item.antes)
  if (antes === 0) return ''
  const pct = ((aCentavos(item.despues) - antes) / antes) * 100
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CambioMasivoDePrecios() {
  const [categorias, setCategorias] = useState<CategoriaDTO[]>([])
  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])

  const [categoriaId, setCategoriaId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [incluirInactivos, setIncluirInactivos] = useState(false)

  const [operacion, setOperacion] = useState<Operacion>('aumentar')
  const [valorTexto, setValorTexto] = useState('')
  const [redondeo, setRedondeo] = useState<Redondeo>('ninguno')

  const [vista, setVista] = useState<VistaDePrecios | null>(null)
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set())
  const [visibles, setVisibles] = useState(DE_A)
  const [calculando, setCalculando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  const [ultimo, setUltimo] = useState<UltimoCambioMasivo | null>(null)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [deshecho, setDeshecho] = useState<ResultadoDeDeshacer | null>(null)

  const cargarUltimo = useCallback(() => {
    apiRequest('/api/products/prices/last', { parse: parseUltimoCambioMasivo })
      .then(setUltimo)
      .catch(() => {
        setUltimo(null)
      })
  }, [])

  useEffect(() => {
    apiRequest('/api/categories', { parse: parseCategorias })
      .then(setCategorias)
      .catch(() => {
        setCategorias([])
      })
    apiRequest('/api/suppliers?activos=true&pageSize=100', { parse: parsePaginaProveedores })
      .then((p) => {
        setProveedores(p.data)
      })
      .catch(() => {
        setProveedores([])
      })
    cargarUltimo()
  }, [cargarUltimo])

  // El valor escrito, leido con las reglas de siempre.
  const lectura = useMemo(
    () =>
      leerNumeroLocal(
        valorTexto,
        esPorcentaje(operacion) ? REGLAS_DE_PORCENTAJE : { ...REGLAS_DE_DINERO, negativos: false },
      ),
    [valorTexto, operacion],
  )
  const criterio: CriterioDePrecio | null =
    lectura.estado === 'ok' ? { operacion, valor: lectura.valor, redondeo } : null
  const problemaDelCriterio =
    lectura.estado === 'invalido'
      ? mensajeDeNumeroInvalido(lectura.motivo, 'importe')
      : criterio
        ? motivoDeCriterioInvalido(criterio)
        : null

  const seleccion = useMemo(
    () => ({
      ...(categoriaId === '' ? {} : { categoriaId: Number(categoriaId) }),
      ...(proveedorId === '' ? {} : { proveedorId: Number(proveedorId) }),
      ...(busqueda.trim() === '' ? {} : { busqueda: busqueda.trim() }),
      incluirInactivos,
    }),
    [categoriaId, proveedorId, busqueda, incluirInactivos],
  )

  /** Cualquier cambio de seleccion o de criterio vuelve la vista previa vieja. */
  function tocar<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      set(v)
      setVista(null)
      setHecho(null)
    }
  }

  async function calcular() {
    if (!criterio || problemaDelCriterio !== null) return
    setCalculando(true)
    setError(null)
    setHecho(null)
    try {
      const v = await apiRequest('/api/products/prices/preview', {
        method: 'POST',
        body: { seleccion, criterio },
        parse: parseVistaDePrecios,
      })
      setVista(v)
      setExcluidos(new Set())
      setVisibles(DE_A)
    } catch (e) {
      setVista(null)
      setError(mensajeDeError(e, 'No se pudo calcular.'))
    } finally {
      setCalculando(false)
    }
  }

  async function aplicar() {
    if (!vista || !criterio) return
    try {
      const r = await apiRequest('/api/products/prices', {
        method: 'POST',
        body: { seleccion, criterio, huella: vista.huella, excluidos: [...excluidos] },
        parse: parseResultadoDePrecios,
      })
      setConfirmando(false)
      setVista(null)
      setHecho(`Listo: se cambió el precio de ${numero(r.cambiados)} productos (${r.descripcion}).`)
      aviso.ok('Precios actualizados.')
      cargarUltimo()
    } catch (e) {
      setConfirmando(false)
      if (e instanceof ApiError && e.code === 'PRICES_CHANGED') {
        setError(e.message)
        void calcular()
        return
      }
      setError(mensajeDeError(e, 'No se pudieron cambiar los precios.'))
    }
  }

  async function deshacerUltimo() {
    if (!ultimo) return
    try {
      const r = await apiRequest('/api/products/prices/undo', {
        method: 'POST',
        body: { operacion: ultimo.operacion },
        parse: parseResultadoDeDeshacer,
      })
      setDeshaciendo(false)
      setDeshecho(r)
      setVista(null)
      aviso.ok('Cambio deshecho.')
      cargarUltimo()
    } catch (e) {
      setDeshaciendo(false)
      aviso.error(mensajeDeError(e, 'No se pudo deshacer.'))
      cargarUltimo()
    }
  }

  const cambian = vista ? vista.items.filter((i) => i.estado === 'cambia') : []
  const otros = vista ? vista.items.filter((i) => i.estado !== 'cambia') : []
  const aAplicar = cambian.filter((i) => !excluidos.has(i.id)).length

  function alternar(id: number, marcado: boolean) {
    setExcluidos((actual) => {
      const nuevo = new Set(actual)
      if (marcado) nuevo.delete(id)
      else nuevo.add(id)
      return nuevo
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {ultimo && (
        <Card className="p-4">
          <CardHeader
            title="Último cambio masivo"
            description={`${ultimo.descripcion} · ${numero(ultimo.productos)} productos · ${fechaHora(ultimo.fecha)} · ${ultimo.usuario}`}
            actions={
              ultimo.deshacible ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeshaciendo(true)
                  }}
                >
                  Deshacer
                </Button>
              ) : undefined
            }
          />
          {!ultimo.deshacible && <p className="mt-1 text-sm text-ink-faint">Ya se deshizo.</p>}
          {deshecho && (
            <Alert tone="success" className="mt-3" title="Cambio deshecho">
              Se devolvieron {numero(deshecho.restaurados)} precios a como estaban.
              {deshecho.totalSaltados > 0 && (
                <>
                  {' '}
                  {numero(deshecho.totalSaltados)} no se tocaron porque alguien los cambió después:
                  <ul className="mt-1 list-disc pl-5">
                    {deshecho.saltados.map((s) => (
                      <li key={s.nombre}>
                        {s.nombre}: {s.motivo}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Alert>
          )}
        </Card>
      )}

      <Card className="p-4">
        <CardHeader
          title="1. ¿Qué productos?"
          description="Se combinan: categoría, proveedor y búsqueda."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Categoría">
            <Select
              value={categoriaId}
              onChange={(e) => {
                tocar(setCategoriaId)(e.target.value)
              }}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proveedor">
            <Select
              value={proveedorId}
              onChange={(e) => {
                tocar(setProveedorId)(e.target.value)
              }}
            >
              <option value="">Todos</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nombre o código">
            <Input
              value={busqueda}
              placeholder="Opcional"
              onChange={(e) => {
                tocar(setBusqueda)(e.target.value)
              }}
            />
          </Field>
        </div>
        <Checkbox
          className="mt-2"
          label="Incluir los productos dados de baja"
          checked={incluirInactivos}
          onChange={(e) => {
            tocar(setIncluirInactivos)(e.target.checked)
          }}
        />
      </Card>

      <Card className="p-4">
        <CardHeader title="2. ¿Qué cambio?" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Cambio">
            <Select
              value={operacion}
              onChange={(e) => {
                tocar(setOperacion)(e.target.value as Operacion)
              }}
            >
              {OPERACIONES.map((o) => (
                <option key={o} value={o}>
                  {NOMBRE_DE_OPERACION[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={esPorcentaje(operacion) ? 'Porcentaje (%)' : 'Monto ($)'}
            error={valorTexto.trim() === '' ? null : problemaDelCriterio}
          >
            <Input
              inputMode="decimal"
              value={valorTexto}
              placeholder={esPorcentaje(operacion) ? '10' : '1.500'}
              onChange={(e) => {
                tocar(setValorTexto)(e.target.value)
              }}
            />
          </Field>
          <Field
            label="Redondeo"
            hint={
              operacion === 'fijar'
                ? 'Un precio fijo queda como lo escribiste.'
                : 'Si el precio sube, redondea para arriba; si baja, para abajo.'
            }
          >
            <Select
              value={operacion === 'fijar' ? 'ninguno' : redondeo}
              disabled={operacion === 'fijar'}
              onChange={(e) => {
                tocar(setRedondeo)(e.target.value as Redondeo)
              }}
            >
              {REDONDEOS.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_DE_REDONDEO[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="primary"
            disabled={!criterio || problemaDelCriterio !== null || calculando}
            onClick={() => {
              void calcular()
            }}
          >
            Ver cómo quedan
          </Button>
          {calculando && (
            <span className="flex items-center gap-2 text-sm text-ink-muted" role="status">
              <Spinner /> Calculando…
            </span>
          )}
          {criterio && problemaDelCriterio === null && (
            <span className="text-sm text-ink-muted">{describirCriterio(criterio)}</span>
          )}
        </div>
        {error && (
          <Alert tone="danger" className="mt-3" title="No se aplicó">
            {error}
          </Alert>
        )}
        {hecho && (
          <Alert tone="success" className="mt-3">
            {hecho}
          </Alert>
        )}
      </Card>

      {vista && (
        <Card className="p-4">
          <CardHeader title="3. Así quedan" description="Todavía no cambió nada." />
          <Resumen vista={vista} />

          {cambian.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setExcluidos(new Set())
                }}
              >
                Marcar todos
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setExcluidos(new Set(cambian.map((i) => i.id)))
                }}
              >
                Desmarcar todos
              </Button>
            </div>
          )}

          <ul className="mt-3 flex flex-col divide-y divide-line rounded-lg border border-line">
            {cambian.slice(0, visibles).map((i) => (
              <li key={i.id} className={cn('p-3', excluidos.has(i.id) && 'opacity-60')}>
                <Checkbox
                  checked={!excluidos.has(i.id)}
                  onChange={(e) => {
                    alternar(i.id, e.target.checked)
                  }}
                  label={
                    <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                      <span className="font-medium">{i.nombre}</span>
                      <span className="text-xs text-ink-faint">
                        {i.categoria}
                        {i.codigo !== null && ` · ${i.codigo}`}
                        {!i.activo && ' · dado de baja'}
                      </span>
                    </span>
                  }
                  description={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {formatearMonto(i.antes)} →{' '}
                        <strong>{i.despues === null ? '' : formatearMonto(i.despues)}</strong> (
                        {variacionDe(i)})
                      </span>
                      {i.bajoCosto && <Badge tone="warning">Queda por debajo del costo</Badge>}
                    </span>
                  }
                />
              </li>
            ))}
            {cambian.length === 0 && (
              <li className="p-3 text-sm text-ink-muted">
                Ningún precio cambia con este criterio.
              </li>
            )}
          </ul>
          {cambian.length > visibles && (
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => {
                setVisibles((v) => v + DE_A)
              }}
            >
              Mostrar más (quedan {numero(cambian.length - visibles)})
            </Button>
          )}

          {otros.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-muted">
                {numero(otros.length)} productos no cambian
              </summary>
              <ul className="mt-2 flex flex-col gap-1 pl-4">
                {otros.slice(0, 200).map((i) => (
                  <li key={i.id}>
                    {i.nombre}: {i.estado === 'igual' ? 'queda igual.' : i.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="primary"
              disabled={aAplicar === 0}
              onClick={() => {
                setConfirmando(true)
              }}
            >
              {aAplicar > 0
                ? `Aplicar a ${numero(aAplicar)} productos`
                : 'No hay precios para cambiar'}
            </Button>
            <Link href="/productos" className="text-sm text-ink-muted hover:text-ink sm:ml-auto">
              Cancelar
            </Link>
          </div>
        </Card>
      )}

      <ConfirmationDialog
        open={confirmando}
        onClose={() => {
          setConfirmando(false)
        }}
        onConfirm={aplicar}
        variant="primary"
        title="¿Cambiamos los precios?"
        confirmLabel="Sí, cambiar"
        message={
          vista ? (
            <span className="flex flex-col gap-2">
              <span>
                Se cambia el precio de <strong>{numero(aAplicar)}</strong> productos:{' '}
                {vista.descripcion}.
              </span>
              <span className="text-ink-muted">
                Queda en la auditoría y en el historial de cada producto. Se puede deshacer mientras
                nadie los vuelva a cambiar.
              </span>
            </span>
          ) : null
        }
      />

      <ConfirmationDialog
        open={deshaciendo}
        onClose={() => {
          setDeshaciendo(false)
        }}
        onConfirm={deshacerUltimo}
        variant="danger"
        title="¿Deshacemos el último cambio?"
        confirmLabel="Sí, deshacer"
        message={
          ultimo ? (
            <span className="flex flex-col gap-2">
              <span>
                Los {numero(ultimo.productos)} productos de «{ultimo.descripcion}» vuelven a su
                precio anterior.
              </span>
              <span className="text-ink-muted">
                Los que alguien haya cambiado después no se tocan.
              </span>
            </span>
          ) : null
        }
      />
    </div>
  )
}

function Resumen({ vista }: { vista: VistaDePrecios }) {
  const r = vista.resumen
  const variacion =
    r.variacion === null
      ? null
      : `${r.variacion.startsWith('-') ? '' : '+'}${r.variacion.replace('.', ',')} %`
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm text-ink">
      <p>
        <strong>{vista.descripcion}.</strong> Cambian <strong>{numero(r.cambian)}</strong> de{' '}
        {numero(r.productos)} productos.
      </p>
      {r.minimo !== null && r.maximo !== null && (
        <p className="text-ink-muted">
          El más barato queda en {formatearMonto(r.minimo)} y el más caro en{' '}
          {formatearMonto(r.maximo)}
          {variacion && <>; en total, {variacion}</>}.
        </p>
      )}
      {r.noAplican > 0 && (
        <p className="text-warning">
          {numero(r.noAplican)} no se pueden cambiar con este criterio (ver abajo).
        </p>
      )}
    </div>
  )
}
