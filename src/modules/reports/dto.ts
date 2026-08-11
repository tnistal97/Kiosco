/**
 * Los reportes, tal como viajan por la API.
 *
 * Todo importe llega como CADENA y se muestra como cadena: ni un solo numero
 * de JSON para dinero. Ver docs/PHASE3_MONEY_MIGRATION.md.
 *
 * Dos campos son NULOS A PROPOSITO y no por omision:
 *
 *   `valorizado`  llega nulo sin `reports.costs.view`. La pantalla no dibuja
 *                 la tarjeta; no muestra "$0,00", que seria mentira.
 *   `margen`      llega nulo cuando no hubo facturacion. Dividir por cero no
 *                 da cero, no da nada.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'
import { cantidadODefecto, type TextoCantidad } from '@/lib/cantidad'

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

export interface ReporteVentasDTO {
  totales: {
    facturado: Monto
    operaciones: number
    ticketPromedio: Monto
    anuladas: number
    facturadoAnulado: Monto
  }
  porDia: Array<{ dia: string; facturado: Monto; operaciones: number }>
  porCajero: Array<{ usuario: string; facturado: Monto; operaciones: number }>
  porMedio: Array<{ medio: string; etiqueta: string; cobrado: Monto; operaciones: number }>
}

export function parseReporteVentas(d: unknown): ReporteVentasDTO {
  const o = esObjeto(d) ? d : {}
  const t = esObjeto(o.totales) ? o.totales : {}
  return {
    totales: {
      facturado: montoODefecto(t.facturado),
      operaciones: numero(t.operaciones),
      ticketPromedio: montoODefecto(t.ticketPromedio),
      anuladas: numero(t.anuladas),
      facturadoAnulado: montoODefecto(t.facturadoAnulado),
    },
    porDia: lista(o.porDia, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        dia: texto(f.dia),
        facturado: montoODefecto(f.facturado),
        operaciones: numero(f.operaciones),
      }
    }),
    porCajero: lista(o.porCajero, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        usuario: texto(f.usuario),
        facturado: montoODefecto(f.facturado),
        operaciones: numero(f.operaciones),
      }
    }),
    porMedio: lista(o.porMedio, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        medio: texto(f.medio),
        etiqueta: texto(f.etiqueta),
        cobrado: montoODefecto(f.cobrado),
        operaciones: numero(f.operaciones),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Rentabilidad
// ---------------------------------------------------------------------------

export interface ReporteRentabilidadDTO {
  facturado: Monto
  costoVendido: Monto
  gananciaBruta: Monto
  margenBruto: string | null
  lineasSinCosto: number
  lineasTotales: number
  facturadoSinCosto: Monto
  porProducto: Array<{
    producto: string
    facturado: Monto
    costo: Monto
    ganancia: Monto
    margen: string | null
    lineasSinCosto: number
  }>
}

export function parseReporteRentabilidad(d: unknown): ReporteRentabilidadDTO {
  const o = esObjeto(d) ? d : {}
  return {
    facturado: montoODefecto(o.facturado),
    costoVendido: montoODefecto(o.costoVendido),
    gananciaBruta: montoODefecto(o.gananciaBruta),
    margenBruto: textoOpcional(o.margenBruto),
    lineasSinCosto: numero(o.lineasSinCosto),
    lineasTotales: numero(o.lineasTotales),
    facturadoSinCosto: montoODefecto(o.facturadoSinCosto),
    porProducto: lista(o.porProducto, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        producto: texto(f.producto),
        facturado: montoODefecto(f.facturado),
        costo: montoODefecto(f.costo),
        ganancia: montoODefecto(f.ganancia),
        margen: textoOpcional(f.margen),
        lineasSinCosto: numero(f.lineasSinCosto),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export interface ReporteProductosDTO {
  masVendidos: Array<{ producto: string; unidades: TextoCantidad; facturado: Monto }>
  menosVendidos: Array<{ producto: string; unidades: TextoCantidad; facturado: Monto }>
  sinVentas: number
}

function ranking(v: unknown) {
  return lista(v, (i) => {
    const f = esObjeto(i) ? i : {}
    return {
      producto: texto(f.producto),
      unidades: cantidadODefecto(f.unidades),
      facturado: montoODefecto(f.facturado),
    }
  })
}

export function parseReporteProductos(d: unknown): ReporteProductosDTO {
  const o = esObjeto(d) ? d : {}
  return {
    masVendidos: ranking(o.masVendidos),
    menosVendidos: ranking(o.menosVendidos),
    sinVentas: numero(o.sinVentas),
  }
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

export interface ReporteInventarioDTO {
  productos: number
  agotados: number
  bajoMinimo: number
  sinCosto: number
  /** Nulo sin `reports.costs.view`. La pantalla no dibuja la tarjeta. */
  valorizado: Monto | null
  productosSinValorizar: number | null
  movimientosPorTipo: Array<{ tipo: string; etiqueta: string; cuantos: number }>
}

