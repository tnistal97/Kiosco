# Estrategia de calidad

> **Estado: implementado en la Fase 1 y ampliado en la Fase 2.** Lo que sigue
> era el plan; las tablas de esta sección muestran lo que quedó hecho. Las
> secciones 4 a 10 conservan el diseño original, que se siguió sin cambios
> salvo donde se indica.

## Dónde se estaba y dónde se está

|                | Antes de la Fase 0                         | Fase 1                                            | Fase 2                                                 | Fase 3A                                                | Fase 3C                                              |
| -------------- | ------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| Pruebas        | 0 archivos                                 | 354, en seis categorías                           | 533 en vitest + 40 de extremo a extremo                | **735** en vitest + **63** de extremo a extremo        | **949** en vitest + **100** de extremo a extremo     |
| Framework      | Ninguno                                    | Vitest 4                                          | Vitest 4 + jsdom + Testing Library + **Playwright**    | **+ axe-core** sobre once pantallas                    | **+ axe-core sobre diecisiete pantallas y diálogos** |
| ESLint         | El script existía; la configuración **no** | Configuración plana, con tipos. 0 errores         | Igual. 0 errores                                       | **+ dos fronteras propias**: dinero y stock. 0 errores | **+ una tercera**: las cantidades. 0 errores         |
| Prettier       | No instalado                               | ts, tsx, js, json, md, css y prisma               | Igual                                                  | Igual                                                  | Igual                                                |
| TypeScript     | `strict: true`, evadido por 35 `: any`     | `strict` + 4 opciones. 0 `any` en `src/`          | Igual                                                  | Igual                                                  | Igual                                                |
| CI             | Ninguna                                    | Formato, lint, tipos, migraciones, pruebas, build | **+ extremo a extremo y comprobación de la PWA**       | Igual                                                  | Igual                                                |
| `npm audit`    | 25 avisos, **1 crítico**                   | 0, con 14 `overrides`                             | **0, con 2 `overrides`**                               | 0                                                      | 0                                                    |
| Alcance medido | —                                          | Solo servidor                                     | Servidor **+ componentes, store y hooks**              | Igual                                                  | Igual                                                |
| Cobertura      | —                                          | 84,1 L · 82,0 S · 85,4 F · 61,8 R (solo servidor) | 81,6 L · 78,7 S · 80,4 F · 69,5 R (alcance más amplio) | **84,0 L · 80,9 S · 82,9 F · 72,5 R**                  | **81,3 L · 78,5 S · 80,5 F · 67,6 R**                |

> **La cobertura baja tres décimas y no es una regresión.** La Fase 3C agrega
> unas mil líneas de servidor —compras, recepción, proveedores— y sus pruebas
> cubren los caminos que importan, no cada rama de cada DTO. Los cuatro
> números siguen por encima de los umbrales, que son la alarma.

### Fase 4A

|                |                                                              |
| -------------- | ------------------------------------------------------------ |
| Pruebas        | **1.131** en vitest + **141** de extremo a extremo           |
| axe            | **+ cuatro pantallas**: clientes, ficha, cobro y comprobante |
| ESLint         | **+ una cuarta frontera**: el saldo de un cliente            |
| Reconciliación | **trece** invariantes (nueve + cuatro de cuenta corriente)   |

### Fase 4B

|                |                                                                     |
| -------------- | ------------------------------------------------------------------- |
| Pruebas        | **1.181** en vitest + **161** de extremo a extremo                  |
| axe            | **+ cuatro pantallas**: cuenta, pago, nota de crédito y comprobante |
| ESLint         | **+ una quinta frontera**: el saldo de un proveedor                 |
| Reconciliación | **diecisiete** invariantes (trece + cuatro de cuentas por pagar)    |

Y tres cosas que la fase encontró sobre su propio código, antes de que las
encontrara alguien más:

