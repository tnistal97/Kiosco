'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PageContainer,
  Alert,
  Badge,
  Button,
  Card,
  CardList,
  CardListItem,
  ConfirmationDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
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
import { ResetearClave } from '@/components/usuarios/ResetearClave'
import { rolLegible } from '@/components/shell/UserMenu'
import { usePermiso, useSession } from '@/components/shell/SessionProvider'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaUsuarios, parseRoles, type RolDTO, type UsuarioDTO } from '@/modules/users/dto'
import { CLAVE_TEMPORAL_MIN } from '@/modules/users/schemas'
import { normalizeUsername } from '@/modules/users/username'

const POR_PAGINA = 25

/** El rol que se ofrece primero: es a quien se da de alta casi siempre. */
const ROL_POR_DEFECTO = 'empleado'

function EstadoDe({ usuario }: { usuario: UsuarioDTO }) {
  return usuario.isActive ? (
    <Badge tone="success">
      <span aria-hidden="true">✓</span> Activo
    </Badge>
  ) : (
    <Badge tone="warning">
      <span aria-hidden="true">⊘</span> Desactivado
    </Badge>
  )
}

function ContrasenaDe({ usuario }: { usuario: UsuarioDTO }) {
  return usuario.mustChangePassword ? (
    <span className="text-sm text-warning" data-clave-temporal>
      Debe cambiar contraseña
    </span>
  ) : (
    <span className="text-sm text-ink-muted">Al día</span>
  )
}

/**
 * Usuarios de un local.
 *
 * La usa quien administra el local, que no es una persona tecnica: una lista
 * con lo que hace falta ver y los botones a la vista, sin menus escondidos. Las
 * reglas (a quien ve, que roles asigna, que no se puede deshacer) estan en el
 * servidor; aca solo se esconde lo que igual responderia que no.
 */
