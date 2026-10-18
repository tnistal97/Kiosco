import { test, expect, type Page } from '@playwright/test'
import { PRODUCTOS, entrar } from './ayudantes'

/**
 * Inventario de un almacen, de punta a punta. UX V5.
 *
 * "Voy a contar lo que hay en el negocio para compararlo con lo que dice el
 * sistema." Crear, contar (con el lector), ver la diferencia, revisar y
 * aplicar con confirmacion; y comprobar que el stock quedo corregido y el
 * movimiento dice "Ajuste de inventario".
 */

const dialogo = (page: Page) => page.getByRole('dialog')

interface Linea {
  id: number
  productName: string
  status: string
  snapshotQuantity: string
}

async function lineasDe(page: Page, id: number): Promise<Linea[]> {
  return page.evaluate(async (sesion: number) => {
    const todas: Linea[] = []
    for (let p = 1; p < 50; p++) {
      const r = await fetch(
        `/api/inventarios/${String(sesion)}/lineas?pageSize=100&page=${String(p)}`,
      )
      const c = (await r.json()) as { data: Linea[] }
      todas.push(...c.data)
      if (c.data.length < 100) break
    }
    return todas
  }, id)
}

async function stockEnPantalla(page: Page, nombre: string): Promise<number> {
  await page.goto('/stock')
  await page.getByRole('searchbox', { name: /buscar productos/i }).fill(nombre)
  await page.waitForTimeout(900)
  const texto = await page
    .getByRole('row')
    .filter({ hasText: nombre })
    .first()
    .locator('td')
    .nth(1)
    .innerText()
  return Number(/(\d+)/.exec(texto)?.[1] ?? '-1')
}

test('crear, contar con el lector, ver la diferencia y aplicar con confirmacion', async ({
  page,
}) => {
  await entrar(page, 'encargado')
  const antes = await stockEnPantalla(page, PRODUCTOS.gaseosa.nombre)
  expect(antes, 'la gaseosa tiene stock para contar').toBeGreaterThan(2)

  // 1. Nuevo inventario: una categoria, para que sea corto.
  await page.goto('/inventarios')
  await page.getByRole('button', { name: 'Nuevo inventario' }).click()
  await dialogo(page)
    .getByRole('radio', { name: /una categoría/i })
    .check()
  await dialogo(page)
    .getByRole('combobox', { name: /categoría/i })
    .selectOption({ label: 'Bebidas' })
  await dialogo(page)
    .getByRole('button', { name: /empezar a contar/i })
    .click()
  await page.waitForURL(/\/inventarios\/\d+/)
  const id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)

  // Los pasos a la vista, y el paso actual marcado.
  await expect(page.getByRole('list', { name: 'Pasos del inventario' })).toBeVisible()
  await expect(page.locator('[aria-current="step"]')).toContainText('Contar')

  // 2. Contar con el lector: el codigo encuentra el producto y deja el cursor
  //    en su cantidad. Se cuentan DOS menos de lo que dice el sistema.
  const sistemaDeLaFila = page.getByRole('row').filter({ hasText: PRODUCTOS.gaseosa.nombre })
  await expect(sistemaDeLaFila.first()).toBeVisible()
  const sistema = Number(
    /(\d+)/.exec(await sistemaDeLaFila.first().locator('td').nth(1).innerText())?.[1] ?? '-1',
  )
  expect(sistema).toBe(antes)

  await page.getByLabel(/escaneá o escribí el producto/i).click()
  await page.keyboard.type(PRODUCTOS.gaseosa.codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  const contado = page.getByRole('textbox', { name: `Contado de ${PRODUCTOS.gaseosa.nombre}` })
  await expect(contado).toBeFocused()
  await page.keyboard.type(String(sistema - 2))
  // La diferencia se ve mientras se escribe, en rojo: falta.
  const fila = page.getByRole('row').filter({ hasText: PRODUCTOS.gaseosa.nombre }).first()
  await expect(fila.getByText('−2 u.')).toBeVisible()
  await expect(fila.getByText('−2 u.')).toHaveClass(/text-danger/)
  await page.keyboard.press('Enter')
  await expect(fila.getByLabel('Guardado')).toBeVisible({ timeout: 15_000 })
  // Y el foco vuelve al lector para el proximo producto.
  await expect(page.getByLabel(/escaneá o escribí el producto/i)).toBeFocused()

  // Un lector que lee con el cursor en OTRA cantidad no la llena de digitos:
  // busca el producto y lleva a su cantidad. Nada mas queda contado.
  const otra = page
    .getByRole('row')
    .filter({ has: page.getByRole('textbox', { name: /^Contado de / }) })
    .filter({ hasNotText: PRODUCTOS.gaseosa.nombre })
    .first()
  await otra.getByRole('textbox').click()
  await page.keyboard.type(PRODUCTOS.gaseosa.codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  await expect(contado).toBeFocused()
  await expect(page.getByText(/sin guardar/i)).toHaveCount(0)
  expect((await lineasDe(page, id)).filter((l) => l.status !== 'PENDING')).toHaveLength(1)

  // El resto de la categoria se cuenta por lo que el sistema ya tenia: lo que
  // se prueba es UNA diferencia.
  const pendientes = (await lineasDe(page, id)).filter((l) => l.status === 'PENDING')
  await page.evaluate(
    async ([ruta, lineas]) => {
      await fetch(ruta, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lineas }),
      })
    },
    [
      `/api/inventarios/${String(id)}/conteo`,
      pendientes.map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
    ] as const,
  )
  await page.reload()
  await expect(page.getByText(/¡Contaste todo!/)).toBeVisible()

  // 3. Terminar de contar pide confirmacion.
  await page.getByRole('button', { name: 'Terminé de contar' }).click()
  await expect(dialogo(page).getByText(/ya no se puede volver a cambiar/i)).toBeVisible()
  await dialogo(page).getByRole('button', { name: 'Sí, terminé' }).click()

  // 4. Revisar: el resumen dice cuantas diferencias hay y de que tipo.
  await expect(page.getByText('Encontramos diferencias en 1 producto.')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('[aria-current="step"]')).toContainText('Revisar diferencias')
  const filaRevision = page.getByRole('row').filter({ hasText: PRODUCTOS.gaseosa.nombre }).first()
  await expect(filaRevision).toContainText('−2 u.')

  // 5. Aplicar: con confirmacion, que avisa que no se deshace.
  await page.getByRole('button', { name: 'APLICAR INVENTARIO' }).click()
  await expect(dialogo(page).getByText(/esto no se puede deshacer/i)).toBeVisible()
  await expect(dialogo(page).getByText(/1 producto/)).toBeVisible()
  await dialogo(page).getByRole('button', { name: 'Aplicar inventario' }).click()
  await expect(page.getByRole('link', { name: 'Ver movimientos' })).toBeVisible({
    timeout: 15_000,
  })

  // 6. El stock quedo corregido...
  expect(await stockEnPantalla(page, PRODUCTOS.gaseosa.nombre)).toBe(antes - 2)

  // ...y el movimiento lo explica con palabras simples.
  await page.goto('/stock/movimientos')
  await page.getByRole('searchbox', { name: /buscar producto/i }).fill(PRODUCTOS.gaseosa.nombre)
  await page.waitForTimeout(900)
  const movimiento = page.getByRole('row').filter({ hasText: 'Ajuste de inventario' }).first()
  await expect(movimiento).toContainText('−2 u.')
  await expect(movimiento).toContainText(`quedó en ${String(antes - 2)} u.`)
})

