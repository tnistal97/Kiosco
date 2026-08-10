'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Money,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoCliente } from '@/components/clientes/DialogoCliente'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { esNegativo, esPositivo } from '@/lib/money'
import { parsePaginaClientes, type ClienteListadoDTO } from '@/modules/clients/dto'

const POR_PAGINA = 25
const ESPERA_MS = 250

/** Fecha corta. Sin hora: "la ultima compra fue el 8/8" alcanza. */
function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/**
 * El saldo, con su signo traducido a palabras.
 *
 * Un `-2.000,00` a secas obliga a recordar la convencion. En el mostrador hay
 * que poder leer la fila sin saber que positivo significa que debe.
 */
function Saldo({ balance }: { balance: string }) {
  if (esPositivo(balance)) {
    return (
      <span className="font-medium text-danger">
        <Money amount={balance} />
      </span>
    )
  }
  if (esNegativo(balance)) {
    return (
      <span className="text-success">
        <Money amount={balance.replace('-', '')} /> a favor
      </span>
    )
  }
  return <span className="text-ink-faint">Al día</span>
}

export default function ClientesPage() {
  const puedeAdministrar = usePermiso('clients.manage')

  const [clientes, setClientes] = useState<ClienteListadoDTO[]>([])
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState('activos')
  const [deuda, setDeuda] = useState('todos')
  const [fiado, setFiado] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialogoAbierto, setDialogoAbierto] = useState(false)

  // El buscador espera a que se deje de tipear: sin esto cada tecla dispara una
  // consulta y la ultima en llegar puede no ser la ultima que se pidio.
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [busquedaAplicada, setBusquedaAplicada] = useState('')

  useEffect(() => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim())
      setPagina(1)
    }, ESPERA_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [busqueda])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      // Todo el filtrado y la paginacion son del SERVIDOR. Con diez mil
      // clientes, traerlos para filtrar en el navegador no es una opcion.
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        estado,
        deuda,
        fiado,
      })
      if (busquedaAplicada !== '') params.set('q', busquedaAplicada)

      const res = await apiRequest(`/api/clients?${params.toString()}`, {
        parse: parsePaginaClientes,
      })
      setClientes(res.data)
      setTotal(res.pagination.total)
      setTotalPaginas(res.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los clientes.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, busquedaAplicada, estado, deuda, fiado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total === 0 ? 'Ningún cliente todavía' : `${String(total)} en total`}
        </p>
        {puedeAdministrar && (
          <Button
            variant="primary"
            onClick={() => {
              setDialogoAbierto(true)
            }}
          >
            Nuevo cliente
          </Button>
        )}
      </header>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <SearchInput
              label="Buscar clientes"
              value={busqueda}
              placeholder="Nombre, teléfono o documento"
              onChange={(e) => {
                setBusqueda(e.target.value)
              }}
              onClear={() => {
                setBusqueda('')
              }}
            />
          </div>
          <Select
            value={deuda}
            aria-label="Filtrar por saldo"
            className="w-44"
            onChange={(e) => {
              setDeuda(e.target.value)
              setPagina(1)
            }}
          >
            <option value="todos">Todos los saldos</option>
            <option value="conDeuda">Con deuda</option>
            <option value="aFavor">Con saldo a favor</option>
            <option value="sinDeuda">Al día</option>
          </Select>
          <Select
            value={fiado}
            aria-label="Filtrar por fiado"
            className="w-44"
            onChange={(e) => {
              setFiado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="todos">Fiado: todos</option>
            <option value="habilitado">Fiado habilitado</option>
            <option value="bloqueado">Fiado cortado</option>
          </Select>
          <Select
            value={estado}
            aria-label="Filtrar por estado"
            className="w-40"
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
          >
            <option value="activos">Solo activos</option>
            <option value="inactivos">Solo dados de baja</option>
            <option value="todos">Todos</option>
          </Select>
        </div>

        {error !== null && <ErrorState description={error} onRetry={() => void cargar()} />}

        {error === null && cargando && <SkeletonRows rows={5} />}

        {error === null && !cargando && clientes.length === 0 && (
          <EmptyState
            title="No hay clientes"
            description={
              busquedaAplicada === ''
                ? 'Cargá el primero para poder vender a cuenta.'
                : `Ningún cliente coincide con “${busquedaAplicada}”.`
            }
          />
        )}

        {error === null && !cargando && clientes.length > 0 && (
          <>
            {/* Escritorio */}
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Cliente</TH>
                    <TH>Teléfono</TH>
                    <TH className="text-right">Saldo</TH>
                    <TH className="text-right">Límite</TH>
                    <TH>Fiado</TH>
                    <TH>Última compra</TH>
                    <TH>Última actividad</TH>
                  </TR>
                </THead>
                <TBody>
                  {clientes.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <Link
                          href={`/clientes/${String(c.id)}`}
                          className="font-medium text-ink hover:text-primary"
                        >
                          {c.name}
                        </Link>
                        {!c.isActive && (
                          <Badge tone="neutral" className="ml-2">
                            De baja
                          </Badge>
                        )}
                        {c.document !== null && (
                          <div className="text-xs text-ink-faint" data-numeric="">
                            {c.document}
                          </div>
                        )}
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {c.phone ?? '—'}
                      </TD>
                      <TD className="text-right" data-numeric="">
                        <Saldo balance={c.balance} />
                      </TD>
                      <TD className="text-right text-ink-muted" data-numeric="">
                        {/*
                          NULL y "0.00" son afirmaciones distintas y se muestran
                          distinto: "sin límite" es que nadie lo configuró; "no
                          se le fía" es una decisión de alguien.
                        */}
                        {c.creditLimit === null ? (
                          <span className="text-ink-faint">Sin límite</span>
                        ) : (
                          <Money amount={c.creditLimit} />
                        )}
                      </TD>
                      <TD>
                        {c.isCreditEnabled ? (
                          <span className="text-ink-faint">Habilitado</span>
                        ) : (
                          <Badge tone="warning">Cortado</Badge>
                        )}
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(c.ultimaCompra)}
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(c.ultimaActividad)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            {/* Movil: tarjetas, no scroll lateral */}
            <CardList className="md:hidden">
              {clientes.map((c) => (
                <CardListItem key={c.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/clientes/${String(c.id)}`}
                        className="font-medium text-ink hover:text-primary"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-ink-faint" data-numeric="">
                        {c.phone ?? 'Sin teléfono'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm" data-numeric="">
                      <Saldo balance={c.balance} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!c.isActive && <Badge tone="neutral">De baja</Badge>}
                    {!c.isCreditEnabled && <Badge tone="warning">Fiado cortado</Badge>}
                    {c.creditLimit !== null && (
                      <span className="text-xs text-ink-faint" data-numeric="">
                        Límite <Money amount={c.creditLimit} />
                      </span>
                    )}
                  </div>
                </CardListItem>
              ))}
            </CardList>

            <Pagination
              page={pagina}
              pageSize={POR_PAGINA}
              total={total}
              totalPages={totalPaginas}
              onPageChange={(p) => {
                setPagina(p)
              }}
            />
          </>
        )}
      </Card>

      <DialogoCliente
        abierto={dialogoAbierto}
        cliente={null}
        onCerrar={() => {
          setDialogoAbierto(false)
        }}
        onGuardado={() => {
          setDialogoAbierto(false)
          void cargar()
        }}
      />
    </div>
  )
}
