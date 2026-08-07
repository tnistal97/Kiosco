'use client'

import { Fragment, useEffect, useState } from 'react'
import {
  Alert,
  Card,
  CardHeader,
  Table,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  cn,
} from '@/components/ui'
import { rolLegible } from '@/components/shell/UserMenu'
import { apiRequest, esObjeto, lista, numero, texto } from '@/lib/api-client'
import type { RolDTO } from '@/modules/users/dto'

/**
 * Matriz de permisos, de solo lectura.
 *
 * Los permisos viven en el catalogo del codigo, no en la base, asi que no hay
 * nada que editar todavia: se muestran para que quede claro que hace cada
 * rol, y sobre todo que **cambiar un precio no es lo mismo que editar un
 * producto**.
 *
 * Un rol que la base tiene pero el catalogo no reconoce se marca: no recibe
 * ningun permiso, y verlo vacio en la pantalla es mejor que descubrirlo
 * cuando alguien no puede trabajar.
 */
interface RolConPermisos extends RolDTO {
  permissions: string[]
  configurado: boolean
}

function parseRolesConPermisos(raw: unknown): RolConPermisos[] {
  const fuente = esObjeto(raw) && 'data' in raw ? raw.data : raw
  return lista(fuente, (r) => {
    if (!esObjeto(r)) throw new Error('La respuesta no tiene la forma de un rol')
    return {
      id: numero(r.id),
      name: texto(r.name),
      permissions: Array.isArray(r.permissions) ? r.permissions.map((p) => texto(p)) : [],
      configurado: r.configurado !== false,
    }
  })
}

/** Agrupacion por area, para que la tabla se pueda leer. */
const AREAS: Array<{ titulo: string; permisos: Array<{ clave: string; que: string }> }> = [
  {
    titulo: 'Venta',
    permisos: [
      { clave: 'sales.create', que: 'Registrar ventas' },
      { clave: 'sales.view', que: 'Ver el historial de ventas' },
      { clave: 'sales.cancel', que: 'Anular una venta' },
    ],
  },
  {
    titulo: 'Catálogo',
    permisos: [
      { clave: 'products.view', que: 'Ver el catálogo' },
      { clave: 'products.create', que: 'Dar de alta productos' },
      { clave: 'products.update', que: 'Editar la ficha (nombre, código, categoría)' },
      { clave: 'products.price.update', que: 'Cambiar el precio de venta' },
      { clave: 'products.delete', que: 'Eliminar un producto' },
      { clave: 'categories.manage', que: 'Administrar categorías' },
    ],
  },
  {
    titulo: 'Inventario',
    permisos: [
      { clave: 'stock.view', que: 'Ver el stock' },
      { clave: 'stock.adjust', que: 'Ajustar unidades (con motivo)' },
    ],
  },
  {
    titulo: 'Caja',
    permisos: [
      { clave: 'cash.view', que: 'Ver el saldo y los movimientos' },
      { clave: 'cash.movement.create', que: 'Registrar ingresos y retiros' },
      { clave: 'cash.count.create', que: 'Hacer arqueos' },
    ],
  },
  {
    titulo: 'Administración',
    permisos: [
      { clave: 'reports.view', que: 'Ver reportes' },
      { clave: 'audit.view', que: 'Ver la bitácora' },
      { clave: 'users.view', que: 'Ver el personal' },
      { clave: 'users.manage', que: 'Administrar el personal' },
      { clave: 'branches.view', que: 'Ver sucursales' },
      { clave: 'branches.manage', que: 'Administrar sucursales' },
      { clave: 'suppliers.view', que: 'Ver proveedores' },
      { clave: 'suppliers.manage', que: 'Administrar proveedores' },
    ],
  },
]

export function MatrizPermisos({ roles }: { roles: RolDTO[] }) {
  const [detalle, setDetalle] = useState<RolConPermisos[]>([])

  useEffect(() => {
    apiRequest('/api/roles', { parse: parseRolesConPermisos })
      .then(setDetalle)
      .catch(() => {
        setDetalle([])
      })
  }, [roles])

  if (detalle.length === 0) return null

  const sinConfigurar = detalle.filter((r) => !r.configurado)

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Qué puede hacer cada rol"
          description="Un rol es un conjunto de permisos. Solo lectura por ahora: los permisos viven en el código."
          className="mb-3"
        />

        <Alert tone="info">
          Un rol que el sistema no reconoce <strong>no recibe ningún permiso</strong>. Es
          deliberado: es preferible que alguien no pueda hacer nada y haya que darle permisos, a que
          herede todo por descuido.
        </Alert>

        {sinConfigurar.length > 0 && (
          <Alert tone="warning" title="Roles sin permisos definidos" className="mt-3">
            {sinConfigurar.map((r) => r.name).join(', ')}. Quien tenga uno de estos no va a poder
            hacer nada en el sistema.
          </Alert>
        )}
      </div>

      <TableWrap className="rounded-none border-x-0 border-b-0">
        <Table caption="Matriz de permisos por rol">
          <THead>
            <TR>
              <TH className="sticky left-0 z-10 bg-raised">Permiso</TH>
              {detalle.map((r) => (
                <TH key={r.id} align="center">
                  {rolLegible(r.name)}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {AREAS.map((area) => (
              <Fragment key={area.titulo}>
                <TR>
                  <TD
                    colSpan={detalle.length + 1}
                    className="sticky left-0 bg-sunken text-xs font-semibold tracking-wide text-ink-faint uppercase"
                  >
                    {area.titulo}
                  </TD>
                </TR>
                {area.permisos.map((p) => (
                  <TR key={p.clave}>
                    <TD className="sticky left-0 z-10 bg-surface">
                      <p className="text-ink">{p.que}</p>
                      <code className="text-xs text-ink-faint">{p.clave}</code>
                    </TD>
                    {detalle.map((r) => {
                      const tiene = r.permissions.includes(p.clave)
                      return (
                        <TD key={r.id} align="center">
                          {/* Simbolo y texto accesible, no solo color. */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'text-base',
                              tiene ? 'text-success' : 'text-ink-faint opacity-45',
                            )}
                          >
                            {tiene ? '✓' : '·'}
                          </span>
                          <span className="sr-only">{tiene ? 'Sí' : 'No'}</span>
                        </TD>
                      )
                    })}
                  </TR>
                ))}
              </Fragment>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  )
}
