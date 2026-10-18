'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  ButtonLink,
  Button,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageContainer,
  Pagination,
  SkeletonRows,
  StatusBadge,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from '@/components/ui'
import { DialogoNuevoInventario } from '@/components/inventarios/DialogoNuevoInventario'
import { usePermiso } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import {
  alcanceDeInventario,
  estadoDeInventario,
  fechaDeInventario,
  inventarioAbierto,
} from '@/components/inventarios/textos'

const POR_PAGINA = 25

interface Sesion {
  id: number
  number: string
  status: string
  scope: string
  categoryName: string | null
  blindCount: boolean
  startedAt: string
  startedByName: string
  lineas: {
    total: number
    contadas: number
    pendientes: number
    sinResolver: number
    conDiferencia: number
  }
}

interface Respuesta {
  data: Sesion[]
  pagination: { total: number; page: number; pageSize: number }
}

/**
 * Inventarios. UX V5.
 *
 * "Voy a contar lo que hay en el negocio para compararlo con lo que dice el
 * sistema." Una accion principal --Nuevo inventario-- y, si hay uno sin
 * terminar, un acceso grande para seguirlo. Debajo, los anteriores.
 */
export default function InventariosPage() {
  const router = useRouter()
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [creando, setCreando] = useState(false)
  const puedeCrear = usePermiso('inventoryCounts.create')

  const cargar = useCallback(() => {
    let vivo = true
    setCargando(true)
    const params = new URLSearchParams({ page: String(pagina), pageSize: String(POR_PAGINA) })
    apiRequest<Respuesta>(`/api/inventarios?${params.toString()}`, { parse: (d) => d as Respuesta })
      .then((r) => {
        if (vivo) {
          setDatos(r)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (vivo) setError(mensajeDeError(e, 'No se pudo cargar. Revisá la conexión.'))
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [pagina])

  useEffect(() => cargar(), [cargar])

  const abierto = datos?.data.find((s) => inventarioAbierto(s.status)) ?? null

  return (
    <PageContainer className="gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="max-w-xl">
          <h2 className="text-xl font-semibold text-ink">Contar la mercadería</h2>
          <p className="mt-1 text-base text-ink-muted">
            Contá lo que hay en el negocio y compará con lo que dice el sistema. Al final, el
            sistema corrige el stock.
          </p>
        </div>
        {puedeCrear && (
          <Button
            variant={abierto ? 'secondary' : 'primary'}
            size="xl"
            onClick={() => {
              setCreando(true)
            }}
          >
            Nuevo inventario
          </Button>
        )}
      </div>

      {abierto && (
        <Link
          href={`/inventarios/${String(abierto.id)}`}
          className="flex flex-col gap-1 rounded-lg border-2 border-primary bg-primary-quiet px-5 py-4 transition-colors hover:bg-surface sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            <span className="block text-lg font-semibold text-ink">
              Tenés un inventario sin terminar
            </span>
            <span className="text-base text-ink" data-numeric="">
              Del {fechaDeInventario(abierto.startedAt)} ·{' '}
              {abierto.status === 'REVIEW'
                ? 'falta revisar y aplicar'
                : `contaste ${String(abierto.lineas.contadas)} de ${String(abierto.lineas.total)}`}
            </span>
          </span>
          <span className="text-lg font-semibold text-primary">
            {abierto.status === 'REVIEW' ? 'Revisar →' : 'Seguir contando →'}
          </span>
        </Link>
      )}

      <DialogoNuevoInventario
        abierto={creando}
        onCerrar={() => {
          setCreando(false)
        }}
        onCreado={(id) => {
          router.push(`/inventarios/${String(id)}`)
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-ink">Inventarios anteriores</h2>

        {error !== null && <ErrorState description={error} onRetry={cargar} />}
        {error === null && cargando && <SkeletonRows rows={4} />}
        {error === null && !cargando && datos !== null && datos.data.length === 0 && (
          <EmptyState
            title="Todavía no hiciste ningún inventario"
            description="Tocá «Nuevo inventario» para empezar a contar."
          />
        )}

        {error === null && !cargando && datos !== null && datos.data.length > 0 && (
          <>
            <div className="hidden md:block">
              <TableWrap>
                <Table caption="Inventarios">
                  <THead>
                    <TR>
                      <TH>Fecha</TH>
                      <TH>Qué se contó</TH>
                      <TH>Estado</TH>
                      <TH align="right">Contados</TH>
                      <TH align="right">Con diferencia</TH>
                      <TH align="right">
                        <span className="sr-only">Abrir</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {datos.data.map((s) => {
                      const e = estadoDeInventario(s.status)
                      return (
                        <TR key={s.id}>
                          <TD className="font-semibold" data-numeric="">
                            {fechaDeInventario(s.startedAt)}
                          </TD>
                          <TD>{alcanceDeInventario(s.scope, s.categoryName)}</TD>
                          <TD>
                            <StatusBadge tone={e.tono} glyph={e.glifo}>
                              {e.etiqueta}
                            </StatusBadge>
                          </TD>
                          <TD align="right" data-numeric="">
                            {s.lineas.contadas} de {s.lineas.total}
                          </TD>
                          <TD align="right" data-numeric="">
                            {s.status === 'DRAFT' || s.status === 'COUNTING'
                              ? '—'
                              : s.lineas.conDiferencia}
                          </TD>
                          <TD align="right">
                            <ButtonLink
                              href={`/inventarios/${String(s.id)}`}
                              variant="secondary"
                              size="sm"
                            >
                              Abrir
                            </ButtonLink>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <CardList className="md:hidden">
              {datos.data.map((s) => {
                const e = estadoDeInventario(s.status)
                return (
                  <CardListItem key={s.id}>
                    <Link href={`/inventarios/${String(s.id)}`} className="block">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-base font-semibold text-ink">
                          {fechaDeInventario(s.startedAt)} ·{' '}
                          {alcanceDeInventario(s.scope, s.categoryName)}
                        </span>
                        <StatusBadge tone={e.tono} glyph={e.glifo}>
                          {e.etiqueta}
                        </StatusBadge>
                      </span>
                      <span className="mt-1 block text-sm text-ink-muted" data-numeric="">
                        Contados {s.lineas.contadas} de {s.lineas.total}
                      </span>
                    </Link>
                  </CardListItem>
                )
              })}
            </CardList>

            <Pagination
              page={datos.pagination.page}
              pageSize={datos.pagination.pageSize}
              total={datos.pagination.total}
              totalPages={Math.max(
                1,
                Math.ceil(datos.pagination.total / datos.pagination.pageSize),
              )}
              onPageChange={setPagina}
            />
          </>
        )}
      </section>
    </PageContainer>
  )
}
