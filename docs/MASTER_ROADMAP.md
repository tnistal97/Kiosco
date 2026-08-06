# Plan maestro

> Plan de implementación por fases para convertir Kiosco en un sistema de gestión de almacén.
> Cada tarea indica prioridad, impacto, riesgo, complejidad, dependencias, archivos, cambios de base y pruebas.
> **Tamaño relativo:** P = pequeño · M = mediano · G = grande. Sin estimaciones de tiempo, por pedido explícito.

## Cómo leer este plan

| Prioridad | Significa                                                        |
| --------- | ---------------------------------------------------------------- |
| **P0**    | Puede alterar dinero, stock o privilegios. Bloquea todo lo demás |
| **P1**    | Base sobre la que se apoya el resto                              |
| **P2**    | Mejora sustancial de la operación                                |
| **P3**    | Deseable                                                         |

**Regla de secuencia:** ninguna fase empieza sin que la anterior esté verificada. La tentación de saltar a la Fase 2 (que es la que se ve) antes de terminar la 0 es exactamente cómo se llegó al estado actual.

---

# Fase 0 · Bloqueos críticos

**Objetivo:** que nadie pueda alterar dinero, stock ni privilegios. Ocho de los diez casos críticos de [QUALITY_STRATEGY.md](QUALITY_STRATEGY.md) fallan hoy; al terminar esta fase pasan los diez.

> **El sistema no debería volver a estar en línea hasta que esta fase esté completa.** Hoy está a salvo solo porque PM2 está detenido.

### 0.0 · Confirmar y rotar los secretos de producción

|                                       |                                              |
| ------------------------------------- | -------------------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Crítico · Bajo · **P**              |
| Depende de                            | —                                            |
| Archivos                              | Ninguno del repositorio (servidor)           |
| Base de datos                         | Cambio de contraseña del usuario `kiosco`    |
| Pruebas                               | Iniciar sesión funciona con el secreto nuevo |

Verificar si `JWT_SECRET` sigue valiendo `change-me`. Si es así, **cualquiera que conozca ese valor por defecto puede firmar un token de administrador sin explotar ninguna vulnerabilidad.** Rotar el secreto, rotar la contraseña de PostgreSQL (estuvo en un repositorio público desde mayo de 2025), y `chmod 600 ecosystem.config.js`.

**Va primero porque no depende de ningún cambio de código.**

### 0.1 · Activar el middleware

|                                       |                                                                     |
| ------------------------------------- | ------------------------------------------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Crítico · **Medio** · **M**                                |
| Depende de                            | 0.2 (ver nota)                                                      |
| Archivos                              | `middleware.ts` → `src/middleware.ts`; `src/server/auth.ts` (nuevo) |
| Base de datos                         | —                                                                   |
| Pruebas                               | Caso crítico 10; verificación de `ƒ Middleware` en CI               |

Mover el archivo a `src/` y **reescribirlo**: verificar la firma con `jose` en vez de `jsonwebtoken` y eliminar la consulta a Prisma, usando el claim `role` que ya viaja firmado. Sin esa reescritura, activarlo mete el motor WASM de Prisma en el bundle Edge y puede romper la aplicación entera.

> **Nota de orden:** hacer esto **después** de 0.2. Activar el middleware primero da la falsa sensación de que el problema está resuelto mientras `/api/users` sigue abierta a cualquier sesión válida.

### 0.2 · Autorización propia en cada ruta de API

|                                       |                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Crítico · Medio · **G**                                                            |
| Depende de                            | —                                                                                           |
| Archivos                              | Las 16 rutas de `src/app/api/`; `src/server/auth.ts`, `authorize.ts`, `handler.ts` (nuevos) |
| Base de datos                         | Tablas de permisos (M2)                                                                     |
| Pruebas                               | Casos 4, 5, 10; matriz de permisos                                                          |

Un único `getSession()` que reemplaza las nueve copias del helper. `requirePermission()` en toda ruta. **Eliminar** `/api/logs` y `/api/stock` (raíz), y el método `DELETE` de `/api/products`. Añadir `select` explícito en `/api/users` para que deje de devolver hashes.

Resuelve P0-4, P0-5, P0-6, P0-7, P0-8, P1-1, P1-2, P1-3, P1-4, P1-5.

### 0.3 · Reescribir el registro de ventas

|                                       |                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Crítico · **Alto** · **M**                                                  |
| Depende de                            | 0.2                                                                                  |
| Archivos                              | `src/app/api/sales/route.ts`, `src/modules/sales/service.ts` + `schemas.ts` (nuevos) |
| Base de datos                         | — (los cambios de esquema llegan en la Fase 2)                                       |
| Pruebas                               | Casos 1, 2, 3, 6, 9                                                                  |

