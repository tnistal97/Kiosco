'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Money,
  SkeletonRows,
} from '@/components/ui'
import { useSession } from '@/components/shell/SessionProvider'
import { montoODefecto, type Monto } from '@/lib/money'
import { apiRequest, esObjeto, lista, mensajeDeError, numero, texto, textoOpcional } from '@/lib/api-client' // prettier-ignore

interface SucursalDTO {
  id: number
  name: string
  address: string | null
  email: string | null
  phone: string | null
  currentCash: Monto
}

function parseSucursales(raw: unknown): SucursalDTO[] {
  const fuente = esObjeto(raw) && 'data' in raw ? raw.data : raw
  return lista(fuente, (s) => {
    if (!esObjeto(s)) throw new Error('La respuesta no tiene la forma de una sucursal')
    return {
      id: numero(s.id),
      name: texto(s.name),
      address: textoOpcional(s.address),
      email: textoOpcional(s.email),
      phone: textoOpcional(s.phone),
      currentCash: montoODefecto(s.currentCash),
    }
  })
}

/**
 * Sucursales.
 *
 * Solo lectura en esta fase. La aplicacion trabaja siempre sobre la sucursal
 * de la sesion --el servidor la toma de ahi y nunca del navegador-- asi que
 * no hay selector: cambiar de sucursal es cambiar de usuario.
 *
 * Alta, edicion y traslado de personal entre sucursales llegan cuando exista
 * mas de una operando de verdad.
 */
export default function SucursalesPage() {
  const { session } = useSession()
  const [sucursales, setSucursales] = useState<SucursalDTO[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiRequest('/api/branches', { parse: parseSucursales })
      .then((s) => {
        setSucursales(s)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(mensajeDeError(err, 'No se pudieron cargar las sucursales.'))
      })
      .finally(() => {
        setCargando(false)
      })
  }, [])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-3 sm:p-5">
      <Alert tone="info">
        Cada usuario trabaja siempre en su sucursal. El servidor la toma de la sesión y nunca del
        navegador: los productos, la caja y las ventas de otra sucursal no son accesibles ni
        mandando su identificador a mano.
      </Alert>

      {error ? (
        <ErrorState description={error} />
      ) : cargando ? (
        <SkeletonRows rows={2} />
      ) : sucursales.length === 0 ? (
        <EmptyState title="No hay sucursales cargadas" />
      ) : (
        <div className="flex flex-col gap-3">
          {sucursales.map((s) => {
            const esLaMia = s.id === session?.branchId
            return (
              <Card key={s.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {s.name}
                      {esLaMia && <Badge tone="primary">Tu sucursal</Badge>}
                    </span>
                  }
                  description={s.address ?? 'Sin dirección cargada'}
                />
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-faint">Teléfono</dt>
                    <dd className="text-ink">{s.phone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Correo</dt>
                    <dd className="truncate text-ink">{s.email ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Efectivo acumulado</dt>
                    <dd>
                      <Money amount={s.currentCash} size="md" />
                    </dd>
                  </div>
                </dl>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
