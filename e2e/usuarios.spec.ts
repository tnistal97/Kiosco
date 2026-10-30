import { test, expect, type Page } from '@playwright/test'
import { campoClave, CLAVE, entrar, salir } from './ayudantes'

/**
 * Usuarios de un local, de punta a punta y en un navegador de verdad: el
 * administrador del local da de alta a un empleado desde la pantalla, el
 * empleado entra y tiene que elegir su contrasena, y el administrador la
 * restablece y lo desactiva.
 *
 * Usa usuarios PROPIOS, con nombres unicos: los del seed los usan las demas
 * pruebas. El administrador del local se crea por la API con la sesion de
 * `admin`, igual que hace `scripts/promover-admin-local.ts`, y cada prueba
 * corre sobre su propio empleado.
 */

const TEMPORAL = 'temporal1'
const PROPIA = 'mi-clave-propia'
const OTRA_TEMPORAL = 'temporal2'

async function entrarCon(page: Page, usuario: string, clave: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Usuario' }).fill(usuario)
  await campoClave(page).fill(clave)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function adentro(page: Page): Promise<void> {
  await page.getByRole('button', { name: /cuenta de/i }).waitFor()
}

async function rechazado(page: Page): Promise<void> {
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
}

/** Crea un administrador de local desde la sesion de `admin`, y lo deja listo. */
async function crearAdministradorDelLocal(page: Page, usuario: string): Promise<void> {
  await entrar(page, 'admin')
  const estado = await page.evaluate(
    async ({ username, password }) => {
      const roles = (await (await fetch('/api/roles')).json()) as Array<{
        id: number
        name: string
      }>
      const rol = roles.find((r) => r.name === 'admin_local')
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, name: 'Dueño Local', password, roleId: rol?.id }),
      })
      return res.status
    },
    { username: usuario, password: TEMPORAL },
  )
  expect(estado).toBe(201)
  await salir(page)

  await entrarCon(page, usuario, TEMPORAL)
  await page.getByRole('heading', { name: 'Cambiá tu contraseña' }).waitFor()
  await page.getByRole('textbox', { name: 'Nueva contraseña' }).fill(CLAVE + CLAVE)
  await page.getByRole('textbox', { name: 'Repetir contraseña' }).fill(CLAVE + CLAVE)
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await adentro(page)
}

