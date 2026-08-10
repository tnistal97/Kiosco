'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Field, Input, Money, SearchInput, aviso } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo } from '@/lib/money'
import { parseCliente, parseClientes, type ClienteDTO } from '@/modules/clients/dto'

const ESPERA_MS = 250

/**
 * Elegir --o crear-- el cliente de una venta, sin salir del cobro.
 *
 * DOS REGLAS DE DISENIO, y las dos son el punto:
 *
 *   1. LA VENTA RAPIDA NO PAGA NADA POR ESTO. El selector no se dibuja hasta
 *      que alguien lo abre o hasta que aparece una linea `ACCOUNT`. Un almacen
 *      no le pide el nombre a quien compra un paquete de yerba, y agregar un
 *      clic obligatorio al camino mas transitado seria el peor cambio posible.
 *
 *   2. NO SE DESCARGAN TODOS LOS CLIENTES. La busqueda pega contra
 *      `/api/clients/buscar`, que EXIGE texto y devuelve ocho. Con diez mil
 *      clientes, un desplegable que los trae todos deja de abrirse.
 *
 * El alta rapida pide tres campos --nombre, telefono, documento-- y selecciona
 * al cliente reci n creado. Meterle limite de credito o direccion convertiria
 * un paso de diez segundos en un tramite; eso se completa despues desde la
 * ficha. Ver docs/CUSTOMER_MODEL.md.
 */
export function SelectorDeCliente({
  cliente,
  onElegir,
  deshabilitado = false,
  /** Cuando el fiado lo exige, el selector no se puede cerrar vacio. */
  obligatorio = false,
}: {
  cliente: ClienteDTO | null
  onElegir: (c: ClienteDTO | null) => void
  deshabilitado?: boolean
  obligatorio?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ClienteDTO[]>([])
  const [buscando, setBuscando] = useState(false)

  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [documento, setDocumento] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El fiado abre el selector solo: sin cliente la venta no se puede registrar,
  // y hacer que el cajero lo descubra al confirmar seria hacerle perder el
  // tiempo con el cliente enfrente.
  useEffect(() => {
    if (obligatorio && cliente === null) setAbierto(true)
  }, [obligatorio, cliente])

  const buscar = useCallback(async (texto: string) => {
    if (texto.trim().length === 0) {
      setResultados([])
      return
    }
    setBuscando(true)
    try {
      setResultados(
        await apiRequest(`/api/clients/buscar?q=${encodeURIComponent(texto.trim())}`, {
          parse: parseClientes,
        }),
      )
    } catch {
      setResultados([])
    } finally {
      setBuscando(false)
    }
  }, [])

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void buscar(busqueda), ESPERA_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [busqueda, buscar])

  async function crear() {
    if (guardando || nombre.trim().length === 0) return
    setGuardando(true)
    setError(null)
    try {
      const nuevo = await apiRequest('/api/clients/rapido', {
        method: 'POST',
        body: { name: nombre.trim(), phone: telefono.trim(), document: documento.trim() },
        parse: parseCliente,
      })
      aviso.ok(`${nuevo.name} agregado`)
      // Se selecciona solo: quien lo acaba de crear lo hizo para usarlo ahora.
      onElegir(nuevo)
      setCreando(false)
      setAbierto(false)
      setNombre('')
      setTelefono('')
      setDocumento('')
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo crear el cliente.'))
    } finally {
      setGuardando(false)
    }
  }

  // Elegido y cerrado: una linea, sin ocupar espacio.
  if (cliente !== null && !abierto) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-sunken px-3 py-2">
        <div className="min-w-0">
          <span className="font-medium text-ink">{cliente.name}</span>
          {esPositivo(cliente.balance) && (
            <span className="ml-2 text-sm text-danger" data-numeric="">
              debe <Money amount={cliente.balance} size="sm" />
            </span>
          )}
          {esNegativo(cliente.balance) && (
            <span className="ml-2 text-sm text-success" data-numeric="">
              <Money amount={cliente.balance.replace('-', '')} size="sm" /> a favor
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={deshabilitado}
            onClick={() => {
              setAbierto(true)
            }}
          >
            Cambiar
          </Button>
          {!obligatorio && (
            <Button
              size="sm"
              variant="secondary"
              disabled={deshabilitado}
              onClick={() => {
                onElegir(null)
              }}
            >
              Quitar
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Sin cliente y cerrado: un boton chico. La venta rapida no paga nada.
  if (!abierto) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={deshabilitado}
        onClick={() => {
          setAbierto(true)
        }}
      >
        Seleccionar cliente
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3">
      {error && (
        <Alert tone="danger" title="No se guardó">
          {error}
        </Alert>
      )}

      {!creando && (
        <>
          <SearchInput
            label="Buscar cliente"
            value={busqueda}
            placeholder="Nombre, teléfono o documento"
            autoFocus
            onChange={(e) => {
              setBusqueda(e.target.value)
            }}
            onClear={() => {
              setBusqueda('')
            }}
          />

          {busqueda.trim() !== '' && !buscando && resultados.length === 0 && (
            <p className="text-sm text-ink-muted">
              Ningún cliente coincide con “{busqueda.trim()}”.
            </p>
          )}

          {resultados.length > 0 && (
            <ul className="max-h-48 divide-y divide-line overflow-y-auto">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left hover:bg-surface-2"
                    onClick={() => {
                      onElegir(c)
                      setAbierto(false)
                      setBusqueda('')
                      setResultados([])
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{c.name}</span>
                      <span className="block text-xs text-ink-faint" data-numeric="">
                        {c.phone ?? c.document ?? 'Sin datos de contacto'}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm" data-numeric="">
                      {esPositivo(c.balance) ? (
                        <span className="text-danger">
                          <Money amount={c.balance} size="sm" />
                        </span>
                      ) : esNegativo(c.balance) ? (
                        <span className="text-success">
                          <Money amount={c.balance.replace('-', '')} size="sm" /> a favor
                        </span>
                      ) : (
                        <span className="text-ink-faint">Al día</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCreando(true)
                setNombre(busqueda.trim())
              }}
            >
              + Nuevo cliente
            </Button>
            {!obligatorio && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setAbierto(false)
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}

      {creando && (
        <>
          <Field label="Nombre" required>
            <Input
              value={nombre}
              autoFocus
              disabled={guardando}
              placeholder="Juan Pérez"
              onChange={(e) => {
                setNombre(e.target.value)
              }}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono">
              <Input
                value={telefono}
                disabled={guardando}
                inputMode="tel"
                onChange={(e) => {
                  setTelefono(e.target.value)
                }}
              />
            </Field>
            <Field label="Documento">
              <Input
                value={documento}
                disabled={guardando}
                inputMode="numeric"
                onChange={(e) => {
                  setDocumento(e.target.value)
                }}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={guardando}
              disabled={nombre.trim().length === 0}
              onClick={() => void crear()}
            >
              Crear y usar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={guardando}
              onClick={() => {
                setCreando(false)
              }}
            >
              Volver
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
