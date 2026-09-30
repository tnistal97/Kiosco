'use client'

import { useEffect, useState } from 'react'
import { Field, Input, RadioGroup } from '@/components/ui'
import {
  guardarPreferencias,
  leerPreferencias,
  esAncho,
  TEXTO_FINAL_MAX,
  type PreferenciasDeImpresion as Preferencias,
} from './preferencias'

/**
 * La tarjeta de Configuracion para la impresora. Dos decisiones y nada mas:
 * el ancho del papel y la frase del final. Se guardan al instante, en este
 * navegador, porque la impresora es de esta maquina.
 */
export function PreferenciasDeImpresion() {
  const [prefs, setPrefs] = useState<Preferencias | null>(null)

  useEffect(() => {
    setPrefs(leerPreferencias())
  }, [])

  function cambiar(cambio: Partial<Preferencias>) {
    setPrefs((actual) => {
      const nuevo = { ...(actual ?? leerPreferencias()), ...cambio }
      guardarPreferencias(nuevo)
      return nuevo
    })
  }

  if (prefs === null) return null

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        legend="Ancho del papel"
        name="ancho-del-ticket"
        columns={2}
        value={prefs.ancho}
        onChange={(v) => {
          if (esAncho(v)) cambiar({ ancho: v })
        }}
        options={[
          { value: '58', label: '58 mm', description: 'Las térmicas chicas, de mostrador.' },
          { value: '80', label: '80 mm', description: 'Las térmicas comunes.' },
        ]}
      />
      <Field
        label="Texto al pie del ticket"
        hint="Una frase. Vacío, no se imprime nada. Abajo va siempre la aclaración de que no es factura."
      >
        <Input
          value={prefs.textoFinal}
          maxLength={TEXTO_FINAL_MAX}
          onChange={(e) => {
            cambiar({ textoFinal: e.target.value })
          }}
        />
      </Field>
    </div>
  )
}