test('un inventario largo: varias paginas, faltantes y sobrantes, y cada cantidad viaja una vez', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await entrar(page, 'duenio')
  await page.goto('/inventarios')

  // Una categoria propia con 105 productos de 10 u.: mas de una pagina (de a
  // 100) sin tocar el resto de los datos de prueba.
  const marca = String(Date.now()).slice(-6)
  const nombre = (i: number) => `Prueba larga ${marca} ${String(i).padStart(3, '0')}`
  const ids = await page.evaluate(async (m: string) => {
    const json = { 'content-type': 'application/json' }
    const rc = await fetch('/api/categories', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: `Inventario largo ${m}` }),
    })
    const categoria = (await rc.json()) as { id: number }
    const creados: number[] = []
    for (let i = 1; i <= 105; i++) {
      const r = await fetch('/api/products', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          name: `Prueba larga ${m} ${String(i).padStart(3, '0')}`,
          barcode: '',
          price: '100.00',
          categoryId: categoria.id,
          totalStock: '10',
          minimumStock: '0',
        }),
      })
      creados.push(((await r.json()) as { id: number }).id)
    }
    return creados
  }, marca)
  expect(ids).toHaveLength(105)

  let id = 0
  try {
    await page.getByRole('button', { name: 'Nuevo inventario' }).click()
    await dialogo(page)
      .getByRole('radio', { name: /una categoría/i })
      .check()
    await dialogo(page)
      .getByRole('combobox', { name: /categoría/i })
      .selectOption({ label: `Inventario largo ${marca}` })
    await dialogo(page)
      .getByRole('button', { name: /empezar a contar/i })
      .click()
    await page.waitForURL(/\/inventarios\/\d+/)
    id = Number(/\/inventarios\/(\d+)/.exec(page.url())?.[1] ?? 0)

    // Se anota cada envio de un conteo: Enter y "al salir" no pueden mandar
    // dos veces lo mismo.
    const envios: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/conteo')) envios.push(r.postData() ?? '')
    })

    const contado = (i: number) => page.getByRole('textbox', { name: `Contado de ${nombre(i)}` })
    const fila = (i: number) =>
      page
        .getByRole('row')
        .filter({ hasText: nombre(i) })
        .first()

    // Primera pagina: 100 de 105, con el stock del sistema a la vista.
    await expect(fila(1)).toContainText('10 u.')
    await expect(fila(101)).toHaveCount(0)

    // 001: faltan 3. 002: sobran 2. Enter pasa EN EL ACTO a la siguiente y
    // guarda en segundo plano: lo que se teclea enseguida va a la 002, no a
    // la que se acaba de confirmar.
    await contado(1).fill('7')
    await contado(1).press('Enter')
    await page.keyboard.type('12')
    await page.keyboard.press('Enter')
    await expect(fila(1).getByLabel('Guardado')).toBeVisible({ timeout: 15_000 })
    await expect(fila(2).getByLabel('Guardado')).toBeVisible({ timeout: 15_000 })
    await expect(contado(1)).toHaveValue('7')
    await expect(contado(2)).toHaveValue('12')
    await expect(contado(3)).toBeFocused()
    // Salir del campo despues de guardar no manda nada mas.
    await page.getByRole('heading', { level: 1 }).click()
    await page.waitForTimeout(800)
    expect(envios).toHaveLength(2)
    await expect(page.getByText(/sin guardar/i)).toHaveCount(0)

    // "Siguiente" en "Sin contar" no saltea a nadie: los contados salen de la
    // lista y entran los que seguian (003 a 102)...
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(fila(102)).toBeVisible({ timeout: 15_000 })
    await expect(fila(3)).toBeVisible()
    await expect(fila(1)).toHaveCount(0)
    await expect(fila(103)).toHaveCount(0)
    // ...y sin nada contado en esta pagina, pasa a la siguiente: 103 a 105.
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(fila(105)).toBeVisible({ timeout: 15_000 })
    await expect(fila(103)).toBeVisible()
    await expect(fila(102)).toHaveCount(0)

    // Lo contado persiste: en "Contados" estan los dos, con su numero.
    await page.getByRole('button', { name: /^Contados \(2\)/ }).click()
    await expect(contado(1)).toHaveValue('7', { timeout: 15_000 })
    await expect(contado(2)).toHaveValue('12')

    // El resto, como dice el sistema.
    const pendientes = (await lineasDe(page, id)).filter((l) => l.status === 'PENDING')
    expect(pendientes).toHaveLength(103)
    await page.evaluate(
      async ([ruta, lineas]) => {
        await fetch(ruta, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lineas }),
        })
      },
      [
        `/api/inventarios/${String(id)}/conteo`,
        pendientes.map((l) => ({ lineId: l.id, countedQuantity: l.snapshotQuantity })),
      ] as const,
    )
    await page.reload()
    await expect(page.getByText(/¡Contaste todo!/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Terminé de contar' }).click()
    await dialogo(page).getByRole('button', { name: 'Sí, terminé' }).click()

    // Revisar: un faltante y un sobrante.
    await expect(page.getByText('Encontramos diferencias en 2 productos.')).toBeVisible({
      timeout: 15_000,
    })
    await expect(fila(1)).toContainText('−3 u.')
    await expect(fila(2)).toContainText('+2 u.')

    await page.getByRole('button', { name: 'APLICAR INVENTARIO' }).click()
    await expect(dialogo(page).getByText(/esto no se puede deshacer/i)).toBeVisible()
    await dialogo(page).getByRole('button', { name: 'Aplicar inventario' }).click()
    await expect(page.getByRole('link', { name: 'Ver movimientos' })).toBeVisible({
      timeout: 15_000,
    })

    // El stock quedo en lo contado.
    const stock = await page.evaluate(async (lista: number[]) => {
      const leer = async (pid: number) =>
        ((await (await fetch(`/api/products/${String(pid)}`)).json()) as { totalStock: string })
          .totalStock
      return [await leer(lista[0] ?? 0), await leer(lista[1] ?? 0), await leer(lista[2] ?? 0)]
    }, ids)
    expect(stock.map(Number)).toEqual([7, 12, 10])
  } finally {
    // Fuera de la venta y de los proximos inventarios. Si la prueba se corto
    // a la mitad, el inventario se cancela (uno aplicado lo rechaza, y esta
    // bien).
    await page.evaluate(
      async ([sesion, lista]) => {
        if (sesion > 0) {
          await fetch(`/api/inventarios/${String(sesion)}/cancelar`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'Prueba automatica cortada' }),
          })
        }
        for (const pid of lista) {
          await fetch(`/api/products/${String(pid)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isActive: false }),
          })
        }
      },
      [id, ids] as const,
    )
  }
})
