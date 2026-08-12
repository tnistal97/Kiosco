'use client'

import { useState } from 'react'
import { Alert, Button } from '@/components/ui'

/**
 * Que pasó con el último código, dicho de forma explícita.
 *
 * Antes de la Fase 5A.1 los cinco desenlaces terminaban en la misma linea de
 * texto chica debajo del campo: un codigo desconocido, uno invalido y un fallo
 * de red se veian igual, y ninguno ofrecia un camino. En el mostrador eso se
 * vive como "no pasó nada" --el cajero vuelve a pasar el producto por el lector,
 * dos o tres veces, y despues busca otro parecido--.
 *
 * Este bloque NO aparece cuando el producto se encontro: ese camino tiene que
 * seguir siendo instantaneo y sin ruido, y ya se anuncia en el campo. Solo
 * interrumpe cuando hay una decision que tomar.
 *
 * Las acciones dependen del permiso, y NUNCA hay un boton muerto: si el usuario
 * no puede crear productos, en vez del boton se explica a quien pedirle. Un
 * boton deshabilitado sin explicacion es peor que no tenerlo.
 */

export type EstadoDelCodigo =
  | { tipo: 'no-registrado'; codigo: string }
  | { tipo: 'invalido'; codigo: string; motivo: string }
  | { tipo: 'inactivo'; codigo: string; nombre: string; productId: number }
  | { tipo: 'sin-red'; codigo: string; mensaje: string }

export interface CodigoSinResolverProps {
  estado: EstadoDelCodigo
  puedeCrear: boolean
  puedeReactivar: boolean
  onCrear: () => void
  onReactivar: () => void
  onReintentar: () => void
  onCerrar: () => void
}

export function CodigoSinResolver({
  estado,
  puedeCrear,
  puedeReactivar,
  onCrear,
  onReactivar,
  onReintentar,
  onCerrar,
}: CodigoSinResolverProps) {
  const [copiado, setCopiado] = useState(false)

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(estado.codigo)
      setCopiado(true)
      setTimeout(() => {
        setCopiado(false)
      }, 1500)
    } catch {
      // Sin permiso de portapapeles --o sin HTTPS-- no se puede copiar. El
      // codigo esta a la vista igual, que es lo que hace falta para dictarlo.
      setCopiado(false)
    }
  }

  const { titulo, tono, cuerpo, acciones } = describir()

  return (
    <Alert tone={tono} title={titulo}>
      <div className="flex flex-col gap-3">
        <p className="font-mono text-base tracking-wide text-ink" data-codigo-leido="">
          {estado.codigo}
        </p>
        <p>{cuerpo}</p>
        <div className="flex flex-wrap gap-2">
          {acciones}
          <Button size="sm" variant="ghost" onClick={() => void copiar()}>
            {copiado ? 'Copiado' : 'Copiar código'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>
    </Alert>
  )

  function describir() {
    switch (estado.tipo) {
      case 'no-registrado':
        return {
          titulo: 'Código no registrado',
          tono: 'warning' as const,
          cuerpo: puedeCrear
            ? 'No hay ningún producto con este código. Podés darlo de alta y seguir vendiendo.'
            : 'No hay ningún producto con este código. Este usuario no tiene permiso para crear productos: pedíselo a un encargado.',
          acciones: puedeCrear ? (
            <Button size="sm" variant="confirm" onClick={onCrear}>
              Crear producto
            </Button>
          ) : null,
        }

      case 'invalido':
        return {
          titulo: 'Código inválido',
          tono: 'danger' as const,
          // A proposito NO se ofrece crear: el codigo no puede existir, asi que
          // el alta iba a fallar igual. Lo que hay que hacer es volver a leerlo.
          cuerpo: `${estado.motivo}. Pasá el producto por el lector otra vez, o escribí el código a mano.`,
          acciones: null,
        }

      case 'inactivo':
        return {
          titulo: 'Producto inactivo',
          tono: 'warning' as const,
          cuerpo: puedeReactivar
            ? `"${estado.nombre}" está dado de baja y no se puede vender. Si volvió a estar en venta, reactivalo.`
            : `"${estado.nombre}" está dado de baja y no se puede vender. Pedile a un encargado que lo reactive.`,
          acciones: puedeReactivar ? (
            <Button size="sm" variant="primary" onClick={onReactivar}>
              Reactivar
            </Button>
          ) : null,
        }

      case 'sin-red':
        return {
          titulo: 'No se pudo consultar el código',
          tono: 'danger' as const,
          cuerpo: `${estado.mensaje} No se sabe si el producto existe: no se creó nada.`,
          acciones: (
            <Button size="sm" variant="primary" onClick={onReintentar}>
              Reintentar
            </Button>
          ),
        }
    }
  }
}
