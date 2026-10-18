'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Drawer, IconButton, cn } from '@/components/ui'
import { navegacionPara, tituloDe } from './navigation'
import { ListaGrupos, Marca, Sidebar } from './Sidebar'
import { UserMenu } from './UserMenu'
import { EstadoCaja } from './EstadoCaja'
import { useSession, type SesionCliente } from './SessionProvider'
import { AvisoDeSesionVencida, SesionVencida } from './SesionVencida'

const CLAVE_CONTRAIDA = 'kiosco:menu-contraido'

/** Pantallas que se dibujan solas, sin barra lateral ni cabecera. */
const SIN_ARMAZON = ['/login', '/offline']

/**
 * Si lo que hay en pantalla ES la pantalla de sin conexion guardada.
 *
 * El service worker sirve el documento de `/offline` para cualquier direccion
 * --se pide /productos sin red y llega esa pantalla--, con lo cual la
 * direccion del navegador NO dice que se esta mostrando. La marca del propio
 * documento si. Se lee del DOM que se esta hidratando, que todavia es el HTML
 * que mando el servidor.
 *
 * Hace falta ademas de `useHayRed` porque `navigator.onLine` no es confiable:
 * con la red emulada de las pruebas sigue diciendo `true`, y en un equipo
 * conectado a un wifi sin salida tambien.
 */
function usePantallaSinConexion(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => document.querySelector('[data-pantalla="sin-conexion"]') !== null,
    () => false,
  )
}

/**
 * Si el navegador dice que hay red.
 *
 * Se pregunta con `useSyncExternalStore` --y no con un `useState` en un
 * efecto-- porque el servidor tambien dibuja este componente: la instantanea
 * del servidor es "hay red", y si el navegador dice otra cosa React vuelve a
 * dibujar solo, sin queja de hidratacion.
 */
function useHayRed(): boolean {
  const suscribir = useCallback((avisar: () => void) => {
    window.addEventListener('online', avisar)
    window.addEventListener('offline', avisar)
    return () => {
      window.removeEventListener('online', avisar)
      window.removeEventListener('offline', avisar)
    }
  }, [])

  return useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  )
}

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
  const { session, permisos, funciones } = useSession()
  const [cajonAbierto, setCajonAbierto] = useState(false)
  /**
   * `null` = sin preferencia guardada; entonces la barra arranca expandida.
   *
   * HASTA LA V3 arrancaba contraida en `/venta` --"si la ruta es la caja,
   * 236 px pasan a 68"--, y eso costaba un CLS de 0,6 medido: al entrar a la
   * caja la barra se encogia con una transicion de ancho y TODA la columna
   * principal se reacomodaba debajo del cursor. La regla por ruta no existe
   * mas. Quien quiera el riel lo contrae una vez y queda contraido en todas
   * las pantallas y en todas las sesiones, que ademas es lo que uno espera de
   * un boton de contraer.
   */
  const [preferencia, setPreferencia] = useState<boolean | null>(null)
  const hayRed = useHayRed()
  const sinConexion = usePantallaSinConexion()
  const contraida = preferencia ?? false

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
    // Sin red no hay sesion que comprobar, y ademas el service worker esta
    // sirviendo la pantalla de "sin conexion" GUARDADA bajo la direccion a la
    // que se quiso ir. Decir "tu sesion vencio" cuando lo que falta es la
    // conexion es mentir, y encima tapa el mensaje correcto, que ya viene
    // dibujado en el documento.
    if (!hayRed || sinConexion) return <>{children}</>
    return <SesionVencida pathname={pathname} />
  }

  const grupos = navegacionPara(permisos, funciones)
  const titulo = tituloDe(pathname)
  const comercio = session.branchName

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <Sidebar
        grupos={grupos}
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
        {/* `relative`: los textos solo para lectores de pantalla (`sr-only`,
            posicion absoluta) se ubican dentro de este panel. Sin eso se
            ubicaban en el documento, lo estiraban por debajo de la pantalla y
            al terminar la lista se desplazaba la ventana entera, dejando una
            franja vacia. */}
        <main
          id="contenido"
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto focus:outline-none"
        >
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

      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink sm:text-xl">
        {titulo}
      </h1>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <EstadoCaja />
        <UserMenu session={session} />
      </div>
    </header>
  )
}