Cuatro correcciones en una sola reescritura, porque tocan las mismas líneas:

1. El precio se lee de la base dentro de la transacción; `price` desaparece del esquema de entrada.
2. Todo dentro de `prisma.$transaction`.
3. Verificación de stock bajo bloqueo (`SELECT … FOR UPDATE`); rechazo con 409.
4. `Branch.currentCash` con `{ increment }` atómico como parche provisional hasta que la Fase 2 lo elimine.

**Riesgo alto** porque es el camino por el que entra todo el dinero. Verificar contra una copia antes de desplegar.

### 0.4 · Arreglar la anulación de ventas

|                                       |                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Alto · Medio · **P**                                                               |
| Depende de                            | 0.2                                                                                         |
| Archivos                              | `src/app/api/sales/[id]/route.ts`, `src/components/ventas/{MovimientoRow,DeleteButton}.tsx` |
| Base de datos                         | —                                                                                           |
| Pruebas                               | Caso 7                                                                                      |

Hoy devuelve 405 y además pasa el id equivocado. Apuntar al `DELETE /api/cash/[id]` existente —que es transaccional y repone stock— con el id correcto, y exigir el permiso `ventas.anular`. La anulación **lógica** (sin borrar filas) llega en 1.4.

### 0.5 · Los diez casos críticos

|                                       |                                       |
| ------------------------------------- | ------------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Alto · Bajo · **M**          |
| Depende de                            | — (se escriben **antes** que 0.1–0.4) |
| Archivos                              | `vitest.config.ts`, `tests/` (nuevos) |
| Base de datos                         | Base de test                          |
| Pruebas                               | Son las pruebas                       |

Escribirlos primero, verlos fallar, y usarlos como definición de fase terminada.

### 0.6 · Eliminar `next-auth` y las dependencias sin uso

|                                       |                                   |
| ------------------------------------- | --------------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Medio · **Nulo** · **P** |
| Depende de                            | —                                 |
| Archivos                              | `package.json`                    |
| Base de datos                         | —                                 |
| Pruebas                               | `npm run build`                   |

`npm uninstall next-auth @faker-js/faker lucide-react react-icons ts-node`. Elimina la única vulnerabilidad crítica del proyecto. Ningún archivo las importa.

### 0.7 · Eliminar `test.js`

|                                       |                              |
| ------------------------------------- | ---------------------------- |
| Prioridad · Impacto · Riesgo · Tamaño | **P0** · Alto · Nulo · **P** |
| Depende de                            | —                            |
| Archivos                              | `test.js`                    |

Script suelto en la raíz que hace `deleteMany()` de productos, stock e ítems de venta sin ninguna guarda, usando el `DATABASE_URL` que encuentre. Un `node test.js` accidental contra producción vacía el catálogo.

---

# Fase 1 · Base segura y estable

**Objetivo:** que el sistema sea correcto por construcción, no por atención.

