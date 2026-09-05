'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Drawer, IconButton, cn } from '@/components/ui'
import { navegacionPara, tituloDe } from './navigation'
import { ListaGrupos, Marca, Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'
import { UserMenu } from './UserMenu'
import { EstadoCaja } from './EstadoCaja'
import { useSession, type SesionCliente } from './SessionProvider'
import { AvisoDeSesionVencida, SesionVencida } from './SesionVencida'

const CLAVE_CONTRAIDA = 'kiosco:menu-contraido'

/** Pantallas que se dibujan solas, sin barra lateral ni cabecera. */
const SIN_ARMAZON = ['/login', '/offline']

/**
 * Armazon de la aplicacion.
 *
 * Escritorio: barra lateral fija y contraible, cabecera baja de 56 px.
 * Movil y tablet: la barra lateral se convierte en un cajon.
 *
 * La cabecera lleva lo minimo --titulo, sucursal, estado de caja, usuario--
 * porque el espacio vertical en la caja se mide en productos visibles. La que
 * habia ocupaba 64 px fijos con ocho enlaces y un boton rojo de cerrar
 * sesion.
 *
 * El login no usa este armazon: es una pantalla propia, sin navegacion.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { session, permisos } = useSession()
  const [cajonAbierto, setCajonAbierto] = useState(false)
  // `null` = sin preferencia guardada. Entonces la barra arranca contraida en la
  // caja y expandida en el resto: en 1366 px, los 168 px que gana el ticket son
  // siete lineas mas a la vista (auditoria, §22). Quien la expanda queda con
  // su eleccion en todas las pantallas.
  const [preferencia, setPreferencia] = useState<boolean | null>(null)
  const contraida = preferencia ?? pathname === '/venta'

  // La preferencia se lee al montar, no en el render inicial: el servidor no
  // tiene localStorage y leerlo antes daria un HTML distinto al del cliente.
  useEffect(() => {
    try {
      const guardada = localStorage.getItem(CLAVE_CONTRAIDA)
      if (guardada === '1' || guardada === '0') setPreferencia(guardada === '1')
    } catch {
      // Sin almacenamiento, la barra arranca expandida.
    }
  }, [])

  function alternarContraida() {
    setPreferencia(() => {
      const nuevo = !contraida
      try {
        localStorage.setItem(CLAVE_CONTRAIDA, nuevo ? '1' : '0')
      } catch {
        // No es grave: se pierde la preferencia, no el estado.
      }
      return nuevo
    })
  }

  // Navegar cierra el cajon. Sin esto queda abierto encima de la pantalla
  // nueva y hay que cerrarlo a mano en cada paso.
  useEffect(() => {
    setCajonAbierto(false)
  }, [pathname])

  // Sin sesion hay dos casos distintos y hasta la 2.1 se trataban igual.
  //
  // En /login y /offline no hay nada que envolver: son pantallas propias, sin
  // navegacion, y asi tienen que verse.
  //
  // En cualquier OTRA pantalla, quedarse sin sesion y dibujar el contenido
  // pelado --sin barra lateral, sin cabecera-- es lo peor de los dos mundos:
  // parece que la aplicacion se rompio y no se entiende que hay que volver a
  // entrar. Pasa cuando el token todavia tiene firma valida (el middleware lo
  // deja pasar) pero la base ya no lo acepta: usuario dado de baja, sesion
  // revocada o sucursal cambiada.
  if (!session) {
    if (SIN_ARMAZON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return <>{children}</>
    }
    return <SesionVencida pathname={pathname} />
  }

  const grupos = navegacionPara(permisos)
  const titulo = tituloDe(pathname)
  const comercio = session.branchName

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <Sidebar
        permisos={permisos}
        collapsed={contraida}
        onToggle={alternarContraida}
        comercio={comercio}
      />

      <Drawer
        open={cajonAbierto}
        onClose={() => {
          setCajonAbierto(false)
        }}
        title="Menú"
      >
        <div className="p-2">
          <ListaGrupos
            grupos={grupos}
            onNavigate={() => {
              setCajonAbierto(false)
            }}
          />
        </div>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <Cabecera
          titulo={titulo}
          session={session}
          onAbrirMenu={() => {
            setCajonAbierto(true)
          }}
        />
        {/*
          `overflow-x-hidden` ademas de `overflow-y-auto`: sin el, una tabla
          ancha desplazaba la PAGINA entera al costado y se perdian de vista
          la navegacion y el total. Ahora cada tabla se desplaza dentro de su
          propio contenedor, que es lo que corresponde.
        */}
        <main id="contenido" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Un 401 en cualquier consulta, desde cualquier pantalla, termina aca. */}
      <AvisoDeSesionVencida />
    </div>
  )
}

function Cabecera({
  titulo,
  session,
  onAbrirMenu,
}: {
  titulo: string
  session: SesionCliente
  onAbrirMenu: () => void
}) {
  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4',
      )}
    >
      <IconButton label="Abrir el menú" size="sm" onClick={onAbrirMenu} className="lg:hidden">
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </IconButton>

      <div className="lg:hidden">
        <Marca compacta nombre={session.branchName} />
      </div>

      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink sm:text-lg">
        {titulo}
      </h1>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <EstadoCaja />
        <span className="hidden max-w-40 truncate text-sm text-ink-muted xl:inline">
          {session.branchName}
        </span>
        <ThemeToggle />
        <UserMenu session={session} />
      </div>
    </header>
  )
}