test('el administrador del local da de alta, el empleado elige su clave y el administrador lo desactiva', async ({
  page,
}) => {
  const sufijo = Date.now().toString(36)
  const jefe = `jefe_${sufijo}`
  const usuario = `emp_${sufijo}`
  const nombre = `Empleado ${sufijo}`
  const fila = page.getByRole('row', { name: new RegExp(nombre) })

  await crearAdministradorDelLocal(page, jefe)

  // 1. El administrador ve Usuarios en el menu y da de alta. Escribe el usuario
  //    con mayusculas: se guarda en minusculas.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Usuarios', exact: true })
    .click()
  await page.getByRole('button', { name: '+ Nuevo usuario' }).click()

  const alta = page.getByRole('dialog')
  await alta.getByRole('textbox', { name: 'Nombre' }).fill(nombre)
  await alta.getByRole('textbox', { name: 'Usuario' }).fill(usuario.toUpperCase())
  await alta.getByRole('textbox', { name: 'Contraseña temporal' }).fill(TEMPORAL)
  await expect(alta.getByRole('combobox', { name: 'Rol' })).toHaveValue(/\d+/)
  await expect(alta.getByRole('option')).toHaveText(['Administrador', 'Empleado'])
  await expect(alta.getByRole('combobox', { name: 'Rol' }).locator('option:checked')).toHaveText(
    'Empleado',
  )
  await alta.getByRole('button', { name: 'Crear' }).click()
  await expect(alta).toBeHidden()

  await expect(fila).toContainText(usuario)
  await expect(fila).toContainText('Empleado')
  await expect(fila).toContainText('Activo')
  await expect(fila).toContainText('Debe cambiar contraseña')
  // Quien lo usa no es una persona tecnica.
  await expect(page.locator('main')).not.toContainText(
    /bcrypt|hash|rbac|permission|mustChangePassword|sessionVersion/i,
  )
  await salir(page)

  // 2. El empleado entra escribiendo el usuario de otra forma, y solo puede
  //    elegir su contrasena: ir a otra pantalla no la saltea.
  await entrarCon(page, usuario.toUpperCase(), TEMPORAL)
  const obligatorio = page.getByRole('heading', { name: 'Cambiá tu contraseña' })
  await expect(obligatorio).toBeVisible()
  await expect(page.getByRole('button', { name: /cuenta de/i })).toHaveCount(0)

  await page.goto('/venta')
  await expect(obligatorio).toBeVisible()
  await expect(page.locator('[data-barcode-input]')).toHaveCount(0)
  await page.goto('/usuarios')
  await expect(obligatorio).toBeVisible()

  await page.getByRole('textbox', { name: 'Nueva contraseña' }).fill(PROPIA)
  await page.getByRole('textbox', { name: 'Repetir contraseña' }).fill(PROPIA)
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await adentro(page)

  // 3. El empleado no ve Usuarios, ni entrando a mano.
  const menu = page.getByRole('navigation', { name: 'Principal' })
  await expect(menu.getByRole('link', { name: 'Vender', exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
  await page.goto('/usuarios')
  await expect(page.getByText('Esta pantalla es para administradores')).toBeVisible()
  await salir(page)

  await entrarCon(page, usuario, PROPIA)
  await adentro(page)
  await salir(page)

  // 4. El administrador restablece: el empleado tiene que volver a elegirla.
  await entrarCon(page, jefe, CLAVE + CLAVE)
  await adentro(page)
  await page.goto('/usuarios')
  await fila.getByRole('button', { name: 'Restablecer contraseña' }).click()

  const reseteo = page.getByRole('dialog')
  await expect(reseteo.getByRole('heading', { name: 'Contraseña temporal' })).toBeVisible()
  await reseteo.getByRole('textbox', { name: 'Nueva contraseña temporal' }).fill(OTRA_TEMPORAL)
  await reseteo.getByRole('textbox', { name: 'Repetir contraseña' }).fill(OTRA_TEMPORAL)
  await reseteo.getByRole('button', { name: 'Restablecer' }).click()
  await expect(
    page.getByText('Contraseña restablecida. El usuario deberá elegir una nueva al ingresar.'),
  ).toBeVisible()
  await expect(fila).toContainText('Debe cambiar contraseña')
  await salir(page)

  await entrarCon(page, usuario, PROPIA)
  await rechazado(page)
  await entrarCon(page, usuario, OTRA_TEMPORAL)
  await expect(obligatorio).toBeVisible()
  await page.getByRole('textbox', { name: 'Nueva contraseña' }).fill(PROPIA)
  await page.getByRole('textbox', { name: 'Repetir contraseña' }).fill(PROPIA)
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await adentro(page)
  await salir(page)

  // 5. Desactivado no entra; activado vuelve con su clave.
  await entrarCon(page, jefe, CLAVE + CLAVE)
  await adentro(page)
  await page.goto('/usuarios')
  await fila.getByRole('button', { name: 'Desactivar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Desactivar' }).click()
  await expect(fila).toContainText('Desactivado')
  await salir(page)

  await entrarCon(page, usuario, PROPIA)
  await rechazado(page)

  await entrarCon(page, jefe, CLAVE + CLAVE)
  await adentro(page)
  await page.goto('/usuarios')
  await fila.getByRole('button', { name: 'Activar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Activar' }).click()
  await expect(fila).toContainText('Activo')
  await salir(page)

  await entrarCon(page, usuario, PROPIA)
  await adentro(page)
})

test('el administrador del local no se puede desactivar y no ve las cuentas generales', async ({
  page,
}) => {
  const jefe = `jefe2_${Date.now().toString(36)}`
  await crearAdministradorDelLocal(page, jefe)

  await page.goto('/usuarios')
  const propia = page.getByRole('row', { name: /Dueño Local/ }).first()
  await expect(propia.getByRole('button', { name: 'Editar' })).toBeVisible()

  const filaPropia = page.getByRole('row').filter({ hasText: jefe })
  await expect(filaPropia.getByRole('button', { name: 'Desactivar' })).toHaveCount(0)
  await expect(filaPropia.getByRole('button', { name: 'Restablecer contraseña' })).toHaveCount(0)

  // La cuenta general `admin` y la matriz de permisos no aparecen.
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toHaveCount(0)
  await expect(page.getByText('Rol × permiso')).toHaveCount(0)
})