**La cuarta frontera de ESLint marcaba las lecturas.** Al escribir la quinta —el
espejo— la regla saltó sobre un `select: { balance: true }`, que es legítimo
desde cualquier lado. La de clientes no lo hacía sólo porque en este proyecto los
`select` viven en constantes aparte, fuera del alcance del selector. Es la peor
forma de que una regla "funcione": el día que alguien escriba el select en línea,
la esquiva extrayéndolo a una constante y de paso deja de protegerse de las
escrituras. Las dos reglas quedaron acotadas a `data`.

**La autorización de sobrepago se decidía con una lectura vieja.** El primer
diseño ataba el autorizante a "y además, según la lectura previa, sobra": con dos
pagos simultáneos de $40.000 sobre una deuda de $50.000, ninguno sobrepasaba
según _su_ lectura, así que ninguno viajaba autorizado y el segundo se rechazaba
aunque quien pagaba lo hubiera confirmado. Lo encontró la prueba de concurrencia.
**El consentimiento lo da quien opera, no una lectura que puede estar vencida.**

**Una comprobación que no podía fallar nunca.** Con la condición
`balance + delta >= 0` dentro del `UPDATE`, el `if` que volvía a mirar el saldo
después del movimiento era código inalcanzable. Se borró: un `if` que no puede
ejecutarse se lee como una defensa y no defiende de nada.

### La regresión de las 21:00

Y una prueba de la 4A que no mide alcance sino honestidad: `LA REGRESION: una venta
de las 21:30 no desaparece de su dia`. La Fase 4A encontró que el error de las
21:00 —que la 3C descubrió y la 3D dio por cerrado— **seguía vivo en el SQL
crudo de los reportes**. Sobrevivió a una fase entera porque la suite crea sus
ventas con `now()` y corría antes de las 21:00.

La lección quedó escrita en el diseño de la prueba: **una prueba que depende del
reloj no prueba nada tres cuartos del día.** La nueva fija la fecha de la venta
a mano.

#### La prueba intermitente de los diálogos

La Fase 4A también cerró una falla intermitente que venía de la 3C: el análisis
de axe sobre el alta de proveedor fallaba una corrida de cada cuatro con
diecisiete faltas de contraste que no existían. **axe mide el contraste sobre la
opacidad que hay en ese instante**, y los diálogos entran con una transición: a
mitad de camino, todo el diálogo parece ilegible.

El primer arreglo estuvo mal, y vale más anotado que borrado: esperar a que
**todos** los descendientes llegaran a opacidad 1. Nunca ocurre. Un botón
deshabilitado vive en `opacity-45` a propósito y un paso de cantidad en el
mínimo, en `opacity-40`; en los dos diálogos que los tienen, la condición era
imposible y la prueba pasó de intermitente a muerta por tiempo agotado.

La condición de verdad no era «todo opaco» sino «la transición terminó», y la
biblioteca ya la publica: `data-closed` mientras no entró, `data-transition`
mientras corre, y ninguna `CSSTransition` sin terminar. `esperarDialogoEstable`
pregunta eso, y se salta las animaciones infinitas —el girador de un botón, el
latido de un esqueleto— que por diseño no terminan nunca.

Dos lecciones, y la segunda es la cara: **una condición de espera que aproxima
lo que se quiere saber convierte una prueba intermitente en otra**, y hay que
mirar qué falló, no suponerlo —las dos pruebas parecían el mismo fallo de
contraste de antes y eran un tiempo agotado.

### Las cuatro fronteras que ESLint hace cumplir

No son reglas de estilo: son las invariantes que sostienen el sistema, y las
cuatro se rompen sin que nada falle.

| Frontera                               | Qué prohíbe                                                    | Único lugar autorizado             |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| **El dinero no se vuelve `number`**    | `.toNumber()` sobre un importe, en servicios, servidor y rutas | `src/server/money.ts`              |
| **Una cantidad no se vuelve `number`** | Lo mismo sobre las cantidades de mercadería                    | `src/server/cantidad.ts`           |
| **El stock no se escribe: se mueve**   | Escrituras de Prisma y SQL crudo sobre `BranchStock`           | `src/modules/inventory/service.ts` |

