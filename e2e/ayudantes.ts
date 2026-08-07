import type { Page } from '@playwright/test'

/**
 * Ayudantes de las pruebas de extremo a extremo.
 *
 * Los usuarios y los codigos son los que crea `prisma/seed-demo.ts`.
 */

export const CLAVE = 'Demo1234!'

/** Codigos de barras del seed, con su nombre y precio. */
export const PRODUCTOS = {
  yerba: { codigo: '7790001000011', nombre: 'Yerba mate 1 kg', precio: 4850 },
  gaseosa: { codigo: '7790002000014', nombre: 'Gaseosa cola 2.25 L', precio: 3450 },
  leche: { codigo: '7790003000017', nombre: 'Leche entera 1 L', precio: 1690 },
  /** Stock 0 en el seed: sirve para probar la falta de stock. */
  agotado: { codigo: '7790008000036', nombre: 'Helado 1 L', precio: 6800 },
  /** Dado de baja en el seed. */
  deBaja: { codigo: '7790002000083', nombre: 'Gaseosa naranja 2 L (discontinuada)' },
} as const

/**
 * El campo de contrasena, sin ambiguedad.
 *
 * `getByLabel('Contraseña')` no sirve: tambien encuentra el boton de
 * mostrar/ocultar, cuyo nombre accesible es "Mostrar la contraseña". Se pide
 * el control por su rol.
 */
export function campoClave(page: Page) {
  return page.locator('input[name="password"]')
}

export async function entrar(page: Page, usuario: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Usuario' }).fill(usuario)
  await campoClave(page).fill(CLAVE)
  await page.getByRole('button', { name: 'Entrar' }).click()

  // El menu de usuario solo existe con sesion, y esta en los dos tamanios.
  // La barra lateral no sirve como senal: en movil se oculta con
  // `display: none` y desaparece del arbol de accesibilidad, asi que
  // `getByRole('navigation')` no la encuentra ni siquiera "adjunta".
  await page.getByRole('button', { name: /cuenta de/i }).waitFor()
}

export async function salir(page: Page): Promise<void> {
  await page.getByRole('button', { name: /cuenta de/i }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await page.waitForURL(/\/login/)
}

/** Escanea un codigo en la pantalla de venta, como lo haria el lector. */
export async function escanear(page: Page, codigo: string): Promise<void> {
  const campo = page.locator('[data-barcode-input]')
  await campo.fill(codigo)
  await campo.press('Enter')
  // El resultado se anuncia en el mismo bloque: esperar a que cambie evita
  // encadenar escaneos antes de que el anterior haya respondido.
  await page.waitForTimeout(700)
}

/** Total del ticket, como numero. */
export async function totalDelTicket(page: Page): Promise<number> {
  const texto = await page
    .getByRole('region', { name: 'Ticket en curso' })
    .getByText(/^\$/)
    .last()
    .innerText()
  return leerMonto(texto)
}

/**
 * Lee el importe de una tarjeta de metrica por su etiqueta.
 *
 * La tarjeta es `<div><div><span>Etiqueta</span></div><div>$ …</div></div>`,
 * asi que desde la etiqueta hay que subir dos niveles. Encapsularlo aca evita
 * repetir el `../..` en cada prueba y que se rompan todas juntas si la
 * tarjeta cambia de forma.
 */
export async function leerMetrica(page: Page, etiqueta: string): Promise<number> {
  const tarjeta = page.getByText(etiqueta, { exact: true }).locator('../..')
  return leerMonto(await tarjeta.getByText(/^\$/).first().innerText())
}

/** "$ 11.390,00" → 11390 */
export function leerMonto(texto: string): number {
  const limpio = texto
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  return Number(limpio)
}
