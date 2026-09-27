'use client'

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  Field,
  RadioGroup,
  Select,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
  aviso,
} from '@/components/ui'
import { ApiError, NetworkError, apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  leerPlanilla,
  textoDeCelda,
  TAMANO_MAXIMO,
  type Planilla,
} from '@/modules/importacion/planilla'
import { ErrorDePlanilla } from '@/modules/importacion/errores'
import {
  CAMPOS,
  ETIQUETA_DE_CAMPO,
  datosAEnviar,
  detectarEncabezado,
  encabezadosDe,
  letraDeColumna,
  mapeoVacio,
  sugerirMapeo,
  type Campo,
  type Mapeo,
} from '@/modules/importacion/columnas'
import type { Modo, ModoDeStock } from '@/modules/importacion/schemas'
import {
  parseResultadoDeImportacion,
  parseVistaPrevia,
  type ResultadoDeImportacion,
  type VistaPrevia,
} from '@/modules/importacion/dto'
import { VistaPreviaImportacion } from './VistaPreviaImportacion'
import { csvDeFilasConError } from './importacion-formato'

/**
 * Productos → Importar. Fase P0-B.
 *
 * Cuatro pasos, y ninguno escribe nada hasta el ultimo:
 *
 *   1. elegir el archivo      se lee ACA, en el navegador: no viaja entero
 *   2. revisar las columnas   el mapeo automatico, corregible
 *   3. vista previa           lo que el servidor dice que va a pasar, fila por
 *                             fila, con las opciones de existentes y de stock
 *   4. confirmar e importar   todo o nada
 *
 * El servidor rearma el plan al importar y se niega si no es el que se mostro:
 * lo que se ve en el paso 3 es lo que queda. Ver src/modules/importacion.
 */

const MODOS: ReadonlyArray<{ value: Modo; label: string; description: string }> = [
  {
    value: 'solo-nuevos',
    label: 'Solo agregar los nuevos',
    description: 'Los que ya están no se tocan.',
  },
  {
    value: 'nuevos-y-existentes',
    label: 'Nuevos y actualizar los que existen',
    description: 'Cambia lo que el archivo trae distinto.',
  },
  {
    value: 'solo-existentes',
    label: 'Solo actualizar los que existen',
    description: 'No agrega nada (lista de un proveedor).',
  },
]

const OPCIONES_DE_STOCK: ReadonlyArray<{ value: ModoDeStock; label: string; description: string }> =
  [
    {
      value: 'no-tocar',
      label: 'No tocar el stock',
      description: 'Los nuevos arrancan en cero.',
    },
    {
      value: 'ajustar',
      label: 'Dejar el stock que dice el archivo',
      description: 'Como un recuento de lo que hay.',
    },
    {
      value: 'sumar',
      label: 'Sumar lo del archivo',
      description: 'Como una entrada de mercadería.',
    },
  ]

interface ArchivoLeido {
  nombre: string
  planilla: Planilla
}

function numero(n: number): string {
  return n.toLocaleString('es-AR')
}

