import { test, expect } from '@playwright/test'
import { PRODUCTOS, campoClave, entrar, escanear, leerMetrica, leerMonto, salir } from './ayudantes'

/**
 * Anulacion, ajuste de stock, acceso por rol y cierre de sesion.
 *
 * Son los caminos que mueven dinero o permisos y que no se pueden comprobar
 * mirando una pantalla suelta.
 */

test.describe('Anular una venta', () => {
  test('la venta no desaparece, deja de sumar y explica por que', async ({ page }) => {
    // 1) Una venta nueva, para anular esa y no una del seed.
    await entrar(page, 'cajero')
    await page.goto('/venta')
    await escanear(page, PRODUCTOS.yerba.codigo)

    await page.keyboard.press('F12')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^cobrar/i })
      .click()
    await expect(page.getByText('Venta registrada')).toBeVisible()

    const numero = (await page.getByText(/^#\d+$/).innerText()).replace('#', '')

    // El dialogo de exito bloquea el resto de la pantalla, que es lo que
    // tiene que hacer: hay que cerrarlo antes de seguir.
    await page.getByRole('button', { name: 'Nueva venta' }).click()
    await salir(page)

    // 2) El supervisor anula.
    await entrar(page, 'supervisor')
    await page.goto('/ventas')

    await page.getByLabel('N° de venta').fill(numero)
    await page.waitForTimeout(1200)

    const fila = page.getByRole('row', { name: new RegExp(`#${numero}\\b`) })
    await expect(fila).toBeVisible()

    const recaudadoAntes = await leerMetrica(page, 'Recaudado')

    await fila.getByRole('button', { name: 'Anular' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo.getByText(/vuelve el stock/i)).toBeVisible()
    await dialogo.getByLabel(/motivo/i).fill('El cliente devolvió la mercadería sin abrir')
    await dialogo.getByRole('button', { name: /anular la venta/i }).click()

    // 3) Sigue en la lista, marcada, y ya no suma.
    await expect(page.getByText(/venta anulada/i)).toBeVisible()
    await page.waitForTimeout(1200)

    await expect(fila).toBeVisible()
    await expect(fila.getByText('Anulada')).toBeVisible()

    const recaudadoDespues = await leerMetrica(page, 'Recaudado')
    expect(recaudadoDespues, 'una venta anulada siguio contando en la recaudacion').toBeLessThan(
      recaudadoAntes,
    )

    // 4) El motivo y el responsable quedan a la vista.
    await fila.click()
    // Aparece en la fila expandida y en el detalle; con que este, alcanza.
    await expect(
      page.getByText(/el cliente devolvió la mercadería sin abrir/i).first(),
    ).toBeVisible()
    await expect(page.getByText(/pablo ferrer/i).first()).toBeVisible()
  })

  test('un cajero no ve el boton de anular', async ({ page }) => {
    await entrar(page, 'cajero')
    await page.goto('/ventas')
    await page.waitForTimeout(1200)

    await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0)
  })
})

test.describe('Ajustar stock', () => {
  test('exige motivo y queda en la bitacora', async ({ page }) => {
    await entrar(page, 'repositor')
    await page.goto('/stock')

    await page.getByPlaceholder('Nombre o código de barras…').fill('Yerba')
    await page.waitForTimeout(1200)

    await page.getByRole('button', { name: 'Ajustar' }).first().click()
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()

    // Sin motivo no se puede guardar.
    await dialogo.getByLabel(/cantidad/i).fill('-3')
    await expect(dialogo.getByRole('button', { name: /guardar ajuste/i })).toBeDisabled()

    await dialogo.getByLabel('Motivo').fill('Rotura de mercadería')
    await dialogo.getByRole('button', { name: /guardar ajuste/i }).click()

    await expect(page.getByText(/stock ajustado/i)).toBeVisible()
    await salir(page)

    // El administrador lo encuentra en la bitacora, con su motivo.
    await entrar(page, 'admin')
    await page.goto('/auditoria')
    await page.getByLabel('Entidad').selectOption('BranchStock')
    await page.waitForTimeout(1200)

    // La primera entrada de la lista es la mas reciente: la que se acaba de
    // hacer. Se abre y tiene que traer el motivo escrito.
    await page.getByRole('button', { expanded: false }).first().click()
    // Aparece dos veces: como motivo de la entrada y dentro del visor de
    // cambios. Con que este, alcanza.
    await expect(page.getByText('Rotura de mercadería').first()).toBeVisible()
  })
})