export default function UsuariosPage() {
  const { session } = useSession()
  const puedeVer = usePermiso('users.view')
  const puedeAdministrar = usePermiso('users.manage')
  // La matriz de permisos es para quien administra el sistema entero.
  const verMatriz = usePermiso('branches.manage')

  const [usuarios, setUsuarios] = useState<UsuarioDTO[]>([])
  const [roles, setRoles] = useState<RolDTO[]>([])
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [altaAbierta, setAltaAbierta] = useState(false)
  const [editando, setEditando] = useState<UsuarioDTO | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState<UsuarioDTO | null>(null)
  const [reseteando, setReseteando] = useState<UsuarioDTO | null>(null)

  const cargar = useCallback(async () => {
    if (!puedeVer) return
    setCargando(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(pagina), pageSize: String(POR_PAGINA) })
      const r = await apiRequest(`/api/users?${params.toString()}`, {
        parse: parsePaginaUsuarios,
      })
      setUsuarios(r.data)
      setTotal(r.pagination.total)
      setPaginas(r.pagination.totalPages)
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cargar la lista.'))
    } finally {
      setCargando(false)
    }
  }, [pagina, puedeVer])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (!puedeVer) return
    apiRequest('/api/roles', { parse: parseRoles })
      .then(setRoles)
      .catch(() => {
        setRoles([])
      })
  }, [puedeVer])

  async function alternarEstado() {
    if (!cambiandoEstado) return
    const nuevo = !cambiandoEstado.isActive
    try {
      await apiRequest(`/api/users/${String(cambiandoEstado.id)}`, {
        method: 'PUT',
        body: { isActive: nuevo },
        parse: () => null,
      })
      aviso.ok(nuevo ? 'Usuario activado.' : 'Usuario desactivado.')
      setCambiandoEstado(null)
      void cargar()
    } catch (err) {
      aviso.error(mensajeDeError(err, 'No se pudo cambiar el estado.'))
      setCambiandoEstado(null)
    }
  }

  if (!puedeVer) {
    return (
      <PageContainer>
        <EmptyState
          title="Esta pantalla es para administradores"
          description="Si necesitás algo de acá, pedíselo al administrador del local."
        />
      </PageContainer>
    )
  }

  /** Los botones de una fila. La propia solo se edita. */
  function Acciones({ usuario, compactas = false }: { usuario: UsuarioDTO; compactas?: boolean }) {
    if (!puedeAdministrar) return null
    const propio = usuario.id === session?.userId
    return (
      <div className={compactas ? 'mt-3 flex flex-wrap gap-2' : 'flex justify-end gap-2'}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setEditando(usuario)
          }}
        >
          Editar
        </Button>
        {!propio && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setReseteando(usuario)
              }}
            >
              Restablecer contraseña
            </Button>
            <Button
              size="sm"
              variant={usuario.isActive ? 'danger' : 'secondary'}
              onClick={() => {
                setCambiandoEstado(usuario)
              }}
            >
              {usuario.isActive ? 'Desactivar' : 'Activar'}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">
          Usuarios de {session?.branchName ?? 'la sucursal'}
        </h2>
        {puedeAdministrar && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setAltaAbierta(true)
            }}
          >
            + Nuevo usuario
          </Button>
        )}
      </div>

      <Card padded={false}>
        <div className="p-3">
          {error ? (
            <ErrorState description={error} onRetry={() => void cargar()} />
          ) : cargando ? (
            <SkeletonRows rows={5} />
          ) : usuarios.length === 0 ? (
            <EmptyState title="Todavía no hay usuarios" />
          ) : (
            <>
              <div className="hidden lg:block">
                <TableWrap className="border-0">
                  <Table caption="Usuarios del local">
                    <THead>
                      <TR>
                        <TH>Nombre</TH>
                        <TH>Usuario</TH>
                        <TH>Rol</TH>
                        <TH>Estado</TH>
                        <TH>Contraseña</TH>
                        <TH align="right">Acciones</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {usuarios.map((u) => (
                        <TR key={u.id}>
                          <TD className="font-medium text-ink">{u.name}</TD>
                          <TD className="text-ink-muted">{u.username}</TD>
                          <TD className="text-ink-muted">{rolLegible(u.role.name)}</TD>
                          <TD>
                            <EstadoDe usuario={u} />
                          </TD>
                          <TD>
                            <ContrasenaDe usuario={u} />
                          </TD>
                          <TD align="right">
                            <Acciones usuario={u} />
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>

              <CardList className="lg:hidden">
                {usuarios.map((u) => (
                  <CardListItem key={u.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{u.name}</p>
                        <p className="text-xs text-ink-faint">{u.username}</p>
                        <p className="mt-1 text-xs text-ink-muted">{rolLegible(u.role.name)}</p>
                        <ContrasenaDe usuario={u} />
                      </div>
                      <EstadoDe usuario={u} />
                    </div>
                    <Acciones usuario={u} compactas />
                  </CardListItem>
                ))}
              </CardList>

              {paginas > 1 && (
                <Pagination
                  className="mt-4"
                  page={pagina}
                  pageSize={POR_PAGINA}
                  total={total}
                  totalPages={paginas}
                  onPageChange={setPagina}
                  disabled={cargando}
                />
              )}
            </>
          )}
        </div>
      </Card>

      {verMatriz && <MatrizPermisos roles={roles} />}

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

      <ResetearClave
        usuario={reseteando}
        onCerrar={() => {
          setReseteando(null)
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
        confirmLabel={cambiandoEstado?.isActive ? 'Desactivar' : 'Activar'}
        title={cambiandoEstado?.isActive ? 'Desactivar usuario' : 'Activar usuario'}
        message={
          cambiandoEstado?.isActive ? (
            <>
              <strong className="text-ink">{cambiandoEstado.name}</strong> no va a poder entrar más
              y se le cierra la sesión ahora. Lo que hizo queda guardado.
            </>
          ) : (
            <>
              <strong className="text-ink">{cambiandoEstado?.name}</strong> va a poder volver a
              entrar con su usuario y su contraseña de antes.
            </>
          )
        }
      />
    </PageContainer>
  )
}

/**
 * Alta y edicion.
 *
 * La contrasena solo aparece en el alta, a la vista y sin repetirla: es una
 * temporal que el administrador le dice al empleado, y despues no se puede ver
 * mas. Cambiarla es otra operacion: "Restablecer contraseña".
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
    const porDefecto = roles.find((r) => r.name === ROL_POR_DEFECTO) ?? roles[0]
    setNombre(usuario?.name ?? '')
    setUsername(usuario?.username ?? '')
    setClave('')
    setRol(String(usuario?.role.id ?? porDefecto?.id ?? ''))
    setError(null)
    setEnviando(false)
  }, [abierto, usuario, roles])

  const valido =
    nombre.trim().length > 0 &&
    rol !== '' &&
    normalizeUsername(username).length >= 3 &&
    (!esAlta || clave.length >= CLAVE_TEMPORAL_MIN)

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
            username: normalizeUsername(username),
            name: nombre.trim(),
            password: clave,
            roleId: Number(rol),
          },
          parse: () => null,
        })
      } else {
        await apiRequest(`/api/users/${String(usuario.id)}`, {
          method: 'PUT',
          body: {
            name: nombre.trim(),
            username: normalizeUsername(username),
            roleId: Number(rol),
          },
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

  // Un rol que quien edita no puede asignar se muestra igual: el formulario no
  // puede cambiarlo sin querer.
  const opciones =
    usuario && !roles.some((r) => r.id === usuario.role.id) ? [usuario.role, ...roles] : roles

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

        <Field label="Nombre" required>
          <Input
            value={nombre}
            disabled={enviando}
            onChange={(e) => {
              setNombre(e.target.value)
            }}
          />
        </Field>

        <Field label="Usuario" required hint="Con esto entra al sistema. Sin espacios.">
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

        {esAlta && (
          <Field
            label="Contraseña temporal"
            required
            hint={`Al menos ${String(CLAVE_TEMPORAL_MIN)} caracteres. Decísela: la usa una sola vez y al entrar elige otra.`}
          >
            <Input
              value={clave}
              disabled={enviando}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setClave(e.target.value)
              }}
            />
          </Field>
        )}

        <Field label="Rol" required>
          <Select
            value={rol}
            disabled={enviando}
            onChange={(e) => {
              setRol(e.target.value)
            }}
          >
            {opciones.map((r) => (
              <option key={r.id} value={r.id}>
                {rolLegible(r.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