La tercera es la que hace que **la recepción de mercadería no pueda tocar el
stock por su cuenta**: llama a `applyStockMovement` como todo lo demás, y por
eso el libro y el saldo no se pueden separar.

La segunda tiene además una prueba que recorre `src/` archivo por archivo
(`tests/unit/inventory.test.ts`). La regla avisa al escribir; la prueba avisa
si alguien desactiva la regla.

Los tres primeros números de cobertura bajan y el cuarto sube, y las dos cosas
son la misma: el alcance pasó de "solo servidor" a "servidor más las piezas de
interfaz que tienen pruebas". Los umbrales **subieron**: de 75/75/50/73 a
78/76/63/75.

### Opciones de TypeScript, una por una

Se activaron midiendo el impacto de cada una por separado, no en bloque.

| Opción                             | Antes     | Ahora        | Errores que produjo     | Correcciones                                                                     |
| ---------------------------------- | --------- | ------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `strict`                           | ✅ activa | ✅           | —                       | —                                                                                |
| `noImplicitAny`                    | implícita | ✅ explícita | 0                       | —                                                                                |
| `strictNullChecks`                 | implícita | ✅ explícita | 0                       | —                                                                                |
| `useUnknownInCatchVariables`       | implícita | ✅ explícita | 0                       | —                                                                                |
| `noFallthroughCasesInSwitch`       | ❌        | ✅           | 0                       | —                                                                                |
| `forceConsistentCasingInFileNames` | ❌        | ✅           | 0                       | —                                                                                |
| `noImplicitOverride`               | ❌        | ✅           | 0                       | —                                                                                |
| `noUncheckedIndexedAccess`         | ❌        | ✅           | **7** (2 en producción) | Dos errores reales, ver abajo. Los otros 5 eran indexaciones en asserts de tests |

Las tres primeras ya estaban cubiertas por `strict`; se escriben explícitas
para que se vea que están activas sin tener que recordar qué implica `strict`.

`forceConsistentCasingInFileNames` importa más de lo que parece acá: el
desarrollo es Windows y el servidor Linux, así que un import con la caja
equivocada compila en una máquina y falla en la otra.

**Los dos errores reales que encontró `noUncheckedIndexedAccess`:**

1. `origenDe()` leía `X-Forwarded-For` y hacía `split(',')[0].trim()`. Con la
   cabecera vacía —o con `", 10.0.0.1"` si un proxy la concatena mal— el
   primer elemento es cadena vacía. Esa cadena se usaba como parte de la clave
   del límite de intentos, de modo que **todos los clientes detrás de un proxy
   mal configurado compartían un mismo contador de bloqueo**.
2. `shouldCacheRequest()` dependía de que `split('?')` devolviera siempre un
   elemento. Ahora, si no lo hace, conserva la ruta entera: la opción segura es
   la que tiene más probabilidad de coincidir con un patrón de exclusión.

| Opción pospuesta                     | Errores | Motivo                                                                                                                                 |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `noPropertyAccessFromIndexSignature` | 24      | Obliga a `obj['clave']` en vez de `obj.clave` sobre firmas de índice. Es estilo, no atrapa errores                                     |
| `exactOptionalPropertyTypes`         | 2       | Útil, pero genera fricción constante con props opcionales de React y con `RequestInit`. Evaluarla junto con el rediseño de la interfaz |

## Principio

**No perseguir un porcentaje de cobertura.** Perseguir que las diez afirmaciones críticas del negocio estén verificadas por una prueba automática que falle si alguien las rompe.

Un sistema que mueve dinero y stock necesita que _esas_ operaciones sean intocables. El resto puede tener menos red.

---

## 1. Herramientas

