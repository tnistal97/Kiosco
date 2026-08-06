# Fase 0 · Decisiones y límites arquitectónicos

Registro de las decisiones que condicionan el diseño de la Fase 0 y de lo que
deliberadamente se dejó preparado sin implementar. Sirve para que quien retome
el proyecto entienda por qué algo está a medio camino a propósito.

---

## 1 · Una sucursal hoy, varias mañana

**Decisión:** el almacén opera con una sola sucursal, pero la arquitectura se
mantiene preparada para varias.

`branchId` se conserva en todos los modelos y **todos los controles de
aislamiento por sucursal quedan activos**, aunque hoy nunca se disparen. Están
cubiertos por `tests/authorization/branch-isolation.test.ts`, que crea dos
sucursales precisamente para ejercitarlos.

Regla que rige todo el código nuevo:

> El `branchId` sale **siempre** de la sesión verificada contra la base. Nunca
> del cuerpo de la petición, nunca de un parámetro de query, nunca del token
> sin contrastar.

Se leyó de la base y no del JWT a propósito: un token emitido antes de que un
empleado fuera trasladado de sucursal no debe dar acceso a la anterior.

**No se hizo** la migración que quita `branchId` de `Product` (M7 en
[ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md)). Es la más riesgosa del
plan y con una sola sucursal no aporta nada. Mientras `Product.branchId` sea
obligatorio y `Product.barcode` sea único global, dos sucursales **no pueden**
tener el mismo producto: esa migración es la condición previa a abrir la
segunda.

---

## 2 · Venta por peso

**Decisión:** preparar el terreno, no implementar la balanza.

El sistema deberá vender por kilogramos, gramos, litros y unidades
fraccionadas. Eso exige cantidades decimales, y hoy `SaleItem.quantity` y
`BranchStock.quantity` son `Int`.

### Qué se hizo en la Fase 0

La validación de cantidades está **centralizada en un solo lugar**:

```ts
// src/server/http/validate.ts
export const quantitySchema = z.number().int().positive().max(100_000).finite()
```

Todas las rutas que aceptan una cantidad usan ese esquema. No hay ni un
`Number(body.quantity)` suelto en el código. Cuando llegue el peso, el cambio
de tipo ocurre en ese archivo y se propaga solo.

### Qué falta, y en qué orden

| Paso | Cambio | Riesgo |
|---|---|---|
| 1 | `Product.unit` (`unidad` \| `kg` \| `g` \| `l` \| `ml`) y `Product.sellsByWeight` | Bajo, aditivo |
| 2 | `SaleItem.quantity` y `BranchStock.quantity` de `Int` a `Decimal(12,3)` | **Alto** — cambia el tipo de columnas con datos |
| 3 | `quantitySchema` pasa a decimal con precisión según la unidad del producto | Bajo |
| 4 | La comparación de stock (`quantity >= n`) sigue siendo válida en `Decimal` | Ninguno |
| 5 | Lectura de balanza (protocolo del equipo, códigos EAN-13 con peso embebido) | Aparte |

El paso 2 conviene hacerlo **junto con la migración de dinero a `Decimal`**
(M4): son la misma clase de cambio sobre las mismas tablas, y hacer dos
migraciones de tipo por separado duplica la ventana de riesgo.

> **Precaución:** `Decimal` de Prisma no es `number` en JavaScript. Al cambiar
> el tipo, toda aritmética (`price * quantity`) debe pasar a `Decimal.mul()`.
> Sumar un `Decimal` con `+` produce concatenación de cadenas silenciosa. La
> suite de tests de venta es la red de contención de ese cambio.

---

## 3 · Facturación (ARCA) — límite arquitectónico

**Decisión:** fuera de la Fase 0 y fuera del MVP inmediato. Pero el diseño
actual **no debe volverla imposible**.

### El límite

La venta y el comprobante fiscal son **dos hechos distintos**. Una venta
existe y es válida aunque nunca se facture; un comprobante fiscal puede
fracasar, reintentarse o emitirse en diferido sin que eso altere la venta.

Concretamente, esto significa que **nada del código de ventas puede llamar a
ARCA**. `src/server/services/sales.ts` no conoce ni conocerá la existencia de
un proveedor de facturación.

### La forma que tendrá cuando se implemente

```
┌──────────────┐      ┌───────────────────┐      ┌──────────────────┐
│ salesService │─────▶│  FiscalDocument   │◀────▶│ Adaptador ARCA   │
│  (no cambia) │ crea │  (tabla propia)   │      │ (o el que sea)   │
└──────────────┘      └───────────────────┘      └──────────────────┘
                       estado: pendiente
                              emitido
                              rechazado
                              anulado
```

Un modelo nuevo, `FiscalDocument`, con `saleId`, tipo de comprobante, punto de
venta, número, CAE, vencimiento del CAE y estado. La emisión ocurre **después**
de que la venta está confirmada, en un proceso aparte que puede reintentar.

Reglas que hay que respetar desde ya:

1. **La venta no espera a la facturación.** Si ARCA no responde, la venta se
   registra igual y el comprobante queda pendiente. Un almacén no puede dejar
   de cobrar porque un servicio externo está caído.
2. **El adaptador es reemplazable.** ARCA hoy, otro proveedor o un servicio
   intermedio mañana. La interfaz que ve el sistema es `emitir(venta)` →
   `{ numero, cae, vencimiento }`, nada específico de ARCA.
3. **Una venta anulada no borra su comprobante.** Genera una nota de crédito.
   Por eso la anulación de la Fase 0 es lógica y conserva todo: si hubiera
   borrado la venta, no habría contra qué emitir la nota.