test.describe('Acceso por rol', () => {
  test('el cajero no ve las secciones administrativas', async ({ page }) => {
    await entrar(page, 'cajero')

    const menu = page.getByRole('navigation', { name: 'Principal' })
    await expect(menu.getByRole('link', { name: 'Venta', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Auditoría', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
  })

  test('el repositor no ve la caja ni la venta', async ({ page }) => {
    await entrar(page, 'repositor')

    const menu = page.getByRole('navigation', { name: 'Principal' })
    await expect(menu.getByRole('link', { name: 'Productos', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Stock', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Venta', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Caja', exact: true })).toHaveCount(0)
  })

  test('compras edita la ficha pero no puede cambiar un precio', async ({ page }) => {
    // `compras` es el rol que tiene `products.update` SIN
    // `products.price.update`: puede cargar mercaderia y corregir una ficha,
    // pero el precio de venta lo decide quien maneja el local. El repositor
    // no sirve para esta prueba: no puede editar productos en absoluto.
    await entrar(page, 'compras')
    await page.goto('/productos')
    await page.waitForTimeout(1200)

    await page
      .getByRole('button', { name: /^acciones de/i })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()

    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeAttached()

    // El precio se ve pero no es un campo.
    await expect(dialogo.getByLabel(/^precio/i)).toHaveCount(0)
    await expect(dialogo.getByText('products.price.update')).toBeVisible()

    // Y lo que si puede editar, lo puede editar.
    await expect(dialogo.getByLabel('Nombre')).toBeEditable()
  })

  test('el encargado si puede cambiar un precio', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/productos')
    await page.waitForTimeout(1200)

    await page
      .getByRole('button', { name: /^acciones de/i })
      .first()
      .click()
    await page.getByRole('menuitem', { name: 'Editar' }).click()

    await expect(page.getByRole('dialog').getByLabel(/^precio/i)).toBeEditable()
  })

  test('entrar directo a una ruta sin permiso responde, no rompe', async ({ page }) => {
    await entrar(page, 'cajero')

    // Se espera la RESPUESTA, no el pintado: esperar el aviso en pantalla
    // dependia de cuando terminara de renderizar y fallaba de a ratos.
    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/audit') && r.status() === 403,
    )
    await page.goto('/auditoria')
    await respuesta

    // El middleware deja pasar --hay sesion-- y el servidor rechaza. La
    // pantalla lo muestra como error, no queda en blanco. Se filtra por texto
    // porque la region de avisos tambien es un `alert`, y esta vacia.
    const aviso = page.getByRole('alert').filter({ hasText: /no se pudo cargar/i })
    await expect(aviso).toBeVisible()

    // Y dice por que, en castellano: no un codigo ni una traza.
    await expect(aviso).toContainText(/falta el permiso/i)
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  })
})

test.describe('Sesion', () => {
  test('sin sesion, cualquier pantalla lleva al login y vuelve despues', async ({ page }) => {
    await page.goto('/productos')
    await page.waitForURL(/\/login\?next=%2Fproductos/)

    await page.getByRole('textbox', { name: 'Usuario' }).fill('admin')
    await campoClave(page).fill('Demo1234!')
    await page.getByRole('button', { name: 'Entrar' }).click()

    // Vuelve a donde queria ir, no al inicio.
    await page.waitForURL(/\/productos/)
  })

  test('el login muestra un error generico con datos incorrectos', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('textbox', { name: 'Usuario' }).fill('admin')
    await campoClave(page).fill('esta-no-es')
    await page.getByRole('button', { name: 'Entrar' }).click()

    const alerta = page.getByRole('alert')
    await expect(alerta).toBeVisible()
    // No dice si el usuario existe: eso permitiria enumerar cuentas.
    await expect(alerta).not.toContainText(/no existe|inexistente|usuario incorrecto$/i)
  })

  test('mostrar y ocultar la contrasena', async ({ page }) => {
    await page.goto('/login')
    const clave = campoClave(page)
    await clave.fill('Demo1234!')

    await expect(clave).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: /mostrar la contraseña/i }).click()
    await expect(clave).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: /ocultar la contraseña/i }).click()
    await expect(clave).toHaveAttribute('type', 'password')
  })

  test('cerrar sesion deja fuera de las pantallas privadas', async ({ page }) => {
    await entrar(page, 'admin')
    await salir(page)

    await page.goto('/caja')
    await page.waitForURL(/\/login/)
  })
})

test.describe('Caja', () => {
  test('advierte que el saldo es acumulado y no un turno', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')

    await expect(page.getByText(/acumulado, no el de un turno/i)).toBeVisible()
    await expect(page.getByText(/fase\s*3/i)).toBeVisible()
  })

  test('el arqueo muestra lo esperado y calcula la diferencia', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')

    await page.getByRole('button', { name: 'Hacer arqueo' }).click()
    const dialogo = page.getByRole('dialog')

    await expect(dialogo.getByText('El sistema espera')).toBeVisible()
    const esperado = leerMonto(await dialogo.getByText(/^\$/).first().innerText())

    await dialogo.getByLabel('Efectivo contado').fill(String(esperado - 1200))
    await expect(dialogo.getByText('Falta plata')).toBeVisible()

    await dialogo.getByLabel('Efectivo contado').fill(String(esperado))
    await expect(dialogo.getByText('Cuadra')).toBeVisible()

    await dialogo.getByRole('button', { name: /registrar arqueo/i }).click()
    await expect(page.getByText(/arqueo registrado/i)).toBeVisible()
  })

  test('los ingresos y los egresos se distinguen sin depender del color', async ({ page }) => {
    await entrar(page, 'encargado')
    await page.goto('/caja')
    await page.getByLabel('Rango de días').selectOption('7')
    await page.waitForTimeout(1200)

    // Se mira la primera columna de la tabla: el selector de tipo de arriba
    // tiene las mismas palabras, y la descripcion de cada fila tambien.
    const tabla = page.getByRole('table', { name: /movimientos de caja/i })
    const tipos = await tabla.locator('tbody td:first-child').allInnerTexts()

    // Cada tipo trae glifo Y palabra: quien no distingue verde de rojo lo lee
    // igual. Antes todos los importes salian en verde y el tipo no figuraba.
    expect(tipos.some((t) => t.includes('Venta'))).toBe(true)
    expect(tipos.some((t) => t.includes('Retiro'))).toBe(true)
    expect(tipos.some((t) => t.includes('↓'))).toBe(true)
    expect(tipos.some((t) => t.includes('↑'))).toBe(true)

    // Los importes negativos llevan el signo escrito, no solo color.
    await expect(tabla.getByText(/−\$/).first()).toBeVisible()
  })
})
