import type { Monto } from '@/lib/money'
import { formatearMonto } from '@/lib/money'

/**
 * El comprobante interno de venta, listo para una termica. V1 comercial.
 *
 * NO ES UNA FACTURA. Lo dice el papel, en la ultima linea, porque un ticket
 * que no lo aclara termina en la mano de un cliente que cree que tiene un
 * comprobante fiscal. La facturacion electronica es otra cosa y otra tanda.
 *
 * Todo lo que se dibuja llega ya calculado en `datos`: el componente no
 * suma, no redondea y no consulta nada. Es el mismo principio que el cierre
 * del dia. Y es un componente de servidor a proposito --sin `use client`--
 * para que una prueba lo renderice a texto sin montar nada.
 */
export interface LineaDeTicket {
  /** "2 u.", "0,425 kg". Ya formateada. */
  cantidad: string
  nombre: string
  precio: Monto
  subtotal: Monto
}

export interface PagoDeTicket {
  etiqueta: string
  importe: Monto
  /** Solo efectivo. */
  recibido?: Monto | null
  vuelto?: Monto | null
}

export interface DatosDeTicket {
  comercio: string
  /** ISO. Se formatea aca, en la zona del dispositivo que imprime. */
  fecha: string
  numero: number
  cajero: string
  lineas: LineaDeTicket[]
  total: Monto
  pagos: PagoDeTicket[]
  cliente?: string | null
  textoFinal?: string
  /** "ANULADA" cruzada arriba de todo, para una reimpresion de una anulada. */
  anulada?: boolean
}

export const LEYENDA_NO_FISCAL = 'Comprobante interno · No válido como factura'

