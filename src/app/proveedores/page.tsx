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
  aviso,
} from '@/components/ui'
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoProveedor } from '@/components/proveedores/DialogoProveedor'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaProveedores, type ProveedorDTO } from '@/modules/suppliers/dto'

const POR_PAGINA = 25
const ESPERA_MS = 250

/** Fecha corta. Sin hora: "la ultima compra fue el 8/8" alcanza. */
function fechaCorta(iso: string | null): string {
  if (iso === null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function ProveedoresPage() {
  const puedeAdministrar = usePermiso('suppliers.manage')

  const [proveedores, setProveedores] = useState<ProveedorDTO[]>([])
  const [total, setTotal] = useState(0)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [activos, setActivos] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editando, setEditando] = useState<ProveedorDTO | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)

  // El buscador espera a que se deje de tipear: sin esto cada tecla dispara
  // una consulta y la ultima en llegar puede no ser la ultima que se pidio.
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
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
      })
      if (busquedaAplicada !== '') params.set('q', busquedaAplicada)
      if (activos !== '') params.set('activos', activos)

      const res = await apiRequest(`/api/suppliers?${params.toString()}`, {
        parse: parsePaginaProveedores,
      })
      setProveedores(res.data)
      setTotal(res.pagination.total)
      setTotalPaginas(res.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron cargar los proveedores.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, busquedaAplicada, activos])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function cambiarEstado(p: ProveedorDTO) {
    try {
      await apiRequest(`/api/suppliers/${String(p.id)}`, {
        method: 'PATCH',
        body: { isActive: !p.isActive },
        parse: () => null,
      })
      aviso.ok(p.isActive ? `${p.name} dado de baja` : `${p.name} activado`)
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cambiar el estado.'))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {/*
          Sin `<h1>`: la cabecera de la aplicacion ya pone uno con el nombre de
          la pantalla, y dos encabezados de nivel uno en la misma pagina es una
          falta de estructura --y lo que hacia que `getByRole('heading', {
          level: 1 })` encontrara dos elementos--.
        */}
        <p className="text-sm text-ink-muted">
          {total === 0 ? 'Ningún proveedor todavía' : `${String(total)} en total`}
        </p>
        {puedeAdministrar && (
          <Button
            variant="primary"
            onClick={() => {
              setEditando(null)
              setDialogoAbierto(true)
            }}
          >
            Nuevo proveedor
          </Button>
        )}
      </header>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <SearchInput
              label="Buscar proveedores"
              value={busqueda}
              placeholder="Nombre, razón social, CUIT o contacto"
              onChange={(e) => {
                setBusqueda(e.target.value)
              }}
              onClear={() => {
                setBusqueda('')
              }}
            />
          </div>
          <Select
            value={activos}
            aria-label="Filtrar por estado"
            className="w-44"
            onChange={(e) => {
              setActivos(e.target.value)
              setPagina(1)
            }}
          >
            <option value="">Todos</option>
            <option value="true">Solo activos</option>
            <option value="false">Solo dados de baja</option>
          </Select>
        </div>

        {error !== null && <ErrorState description={error} onRetry={() => void cargar()} />}

        {error === null && cargando && <SkeletonRows rows={5} />}

        {error === null && !cargando && proveedores.length === 0 && (
          <EmptyState
            title="No hay proveedores"
            description={
              busquedaAplicada === ''
                ? 'Cargá el primero para poder registrar compras.'
                : `Ningún proveedor coincide con “${busquedaAplicada}”.`
            }
          />
        )}

        {error === null && !cargando && proveedores.length > 0 && (
          <>
            {/* Escritorio */}
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Proveedor</TH>
                    <TH>Contacto</TH>
                    <TH>Teléfono</TH>
                    <TH className="text-right">Productos</TH>
                    <TH className="text-right">Compras</TH>
                    <TH>Última compra</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {proveedores.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <Link
                          href={`/proveedores/${String(p.id)}`}
                          className="font-medium text-ink hover:text-primary"
                        >
                          {p.name}
                        </Link>
                        {!p.isActive && (
                          <Badge tone="neutral" className="ml-2">
                            De baja
                          </Badge>
                        )}
                        {p.taxId !== null && (
                          <div className="text-xs text-ink-faint" data-numeric="">
                            {p.taxId}
                          </div>
                        )}
                      </TD>
                      <TD className="text-ink-muted">{p.contactName ?? '—'}</TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {p.phone ?? '—'}
                      </TD>
                      <TD className="text-right" data-numeric="">
                        {p.productos}
                      </TD>
                      <TD className="text-right" data-numeric="">
                        {p.ordenes}
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(p.ultimaCompra)}
                      </TD>
                      <TD className="text-right">
                        {puedeAdministrar && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void cambiarEstado(p)}
                          >
                            {p.isActive ? 'Dar de baja' : 'Activar'}
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>

            {/* Movil: tarjetas, no scroll lateral */}
            <CardList className="md:hidden">
              {proveedores.map((p) => (
                <CardListItem key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/proveedores/${String(p.id)}`}
                        className="font-medium text-ink hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-ink-muted">
                        {p.contactName ?? 'Sin contacto'}
                        {p.phone !== null && ` · ${p.phone}`}
                      </div>
                    </div>
                    {!p.isActive && <Badge tone="neutral">De baja</Badge>}
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-ink-faint">
                    <span data-numeric="">{p.productos} productos</span>
                    <span data-numeric="">{p.ordenes} compras</span>
                    <span data-numeric="">Últ.: {fechaCorta(p.ultimaCompra)}</span>
                  </div>
                </CardListItem>
              ))}
            </CardList>

            <Pagination
              page={pagina}
              pageSize={POR_PAGINA}
              total={total}
              totalPages={totalPaginas}
              onPageChange={setPagina}
            />
          </>
        )}
      </Card>

      <DialogoProveedor
        abierto={dialogoAbierto}
        proveedor={editando}
        onCerrar={() => {
          setDialogoAbierto(false)
        }}
        onGuardado={() => {
          setDialogoAbierto(false)
          aviso.ok(editando ? 'Proveedor actualizado' : 'Proveedor creado')
          void cargar()
        }}
      />
    </div>
  )
}