| Necesidad               | Herramienta                                                              | Por qué                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Unitarios e integración | **Vitest**                                                               | Nativo con TypeScript y ESM, sin configuración de Babel. Mucho más rápido que Jest. Compatible con el stack de Next 15          |
| Componentes             | **@testing-library/react**                                               | Estándar; prueba comportamiento, no implementación                                                                              |
| Extremo a extremo       | **Playwright**                                                           | Cubre los flujos de teclado y escáner del punto de venta, que es donde están los bugs reales de esta aplicación                 |
| Base para tests         | **PostgreSQL en Docker**, o instancia efímera con `initdb`               | Contra SQLite: el esquema usa `Json`, tipos y bloqueos específicos de PostgreSQL. Probar sobre otro motor daría falsa confianza |
| Lint                    | **ESLint 9** (flat config) + `eslint-config-next` + `@typescript-eslint` | La configuración que falta                                                                                                      |
| Formato                 | **Prettier**                                                             | Termina la discusión de estilo                                                                                                  |
| Hooks                   | **Husky** + **lint-staged**                                              | Opcional, a criterio del equipo                                                                                                 |
| CI                      | **GitHub Actions**                                                       | El repositorio ya está en GitHub                                                                                                |

Cinco dependencias de desarrollo nuevas. Ninguna llega al bundle de producción.

---

## 2. Los diez casos críticos

Son los del brief. Cada uno es un test de integración contra una base real, y **ninguno pasa hoy**.

| #   | Caso                                                            | Estado actual                                                                       | Tipo         |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| 1   | Una venta descuenta el stock exactamente una vez                | Pasaría                                                                             | Integración  |
| 2   | Una venta fallida no descuenta stock ni deja movimiento de caja | **FALLA** — no hay transacción (P0-2)                                               | Integración  |
| 3   | No se puede vender por debajo de cero sin permiso               | **FALLA** — verificado: 999 unidades con 23 en stock → −976 (P0-3)                  | Integración  |
| 4   | Un cajero no puede cambiar costos ni precios                    | **FALLA** — verificado: cambió $12.500 → $1 (P1-1)                                  | Integración  |
| 5   | Un usuario de una sucursal no accede a otra                     | Pasaría en la mayoría de las rutas; **falla** en `/api/stock` y `/api/sales/recent` | Integración  |
| 6   | Dos ventas simultáneas no generan inconsistencias               | **FALLA** — condición de carrera en `currentCash` (P0-9)                            | Concurrencia |
| 7   | Una anulación repone el stock correctamente                     | **FALLA** — la ruta devuelve 405 (§1.3 de UI/UX)                                    | Integración  |
| 8   | Un cierre de caja no se modifica sin auditoría                  | **FALLA** — no existe el concepto de cierre                                         | Integración  |
| 9   | El cliente no puede alterar precios desde el navegador          | **FALLA** — verificado: `price: 1` se guardó tal cual (P0-1)                        | Integración  |
| 10  | Las APIs privadas rechazan a los no autenticados                | **FALLA** — verificado: 7 rutas responden sin sesión (P0-0, P0-4)                   | Integración  |

**Ocho de diez fallan.** Estos tests son la definición de "Fase 0 terminada": se escriben primero, se los ve fallar, y se los hace pasar.

### Ejemplo — caso 9

```ts
test('el precio lo decide el servidor, no el cliente', async () => {
  const producto = await crearProducto({ price: 12500 })
  const sesion = await sesionDe('cajero')

  const res = await POST('/api/sales', sesion, {
    items: [{ productId: producto.id, quantity: 1, price: 1 }], // ← manipulado
    pagos: [{ metodo: 'efectivo', monto: 1 }],
  })

  expect(res.status).toBe(201)
  const item = await prisma.saleItem.findFirst({
    where: { saleId: res.body.id },
  })
  expect(Number(item.price)).toBe(12500) // no 1
})
```

### Ejemplo — caso 6 (concurrencia)

```ts
test('dos ventas simultaneas suman ambos importes', async () => {
  const turno = await abrirCaja({ inicial: 0 })
  const p = await crearProducto({ price: 1000, stock: 100 })

  await Promise.all([
    POST('/api/sales', sesionA, ventaDe(p, 1)),
    POST('/api/sales', sesionB, ventaDe(p, 1)),
  ])

  expect(await saldoEsperado(turno)).toBe(2000) // hoy da 1000
  expect(await stockDe(p)).toBe(98) // hoy puede dar 99
})
```

