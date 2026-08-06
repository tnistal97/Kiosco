# Estrategia de calidad

> El proyecto hoy tiene **cero tests**, **ninguna configuración de ESLint**, ningún formateador y ninguna integración continua.
> Esto es el plan, no la implementación. Nada de esto se instaló todavía.

## Punto de partida

|                       | Estado                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Tests                 | 0 archivos                                                                                                     |
| Framework de testing  | Ninguno instalado                                                                                              |
| ESLint                | El script `lint` existe; **la configuración no**. `next lint` abre un asistente interactivo → inservible en CI |
| Prettier              | No instalado. El formato es inconsistente entre archivos                                                       |
| TypeScript            | `strict: true` ✅ — pero 35 usos de `: any` lo evaden                                                          |
| Hooks de git          | Ninguno                                                                                                        |
| CI                    | Ninguna                                                                                                        |
| Verificación real hoy | `npx tsc --noEmit` y `npm run build` a mano                                                                    |

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

La que hoy no existe. Reglas elegidas para atacar los problemas concretos de este código, no un preset genérico:

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

## 5. TypeScript

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
