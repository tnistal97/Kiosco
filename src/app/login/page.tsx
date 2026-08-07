'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Alert, Button, Field, Input, cn } from '@/components/ui'
import { ApiError, apiRequest, mensajeDeError } from '@/lib/api-client'
import { useCartStore } from '@/store/cart'

/** Nombre del comercio. Configurable sin tocar el codigo. */
const COMERCIO = process.env.NEXT_PUBLIC_COMMERCE_NAME ?? 'Almacén'

/**
 * Destino despues de iniciar sesion.
 *
 * El middleware agrega `?next=` con la pantalla que el usuario intentaba
 * abrir. Solo se aceptan rutas internas: una que empiece con `//` o que
 * traiga esquema es una URL a otro sitio, y respetarla convertiria el login
 * en una redireccion abierta que sirve para pescar credenciales.
 */
function destinoSeguro(next: string | null): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  if (next.startsWith('/login')) return '/'
  return next
}

/**
 * Motivo por el que el usuario termino aca.
 *
 * Se pasa por query desde el cliente HTTP cuando una peticion vuelve 401 con
 * la sesion vencida. Sin esto, alguien que estuvo diez minutos sin tocar la
 * pantalla ve el login de golpe y no sabe si se equivoco de tecla.
 */
const MOTIVOS: Record<string, { tono: 'warning' | 'danger'; titulo: string; texto: string }> = {
  expirada: {
    tono: 'warning',
    titulo: 'La sesión venció',
    texto: 'Por seguridad se cierra sola tras un rato sin uso. Volvé a entrar para seguir.',
  },
  inactivo: {
    tono: 'danger',
    titulo: 'La cuenta está dada de baja',
    texto: 'Pedile a un administrador que la vuelva a habilitar.',
  },
  cerrada: {
    tono: 'warning',
    titulo: 'Sesión cerrada',
    texto: 'Podés volver a entrar cuando quieras.',
  },
}

/**
 * `useSearchParams` obliga a un limite de Suspense: sin el, el build de Next
 * falla al prerenderizar la pagina.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<Marco>{null}</Marco>}>
      <Formulario />
    </Suspense>
  )
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-ink-on-solid"
          >
            {COMERCIO.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink">{COMERCIO}</h1>
            <p className="mt-1 text-sm text-ink-muted">Sistema de gestión</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Formulario() {
  const router = useRouter()
  const params = useSearchParams()
  const destino = destinoSeguro(params.get('next'))
  const motivo = MOTIVOS[params.get('motivo') ?? '']

  const vaciarCarrito = useCartStore((s) => s.clear)

  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bloqueado, setBloqueado] = useState(false)

  const campoUsuario = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campoUsuario.current?.focus()
  }, [])

  // Llegar al login significa que no hay sesion: el ticket a medias de quien
  // estuvo antes no puede sobrevivir a eso.
  useEffect(() => {
    vaciarCarrito()
  }, [vaciarCarrito])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return

    setEnviando(true)
    setError(null)
    setBloqueado(false)

    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { username: usuario.trim(), password: clave },
        parse: () => null,
      })
      // `refresh` para que el armazon vuelva a pedir la sesion al servidor.
      router.replace(destino)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setBloqueado(true)
        setError(null)
      } else {
        setError(mensajeDeError(err, 'No se pudo iniciar sesión.'))
      }
      setEnviando(false)
    }
  }

  return (
    <Marco>
      <form
        onSubmit={(e) => void enviar(e)}
        className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      >
        {motivo && (
          <Alert tone={motivo.tono} title={motivo.titulo}>
            {motivo.texto}
          </Alert>
        )}

        {bloqueado && (
          <Alert tone="warning" title="Demasiados intentos">
            {/* Ni cuantos intentos quedaban, ni si el usuario existe: solo
                que hay que esperar. */}
            Esperá 15 minutos antes de volver a probar. Si no recordás la contraseña, pedile a un
            administrador que la restablezca.
          </Alert>
        )}

        {error && (
          <Alert tone="danger" title="No se pudo entrar">
            {error}
          </Alert>
        )}

        <Field label="Usuario" required>
          <Input
            ref={campoUsuario}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={usuario}
            onChange={(e) => {
              setUsuario(e.target.value)
            }}
            disabled={enviando}
          />
        </Field>

        <Field label="Contraseña" required>
          <div className="relative">
            <Input
              name="password"
              type={verClave ? 'text' : 'password'}
              autoComplete="current-password"
              value={clave}
              onChange={(e) => {
                setClave(e.target.value)
              }}
              disabled={enviando}
              className="pr-touch"
            />
            <button
              type="button"
              onClick={() => {
                setVerClave((v) => !v)
              }}
              // El estado se anuncia; el icono solo no lo dice.
              aria-pressed={verClave}
              aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
              className={cn(
                'absolute right-0 top-0 flex h-control w-touch items-center justify-center',
                'rounded-r-md text-ink-faint transition-colors hover:text-ink',
              )}
            >
              {verClave ? (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.4 5.3A9.5 9.5 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1M6.3 6.9C4.2 8.3 3 10.4 3 12c0 2.5 4 7 9 7 1.3 0 2.5-.3 3.6-.8" />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              )}
            </button>
          </div>
        </Field>

        <Button type="submit" variant="primary" size="lg" block loading={enviando} className="mt-1">
          Entrar
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-ink-faint">
        Si no podés entrar, hablá con el encargado del local.
      </p>
    </Marco>
  )
}