export function parseReporteInventario(d: unknown): ReporteInventarioDTO {
  const o = esObjeto(d) ? d : {}
  return {
    productos: numero(o.productos),
    agotados: numero(o.agotados),
    bajoMinimo: numero(o.bajoMinimo),
    sinCosto: numero(o.sinCosto),
    valorizado: montoOpcional(o.valorizado),
    productosSinValorizar:
      typeof o.productosSinValorizar === 'number' ? o.productosSinValorizar : null,
    movimientosPorTipo: lista(o.movimientosPorTipo, (i) => {
      const f = esObjeto(i) ? i : {}
      return { tipo: texto(f.tipo), etiqueta: texto(f.etiqueta), cuantos: numero(f.cuantos) }
    }),
  }
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

export interface ReporteComprasDTO {
  ordenes: number
  recepciones: number
  totalComprado: Monto
  porProveedor: Array<{ proveedor: string; ordenes: number; total: Monto }>
  diferenciasDeCosto: Array<{
    orden: string
    producto: string
    esperado: Monto
    recibido: Monto
    diferencia: Monto
  }>
}

export function parseReporteCompras(d: unknown): ReporteComprasDTO {
  const o = esObjeto(d) ? d : {}
  return {
    ordenes: numero(o.ordenes),
    recepciones: numero(o.recepciones),
    totalComprado: montoODefecto(o.totalComprado),
    porProveedor: lista(o.porProveedor, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        proveedor: texto(f.proveedor),
        ordenes: numero(f.ordenes),
        total: montoODefecto(f.total),
      }
    }),
    diferenciasDeCosto: lista(o.diferenciasDeCosto, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        orden: texto(f.orden),
        producto: texto(f.producto),
        esperado: montoODefecto(f.esperado),
        recibido: montoODefecto(f.recibido),
        diferencia: montoODefecto(f.diferencia),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

export interface ReporteCajaDTO {
  turnos: number
  turnosConDiferencia: number
  sobrantes: Monto
  faltantes: Monto
  ingresos: Monto
  egresos: Monto
  retiros: Monto
  ventasEnEfectivo: Monto
  detalle: Array<{
    turno: number
    abierto: string
    cerradoPor: string | null
    esperado: Monto | null
    contado: Monto | null
    diferencia: Monto | null
  }>
}

export function parseReporteCaja(d: unknown): ReporteCajaDTO {
  const o = esObjeto(d) ? d : {}
  return {
    turnos: numero(o.turnos),
    turnosConDiferencia: numero(o.turnosConDiferencia),
    sobrantes: montoODefecto(o.sobrantes),
    faltantes: montoODefecto(o.faltantes),
    ingresos: montoODefecto(o.ingresos),
    egresos: montoODefecto(o.egresos),
    retiros: montoODefecto(o.retiros),
    ventasEnEfectivo: montoODefecto(o.ventasEnEfectivo),
    detalle: lista(o.detalle, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        turno: numero(f.turno),
        abierto: texto(f.abierto),
        cerradoPor: textoOpcional(f.cerradoPor),
        esperado: montoOpcional(f.esperado),
        contado: montoOpcional(f.contado),
        diferencia: montoOpcional(f.diferencia),
      }
    }),
  }
}

export interface ReporteClientesDTO {
  cartera: {
    saldoPendiente: Monto
    deudores: number
    deudaPromedio: Monto
    saldoAFavor: Monto
    conSaldoAFavor: number
    sobreLimite: number
  }
  periodo: {
    ventasACuenta: Monto
    cuantasVentasACuenta: number
    cobrado: Monto
    cuantosCobros: number
    cobradoEnEfectivo: Monto
    ajustes: Monto
  }
  topDeudores: Array<{ cliente: string; saldo: Monto; limite: Monto | null }>
  cobrosPorMedio: Array<{ medio: string; etiqueta: string; cobrado: Monto; cuantos: number }>
}

