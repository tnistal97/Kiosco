/**
 * @vitest-environment jsdom
 *
 * Lo que cada rol ve.
 *
 * Caso obligatorio de la fase: **un usuario sin permiso no puede editar el
 * precio**. La comprobacion que cuenta es la del servidor
 * (`tests/authorization/roles.test.ts`); esta cubre la otra mitad, que la
 * pantalla no le ofrezca un campo que le van a rechazar.
 *
 * Sin permiso el precio no es un input deshabilitado: es texto. Un input gris
 * invita a intentarlo y a pelearse con la pantalla.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

/**
 * `usePathname` devuelve null sin un router de Next alrededor.
 *
 * Se simula en vez de hacer que el componente tolere null: el tipo dice
 * `string`, en la aplicacion siempre lo es, y agregar un `?? ''` seria
 * codigo muerto que ademas el linter marca.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/venta',
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}))
import { DialogoProducto } from '@/components/productos/DialogoProducto'
import { ListaGrupos } from '@/components/shell/Sidebar'
import { navegacionPara, tituloDe } from '@/components/shell/navigation'
import { permissionsForRole } from '@/server/authz/permissions'
import type { ProductoDTO } from '@/modules/products/dto'
import {
  renderConSesion,
  SESION_ADMIN,
  SESION_CAJERO,
  SESION_COMPRAS,
  SESION_REPOSITOR,
} from './helpers'

const PRODUCTO: ProductoDTO = {
  id: 1,
  name: 'Yerba mate 1 kg',
  barcode: '7790001000011',
  description: null,
  price: '4850.00',
  isActive: true,
  category: { id: 1, name: 'Almacen' },
  supplier: null,
  saleUnit: 'UNIT',
  purchaseUnit: 'UNIT',
  unitsPerPurchaseUnit: '1.000',
  totalStock: '24.000',
  sellableStock: '24.000',
  expiredStock: '0.000',
  minimumStock: '6.000',
  estado: 'OK',
}

const CATEGORIAS = [{ id: 1, name: 'Almacen' }]

function abrirFicha(sesion: typeof SESION_ADMIN) {
  return renderConSesion(
    <DialogoProducto
      producto={PRODUCTO}
      abierto
      categorias={CATEGORIAS}
      proveedores={[]}
      onCerrar={() => undefined}
      onGuardado={() => undefined}
    />,
    sesion,
  )
}

describe('Precio en la ficha del producto', () => {
  it('con products.price.update el precio es editable', async () => {
    abrirFicha(SESION_ADMIN)
    await screen.findByRole('dialog')

    const campo = screen.getByLabelText(/^precio/i)
    expect(campo).toBeInstanceOf(HTMLInputElement)
    expect(campo).not.toBeDisabled()
    // El campo trae la escala completa: es el mismo texto que devuelve la API.
    expect(campo).toHaveValue('4850.00')
  })

  it('SIN products.price.update el precio no es un campo', async () => {
    // `compras` puede editar la ficha entera menos el precio.
    abrirFicha(SESION_COMPRAS)
    await screen.findByRole('dialog')

    expect(
      screen.queryByLabelText(/^precio/i),
      'un usuario sin permiso de precios recibio un campo de precio editable',
    ).toBeNull()

    // El precio se sigue viendo: es informacion que necesita para trabajar.
    expect(screen.getByText(/4\.850/)).toBeInTheDocument()
    expect(screen.getByText(/products\.price\.update/)).toBeInTheDocument()
  })

  it('sin permiso tampoco aparece el interruptor de alta y baja', async () => {
    abrirFicha(SESION_COMPRAS)
    await screen.findByRole('dialog')
    expect(screen.queryByLabelText(/en venta/i)).toBeNull()
  })

  it('el stock actual se muestra, y NADIE lo edita desde la ficha', async () => {
    // Cambio de la Fase 3B: el stock dejo de ser un campo del formulario.
    // Mover inventario es una operacion con motivo, tipo y fila en el libro, y
    // se hace con el boton "Ajustar" de la pantalla de stock. Ni siquiera el
    // administrador tiene aca un campo para escribirlo.
    for (const sesion of [SESION_CAJERO, SESION_ADMIN]) {
      const { unmount } = abrirFicha(sesion)
      await screen.findByRole('dialog')

      expect(screen.queryByLabelText(/^stock actual/i)).toBeNull()
      expect(screen.getByText('24 u.')).toBeInTheDocument()
      expect(screen.getByText(/se mueve con el botón/i)).toBeInTheDocument()

      unmount()
    }
  })
})

describe('Costo en la ficha del producto', () => {
  it('SIN products.cost.view no hay costo ni margen en pantalla', async () => {
    // El cajero no tiene el permiso. Y el servidor tampoco le manda el dato:
    // esta prueba cubre la mitad visual, `tests/authorization` la otra.
    abrirFicha(SESION_CAJERO)
    await screen.findByRole('dialog')

    expect(screen.queryByLabelText(/^costo/i)).toBeNull()
    expect(screen.queryByText(/^margen$/i)).toBeNull()
    expect(screen.getByText(/products\.cost\.view/)).toBeInTheDocument()
  })

  it('con el permiso aparecen costo, ganancia, margen y markup', async () => {
    abrirFicha(SESION_ADMIN)
    await screen.findByRole('dialog')

    expect(screen.getByLabelText(/^costo/i)).toBeInstanceOf(HTMLInputElement)
    expect(screen.getByText('Ganancia')).toBeInTheDocument()
    expect(screen.getByText('Margen')).toBeInTheDocument()
    expect(screen.getByText('Markup')).toBeInTheDocument()
  })
})

describe('Navegacion filtrada por permiso', () => {
  it('el administrador ve todas las secciones', () => {
    const grupos = navegacionPara(new Set(SESION_ADMIN.permissions))
    const titulos = grupos.map((g) => g.title)
    // "Catálogo" pasó a llamarse "Inventario" en la Fase 3A: el grupo dejó de
    // ser una lista de productos y pasó a incluir el libro de movimientos.
    // "Control" --reportes y auditoría-- se separó de "Administración" en la
    // 3D: mirar el negocio y administrar el sistema son dos cosas.
    expect(titulos).toEqual([
      undefined,
      'Operación',
      'Inventario',
      'Compras',
      'Control',
      'Administración',
    ])
  })

  it('el cajero no ve el libro de movimientos', () => {
    // Ve el stock --lo necesita para vender-- pero no quién ajustó qué: eso es
    // información de control, no de mostrador.
    const grupos = navegacionPara(new Set(SESION_CAJERO.permissions))
    const rutas = grupos.flatMap((g) => g.items.map((i) => i.href))

    expect(rutas).toContain('/stock')
    expect(rutas).not.toContain('/stock/movimientos')
  })

  it('el cajero no ve Auditoria ni Usuarios', () => {
    const grupos = navegacionPara(new Set(SESION_CAJERO.permissions))
    const rutas = grupos.flatMap((g) => g.items.map((i) => i.href))

    expect(rutas).toContain('/venta')
    expect(rutas).toContain('/caja')
    expect(rutas).not.toContain('/auditoria')
    expect(rutas).not.toContain('/usuarios')
    expect(rutas).not.toContain('/sucursales')
  })

  it('el repositor no ve la caja ni la venta', () => {
    const grupos = navegacionPara(new Set(SESION_REPOSITOR.permissions))
    const rutas = grupos.flatMap((g) => g.items.map((i) => i.href))

    expect(rutas).toContain('/productos')
    expect(rutas).toContain('/stock')
    expect(rutas).not.toContain('/venta')
    expect(rutas).not.toContain('/caja')
    expect(rutas).not.toContain('/ventas')
  })

  it('un rol desconocido solo ve lo que no exige permiso', () => {
    const grupos = navegacionPara(permissionsForRole('rol-que-no-existe'))
    const rutas = grupos.flatMap((g) => g.items.map((i) => i.href))

    // Inicio y Configuracion no piden permiso; nada mas debe quedar.
    expect(rutas.sort()).toEqual(['/', '/configuracion'])
  })

  it('los enlaces que se dibujan son solo los permitidos', () => {
    renderConSesion(
      <ListaGrupos grupos={navegacionPara(new Set(SESION_CAJERO.permissions))} />,
      SESION_CAJERO,
    )

    // Nombres exactos: "Venta" y "Ventas" son dos entradas distintas.
    expect(screen.getByRole('link', { name: 'Venta' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Caja' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Auditoría' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Usuarios' })).toBeNull()
  })

  it('la seccion activa se marca con aria-current', () => {
    renderConSesion(
      <ListaGrupos grupos={navegacionPara(new Set(SESION_CAJERO.permissions))} />,
      SESION_CAJERO,
    )

    // El router simulado esta en /venta.
    expect(screen.getByRole('link', { name: 'Venta' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Caja' })).not.toHaveAttribute('aria-current')
  })
})

describe('Titulo de la pantalla', () => {
  it.each([
    ['/', 'Inicio'],
    ['/venta', 'Venta'],
    ['/caja', 'Caja'],
    ['/ventas', 'Ventas'],
    ['/productos', 'Productos'],
    ['/productos/12', 'Productos'],
    ['/auditoria', 'Auditoría'],
    ['/usuarios', 'Usuarios'],
  ])('%s se titula "%s"', (ruta, titulo) => {
    expect(tituloDe(ruta)).toBe(titulo)
  })
})
