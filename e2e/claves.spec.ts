import { test, expect, type Page } from '@playwright/test'
import { campoClave, entrar, salir } from './ayudantes'

/**
 * Contrasenas desde la aplicacion (P0-A), de punta a punta y en un navegador
 * de verdad: el administrador resetea, el empleado entra con la temporal y la
 * cambia por una propia. Hasta ahora todo esto era SSH y un guion. Con la
 * temporal no hay menu ni pantallas: solo la que pide elegir una nueva.
 *
 * Usa un usuario PROPIO, creado aca con un nombre unico: cambiarle la clave a
 * uno del seed romperia las demas pruebas, que entran con la clave del seed.
 */

const INICIAL = 'Inicial-2026-clave'
const PROPIA = 'Propia-2026-clave'

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

test('el administrador resetea, el empleado entra con la temporal y tiene que cambiarla', async ({
  page,
}) => {
  const usuario = `clave_${Date.now().toString(36)}`
  const nombre = `Prueba Clave ${usuario.slice(-5)}`

  await entrar(page, 'admin')

  // El empleado se da de alta por la API, con la sesion del administrador:
  // lo que se prueba aca es la clave, no el formulario de alta.
  //
  // Con `fetch` DESDE LA PAGINA y no con `page.request`: la cookie de sesion es
  // `Secure` en produccion, y el cliente HTTP de Playwright no la manda a
  // `http://127.0.0.1`. El navegador si, porque trata a la propia maquina como
  // origen seguro; es lo mismo que hace la aplicacion.
  const estado = await page.evaluate(
    async ({ username, name, password }) => {
      const roles = (await (await fetch('/api/roles')).json()) as Array<{
        id: number
        name: string
      }>
      const cajero = roles.find((r) => r.name === 'cajero')
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, name, password, roleId: cajero?.id }),
      })
      return res.status
    },
    { username: usuario, name: nombre, password: INICIAL },
  )
  expect(estado).toBe(201)

  // 1. El administrador restablece desde Usuarios, con una temporal que elige.
  await page.goto('/usuarios')
  await page
    .getByRole('row', { name: new RegExp(nombre) })
    .getByRole('button', { name: 'Restablecer contraseña' })
    .click()

  const temporal = 'temporal1'
  const dialogo = page.getByRole('dialog')
  await dialogo.getByRole('textbox', { name: 'Nueva contraseña temporal' }).fill(temporal)
  await dialogo.getByRole('textbox', { name: 'Repetir contraseña' }).fill(temporal)
  await dialogo.getByRole('button', { name: 'Restablecer' }).click()
  await expect(dialogo).toBeHidden()
  await salir(page)

  // 2. La de antes ya no sirve; la temporal si, pero solo para elegir otra.
  await entrarCon(page, usuario, INICIAL)
  await rechazado(page)
  await entrarCon(page, usuario, temporal)
  const obligatorio = page.getByRole('heading', { name: 'Cambiá tu contraseña' })
  await expect(obligatorio).toBeVisible()
  await expect(page.getByRole('button', { name: /cuenta de/i })).toHaveCount(0)

  // Ir a otra pantalla no la saltea: sigue pidiendo la nueva.
  await page.goto('/venta')
  await expect(obligatorio).toBeVisible()
  await expect(page.locator('[data-barcode-input]')).toHaveCount(0)

  // 3. La cambia por una propia ahi mismo, y entra.
  await page.getByRole('textbox', { name: 'Nueva contraseña' }).fill(PROPIA)
  await page.getByRole('textbox', { name: 'Repetir contraseña' }).fill(PROPIA)
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await adentro(page)

  await page.reload()
  await adentro(page)
  await salir(page)

  // 4. Entra con la propia; la temporal ya no.
  await entrarCon(page, usuario, temporal)
  await rechazado(page)
  await entrarCon(page, usuario, PROPIA)
  await adentro(page)
})

test('Configuracion muestra el nombre del comercio y no promete lo que ya existe', async ({
  page,
}) => {
  await entrar(page, 'admin')
  await page.goto('/configuracion')

  await expect(page.getByRole('heading', { name: 'Contraseña' })).toBeVisible()
  await expect(page.getByText('Turnos de caja con apertura y cierre')).toHaveCount(0)
  await expect(page.getByText('Compras, proveedores y clientes')).toHaveCount(0)
})
