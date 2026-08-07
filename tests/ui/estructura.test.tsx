/**
 * @vitest-environment jsdom
 *
 * Tablas, tarjetas, menus y ayuda al apuntar.
 *
 * Son las piezas que sostienen las pantallas administrativas. Lo que se
 * comprueba son las decisiones de la fase, no el aspecto:
 *
 *   - una tabla ancha se desplaza dentro de su caja, nunca arrastra la
 *     pagina;
 *   - en movil hay tarjetas, no una tabla estrujada;
 *   - la accion destructiva vive dentro de un menu y no suelta en la fila;
 *   - la ayuda al apuntar aparece tambien con el teclado.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CardList,
  CardListItem,
  SortableTH,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrap,
} from '@/components/ui/Table'
import { Card, CardHeader, MetricCard } from '@/components/ui/Card'
import { Tooltip } from '@/components/ui/Tooltip'
import { DropdownMenu, DropdownItem } from '@/components/ui/DropdownMenu'
import { Money } from '@/components/ui/Money'

describe('Tablas', () => {
  it('la tabla se desplaza dentro de su contenedor, no arrastra la pagina', () => {
    const { container } = render(
      <TableWrap>
        <Table caption="Catálogo de la sucursal">
          <THead>
            <TR>
              <TH>Producto</TH>
              <TH align="right">Precio</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>Yerba mate 1 kg</TD>
              <TD align="right">
                <Money amount="4850.00" />
              </TD>
            </TR>
          </TBody>
        </Table>
      </TableWrap>,
    )

    const envoltorio = container.firstElementChild
    // `min-w-0` es lo que impide que la tabla empuje al contenedor flex y
    // termine desplazando la pagina entera en un telefono.
    expect(envoltorio?.className).toContain('overflow-x-auto')
    expect(envoltorio?.className).toContain('min-w-0')
  })

  it('la tabla tiene descripcion para el lector de pantalla', () => {
    render(
      <Table caption="Movimientos de caja">
        <TBody>
          <TR>
            <TD>Venta</TD>
          </TR>
        </TBody>
      </Table>,
    )
    expect(screen.getByRole('table', { name: 'Movimientos de caja' })).toBeInTheDocument()
  })

  it('el encabezado que ordena es un boton y declara el sentido', async () => {
    const usuario = userEvent.setup()
    const ordenar = vi.fn()

    render(
      <Table caption="Catálogo">
        <THead>
          <TR>
            <SortableTH active direction="asc" onSort={ordenar}>
              Precio
            </SortableTH>
            <SortableTH active={false} direction="asc" onSort={() => undefined}>
              Nombre
            </SortableTH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>—</TD>
            <TD>—</TD>
          </TR>
        </TBody>
      </Table>,
    )

    expect(screen.getByRole('columnheader', { name: /precio/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(screen.getByRole('columnheader', { name: /nombre/i })).toHaveAttribute(
      'aria-sort',
      'none',
    )

    await usuario.click(screen.getByRole('button', { name: /precio/i }))
    expect(ordenar).toHaveBeenCalledOnce()
  })

  it('una fila interactiva declara si esta seleccionada', () => {
    render(
      <Table caption="Ventas">
        <TBody>
          <TR interactive selected>
            <TD>#128</TD>
          </TR>
        </TBody>
      </Table>,
    )
    expect(screen.getByRole('row')).toHaveAttribute('aria-selected', 'true')
  })

  it('en movil la lista de tarjetas reemplaza a la tabla', async () => {
    const usuario = userEvent.setup()
    const abrir = vi.fn()

    render(
      <CardList>
        <CardListItem onClick={abrir}>Yerba mate 1 kg</CardListItem>
        <CardListItem>Leche entera 1 L</CardListItem>
      </CardList>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // La tarjeta que se puede abrir es un boton, no un div con onClick.
    await usuario.click(screen.getByRole('button', { name: 'Yerba mate 1 kg' }))
    expect(abrir).toHaveBeenCalledOnce()
  })
})

describe('Tarjetas', () => {
  it('la tarjeta de metrica que lleva a algun lado es un enlace', () => {
    render(<MetricCard label="Efectivo en caja" value="$ 71.000,00" href="/caja" />)

    expect(screen.getByRole('link', { name: /efectivo en caja/i })).toHaveAttribute('href', '/caja')
  })

  it('sin destino no es un enlace', () => {
    render(<MetricCard label="Ventas de hoy" value={6} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('la cabecera de tarjeta usa un encabezado de verdad', () => {
    render(
      <Card>
        <CardHeader title="Últimos arqueos" description="Lo contado contra lo esperado." />
      </Card>,
    )
    expect(screen.getByRole('heading', { name: 'Últimos arqueos' })).toBeInTheDocument()
    expect(screen.getByText('Lo contado contra lo esperado.')).toBeInTheDocument()
  })
})

describe('Ayuda al apuntar', () => {
  it('aparece con el foco, no solo con el mouse', async () => {
    const usuario = userEvent.setup()
    render(
      <Tooltip label="Copiar el identificador">
        <button type="button">Copiar</button>
      </Tooltip>,
    )

    expect(screen.queryByRole('tooltip')).toBeNull()

    await usuario.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copiar el identificador')

    await usuario.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('queda asociada al control mientras se ve', async () => {
    const usuario = userEvent.setup()
    render(
      <Tooltip label="Vaciar la búsqueda">
        <button type="button">Vaciar</button>
      </Tooltip>,
    )

    await usuario.hover(screen.getByRole('button'))
    const globo = screen.getByRole('tooltip')
    expect(screen.getByRole('button').parentElement).toHaveAttribute('aria-describedby', globo.id)
  })
})

describe('Menu desplegable', () => {
  it('se abre y ejecuta la opcion elegida', async () => {
    const usuario = userEvent.setup()
    const editar = vi.fn()
    const eliminar = vi.fn()

    render(
      <DropdownMenu trigger={<button type="button">Acciones de Yerba mate</button>}>
        <DropdownItem onClick={editar}>Editar</DropdownItem>
        <DropdownItem tone="danger" onClick={eliminar}>
          Eliminar
        </DropdownItem>
      </DropdownMenu>,
    )

    await usuario.click(screen.getByRole('button', { name: /acciones de/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await usuario.click(screen.getByRole('menuitem', { name: 'Editar' }))
    expect(editar).toHaveBeenCalledOnce()
    expect(eliminar).not.toHaveBeenCalled()
  })

  it('la accion destructiva vive dentro del menu, no suelta en la fila', async () => {
    const usuario = userEvent.setup()
    render(
      <DropdownMenu trigger={<button type="button">Acciones</button>}>
        <DropdownItem>Editar</DropdownItem>
        <DropdownItem tone="danger">Eliminar</DropdownItem>
      </DropdownMenu>,
    )

    // Cerrado no hay ningun "Eliminar" que tocar por accidente. Antes era un
    // boton rojo pegado a "Editar" en cada una de las cuarenta filas.
    expect(screen.queryByRole('menuitem', { name: 'Eliminar' })).toBeNull()

    await usuario.click(screen.getByRole('button', { name: 'Acciones' }))
    expect(await screen.findByRole('menuitem', { name: 'Eliminar' })).toBeInTheDocument()
  })
})