| #    | Tarea                                                                                                                                              | Prio | Impacto | Riesgo   | Tam. | Depende      | Archivos / BD                   | Pruebas                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | -------- | ---- | ------------ | ------------------------------- | --------------------------------- |
| 1.1  | **Validación con Zod en todas las rutas.** Esquemas compartidos; rechazo de negativos, `NaN` y campos de más                                       | P1   | Alto    | Bajo     | M    | 0.2          | `modules/*/schemas.ts`          | Esquemas + rutas                  |
| 1.2  | **Permisos granulares.** Tablas `Permission`, `RolePermission`, `UserPermission`; reemplazo del booleano `isAdmin`                                 | P1   | Alto    | Medio    | M    | 0.2 · **M2** | `modules/auth/`, migración      | Matriz completa                   |
| 1.3  | **Auditoría centralizada.** Un solo `audit()` dentro de transacción; snapshots recortados; sin exponer costos                                      | P1   | Alto    | Bajo     | M    | 0.2          | `server/audit.ts`, 12 rutas     | Cada mutación deja registro       |
| 1.4  | **Anulación lógica.** `Sale.estado`, `anulaVentaId`; nunca más `DELETE` sobre registros financieros                                                | P1   | Alto    | Medio    | M    | 0.4 · **M3** | `modules/sales/`, migración     | Caso 7 ampliado                   |
| 1.5  | **Manejo de errores unificado.** `AppError` + mapeo HTTP; dejar de filtrar mensajes internos                                                       | P1   | Medio   | Bajo     | P    | 0.2          | `server/errors.ts`              | Los 500 no filtran detalle        |
| 1.6  | **Límite de intentos de login** por IP y usuario, con bloqueo creciente y registro en auditoría                                                    | P1   | Alto    | Bajo     | P    | 0.2          | `api/auth/login`                | 10 fallos → bloqueo               |
| 1.7  | **Encabezados de seguridad.** CSP, `X-Frame-Options`, HSTS, `Referrer-Policy`, `X-Content-Type-Options`                                            | P1   | Medio   | Bajo     | P    | —            | `next.config.ts`                | Verificación en CI                |
| 1.8  | **Service worker sin APIs privadas.** Excluir todo `/api/` autenticado; limpiar `CacheStorage` al cerrar sesión                                    | P1   | Alto    | Bajo     | P    | —            | `next.config.ts`, logout        | Cerrar sesión borra el caché      |
| 1.9  | **Actualización controlada de dependencias.** Pasos 2 y 3 de la auditoría (`next@15.5.x`, `postcss`, `prisma`)                                     | P1   | Medio   | Medio    | P    | 0.6          | `package.json`                  | `tsc` + build + tests             |
| 1.10 | **ESLint, Prettier y CI**, incluida la verificación de que el middleware está en el build                                                          | P1   | Alto    | Bajo     | M    | 0.5          | `eslint.config.mjs`, `.github/` | La CI corre en verde              |
| 1.11 | **Revocación de sesión.** `User.sessionVersion`; cambiar rol o dar de baja invalida el token                                                       | P1   | Medio   | Bajo     | P    | 1.2 · M2     | `modules/auth/`, migración      | Baja de usuario corta la sesión   |
| 1.12 | **Eliminar código muerto:** 19 archivos, incluidos `components/cashregister/`, `components/dashboard/`, `app/store/cart.ts`, `ClientAuthCheck.tsx` | P2   | Medio   | **Nulo** | P    | —            | 19 archivos                     | El build sigue pasando            |
| 1.13 | **Consolidar el historial de Prisma** en una baseline limpia                                                                                       | P1   | Alto    | Medio    | P    | —            | `prisma/migrations/`            | `migrate deploy` sobre base nueva |

---

# Fase 2 · Nueva experiencia de caja

**Objetivo:** que un cajero sin formación técnica trabaje rápido durante horas.

| #    | Tarea                                                                                                                                 | Prio | Impacto     | Riesgo   | Tam. | Depende      | Archivos / BD                   | Pruebas                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------- | -------- | ---- | ------------ | ------------------------------- | ----------------------------------- |
| 2.1  | **Base visual:** tema en CSS con `@theme`, tipografía, colores semánticos, biblioteca de componentes                                  | P1   | Alto        | Bajo     | M    | —            | `globals.css`, `components/ui/` | Componentes                         |
| 2.2  | **Turnos de caja.** `CashSession` con apertura, saldo inicial y cierre. **Se elimina `Branch.currentCash`** y su condición de carrera | P1   | **Crítico** | **Alto** | G    | 1.4 · **M5** | `modules/cash/`, migración      | Caso 6, caso 8                      |
| 2.3  | **Pagos como entidad.** Tabla `Payment` con FK a `Sale`; se deja de parsear `"Venta #123"`                                            | P1   | Alto        | Medio    | M    | 2.2 · **M3** | `modules/sales/`, migración     | El reporte por medio de pago cuadra |
| 2.4  | **Dinero a `Decimal`** en las 5 tablas                                                                                                | P1   | Alto        | **Alto** | M    | 2.2 · **M4** | esquema completo                | Conciliación antes/después          |
| 2.5  | **Pantalla de venta rápida:** cuadrícula táctil, favoritos, categorías, ticket lateral                                                | P1   | Alto        | Medio    | G    | 2.1 · 0.3    | `app/(app)/venta/`              | Componentes + E2E                   |
| 2.6  | **Atajos de teclado y aislamiento del escáner.** Corrige el bug verificado de productos que entran al carrito con modales abiertos    | P1   | **Alto**    | Medio    | M    | 2.5          | `modules/sales/hooks/`          | E2E con escáner simulado            |
| 2.7  | **Cobro:** vuelto, pago combinado, descuentos con permiso y tope                                                                      | P1   | Alto        | Medio    | M    | 2.3 · 2.5    | `modules/sales/`                | Cálculo de vuelto y combinado       |
| 2.8  | **Ventas en espera** y persistencia del carrito                                                                                       | P2   | Alto        | Bajo     | M    | 2.5          | `store/cart.ts` con `persist`   | Un refresco no pierde la venta      |
| 2.9  | **Arqueo y cierre de turno** con diferencia, observación obligatoria y cierre inmutable                                               | P1   | Alto        | Medio    | M    | 2.2          | `app/(app)/caja/`               | Caso 8                              |
| 2.10 | **Devolución parcial** con reposición de stock y asiento de reversión                                                                 | P2   | Alto        | Medio    | M    | 1.4 · 2.2    | `modules/sales/`                | Devolución repone stock             |
| 2.11 | **Navegación por permisos** + barra responsive con menú colapsable                                                                    | P1   | Alto        | Bajo     | M    | 1.2 · 2.1    | `components/Navbar`             | Cada rol ve lo suyo                 |
| 2.12 | **Inicio accionable** con alertas que llevan al problema                                                                              | P2   | Alto        | Bajo     | M    | 2.1 · 2.2    | `app/(app)/inicio/`             | Componentes                         |
| 2.13 | **Reemplazar `alert`/`confirm`** por los componentes propios                                                                          | P2   | Medio       | Nulo     | P    | 2.1          | 5 archivos                      | —                                   |
| 2.14 | **Accesibilidad:** objetivos de 44 px, contraste, foco visible, modales con `role="dialog"`                                           | P2   | Medio       | Bajo     | M    | 2.1          | `components/`                   | Auditoría automática                |

