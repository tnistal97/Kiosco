/**
 * Como se arma un ticket a partir de lo que ya tiene cada pantalla.
 *
 * Dos origenes y un solo formato: la venta recien cobrada (con el carrito y
 * los pagos que se mandaron) y una venta del historial (tal como la devuelve
 * la API). El ticket no sabe de donde viene.
 */

import type { CartLine } from '@/store/cart'
import type { VentaDTO } from '@/modules/sales/dto'
import { precioPorCantidad, type TextoCantidad } from '@/lib/cantidad'
import { multiplicarMonto, type Monto } from '@/lib/money'
import { etiquetaDeMedio, normalizarMedio } from '@/modules/sales/payment-methods'
import { formatearCantidadConUnidad, unidadDeVentaODefecto } from '@/modules/products/units'
import type { DatosDeTicket, PagoDeTicket } from './Ticket'

/** Un pago tal como se mando al servidor, mas el vuelto que se calculo. */
export interface PagoCobrado {
  method: string
  amount: Monto
  cashReceived?: Monto | null
  changeGiven?: Monto | null
}

function etiquetaDeTicket(method: string): string {
  const medio = normalizarMedio(method)
  return medio === 'ACCOUNT' ? 'Fiado' : etiquetaDeMedio(medio)
}

function pagoDeTicket(p: PagoCobrado): PagoDeTicket {
  return {
    etiqueta: etiquetaDeTicket(p.method),
    importe: p.amount,
    recibido: p.cashReceived ?? null,
    vuelto: p.changeGiven ?? null,
  }
}

/** Recien cobrada: lo que habia en el carrito y lo que se cobro. */
export function ticketDeCobro(entrada: {
  comercio: string
  numero: number
  fecha: string
  cajero: string
  lineas: CartLine[]
  total: Monto
  pagos: PagoCobrado[]
  cliente: string | null
  textoFinal: string
}): DatosDeTicket {
  return {
    comercio: entrada.comercio,
    fecha: entrada.fecha,
    numero: entrada.numero,
    cajero: entrada.cajero,
    lineas: entrada.lineas.map((l) => ({
      cantidad: formatearCantidadConUnidad(l.quantity, l.saleUnit),
      nombre: l.name,
      precio: l.price,
      subtotal: precioPorCantidad(l.price, l.quantity),
    })),
    total: entrada.total,
    pagos: entrada.pagos.map(pagoDeTicket),
    cliente: entrada.cliente,
    textoFinal: entrada.textoFinal,
  }
}

/** Del historial: reimpresion. */
export function ticketDeVenta(
  venta: VentaDTO,
  entorno: { comercio: string; textoFinal: string },
): DatosDeTicket {
  return {
    comercio: entorno.comercio,
    fecha: venta.date,
    numero: venta.id,
    cajero: venta.user.name,
    lineas: venta.items.map((i) => {
      const unidad = unidadDeVentaODefecto(i.saleUnit)
      const cantidad: TextoCantidad = i.quantity.toFixed(3)
      return {
        cantidad: formatearCantidadConUnidad(cantidad, unidad),
        nombre: i.product.name,
        precio: i.price,
        subtotal: multiplicarMonto(i.price, i.quantity),
      }
    }),
    total: venta.total,
    pagos:
      venta.payments.length > 0
        ? venta.payments.map(pagoDeTicket)
        : venta.paymentMethod
          ? [{ etiqueta: etiquetaDeTicket(venta.paymentMethod), importe: venta.total }]
          : [],
    cliente: venta.client?.name ?? null,
    textoFinal: entorno.textoFinal,
    anulada: venta.status === 'canceled',
  }
}
