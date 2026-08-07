'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  ConfirmationDialog,
  Dialog,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Pagination,
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
import { MatrizPermisos } from '@/components/usuarios/MatrizPermisos'
import { rolLegible } from '@/components/shell/UserMenu'
import { usePermiso, useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaUsuarios, parseRoles, type RolDTO, type UsuarioDTO } from '@/modules/users/dto'
import { PASSWORD_MIN } from '@/modules/users/schemas'

const POR_PAGINA = 25

function fechaCorta(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function UsuariosPage() {
  const { session } = useSession()
  const puedeAdministrar = usePermiso('users.manage')

  const [usuarios, setUsuarios] = useState<UsuarioDTO[]>([])
  const [roles, setRoles] = useState<RolDTO[]>([])
  const [estado, setEstado] = useState('todos')
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [altaAbierta, setAltaAbierta] = useState(false)
  const [editando, setEditando] = useState<UsuarioDTO | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState<UsuarioDTO | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(pagina),
        pageSize: String(POR_PAGINA),
        estado,
      })
      const r = await apiRequest(`/api/users?${params.toString()}`, {
        parse: parsePaginaUsuarios,
      })
      setUsuarios(r.data)
      setTotal(r.pagination.total)
      setPaginas(r.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar el personal.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, estado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    apiRequest('/api/roles', { parse: parseRoles })
      .then(setRoles)
      .catch(() => {
        setRoles([])
      })
  }, [])

  async function alternarEstado() {
    if (!cambiandoEstado) return
    const nuevo = !cambiandoEstado.isActive
    try {
      await apiRequest(`/api/users/${cambiandoEstado.id}`, {
        method: 'PUT',
        body: { isActive: nuevo },
        parse: () => null,
      })
      aviso.ok(nuevo ? 'Usuario habilitado.' : 'Usuario dado de baja.')
      setCambiandoEstado(null)
      void cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cambiar el estado.'))
      setCambiandoEstado(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-5">
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select
            aria-label="Estado"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value)
              setPagina(1)
            }}
            className="w-auto"
          >
            <option value="todos">Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Dados de baja</option>
          </Select>

          {puedeAdministrar && (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() => {
                setAltaAbierta(true)
              }}
            >
              Nuevo usuario
            </Button>
          )}
        </div>

        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={5} />
          ) : usuarios.length === 0 ? (
            <EmptyState title="No hay usuarios con ese filtro" />
          ) : (
            <>
              <div className="hidden md:block">
                <TableWrap className="border-0">
                  <Table caption="Personal de la sucursal">
                    <THead>
                      <TR>
                        <TH>Usuario</TH>
                        <TH>Rol</TH>
                        <TH>Sucursal</TH>
                        <TH>Estado</TH>
                        <TH>Alta</TH>
                        <TH align="right">
                          <span className="sr-only">Acciones</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {usuarios.map((u) => (
                        <TR key={u.id}>
                          <TD>
                            <p className="font-medium text-ink">{u.name}</p>
                            <p className="text-xs text-ink-faint">@{u.username}</p>
                          </TD>
                          <TD className="text-ink-muted">{rolLegible(u.role.name)}</TD>
                          <TD className="text-ink-muted">{u.branch.name}</TD>
                          <TD>
                            {u.isActive ? (
                              <Badge tone="success">
                                <span aria-hidden="true">✓</span> Activo
                              </Badge>
                            ) : (
                              <Badge tone="warning">
                                <span aria-hidden="true">⊘</span> De baja
                              </Badge>
                            )}
                          </TD>
                          <TD className="text-ink-muted">{fechaCorta(u.createdAt)}</TD>
                          <TD align="right">
                            {puedeAdministrar && u.id !== session?.userId && (
                              <DropdownMenu
                                trigger={
                                  <IconButton label={`Acciones de ${u.name}`} size="sm">
                                    <svg
                                      className="h-5 w-5"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                      aria-hidden="true"
                                    >
                                      <circle cx="12" cy="5" r="1.6" />
                                      <circle cx="12" cy="12" r="1.6" />
                                      <circle cx="12" cy="19" r="1.6" />
                                    </svg>
                                  </IconButton>
                                }
                              >
                                <DropdownItem
                                  onClick={() => {
                                    setEditando(u)
                                  }}
                                >
                                  Editar
                                </DropdownItem>
                                <DropdownItem
                                  tone={u.isActive ? 'danger' : 'default'}
                                  onClick={() => {
                                    setCambiandoEstado(u)
                                  }}
                                >
                                  {u.isActive ? 'Dar de baja' : 'Habilitar'}
                                </DropdownItem>
                              </DropdownMenu>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              <CardList className="md:hidden">
                {usuarios.map((u) => (
                  <CardListItem key={u.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{u.name}</p>
                        <p className="text-xs text-ink-faint">@{u.username}</p>
                        <p className="mt-1 text-xs text-ink-muted">{rolLegible(u.role.name)}</p>
                      </div>
                      {u.isActive ? (
                        <Badge tone="success">
                          <span aria-hidden="true">✓</span> Activo
                        </Badge>
                      ) : (
                        <Badge tone="warning">
                          <span aria-hidden="true">⊘</span> De baja
                        </Badge>
                      )}
                    </div>
                    {puedeAdministrar && u.id !== session?.userId && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          onClick={() => {
                            setEditando(u)
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant={u.isActive ? 'danger' : 'secondary'}
                          className="flex-1"
                          onClick={() => {
                            setCambiandoEstado(u)
                          }}
                        >
                          {u.isActive ? 'Dar de baja' : 'Habilitar'}
                        </Button>
                      </div>
                    )}
                  </CardListItem>
                ))}
              </CardList>

              <Pagination
                className="mt-4"
                page={pagina}
                pageSize={POR_PAGINA}
                total={total}
                totalPages={paginas}
                onPageChange={setPagina}
                disabled={cargando}
              />
            </>
          )}
        </div>
      </Card>

      <MatrizPermisos roles={roles} />

      <FormularioUsuario
        abierto={altaAbierta || editando !== null}
        usuario={editando}
        roles={roles}
        onCerrar={() => {
          setAltaAbierta(false)
          setEditando(null)
        }}
        onGuardado={() => {
          setAltaAbierta(false)
          setEditando(null)
          void cargar()
        }}
      />

      <ConfirmationDialog
        open={cambiandoEstado !== null}
        onClose={() => {
          setCambiandoEstado(null)
        }}
        onConfirm={alternarEstado}
        variant={cambiandoEstado?.isActive ? 'danger' : 'primary'}
        confirmLabel={cambiandoEstado?.isActive ? 'Dar de baja' : 'Habilitar'}
        title={cambiandoEstado?.isActive ? 'Dar de baja al usuario' : 'Habilitar al usuario'}
        message={
          cambiandoEstado?.isActive ? (
            <>
              <strong className="text-ink">{cambiandoEstado.name}</strong> no va a poder entrar más.
              Sus sesiones abiertas se cierran en el acto y su historial se conserva entero.
            </>
          ) : (
            <>
              <strong className="text-ink">{cambiandoEstado?.name}</strong> va a poder volver a
              entrar con su usuario y contraseña de antes.
            </>
          )
        }
      />
    </div>
  )
}

/**
 * Alta y edicion.
 *
 * La contrasena solo aparece en el alta. Cambiarla es una operacion distinta,
 * con su propia comprobacion: mezclarla con la edicion del perfil permitiria
 * cambiarla sin conocer la anterior.
 */
function FormularioUsuario({
  abierto,
  usuario,
  roles,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  usuario: UsuarioDTO | null
  roles: RolDTO[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const esAlta = usuario === null

  const [nombre, setNombre] = useState('')
  const [username, setUsername] = useState('')
  const [clave, setClave] = useState('')
  const [rol, setRol] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setNombre(usuario?.name ?? '')
    setUsername(usuario?.username ?? '')
    setClave('')
    setRol(String(usuario?.role.id ?? roles[0]?.id ?? ''))
    setError(null)
    setEnviando(false)
  }, [abierto, usuario, roles])

  const valido =
    nombre.trim().length > 0 &&
    rol !== '' &&
    (esAlta ? username.trim().length >= 3 && clave.length >= PASSWORD_MIN : true)

  async function guardar() {
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      if (esAlta) {
        await apiRequest('/api/users', {
          method: 'POST',
          // Sin `branchId`: la sucursal la fija el servidor con la de la
          // sesión. Mandarla hace fallar la petición entera.
          body: {
            username: username.trim(),
            name: nombre.trim(),
            password: clave,
            roleId: Number(rol),
          },
          parse: () => null,
        })
      } else {
        await apiRequest(`/api/users/${usuario.id}`, {
          method: 'PUT',
          body: { name: nombre.trim(), roleId: Number(rol) },
          parse: () => null,
        })
      }
      aviso.ok(esAlta ? 'Usuario creado.' : 'Usuario actualizado.')
      onGuardado()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar.'))
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      title={esAlta ? 'Nuevo usuario' : `Editar a ${usuario.name}`}
      size="md"
      dismissible={!enviando}
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={enviando}
            disabled={!valido}
            onClick={() => void guardar()}
          >
            {esAlta ? 'Crear' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" title="No se guardó">
            {error}
          </Alert>
        )}

        <Field label="Nombre y apellido" required>
          <Input
            value={nombre}
            disabled={enviando}
            onChange={(e) => {
              setNombre(e.target.value)
            }}
          />
        </Field>

        {esAlta && (
          <>
            <Field label="Usuario" required hint="Letras, números, punto, guion y guion bajo.">
              <Input
                value={username}
                disabled={enviando}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setUsername(e.target.value)
                }}
              />
            </Field>

            <Field
              label="Contraseña"
              required
              hint={`Al menos ${PASSWORD_MIN} caracteres. Se guarda cifrada; nadie puede verla después.`}
            >
              <Input
                type="password"
                value={clave}
                disabled={enviando}
                autoComplete="new-password"
                onChange={(e) => {
                  setClave(e.target.value)
                }}
              />
            </Field>
          </>
        )}

        <Field label="Rol" required hint="Define qué puede hacer. Ver la matriz más abajo.">
          <Select
            value={rol}
            disabled={enviando}
            onChange={(e) => {
              setRol(e.target.value)
            }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {rolLegible(r.name)}
              </option>
            ))}
          </Select>
        </Field>

        {!esAlta && (
          <Alert tone="info">
            Para cambiar la contraseña hay que darla de nuevo desde el servidor. No se puede hacer
            desde acá todavía.
          </Alert>
        )}
      </div>
    </Dialog>
  )
}