Este es el único que exige infraestructura real: transacciones concurrentes contra PostgreSQL. Es también el que descubre la clase de error más cara de diagnosticar en producción.

---

## 3. Alcance por capa

> **Estado.** Cubierto: servicios de dominio, rutas de API, transacciones,
> esquemas, permisos, migraciones y rendimiento de consultas. **Pendientes:
> componentes y extremo a extremo**, que dependen del rediseño de la interfaz
> y por eso van con la Fase 2.
>
> Las 354 pruebas, por categoría:
>
> | Categoría             | Cuántas | Qué cubre                                                                                                     |
> | --------------------- | ------: | ------------------------------------------------------------------------------------------------------------- |
> | `tests/authorization` |     189 | Anónimo, permisos por rol, aislamiento por sucursal, endpoints retirados, matriz documentada contra el código |
> | `tests/integration`   |      82 | Ventas, anulación, login, auditoría, contrato de error                                                        |
> | `tests/unit`          |      55 | Permisos, validación, política de caché                                                                       |
> | `tests/migrations`    |      16 | Cadena desde cero y sobre copia con datos                                                                     |
> | `tests/performance`   |       8 | Paginación, N+1, escrituras por venta                                                                         |
> | `tests/concurrency`   |       4 | Ventas simultáneas, sobreventa, coherencia de caja                                                            |
>
> **Cobertura sobre el código de servidor:** 84,1 % líneas · 82,0 % sentencias
> · 85,4 % funciones · 61,8 % ramas. Los umbrales están unos puntos por debajo
> (75 / 73 / 75 / 50). No son una meta: son una alarma, para que una caída se
> note sin que el número oscile por un par de líneas.
>
> Las pantallas quedan fuera de la medición a propósito: sin pruebas de
> interfaz, incluirlas daría un porcentaje que no dice nada y que escondería
> una caída real en el código que sí está probado.

| Capa                     | Qué se prueba                                                                                               | Cómo                       | Prioridad  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- |
| **Servicios de dominio** | Reglas de negocio: cálculo de totales, descuentos con tope, saldo esperado, resultado de un ajuste de stock | Unitario, sin base         | Alta       |
| **Rutas de API**         | Autenticación, permisos, validación, códigos HTTP, aislamiento por sucursal                                 | Integración con base       | **Máxima** |
| **Transacciones**        | Atomicidad y concurrencia de venta, anulación, recepción y cierre                                           | Integración con base       | **Máxima** |
| **Esquemas Zod**         | Rechazo de negativos, `NaN`, arrays vacíos, campos de más                                                   | Unitario                   | Alta       |
| **Componentes**          | Carrito, cálculo de vuelto, atajos, aislamiento del escáner                                                 | Testing Library            | Media      |
| **Extremo a extremo**    | Vender, cobrar, anular, arquear, recibir mercadería                                                         | Playwright                 | Media      |
| **Permisos**             | Matriz rol × endpoint                                                                                       | Integración, parametrizado | **Máxima** |

### La matriz de permisos

Una sola tabla genera toda la cobertura de autorización:

```ts
const MATRIZ = [
  //  ruta                método   cajero  repositor  encargado  dueño
  ['/api/sales', 'POST', 200, 403, 200, 200],
  ['/api/products/:id', 'PUT', 403, 403, 200, 200],
  ['/api/products', 'DELETE', 403, 403, 403, 403],
  ['/api/users', 'GET', 403, 403, 403, 200],
  ['/api/audit', 'GET', 403, 403, 200, 200],
  ['/api/stock/:id', 'PATCH', 403, 200, 200, 200],
  // …
]

test.each(MATRIZ)(
  '%s %s respeta los permisos',
  async (ruta, metodo, ...esperados) => {
    for (const [i, rol] of ROLES.entries()) {
      expect((await pedir(ruta, metodo, await sesionDe(rol))).status).toBe(
        esperados[i],
      )
    }
  },
)
```

Agregar una ruta sin agregar su fila hace fallar la suite. La autorización deja de depender de que alguien se acuerde.

---

## 4. Configuración de ESLint