export function parseReporteClientes(d: unknown): ReporteClientesDTO {
  const o = esObjeto(d) ? d : {}
  const c = esObjeto(o.cartera) ? o.cartera : {}
  const p = esObjeto(o.periodo) ? o.periodo : {}

  return {
    cartera: {
      saldoPendiente: montoODefecto(c.saldoPendiente),
      deudores: numero(c.deudores),
      deudaPromedio: montoODefecto(c.deudaPromedio),
      saldoAFavor: montoODefecto(c.saldoAFavor),
      conSaldoAFavor: numero(c.conSaldoAFavor),
      sobreLimite: numero(c.sobreLimite),
    },
    periodo: {
      ventasACuenta: montoODefecto(p.ventasACuenta),
      cuantasVentasACuenta: numero(p.cuantasVentasACuenta),
      cobrado: montoODefecto(p.cobrado),
      cuantosCobros: numero(p.cuantosCobros),
      cobradoEnEfectivo: montoODefecto(p.cobradoEnEfectivo),
      ajustes: montoODefecto(p.ajustes),
    },
    topDeudores: lista(o.topDeudores, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        cliente: texto(f.cliente, '—'),
        saldo: montoODefecto(f.saldo),
        limite: montoOpcional(f.limite),
      }
    }),
    cobrosPorMedio: lista(o.cobrosPorMedio, (i) => {
      const f = esObjeto(i) ? i : {}
      return {
        medio: texto(f.medio, '—'),
        etiqueta: texto(f.etiqueta, texto(f.medio, '—')),
        cobrado: montoODefecto(f.cobrado),
        cuantos: numero(f.cuantos),
      }
    }),
  }
}

/** Lo que el panel necesita de la rentabilidad del dia: tres cifras. */
export function parseRentabilidadDelDia(d: unknown): {
  gananciaBruta: Monto
  margenBruto: string | null
  lineasSinCosto: number
} {
  const o = esObjeto(d) ? d : {}
  return {
    gananciaBruta: montoODefecto(o.gananciaBruta),
    margenBruto: textoOpcional(o.margenBruto),
    lineasSinCosto: numero(o.lineasSinCosto),
  }
}

// ---------------------------------------------------------------------------
// Proveedores y cuentas por pagar (Fase 4B)
// ---------------------------------------------------------------------------

export interface ReporteProveedoresDTO {
  cuentasPorPagar: {
    total: Monto
    proveedores: number
    vencido: Monto
    porVencer: Monto
    sinVencimiento: Monto
  }
  periodo: {
    recibido: Monto
    cuantasRecepciones: number
    pagado: Monto
    cuantosPagos: number
    pagadoEnEfectivo: Monto
    notasDeCredito: Monto
    ajustes: Monto
  }
  deudaPorProveedor: Array<{ proveedor: string; saldo: Monto; vencido: Monto }>
  topPorCompras: Array<{ proveedor: string; comprado: Monto; recepciones: number }>
  pagosPorMedio: Array<{ medio: string; etiqueta: string; pagado: Monto; cuantos: number }>
}

export function parseReporteProveedores(d: unknown): ReporteProveedoresDTO {
  const o = esObjeto(d) ? d : {}
  const c = esObjeto(o.cuentasPorPagar) ? o.cuentasPorPagar : {}
  const p = esObjeto(o.periodo) ? o.periodo : {}

  return {
    cuentasPorPagar: {
      total: montoODefecto(c.total),
      proveedores: numero(c.proveedores),
      vencido: montoODefecto(c.vencido),
      porVencer: montoODefecto(c.porVencer),
      sinVencimiento: montoODefecto(c.sinVencimiento),
    },
    periodo: {
      recibido: montoODefecto(p.recibido),
      cuantasRecepciones: numero(p.cuantasRecepciones),
      pagado: montoODefecto(p.pagado),
      cuantosPagos: numero(p.cuantosPagos),
      pagadoEnEfectivo: montoODefecto(p.pagadoEnEfectivo),
      notasDeCredito: montoODefecto(p.notasDeCredito),
      ajustes: montoODefecto(p.ajustes),
    },
    deudaPorProveedor: lista(o.deudaPorProveedor, (f) => {
      const x = esObjeto(f) ? f : {}
      return {
        proveedor: texto(x.proveedor, '—'),
        saldo: montoODefecto(x.saldo),
        vencido: montoODefecto(x.vencido),
      }
    }),
    topPorCompras: lista(o.topPorCompras, (f) => {
      const x = esObjeto(f) ? f : {}
      return {
        proveedor: texto(x.proveedor, '—'),
        comprado: montoODefecto(x.comprado),
        recepciones: numero(x.recepciones),
      }
    }),
    pagosPorMedio: lista(o.pagosPorMedio, (f) => {
      const x = esObjeto(f) ? f : {}
      return {
        medio: texto(x.medio, '—'),
        etiqueta: texto(x.etiqueta, '—'),
        pagado: montoODefecto(x.pagado),
        cuantos: numero(x.cuantos),
      }
    }),
  }
}
