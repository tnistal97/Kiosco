/**
 * @vitest-environment jsdom
 *
 * La biblioteca de componentes.
 *
 * Lo que se comprueba no es como se ven --eso son las capturas-- sino las
 * reglas que la fase impuso y que un cambio de estilos podria romper sin
 * avisar:
 *
 *   - ningun estado depende SOLO del color;
 *   - un campo no puede quedarse sin etiqueta;
 *   - el dinero tiene un solo formato;
 *   - vacio, error y carga se distinguen entre si.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Money, formatMoney } from '@/components/ui/Money'
import { Badge, SaleStatusBadge, StockBadge, StatusBadge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States'
import { Field, Input, Select, Textarea, Checkbox, RadioGroup } from '@/components/ui/Field'
import { Pagination } from '@/components/ui/Pagination'
import { Alert } from '@/components/ui/Alert'
import { Button, IconButton } from '@/components/ui/Button'
import { BarcodeInput } from '@/components/ui/BarcodeInput'

describe('Dinero', () => {
  it('un solo formato en toda la aplicacion', () => {
    // Antes convivian `$4850.00` y `$ 134.600,00` en la misma pantalla.
    expect(formatMoney('4850.00')).toBe(formatMoney('4850'))
    expect(formatMoney('4850.00')).toMatch(/4\.850,00/)
    expect(formatMoney('134600.00')).toMatch(/134\.600,00/)
    expect(formatMoney('0.00')).toMatch(/0,00/)
  })

  it('el signo se muestra explicito, no solo por color', () => {
    const { rerender } = render(<Money amount="-1500.00" signed />)
    expect(screen.getByText(/−/)).toBeInTheDocument()

    rerender(<Money amount="1500.00" signed />)
    expect(screen.getByText(/\+/)).toBeInTheDocument()
  })

  it('sin `signed` no antepone signo', () => {
    render(<Money amount="1500.00" />)
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('usa cifras de ancho fijo para que el total no baile', () => {
    const { container } = render(<Money amount="1500.00" />)
    expect(container.querySelector('[data-numeric]')).not.toBeNull()
  })
})

describe('Estados: nunca solo color', () => {
  it('una venta anulada trae simbolo ademas de color', () => {
    render(<SaleStatusBadge status="canceled" />)
    expect(screen.getByText('Anulada')).toBeInTheDocument()
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('una venta vigente se distingue de una anulada por el texto', () => {
    const { rerender } = render(<SaleStatusBadge status="completed" />)
    expect(screen.getByText('Vigente')).toBeInTheDocument()

    rerender(<SaleStatusBadge status="canceled" />)
    expect(screen.getByText('Anulada')).toBeInTheDocument()
  })

  it('el stock dice cuantos quedan, no solo si es poco', () => {
    const { rerender } = render(<StockBadge quantity={0} />)
    expect(screen.getByText('Agotado')).toBeInTheDocument()

    // El umbral es el MINIMO DEL PRODUCTO, no una constante global. Con
    // minimo 6 y cuatro unidades, esta bajo minimo y lo dice con los dos
    // numeros: cuantas quedan y cuantas tendria que haber.
    rerender(<StockBadge quantity={4} minimum={6} />)
    expect(screen.getByText(/quedan 4/i)).toBeInTheDocument()
    expect(screen.getByText(/mín\. 6/i)).toBeInTheDocument()

    rerender(<StockBadge quantity={40} minimum={6} />)
    expect(screen.getByText(/40 en stock/i)).toBeInTheDocument()
  })

  it('sin minimo configurado, cuatro unidades no son una alarma', () => {
    // Es la diferencia entre "faltan" y "nadie dijo cuantas tiene que haber".
    // Hasta la Fase 2 el umbral eran diez unidades para todo, y por eso el
    // aviso no significaba nada. Ver docs/INVENTORY_LEDGER.md, seccion 8.
    render(<StockBadge quantity={4} />)
    expect(screen.getByText(/4 en stock/i)).toBeInTheDocument()
    expect(screen.queryByText(/quedan/i)).toBeNull()
  })

  it('un badge de estado siempre lleva glifo', () => {
    render(<StatusBadge tone="warning">Pendiente</StatusBadge>)
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('●')).toBeInTheDocument()
  })

  it('un badge simple no exige glifo', () => {
    render(<Badge>Almacen</Badge>)
    expect(screen.getByText('Almacen')).toBeInTheDocument()
  })
})

describe('Vacio, error y carga se distinguen', () => {
  it('el vacio explica y puede ofrecer una accion', () => {
    render(
      <EmptyState
        title="Todavía no hay productos"
        description="Cargá el primero para empezar a vender."
        action={<Button>Nuevo producto</Button>}
      />,
    )
    expect(screen.getByText('Todavía no hay productos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuevo producto' })).toBeInTheDocument()
  })

  it('el error se anuncia y deja reintentar', async () => {
    const usuario = userEvent.setup()
    const reintentar = vi.fn()
    render(<ErrorState description="No hubo respuesta del servidor." onRetry={reintentar} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(reintentar).toHaveBeenCalledOnce()
  })

  it('la carga se anuncia a un lector de pantalla', () => {
    render(<SkeletonRows rows={3} />)
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })
})

describe('Campos de formulario', () => {
  it('la etiqueta queda asociada al control', () => {
    render(
      <Field label="Motivo del ajuste">
        <Input />
      </Field>,
    )
    const campo = screen.getByLabelText('Motivo del ajuste')
    expect(campo).toBeInstanceOf(HTMLInputElement)
  })

  it('un campo obligatorio lo declara para el lector de pantalla', () => {
    render(
      <Field label="Monto" required>
        <Input />
      </Field>,
    )
    expect(screen.getByLabelText(/monto/i)).toHaveAttribute('aria-required', 'true')
  })

  it('el error queda asociado al campo, no suelto en la pantalla', () => {
    render(
      <Field label="Precio" error="Tiene que ser mayor que cero">
        <Input />
      </Field>,
    )

    const campo = screen.getByLabelText(/precio/i)
    const error = screen.getByRole('alert')

    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo.getAttribute('aria-describedby')).toBe(error.id)
  })

  it('la ayuda tambien queda asociada', () => {
    render(
      <Field label="Código de barras" hint="Vacío si no tiene etiqueta">
        <Input />
      </Field>,
    )
    const campo = screen.getByLabelText(/código de barras/i)
    const ayuda = screen.getByText('Vacío si no tiene etiqueta')
    expect(campo.getAttribute('aria-describedby')).toBe(ayuda.id)
  })

  it('una etiqueta oculta sigue existiendo para el lector de pantalla', () => {
    render(
      <Field label="Buscar" labelHidden>
        <Input />
      </Field>,
    )
    expect(screen.getByLabelText('Buscar')).toBeInTheDocument()
  })

  it('select y textarea reciben el mismo trato', () => {
    render(
      <>
        <Field label="Categoría">
          <Select>
            <option value="1">Almacen</option>
          </Select>
        </Field>
        <Field label="Descripción">
          <Textarea />
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Categoría')).toBeInstanceOf(HTMLSelectElement)
    expect(screen.getByLabelText('Descripción')).toBeInstanceOf(HTMLTextAreaElement)
  })

  it('la casilla se activa haciendo clic en su texto', async () => {
    const usuario = userEvent.setup()
    const cambiar = vi.fn()
    render(<Checkbox label="En venta" onChange={cambiar} />)

    await usuario.click(screen.getByText('En venta'))
    expect(cambiar).toHaveBeenCalled()
  })

  it('el grupo de opciones es un fieldset con leyenda', async () => {
    const usuario = userEvent.setup()
    const cambiar = vi.fn()
    render(
      <RadioGroup
        legend="Medio de pago"
        name="medio"
        value="efectivo"
        onChange={cambiar}
        options={[
          { value: 'efectivo', label: 'Efectivo' },
          { value: 'tarjeta', label: 'Tarjeta' },
        ]}
      />,
    )

    expect(screen.getByRole('group', { name: 'Medio de pago' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /efectivo/i })).toBeChecked()

    await usuario.click(screen.getByRole('radio', { name: /tarjeta/i }))
    expect(cambiar).toHaveBeenCalledWith('tarjeta')
  })
})

describe('Paginacion', () => {
  it('dice cuantos hay en total, no solo la pagina', () => {
    render(
      <Pagination
        page={3}
        pageSize={25}
        total={128}
        totalPages={6}
        onPageChange={() => undefined}
      />,
    )
    expect(screen.getByText(/51–75/)).toBeInTheDocument()
    expect(screen.getByText(/128/)).toBeInTheDocument()
    expect(screen.getByText('3 / 6')).toBeInTheDocument()
  })

  it('no deja retroceder desde la primera ni avanzar desde la ultima', () => {
    const { rerender } = render(
      <Pagination
        page={1}
        pageSize={25}
        total={128}
        totalPages={6}
        onPageChange={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    rerender(
      <Pagination
        page={6}
        pageSize={25}
        total={128}
        totalPages={6}
        onPageChange={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })

  it('sin resultados no se dibuja', () => {
    const { container } = render(
      <Pagination page={1} pageSize={25} total={0} totalPages={1} onPageChange={() => undefined} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Avisos', () => {
  it('lo urgente interrumpe al lector de pantalla; lo informativo no', () => {
    const { rerender } = render(<Alert tone="danger">No se pudo guardar</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(<Alert tone="info">El saldo es acumulado</Alert>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('cada tono trae su glifo', () => {
    const { rerender } = render(<Alert tone="success">Listo</Alert>)
    expect(screen.getByText('✓')).toBeInTheDocument()

    rerender(<Alert tone="warning">Cuidado</Alert>)
    expect(screen.getByText('▲')).toBeInTheDocument()
  })
})

describe('Botones', () => {
  it('un boton en espera se bloquea y lo declara', () => {
    render(<Button loading>Cobrar</Button>)
    const boton = screen.getByRole('button')
    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('aria-busy', 'true')
  })

  it('un boton de solo icono tiene nombre accesible', () => {
    render(
      <IconButton label="Cerrar">
        <svg />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })

  it('por omision no envia formularios', () => {
    render(<Button>Guardar</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })
})

describe('Campo de codigo de barras', () => {
  it('se marca para que el escucha global no le robe las teclas', () => {
    render(<BarcodeInput onSubmit={() => undefined} />)
    expect(screen.getByLabelText(/codigo de barras/i)).toHaveAttribute('data-barcode-input')
  })

  it('Enter entrega el codigo y vacia el campo', async () => {
    const usuario = userEvent.setup()
    const enviar = vi.fn()
    render(<BarcodeInput onSubmit={enviar} />)

    const campo = screen.getByLabelText(/codigo de barras/i)
    await usuario.type(campo, '7790001000011{Enter}')

    expect(enviar).toHaveBeenCalledWith('7790001000011')
    expect(campo).toHaveValue('')
  })

  it('Enter con el campo vacio no entrega nada', async () => {
    const usuario = userEvent.setup()
    const enviar = vi.fn()
    render(<BarcodeInput onSubmit={enviar} />)

    await usuario.type(screen.getByLabelText(/codigo de barras/i), '{Enter}')
    expect(enviar).not.toHaveBeenCalled()
  })

  it('el resultado se anuncia', () => {
    render(<BarcodeInput onSubmit={() => undefined} status="error" message="Código desconocido" />)
    expect(screen.getByRole('status')).toHaveTextContent('Código desconocido')
  })
})