> **Implementada.** La configuración real está en
> [`eslint.config.mjs`](../eslint.config.mjs) y sigue este diseño con dos
> diferencias, ambas anotadas más abajo. `eslint .` da **0 errores** y 4
> avisos, todos por claves de índice en listas de esqueleto de carga, que son
> estáticas.
>
> Lo que se descartó del plan original:
>
> - **`no-console: error`.** El código de servidor usa `console.error` y
>   `console.warn` a propósito para el log del servidor, que es donde va el
>   detalle técnico que no se le muestra al usuario. Prohibirlo obligaría a
>   una excepción en cada uno de esos puntos.
> - **`no-alert: error`.** Quedan tres usos (`src/app/page.tsx`,
>   `src/components/dashboard/CartModal.tsx` y un `confirm()` de borrado en
>   productos). Los dos primeros son de pantallas que la Fase 2 rehace; el
>   `confirm()` es una confirmación de borrado que hoy no tiene reemplazo.
>   Activar la regla ahora obligaría a tres `eslint-disable`, que es
>   exactamente lo que este documento prohíbe. **Queda pendiente para la
>   Fase 2**, junto con el rediseño.
>
> Lo que se agregó y no estaba en el plan: reglas contra condiciones siempre
> ciertas (`no-unnecessary-condition`), aserciones no nulas
> (`no-non-null-assertion`), y el plugin de Vitest para las pruebas.

Reglas elegidas para atacar los problemas concretos de este código, no un preset genérico:

```js
// eslint.config.mjs
import next from 'eslint-config-next'
import ts from 'typescript-eslint'

export default [
  ...next(),
  ...ts.configs.recommendedTypeChecked,
  {
    rules: {
      // Contra las 35 apariciones de `: any`
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',

      // Contra los `console.log` de depuración en produccion
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Contra los `useEffect` sin array de dependencias (el bug de foco de SearchBar)
      'react-hooks/exhaustive-deps': 'error',

      // Contra alert/confirm/prompt nativos
      'no-alert': 'error',

      // Contra promesas sin await en las rutas
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Regla propia: prohibir importar prisma desde componentes de cliente
    files: ['src/components/**', 'src/hooks/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/lib/prisma', '@prisma/client'] },
      ],
    },
  },
]
```

`react-hooks/exhaustive-deps` en `error` habría detectado el bug de foco de `SearchBar` el día que se escribió.

**Sobre el volumen inicial:** activar esto de golpe va a producir cientos de errores sobre código existente. La forma de introducirlo sin frenar todo: empezar con las reglas en `warn`, arreglar por módulo a medida que se refactoriza, y subirlas a `error` cuando el módulo esté limpio. **Nunca con `eslint-disable`.**

> **Lo que pasó de verdad:** activarlo todo en `error` de una vez dio **252
> errores** sobre 58 archivos. No hizo falta la introducción gradual porque
> 81 de ellos tenían una sola causa —`res.json()` devuelve `any` y ese `any`
> se propagaba desde 19 puntos de `fetch`— y se cerraron todos escribiendo un
> cliente HTTP tipado. Los demás se corrigieron uno por uno.
>
> Quedan **tres** `eslint-disable` en todo el proyecto, cada uno con su motivo
> escrito en la misma línea: dos por firmas que Next obliga a declarar `async`
> sin que haya nada que esperar, y uno por una imagen de un dominio externo
> arbitrario que `next/image` exigiría declarar en `remotePatterns`.
>
> Errores reales que ESLint encontró, y que no eran cuestión de estilo:
>
> | Hallazgo                 | Qué pasaba                                                                                                                                                                                      |
> | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `Navbar.handleLogout`    | `await fetch(...)` sin `try`. Si fallaba la red, la promesa quedaba rechazada sin manejar, no se ejecutaba el redirect y el usuario se quedaba en la pantalla creyendo que había cerrado sesión |
> | `productos.handleDelete` | No miraba la respuesta. Un 403 por falta de permiso mostraba "Producto eliminado correctamente"                                                                                                 |
> | `SalesMetrics`           | Sumaba las ventas anuladas a la recaudación: anular una venta hacía **subir** el total                                                                                                          |
> | `BarcodeScanner`         | El efecto dependía de `code`, que el propio efecto cambiaba: cada lectura apagaba y encendía la cámara. Y nunca detenía los controles del lector al desmontarse                                 |
> | `Modal`                  | Registraba un listener nativo tipado con el `KeyboardEvent` sintético de React; dos `as any` tapaban la diferencia                                                                              |
> | `login`                  | Ignoraba el `?next=` que pone el middleware y siempre iba a `/caja`                                                                                                                             |

