'use client'

/**
 * Cuando falla el armazon mismo. UX V2, Fase 2.1.
 *
 * `error.tsx` cubre las pantallas, pero no puede cubrir al layout que lo
 * contiene: si lo que falla es el layout --y el layout es justamente el que
 * pregunta quien es el usuario contra la base-- React no tiene donde dibujar
 * el error y el navegador se queda con una pagina en blanco. Eso es lo que se
 * veia con la base caida.
 *
 * Este archivo reemplaza al documento entero, asi que trae su propio `html`,
 * su propio `body` y su propio estilo: no puede contar con las hojas de la
 * aplicacion ni con el script que elige el tema. Por eso el CSS va aca
 * adentro, corto y con las dos variantes de color.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body>
        <style>{`
          :root { color-scheme: light dark; }
          body {
            margin: 0;
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            background: #f6f7f9;
            color: #101418;
          }
          main { max-width: 34rem; text-align: center; }
          h1 { font-size: 1.375rem; margin: 0 0 .75rem; }
          p { margin: 0 0 1rem; line-height: 1.5; font-size: .9375rem; }
          .apagado { color: #5b6672; font-size: .8125rem; }
          .acciones { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; }
          button, a {
            display: inline-flex; align-items: center; justify-content: center;
            min-height: 44px; padding: 0 1.25rem; border-radius: .5rem;
            font: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
            border: 1px solid #c8ced6; background: #ffffff; color: #101418;
          }
          button { background: #1f6feb; border-color: #1f6feb; color: #ffffff; }
          @media (prefers-color-scheme: dark) {
            body { background: #0c1117; color: #e6edf3; }
            .apagado { color: #8b949e; }
            a { background: #161b22; border-color: #30363d; color: #e6edf3; }
          }
        `}</style>

        <main>
          <h1>No se pudo abrir la aplicación</h1>
          <p>
            El servidor no respondió como se esperaba. No se perdió nada de lo que ya estaba
            guardado: la caja, las ventas y el stock siguen en la base.
          </p>
          <p className="apagado">
            Probá de nuevo. Si sigue igual, revisá que el servidor y la base estén andando.
            {error.digest ? ` Código: ${error.digest}` : ''}
          </p>
          <div className="acciones">
            <button type="button" onClick={reset}>
              Probar de nuevo
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                aca fallo el layout raiz: hay que recargar el documento entero,
                que es justo lo que `<Link>` evita. */}
            <a href="/">Ir al inicio</a>
          </div>
        </main>
      </body>
    </html>
  )
}