4. **Los certificados no van al repositorio.** `.gitignore` ya excluye `*.pem`,
   `*.key`, `*.crt`, `*.pfx` y `*.p12`.

La anulación lógica de la Fase 0 fue diseñada con esto en mente: es la pieza
que hace posible la facturación posterior sin rehacer nada.

---

## 4 · Stock: cómo evoluciona hacia `StockMovement`

**Estado actual:** `BranchStock.quantity` es un número que se sobrescribe. No
hay forma de reconstruir cómo llegó a ese valor.

### Qué se hizo en la Fase 0

No se creó el libro de movimientos, pero **todo ajuste ya pasa por un único
camino** y deja rastro:

| Operación | Ruta | Permiso | Motivo | Auditoría |
|---|---|---|---|---|
| Venta | `POST /api/sales` | `sales.create` | implícito | sí |
| Anulación | `POST /api/sales/:id/cancel` | `sales.cancel` | **obligatorio** | sí |
| Recuento | `PUT /api/stock/:productId` | `stock.adjust` | **obligatorio** | sí |
| Ajuste ± | `PATCH /api/stock/:productId` | `stock.adjust` | **obligatorio** | sí |
| Alta | `POST /api/products` | `products.create` | implícito | sí |
| Ficha | `PUT /api/products/:id` | `stock.adjust` | implícito | sí |

Cada entrada de auditoría guarda cantidad anterior, posterior, diferencia,
motivo, usuario y sucursal. **Esa información es exactamente la que necesita
`StockMovement`**, ya se está capturando; hoy vive en `AuditLog` en vez de en
una tabla propia.

Ningún otro código toca `BranchStock`. Se puede verificar:

```bash
grep -rn "branchStock" src/ --include=*.ts
```

### La migración

```prisma
model StockMovement {
  id         Int      @id @default(autoincrement())
  branchId   Int
  productId  Int
  /// venta | anulacion | ajuste | recuento | compra | rotura | transferencia
  type       String
  /// Negativo para salidas. La suma de deltas = quantity actual.
  delta      Int
  balance    Int      // stock resultante, para no recalcular la serie entera
  reason     String?
  userId     Int
  saleId     Int?
  date       DateTime @default(now())

  @@index([branchId, productId, date])
}
```

Pasos, en orden:

1. Crear la tabla (aditivo, sin riesgo).
2. Escribir en ella **además** de actualizar `BranchStock.quantity`. Doble
   escritura dentro de la misma transacción. `BranchStock` sigue siendo la
   fuente de verdad y el candado de concurrencia.
3. Rellenar el histórico a partir de `AuditLog` (los datos están) y de
   `SaleItem`. Lo anterior a la Fase 0 será incompleto: hasta ahora los ajustes
   no registraban motivo.
4. Cuando el libro esté completo y verificado, `BranchStock.quantity` pasa a
   ser una **caché** del saldo, con una comprobación periódica de que coincide
   con la suma de deltas.

**No conviene** eliminar `BranchStock.quantity` ni reemplazar el descuento por
una suma de movimientos. El `UPDATE ... WHERE quantity >= n` sobre una sola
fila es lo que hace imposible la sobreventa bajo concurrencia; calcular el
saldo sumando una tabla de movimientos reintroduce exactamente la condición de
carrera que la Fase 0 cerró.

---

## 5 · Permisos: del código a la base

Los permisos son explícitos (`sales.create`, `stock.adjust`, …) y las rutas
preguntan por permiso, nunca por nombre de rol. Pero la tabla que asocia rol →
permisos vive hoy en `src/server/authz/permissions.ts`, no en la base.

Es deliberado para la Fase 0: cambiar el modelo de permisos y activar la
autorización a la vez habría hecho imposible saber cuál de las dos cosas rompió
algo.

La migración posterior no toca ninguna ruta:

```prisma
model Permission     { id Int @id, code String @unique, description String }
model RolePermission { roleId Int, permissionId Int, @@id([roleId, permissionId]) }
```

`permissionsForRole()` pasa a consultar la base con caché, y `requirePermission`
sigue recibiendo el mismo string. Las 22 rutas quedan igual.

**Advertencia:** un rol que no figure en el catálogo recibe **cero** permisos.
Es intencional —es preferible que un rol nuevo no pueda hacer nada a que herede
todo por descuido— pero significa que dar de alta un rol requiere agregarlo al
catálogo. Los roles reconocidos hoy son `admin`, `encargado`, `cajero`,
`vendedor` (alias histórico de cajero) y `repositor`.

---

## 6 · Lo que sigue pendiente y por qué

| Pendiente | Por qué no está en la Fase 0 |
|---|---|
| Dinero en `Decimal` | Cambia el tipo de columnas con datos productivos. Conviene junto con el paso 2 de la venta por peso. |
| Turno de caja (`CashSession`) | `currentCash` es un total corrido desde que se instaló el sistema. Sin turnos, el arqueo no puede compararse con nada real. Es el cambio que vuelve confiable el control de caja. |
| ESLint, Prettier, CI | Estaban clasificados P1. Ver [QUALITY_STRATEGY.md](QUALITY_STRATEGY.md). |
| `Product.isActive` | Hoy un producto que figura en ventas no se puede dar de baja: el borrado se rechaza para no destruir el historial. |
| Límite de intentos compartido | El contador vive en la memoria del proceso. Alcanza para un único proceso PM2, que es el despliegue actual. Con varias instancias hay que moverlo a la base o a Redis. |
| Paginación del catálogo | `/api/products` sigue devolviendo el catálogo completo. Es un problema de rendimiento, no de seguridad. |