export function fechaDeTicket(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function $(m: Monto): string {
  return formatearMonto(m)
}

export function TicketDeVenta({ datos }: { datos: DatosDeTicket }) {
  return (
    <article
      className="ticket"
      data-testid="ticket-de-venta"
      aria-label={`Ticket de la venta ${String(datos.numero)}`}
    >
      <header className="ticket-cabecera">
        <p className="ticket-comercio">{datos.comercio}</p>
        {datos.anulada && <p className="ticket-anulada">ANULADA</p>}
        <p>{fechaDeTicket(datos.fecha)}</p>
        <p>
          Venta N° <span data-numeric="">{datos.numero}</span>
        </p>
        <p>Cajero: {datos.cajero}</p>
        {datos.cliente && <p>Cliente: {datos.cliente}</p>}
      </header>

      <hr className="ticket-linea" />

      <table className="ticket-lineas">
        <tbody>
          {datos.lineas.map((l, i) => (
            // El indice como clave: el ticket no se reordena ni se edita.
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              <td className="ticket-cantidad">{l.cantidad}</td>
              <td className="ticket-nombre">
                {l.nombre}
                <span className="ticket-precio"> × {$(l.precio)}</span>
              </td>
              <td className="ticket-importe">{$(l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr className="ticket-linea" />

      <p className="ticket-total">
        <span>TOTAL</span>
        <span>{$(datos.total)}</span>
      </p>

      <dl className="ticket-pagos">
        {datos.pagos.map((p, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i}>
            <div className="ticket-renglon">
              <dt>{p.etiqueta}</dt>
              <dd>{$(p.importe)}</dd>
            </div>
            {p.recibido != null && (
              <div className="ticket-renglon ticket-secundario">
                <dt>Entregado</dt>
                <dd>{$(p.recibido)}</dd>
              </div>
            )}
            {p.vuelto != null && (
              <div className="ticket-renglon ticket-secundario">
                <dt>Vuelto</dt>
                <dd>{$(p.vuelto)}</dd>
              </div>
            )}
          </div>
        ))}
      </dl>

      <footer className="ticket-pie">
        {datos.textoFinal && <p>{datos.textoFinal}</p>}
        <p className="ticket-no-fiscal">{LEYENDA_NO_FISCAL}</p>
      </footer>
    </article>
  )
}

/**
 * El cierre del dia en papel. Los mismos numeros de la pantalla, en el ancho
 * del ticket, para dejarlo en el sobre con la plata.
 */
export interface DatosDeCierreImpreso {
  comercio: string
  fecha: string
  impresoEn: string
  ventas: { total: Monto; operaciones: number; anuladas: number }
  porMedio: Array<{ etiqueta: string; cobrado: Monto }>
  caja: {
    hay: boolean
    cajaInicial: Monto
    ventasEnEfectivo: Monto
    ingresos: Monto
    egresos: Monto
    deberiaHaber: Monto
    contado: Monto | null
    diferencia: Monto | null
  }
}

export function CierreImpreso({ datos }: { datos: DatosDeCierreImpreso }) {
  return (
    <article
      className="ticket"
      data-testid="cierre-impreso"
      aria-label={`Cierre del ${datos.fecha}`}
    >
      <header className="ticket-cabecera">
        <p className="ticket-comercio">{datos.comercio}</p>
        <p>Cierre del día {datos.fecha}</p>
        <p className="ticket-secundario">Impreso {fechaDeTicket(datos.impresoEn)}</p>
      </header>

      <hr className="ticket-linea" />

      <dl className="ticket-pagos">
        <div className="ticket-renglon ticket-total">
          <dt>Ventas</dt>
          <dd>{$(datos.ventas.total)}</dd>
        </div>
        <div className="ticket-renglon">
          <dt>Operaciones</dt>
          <dd data-numeric="">{datos.ventas.operaciones}</dd>
        </div>
        {datos.ventas.anuladas > 0 && (
          <div className="ticket-renglon ticket-secundario">
            <dt>Anuladas</dt>
            <dd data-numeric="">{datos.ventas.anuladas}</dd>
          </div>
        )}
      </dl>

      <hr className="ticket-linea" />
      <p className="ticket-titulo">MEDIOS DE PAGO</p>
      <dl className="ticket-pagos">
        {datos.porMedio.map((m) => (
          <div key={m.etiqueta} className="ticket-renglon">
            <dt>{m.etiqueta}</dt>
            <dd>{$(m.cobrado)}</dd>
          </div>
        ))}
        {datos.porMedio.length === 0 && <p className="ticket-secundario">Sin ventas.</p>}
      </dl>

      <hr className="ticket-linea" />
      <p className="ticket-titulo">CAJA (solo efectivo)</p>
      {datos.caja.hay ? (
        <dl className="ticket-pagos">
          <div className="ticket-renglon">
            <dt>Caja inicial</dt>
            <dd>{$(datos.caja.cajaInicial)}</dd>
          </div>
          <div className="ticket-renglon">
            <dt>+ Ventas efectivo</dt>
            <dd>{$(datos.caja.ventasEnEfectivo)}</dd>
          </div>
          <div className="ticket-renglon">
            <dt>+ Ingresos</dt>
            <dd>{$(datos.caja.ingresos)}</dd>
          </div>
          <div className="ticket-renglon">
            <dt>− Egresos</dt>
            <dd>{$(datos.caja.egresos)}</dd>
          </div>
          <div className="ticket-renglon ticket-total">
            <dt>Debería haber</dt>
            <dd>{$(datos.caja.deberiaHaber)}</dd>
          </div>
          <div className="ticket-renglon">
            <dt>Contaste</dt>
            <dd>{datos.caja.contado === null ? 'caja abierta' : $(datos.caja.contado)}</dd>
          </div>
          <div className="ticket-renglon ticket-total">
            <dt>Diferencia</dt>
            <dd>{datos.caja.diferencia === null ? '—' : $(datos.caja.diferencia)}</dd>
          </div>
        </dl>
      ) : (
        <p className="ticket-secundario">No se abrió la caja.</p>
      )}

      <footer className="ticket-pie">
        <p className="ticket-no-fiscal">Uso interno</p>
      </footer>
    </article>
  )
}