## 5. TypeScript

> **Implementado.** La tabla opción por opción, con los errores que produjo
> cada una y las dos que se pospusieron, está al principio de este documento.
> El plan de abajo se cumplió salvo `exactOptionalPropertyTypes`, que se
> pospuso con motivo.

`strict: true` ya está. Faltan cuatro opciones que este código necesita:

```jsonc
{
  "noUncheckedIndexedAccess": true, // paymentMap[s.id] puede ser undefined y hoy se asume 'efectivo'
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true,
  "noFallthroughCasesInSwitch": true,
}
```

`noUncheckedIndexedAccess` habría marcado la línea de `/api/admin/sales` donde un medio de pago no encontrado se convierte silenciosamente en `'efectivo'`.

**Y prohibir `any` de verdad.** Los 35 usos actuales están casi todos en `catch (e: any)`; con `useUnknownInCatchVariables` (incluido en `strict`) el reemplazo correcto es `catch (e)` más un `isAppError(e)`.

## 6. Integración continua

> **Implementada** en [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
> con cuatro trabajos en paralelo en vez de uno solo: calidad (sin base de
> datos, responde en menos de un minuto), pruebas, construcción y auditoría de
> dependencias.
>
> Dos comprobaciones que no estaban en el plan y que valen más que el resto:
>
> 1. **Que el manifiesto declare el middleware.** Es el fallo que la Fase 0
>    corrigió y el que más fácil se vuelve a colar: con un directorio `src/`,
>    mover el archivo a la raíz compila igual y deja la autenticación de
>    navegación sin ejecutarse. El manifiesto decía `middleware: []` y nadie se
>    dio cuenta durante meses.
> 2. **Que el service worker declare `NetworkOnly`.** Si un cambio en la cadena
>    de `next-pwa` rompiera la generación, la PWA volvería a cachear respuestas
>    privadas en el disco de la máquina, sin dar ningún error.
>
> `npm audit` falla ante críticas y altas, e informa las moderadas y bajas sin
> cortar. Cortar por una vulnerabilidad baja en una herramienta de compilación
> entrena a todo el mundo a ignorar el paso, y entonces tampoco se mira cuando
> aparece una crítica.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  verificar:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: kiosco_test }
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx prisma migrate deploy # contra la base de test
        env:
          {
            DATABASE_URL: postgresql://postgres:test@localhost:5432/kiosco_test,
          }
      - run: npm test -- --coverage
        env:
          {
            DATABASE_URL: postgresql://postgres:test@localhost:5432/kiosco_test,
            JWT_SECRET: test-secret,
          }
      - run: npm run build

  auditar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm audit --audit-level=high # informativo hasta terminar la Fase 1
```

Y una verificación que este proyecto necesita específicamente:

```yaml
- name: El middleware debe estar en el build
  run: |
    node -e "
      const m = require('./.next/server/middleware-manifest.json');
      if (!Object.keys(m.middleware || {}).length) {
        console.error('El middleware NO se incluyo en el build. Verificar que este en src/.');
        process.exit(1);
      }
    "
