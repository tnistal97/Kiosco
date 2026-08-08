'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
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
import { usePermiso } from '@/components/shell/SessionProvider'
import { DialogoProveedor } from '@/components/proveedores/DialogoProveedor'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseDetalleProveedor, type DetalleProveedorDTO } from '@/modules/suppliers/dto'
import { etiquetaDeEstado } from '@/modules/purchases/status'

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Un dato de la ficha. Los vacios se dibujan igual, con una raya. */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{etiqueta}</dt>
      <dd className="text-sm text-ink">{valor ?? '—'}</dd>
    </div>
  )
}

export default function ProveedorPage() {
  const params = useParams<{ id: string }>()
  const id = Number(params.id)

  const puedeAdministrar = usePermiso('suppliers.manage')
  const puedeVerCompras = usePermiso('purchases.view')

  const [proveedor, setProveedor] = useState<DetalleProveedorDTO | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setProveedor(
        await apiRequest(`/api/suppliers/${String(id)}`, { parse: parseDetalleProveedor }),
      )
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar el proveedor.'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function cambiarEstado() {
    if (!proveedor) return
    try {
      await apiRequest(`/api/suppliers/${String(id)}`, {
        method: 'PATCH',
        body: { isActive: !proveedor.isActive },
        parse: () => null,
      })
      aviso.ok(proveedor.isActive ? 'Proveedor dado de baja' : 'Proveedor activado')
      setConfirmandoBaja(false)
      await cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cambiar el estado.'))
      setConfirmandoBaja(false)
    }
  }

  if (cargando) return <SkeletonRows rows={6} />
  if (error !== null) return <ErrorState description={error} onRetry={() => void cargar()} />
  if (!proveedor) return null

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/proveedores" className="text-sm text-ink-muted hover:text-ink">
            ← Proveedores
          </Link>
          {/* `h2`: el `h1` de la pagina lo pone la cabecera de la aplicacion. */}
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
            {proveedor.name}
            {!proveedor.isActive && <Badge tone="neutral">De baja</Badge>}
          </h2>
          {proveedor.legalName !== null && (
            <p className="text-sm text-ink-muted">{proveedor.legalName}</p>
          )}
        </div>

        {puedeAdministrar && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setEditando(true)
              }}
            >
              Editar
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmandoBaja(true)
              }}
            >
              {proveedor.isActive ? 'Dar de baja' : 'Activar'}
            </Button>
          </div>
        )}
      </header>

      {!proveedor.isActive && (
        <Alert tone="warning" title="Dado de baja">
          No se le pueden hacer compras nuevas. Sus compras anteriores siguen intactas.
        </Alert>
      )}

      <Card className="p-4">
        <CardHeader title="Datos" />
        <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Dato etiqueta="CUIT" valor={proveedor.taxId} />
          <Dato etiqueta="Contacto" valor={proveedor.contactName} />
          <Dato etiqueta="Teléfono" valor={proveedor.phone} />
          <Dato etiqueta="Correo" valor={proveedor.email} />
          <Dato etiqueta="Dirección" valor={proveedor.address} />
        </dl>
        {proveedor.notes !== null && (
          <p className="mt-4 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-muted">
            {proveedor.notes}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader
          title="Productos que se le compran"
          description={
            proveedor.productos_lista.length === 0
              ? undefined
              : `${String(proveedor.productos_lista.length)} en esta sucursal`
          }
        />

        {proveedor.productos_lista.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Ningún producto asociado"
            description="Se asocian solos al recibir una compra, o desde la ficha del producto."
          />
        ) : (
          <TableWrap className="mt-3">
            <Table>
              <THead>
                <TR>
                  <TH>Producto</TH>
                  <TH>Su código</TH>
                  <TH className="text-right">Último costo</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {proveedor.productos_lista.map((p) => (
                  <TR key={p.productId}>
                    <TD>
                      <Link
                        href={`/productos?producto=${String(p.productId)}`}
                        className="text-ink hover:text-primary"
                      >
                        {p.name}
                      </Link>
                    </TD>
                    <TD className="text-ink-muted" data-numeric="">
                      {p.supplierCode ?? '—'}
                    </TD>
                    <TD className="text-right">
                      {/*
                        `undefined` es "no lo puedo ver" y `null` es "no hay
                        costo cargado". Son dos cosas distintas y la pantalla
                        las dice distinto: una raya para lo segundo, nada para
                        lo primero.
                      */}
                      {p.lastCost === undefined ? (
                        <span className="text-ink-faint">·</span>
                      ) : p.lastCost === null ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <Money amount={p.lastCost} />
                      )}
                    </TD>
                    <TD className="text-right">
                      {p.isPreferred && <Badge tone="primary">Principal</Badge>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {puedeVerCompras && (
        <Card className="p-4">
          <CardHeader
            title="Compras recientes"
            description={
              proveedor.ordenes === 0 ? undefined : `${String(proveedor.ordenes)} en total`
            }
          />

          {proveedor.compras.length === 0 ? (
            <EmptyState className="mt-3" title="Todavía no se le compró nada" />
          ) : (
            <TableWrap className="mt-3">
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Fecha</TH>
                    <TH>Estado</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {proveedor.compras.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <Link
                          href={`/compras/${String(c.id)}`}
                          className="font-medium text-ink hover:text-primary"
                          data-numeric=""
                        >
                          {c.number}
                        </Link>
                      </TD>
                      <TD className="text-ink-muted" data-numeric="">
                        {fechaCorta(c.createdAt)}
                      </TD>
                      <TD className="text-ink-muted">{etiquetaDeEstado(c.status)}</TD>
                      <TD className="text-right">
                        {c.expectedTotal === undefined || c.expectedTotal === null ? (
                          <span className="text-ink-faint">·</span>
                        ) : (
                          <Money amount={c.expectedTotal} />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      <DialogoProveedor
        abierto={editando}
        proveedor={proveedor}
        onCerrar={() => {
          setEditando(false)
        }}
        onGuardado={() => {
          setEditando(false)
          aviso.ok('Proveedor actualizado')
          void cargar()
        }}
      />

      <ConfirmationDialog
        open={confirmandoBaja}
        onClose={() => {
          setConfirmandoBaja(false)
        }}
        onConfirm={() => void cambiarEstado()}
        title={
          proveedor.isActive ? `¿Dar de baja a ${proveedor.name}?` : `¿Activar a ${proveedor.name}?`
        }
        confirmLabel={proveedor.isActive ? 'Dar de baja' : 'Activar'}
        variant={proveedor.isActive ? 'danger' : 'primary'}
        message={
          proveedor.isActive
            ? 'No se le van a poder hacer compras nuevas. Las anteriores quedan intactas y se puede reactivar cuando quieras.'
            : 'Vuelve a estar disponible para nuevas compras.'
        }
      />
    </div>
  )
}