---

# Fase 3 · Gestión de almacén

**Objetivo:** dejar de ser un punto de venta y ser un sistema de gestión.

| #    | Tarea                                                                                                  | Prio | Impacto     | Riesgo   | Tam. | Depende      | Archivos / BD                   | Pruebas                             |
| ---- | ------------------------------------------------------------------------------------------------------ | ---- | ----------- | -------- | ---- | ------------ | ------------------------------- | ----------------------------------- |
| 3.1  | **Libro de movimientos de stock.** `StockMovement` inmutable; `BranchStock` pasa a total denormalizado | P1   | **Crítico** | **Alto** | G    | 2.2 · **M6** | `modules/inventory/`, migración | El stock es la suma de sus asientos |
| 3.2  | **Producto sin `branchId`** + `ProductBarcode`. **Habilita la multisucursal real**                     | P1   | **Crítico** | **Alto** | G    | 3.1 · **M7** | esquema, `modules/products/`    | Dos sucursales, mismo producto      |
| 3.3  | **Campos de almacén:** costo, margen, unidades, bultos, mínimo, ideal, activo, marca, proveedor        | P1   | Alto        | Bajo     | M    | 3.2 · **M8** | esquema, `modules/products/`    | Cálculo de margen                   |
| 3.4  | **Pantalla de stock** con ajustes de motivo obligatorio                                                | P1   | Alto        | Bajo     | M    | 3.1          | `app/(app)/stock/`              | Ajuste sin motivo → 400             |
| 3.5  | **Proveedores:** alta, edición, listado                                                                | P1   | Medio       | Bajo     | P    | 0.2          | `modules/suppliers/`            | CRUD + permisos                     |
| 3.6  | **Órdenes de compra**                                                                                  | P1   | Alto        | Medio    | G    | 3.3 · **M9** | `modules/purchases/`, migración | Ciclo completo                      |
| 3.7  | **Recepción de mercadería** con actualización de costo y aviso de impacto en el margen                 | P1   | **Alto**    | Medio    | G    | 3.6 · 3.1    | `modules/purchases/`            | Parcial y total                     |
| 3.8  | **Alertas de stock mínimo** y sugerencia de reposición                                                 | P2   | Alto        | Bajo     | M    | 3.3 · 3.4    | `modules/inventory/`            | Umbral por producto                 |
| 3.9  | **Lotes y vencimientos**                                                                               | P2   | Medio       | Medio    | G    | 3.1          | esquema, `modules/inventory/`   | Alerta de vencimiento               |
| 3.10 | **Conteos de inventario** con diferencias                                                              | P2   | Medio       | Medio    | M    | 3.1          | `modules/inventory/`            | Diferencia genera asiento           |
| 3.11 | **Transferencias entre sucursales**                                                                    | P3   | Medio       | Medio    | M    | 3.2 · 3.1    | `modules/inventory/`            | Salida y entrada cuadran            |
| 3.12 | **Historial de precios y costos**                                                                      | P2   | Medio       | Bajo     | P    | 3.3 · M9     | `modules/products/`             | Cada cambio queda                   |

---

# Fase 4 · Gestión avanzada