```

Un test de cinco líneas que habría evitado el hallazgo P0-0. **Vale la pena aunque no se haga nada más de este documento.**

## 7. Hooks de git (opcional)

```json
// lint-staged
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css}": ["prettier --write"]
}
```

Solo formato y lint en `pre-commit`. **Los tests no van en el hook**: un `pre-commit` lento se termina salteando con `--no-verify`, y ahí se pierde todo. Los tests corren en CI.

## 8. Datos de prueba

- **Fábricas, no fixtures.** `crearProducto({ price: 1000 })` con valores por defecto sensatos, sobrescribibles.
- **Aislamiento por transacción:** cada test corre dentro de una transacción que se revierte al terminar. Sin `TRUNCATE` entre tests, sin orden dependiente, y se pueden paralelizar.
- **Sin datos reales.** Nunca una copia de producción en los tests.
- **`@faker-js/faker` ya está declarado** en el proyecto y no se usa en ningún archivo: o se aprovecha acá, o se desinstala.

## 9. Definición de terminado

Para cualquier tarea que toque dinero, stock o permisos:

- [ ] `npx tsc --noEmit` sin errores
- [ ] `npm run lint` sin errores nuevos
- [ ] Test de integración de la ruta, incluyendo el camino de error
- [ ] Fila agregada a la matriz de permisos
- [ ] Si es una operación de varios pasos: test que verifica que un fallo intermedio no deja estado parcial
- [ ] Si cambia el esquema: migración probada sobre una copia de producción
- [ ] Bitácora de auditoría escrita dentro de la misma transacción
- [ ] Sin `any`, sin `eslint-disable`, sin `console.log`

## 10. Orden de adopción

| Paso | Qué                                          | Cuándo                                     |
| ---- | -------------------------------------------- | ------------------------------------------ |
| 1    | Verificación de middleware en CI (§6)        | **Ya** — cinco líneas                      |
| 2    | ESLint + Prettier, reglas en `warn`          | Fase 0                                     |
| 3    | Vitest + base de test + fábricas             | Fase 0                                     |
| 4    | **Los diez casos críticos**                  | Fase 0, escritos antes de las correcciones |
| 5    | Matriz de permisos                           | Fase 1                                     |
| 6    | CI completa con `tsc` + lint + tests + build | Fase 1                                     |
| 7    | Tests de servicios y esquemas por módulo     | Fase 1 en adelante, junto al refactor      |
| 8    | Playwright sobre los flujos de caja          | Fase 2                                     |
| 9    | Reglas de ESLint a `error`                   | Fase 2                                     |
| 10   | Tests de componentes de la nueva UI          | Fase 2 en adelante                         |

## 11. Reconciliación: la prueba que no se puede escribir mal

Toda la estrategia de arriba tiene un punto ciego conocido: **una prueba que
llama a la misma función que escribió el dato no comprueba nada.** Comprueba que
la función es igual a sí misma.

`npm run integrity:check` cierra ese hueco por construcción:

|                        | Escribe                    | Comprueba                                |
| ---------------------- | -------------------------- | ---------------------------------------- |
| Motor                  | `Decimal.js` en JavaScript | `SUM()` en PostgreSQL                    |
| Código                 | `src/modules/*/service.ts` | SQL en `src/modules/integrity/checks.ts` |
| Autor de la aritmética | La aplicación              | La base                                  |

Si los dos caminos dieran lo mismo por estar equivocados igual, sería porque son
el mismo camino. No lo son.

### La segunda mitad de cada prueba

Las pruebas de `tests/integration/reconciliacion.test.ts` no se conforman con
"la base sana no reporta nada". **Rompen algo con SQL directo y exigen que la
comprobación lo encuentre**, con la regla exacta y la diferencia exacta. Una
comprobación que no falla cuando tiene que fallar es un adorno, y que pase no
significa nada.

Ahí también se documenta lo que **no** detecta: borrar el último movimiento de un
producto y ajustar el saldo a mano queda invisible para las tres reglas del
libro. Contra eso protege el disparador de inmutabilidad, no la reconciliación.
Decirlo vale más que fingir lo contrario.

### La cobertura de una guardia se comprueba al revés

`tests/migrations/chain.test.ts` no sólo exige que ninguna migración borre sin
permiso: exige que **toda excepción de la lista siga borrando algo**. Una
excepción que dejó de hacer falta tiene que caducar, o la lista crece hasta no
significar nada.