export function ImportarProductos() {
  const idArchivo = useId()
  const entrada = useRef<HTMLInputElement | null>(null)

  const [leyendo, setLeyendo] = useState(false)
  const [errorDeArchivo, setErrorDeArchivo] = useState<string | null>(null)
  const [archivo, setArchivo] = useState<ArchivoLeido | null>(null)
  const [sinEncabezados, setSinEncabezados] = useState(false)
  const [mapeo, setMapeo] = useState<Mapeo>(mapeoVacio())

  const [modo, setModo] = useState<Modo>('solo-nuevos')
  const [stock, setStock] = useState<ModoDeStock | null>(null)

  const [vista, setVista] = useState<VistaPrevia | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [errorDeRevision, setErrorDeRevision] = useState<string | null>(null)

  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDeImportacion | null>(null)
  const [errorDeImportacion, setErrorDeImportacion] = useState<string | null>(null)

  const encabezado = useMemo(() => {
    if (!archivo || sinEncabezados) return -1
    return detectarEncabezado(archivo.planilla.filas)
  }, [archivo, sinEncabezados])

  const columnas = useMemo(
    () => (archivo ? encabezadosDe(archivo.planilla.filas, encabezado) : []),
    [archivo, encabezado],
  )

  const datos = useMemo(
    () => (archivo ? datosAEnviar(archivo.planilla.filas, encabezado, mapeo) : null),
    [archivo, encabezado, mapeo],
  )

  const stockMapeado = mapeo.stock !== null
  const modoDeStock: ModoDeStock = stockMapeado ? (stock ?? 'no-tocar') : 'no-tocar'

  function reiniciar() {
    setArchivo(null)
    setVista(null)
    setResultado(null)
    setErrorDeArchivo(null)
    setErrorDeRevision(null)
    setErrorDeImportacion(null)
    setStock(null)
    setModo('solo-nuevos')
    setSinEncabezados(false)
    setMapeo(mapeoVacio())
    if (entrada.current) entrada.current.value = ''
  }

  async function elegir(file: File | undefined) {
    if (!file) return
    reiniciar()
    if (file.size > TAMANO_MAXIMO) {
      setErrorDeArchivo('El archivo pesa más de 10 MB. Partilo en dos o guardalo como .csv.')
      return
    }
    setLeyendo(true)
    try {
      const planilla = await leerPlanilla(file.name, new Uint8Array(await file.arrayBuffer()))
      const posicion = detectarEncabezado(planilla.filas)
      setArchivo({ nombre: file.name, planilla })
      setMapeo(sugerirMapeo(encabezadosDe(planilla.filas, posicion)))
    } catch (error) {
      setErrorDeArchivo(
        error instanceof ErrorDePlanilla ? error.message : 'No se pudo leer el archivo.',
      )
    } finally {
      setLeyendo(false)
    }
  }

  function cambiarEncabezados(sin: boolean) {
    if (!archivo) return
    setSinEncabezados(sin)
    setVista(null)
    setMapeo(
      sin
        ? mapeoVacio()
        : sugerirMapeo(
            encabezadosDe(archivo.planilla.filas, detectarEncabezado(archivo.planilla.filas)),
          ),
    )
  }

  function mapear(campo: Campo, columna: number | null) {
    setVista(null)
    setMapeo((actual) => {
      const nuevo = { ...actual }
      // Una columna es un solo dato: si ya la tenia otro campo, se la saca.
      if (columna !== null) {
        for (const c of CAMPOS) if (nuevo[c] === columna) nuevo[c] = null
      }
      nuevo[campo] = columna
      return nuevo
    })
  }

  const revisar = useCallback(
    async (opciones: { modo: Modo; stock: ModoDeStock }) => {
      if (!archivo || !datos) return
      setRevisando(true)
      setErrorDeRevision(null)
      setErrorDeImportacion(null)
      try {
        const v = await apiRequest('/api/products/import/preview', {
          method: 'POST',
          body: { archivo: archivo.nombre, ...datos, ...opciones },
          parse: parseVistaPrevia,
        })
        setVista(v)
      } catch (error) {
        setVista(null)
        setErrorDeRevision(mensajeDeError(error, 'No se pudo revisar el archivo.'))
      } finally {
        setRevisando(false)
      }
    },
    [archivo, datos],
  )

  function cambiarModo(m: Modo) {
    setModo(m)
    void revisar({ modo: m, stock: modoDeStock })
  }

  function cambiarStock(s: ModoDeStock) {
    setStock(s)
    void revisar({ modo, stock: s })
  }

  async function importar() {
    if (!archivo || !datos || !vista) return
    setErrorDeImportacion(null)
    try {
      const r = await apiRequest('/api/products/import', {
        method: 'POST',
        body: {
          archivo: archivo.nombre,
          ...datos,
          modo,
          stock: modoDeStock,
          importacion: vista.importacion,
          huella: vista.huella,
        },
        parse: parseResultadoDeImportacion,
      })
      setConfirmando(false)
      setResultado(r)
      aviso.ok('Importación terminada.')
    } catch (error) {
      setConfirmando(false)
      if (error instanceof ApiError && error.code === 'IMPORT_PREVIEW_STALE') {
        setErrorDeImportacion(error.message)
        void revisar({ modo, stock: modoDeStock })
        return
      }
      if (error instanceof NetworkError || (error instanceof ApiError && error.status >= 502)) {
        // La respuesta no llego, pero la importacion pudo haber terminado del
        // otro lado. Reintentar a ciegas no suma dos veces --el servidor lo
        // impide-- pero la vista previa nueva dice que paso de verdad.
        setErrorDeImportacion(
          'No llegó la respuesta del servidor. La importación pudo haber terminado igual: ' +
            'revisá la vista previa de nuevo antes de reintentar. Si ya se aplicó, los productos van a figurar como existentes.',
        )
        return
      }
      setErrorDeImportacion(mensajeDeError(error, 'No se pudo importar.'))
    }
  }

  function descargarErrores() {
    if (!archivo || !vista) return
    const csv = csvDeFilasConError(archivo.planilla, columnas, encabezado, vista)
    const enlace = document.createElement('a')
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    enlace.download = `errores-${archivo.nombre.replace(/\.[^.]+$/, '')}.csv`
    enlace.click()
    URL.revokeObjectURL(enlace.href)
  }

  // ---------------------------------------------------------------- listo

  if (resultado) {
    return (
      <Card className="p-4">
        <CardHeader title="Importación terminada" />
        <ul className="mt-2 grid gap-1 text-sm text-ink">
          <li>
            <strong>{numero(resultado.creados)}</strong> productos agregados
          </li>
          <li>
            <strong>{numero(resultado.actualizados)}</strong> productos actualizados
          </li>
          {resultado.movimientosDeStock > 0 && (
            <li>
              Stock registrado en <strong>{numero(resultado.movimientosDeStock)}</strong> productos,
              con su movimiento en el historial
            </li>
          )}
          {resultado.categoriasCreadas.length > 0 && (
            <li>Categorías nuevas: {resultado.categoriasCreadas.join(', ')}</li>
          )}
          {resultado.sinCambios + resultado.omitidos > 0 && (
            <li className="text-ink-muted">
              {numero(resultado.sinCambios + resultado.omitidos)} filas no cambiaban nada o se
              omitieron
            </li>
          )}
          {resultado.conErrores > 0 && (
            <li className="text-warning">
              {numero(resultado.conErrores)} filas con errores no se importaron
            </li>
          )}
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
          Queda registrado en la auditoría como «Importación de {archivo?.nombre ?? 'productos'}».
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ButtonLink href="/productos" variant="primary">
            Ver los productos
          </ButtonLink>
          <Button variant="secondary" onClick={reiniciar}>
            Importar otro archivo
          </Button>
        </div>
      </Card>
    )
  }

  const aAplicar = vista ? vista.totales.crear + vista.totales.actualizar : 0
  const faltaElegirStock = stockMapeado && stock === null
  const puedeImportar =
    vista !== null && vista.bloqueos.length === 0 && aAplicar > 0 && !faltaElegirStock && !revisando

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------ 1. archivo */}
      <Card className="p-4">
        <CardHeader
          title="1. Elegí el archivo"
          description="Excel (.xlsx) o CSV, hasta 10 MB y 10.000 productos. Nada se guarda hasta que confirmes."
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor={idArchivo} className="sr-only">
            Archivo de productos
          </label>
          <input
            ref={entrada}
            id={idArchivo}
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="block w-full text-sm text-ink file:mr-3 file:min-h-touch file:rounded-md file:border file:border-line file:bg-raised file:px-3 file:text-sm file:text-ink"
            onChange={(e) => {
              void elegir(e.target.files?.[0])
            }}
          />
          {leyendo && (
            <span className="flex items-center gap-2 text-sm text-ink-muted" role="status">
              <Spinner /> Leyendo…
            </span>
          )}
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          ¿No tenés una planilla?{' '}
          <a href="/productos-ejemplo.xlsx" download className="text-primary underline">
            Descargá la de ejemplo
          </a>
          : una fila por producto, con el código de barras en formato Texto.
        </p>
        {errorDeArchivo && (
          <Alert tone="danger" title="No se pudo leer" className="mt-3">
            {errorDeArchivo}
          </Alert>
        )}
      </Card>

      {/* ------------------------------------------------------ 2. columnas */}
      {archivo && datos && (
        <Card className="p-4">
          <CardHeader
            title="2. Revisá las columnas"
            description={
              <>
                {archivo.nombre}
                {archivo.planilla.hoja !== null && <> · hoja «{archivo.planilla.hoja}»</>} ·{' '}
                {numero(datos.filas.length)} filas con datos
              </>
            }
          />
          {archivo.planilla.otrasHojas.length > 0 && (
            <Alert tone="info" className="mt-3">
              Se leyó solo la hoja «{archivo.planilla.hoja}». Las demás (
              {archivo.planilla.otrasHojas.join(', ')}) no se importan.
            </Alert>
          )}

          <Checkbox
            className="mt-2"
            label="La primera fila ya es un producto: el archivo no tiene títulos de columna"
            checked={sinEncabezados}
            onChange={(e) => {
              cambiarEncabezados(e.target.checked)
            }}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CAMPOS.map((campo) => (
              <Field key={campo} label={ETIQUETA_DE_CAMPO[campo]}>
                <Select
                  value={mapeo[campo] === null ? '' : String(mapeo[campo])}
                  onChange={(e) => {
                    mapear(campo, e.target.value === '' ? null : Number(e.target.value))
                  }}
                >
                  <option value="">— No importar —</option>
                  {columnas.map((nombre, i) => (
                    <option key={`${String(i)}-${nombre}`} value={i}>
                      {letraDeColumna(i)} · {nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          {datos.campos.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-ink">Primeras filas, como se van a leer</h3>
              <TableWrap className="mt-2">
                <Table caption="Primeras filas del archivo">
                  <THead>
                    <TR>
                      <TH>Fila</TH>
                      {datos.campos.map((c) => (
                        <TH key={c}>{ETIQUETA_DE_CAMPO[c]}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {datos.filas.slice(0, 5).map((f) => (
                      <TR key={f.f}>
                        <TD>{f.f}</TD>
                        {f.v.map((valor, i) => (
                          <TD key={datos.campos[i]}>
                            {typeof valor === 'string' ? valor : textoDeCelda(valor)}
                          </TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="primary"
              disabled={datos.campos.length === 0 || datos.filas.length === 0 || revisando}
              onClick={() => {
                void revisar({ modo, stock: modoDeStock })
              }}
            >
              {vista ? 'Revisar de nuevo' : 'Revisar'}
            </Button>
            {revisando && (
              <span className="flex items-center gap-2 text-sm text-ink-muted" role="status">
                <Spinner /> Revisando {numero(datos.filas.length)} filas…
              </span>
            )}
          </div>
          {errorDeRevision && (
            <Alert tone="danger" title="No se pudo revisar" className="mt-3">
              {errorDeRevision}
            </Alert>
          )}
        </Card>
      )}

      {/* ------------------------------------------------------ 3. vista previa */}
      {archivo && vista && (
        <Card className="p-4">
          <CardHeader title="3. Mirá qué va a pasar" description="Todavía no se guardó nada." />

          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <RadioGroup
              legend="Los que ya están en el catálogo"
              name="modo"
              value={modo}
              onChange={cambiarModo}
              options={MODOS}
            />
            {stockMapeado && (
              <RadioGroup
                legend="El stock"
                name="stock"
                value={stock}
                onChange={cambiarStock}
                options={OPCIONES_DE_STOCK}
              />
            )}
          </div>

          <VistaPreviaImportacion key={vista.importacion} vista={vista} revisando={revisando} />

          {vista.bloqueos.length > 0 && (
            <Alert tone="danger" title="Así no se puede importar" className="mt-3">
              <ul className="list-disc pl-5">
                {vista.bloqueos.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}
          {errorDeImportacion && (
            <Alert tone="danger" title="No se importó" className="mt-3">
              {errorDeImportacion}
            </Alert>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="primary"
              disabled={!puedeImportar}
              onClick={() => {
                setConfirmando(true)
              }}
            >
              {aAplicar > 0
                ? `Importar ${numero(aAplicar)} productos`
                : 'No hay nada para importar'}
            </Button>
            {vista.totales.conErrores > 0 && (
              <Button variant="secondary" onClick={descargarErrores}>
                Descargar las filas con error (CSV)
              </Button>
            )}
            <Link href="/productos" className="text-sm text-ink-muted hover:text-ink sm:ml-auto">
              Cancelar
            </Link>
          </div>
          {faltaElegirStock && (
            <p className="mt-2 text-sm text-warning">Elegí qué hacer con el stock para seguir.</p>
          )}
        </Card>
      )}

      <ConfirmationDialog
        open={confirmando}
        onClose={() => {
          setConfirmando(false)
        }}
        onConfirm={importar}
        variant="primary"
        title="¿Importamos?"
        confirmLabel="Sí, importar"
        message={
          vista ? (
            <span className="flex flex-col gap-2">
              <span>
                Se van a agregar <strong>{numero(vista.totales.crear)}</strong> productos y
                actualizar <strong>{numero(vista.totales.actualizar)}</strong>.
              </span>
              {vista.totales.conStock > 0 && (
                <span>
                  El stock cambia en <strong>{numero(vista.totales.conStock)}</strong> productos, y
                  cada cambio queda en el historial de movimientos.
                </span>
              )}
              {vista.categoriasNuevas.length > 0 && (
                <span>Se crean {numero(vista.categoriasNuevas.length)} categorías nuevas.</span>
              )}
              {vista.totales.conErrores > 0 && (
                <span>
                  <strong>{numero(vista.totales.conErrores)}</strong> filas con errores NO se
                  importan.
                </span>
              )}
              <span className="text-ink-muted">
                Se hace todo junto: si algo falla, no se guarda nada.
              </span>
            </span>
          ) : null
        }
      />
    </div>
  )
}