| #    | Tarea                                                                                   | Prio | Impacto | Riesgo | Tam. | Depende       |
| ---- | --------------------------------------------------------------------------------------- | ---- | ------- | ------ | ---- | ------------- |
| 4.1  | **Clientes mínimos** (nombre, teléfono, saldo) y venta fiada                            | P2   | Alto    | Medio  | M    | 2.3 · **M10** |
| 4.2  | **Cuenta corriente completa:** límite, vencimientos, pagos parciales, bloqueo por deuda | P3   | Medio   | Medio  | G    | 4.1           |
| 4.3  | **Reportes del MVP** (§7 de la propuesta de arquitectura)                               | P2   | Alto    | Bajo   | G    | 2.3 · 3.3     |
| 4.4  | **Reportes de 2.ª etapa**, incluido ventas por hora y margen por producto               | P3   | Medio   | Bajo   | M    | 4.3           |
| 4.5  | **Pantalla de usuarios y permisos**                                                     | P1   | Alto    | Bajo   | M    | 1.2           |
| 4.6  | **Pantalla de sucursales**                                                              | P2   | Medio   | Bajo   | P    | 3.2           |
| 4.7  | **Promociones y combos**                                                                | P3   | Medio   | Medio  | G    | 2.7           |
| 4.8  | **Precio mayorista por cantidad**                                                       | P3   | Medio   | Bajo   | M    | 3.3           |
| 4.9  | **Comprobante impreso o PDF** y reimpresión                                             | P2   | Alto    | Medio  | M    | 2.7           |
| 4.10 | **Configuración del sistema** (umbrales, topes de descuento, datos del negocio)         | P2   | Medio   | Bajo   | M    | 1.2           |
| 4.11 | **Cambio y recuperación de contraseña**                                                 | P1   | Alto    | Bajo   | P    | 1.2           |

---

# Fase 5 · Operación y despliegue

| #   | Tarea                                                                                                              | Prio   | Impacto     | Riesgo   | Tam. |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ | ----------- | -------- | ---- |
| 5.1 | **Backups automáticos verificados.** No basta con generar el dump: hay que probar la restauración periódicamente   | **P0** | **Crítico** | Bajo     | M    |
| 5.2 | **Despliegue reproducible:** build, migración y arranque en un solo paso, con reversión                            | P1     | Alto        | Medio    | M    |
| 5.3 | **Resurrección de PM2 verificada.** El dump actual no incluye el proceso `kiosco`: no vuelve solo tras un reinicio | P1     | Alto        | Bajo     | P    |
| 5.4 | **Registro estructurado** con rotación, sin datos sensibles                                                        | P1     | Medio       | Bajo     | M    |
| 5.5 | **Monitoreo de disponibilidad** con alerta. El sitio estuvo caído casi seis meses sin que nadie se enterara        | **P1** | **Alto**    | Bajo     | P    |
| 5.6 | **Métricas de negocio y de errores**                                                                               | P2     | Medio       | Bajo     | M    |
| 5.7 | **Modo offline real** para vender con internet caído                                                               | P3     | Alto        | **Alto** | G    |
| 5.8 | **Manual de operación** para el personal del local                                                                 | P2     | Alto        | Nulo     | M    |
| 5.9 | **Migrar `next-pwa` a `@serwist/next`** — resuelve ~12 vulnerabilidades altas de la cadena de build                | P2     | Medio       | Medio    | M    |

---

# Resumen

| Fase                    | Tareas | P0    | Grandes | Migraciones de alto riesgo |
| ----------------------- | ------ | ----- | ------- | -------------------------- |
| 0 · Bloqueos críticos   | 8      | 8     | 1       | —                          |
| 1 · Base segura         | 13     | —     | —       | M2, M3                     |
| 2 · Experiencia de caja | 14     | —     | 2       | **M4, M5**                 |
| 3 · Gestión de almacén  | 12     | —     | 4       | **M6, M7**                 |
| 4 · Gestión avanzada    | 11     | —     | 3       | M9, M10                    |
| 5 · Operación           | 9      | 1     | 1       | —                          |
| **Total**               | **67** | **9** | **11**  | **4**                      |

## Las cuatro decisiones que hay que tomar antes de empezar

1. **¿Se vuelve a poner el sitio en línea antes de terminar la Fase 0?** La recomendación es que no. Hoy está protegido solo porque PM2 está detenido.
2. **¿Cuántas sucursales, realmente?** Si es una sola, la tarea 3.2 (la más riesgosa del plan) puede posponerse indefinidamente.
3. **¿Se vende algo por peso?** Si hay fiambrería o verdulería, `SaleItem.quantity` debe dejar de ser entero, y eso cambia el esquema desde la Fase 2.
4. **¿Hace falta facturación fiscal (AFIP)?** No está en este plan. Si se necesita, cambia el modelo de comprobantes y conviene contemplarlo antes de la tarea 4.9.
