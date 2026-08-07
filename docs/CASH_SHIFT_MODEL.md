# Turnos de caja

## El problema que resuelve

Hasta la Fase 2, `Branch.currentCash` era **el efectivo acumulado desde que se
instaló el sistema**. La pantalla de caja lo mostraba grande arriba de todo, y
el arqueo comparaba contra él.

Eso no es un saldo de caja. Es un total histórico. Un cajero que abre a las 8
con $10.000 en el cajón y a las 20 cuenta $47.500 no tiene forma de saber si
cuadra, porque el sistema le muestra $2.340.000 —lo que pasó por esa caja en
dos años—. La Fase 2 puso una advertencia arriba de la pantalla en vez de
esconderlo, pero la advertencia no arregla el número.

Un turno responde la pregunta que de verdad se hace en el mostrador:

> **Empecé con esto, pasó esto, tengo que tener esto. ¿Lo tengo?**

## El modelo

```
CashShift
  id
  branchId          sucursal
  openedById        quién abrió
  closedById        quién cerró (null mientras está abierto)
  openedAt
  closedAt
  openingAmount     lo que había en el cajón al abrir
  expectedAmount    lo que el sistema esperaba al cerrar   (null hasta cerrar)
  countedAmount     lo que se contó al cerrar              (null hasta cerrar)
  difference        contado − esperado                     (null hasta cerrar)
  status            'open' | 'closed' | 'legacy'
  openingNotes
  closingNotes
  authorizedById    quién autorizó una diferencia grande   (null si no hizo falta)
```

Y el vínculo desde lo que ya existía:

```
CashRegisterMovement.shiftId   → CashShift    (null en los movimientos legacy)
CashCount.shiftId              → CashShift    (null en los arqueos legacy)
```

### Por qué `expectedAmount` se guarda pero no se usa mientras el turno está abierto

Durante el turno, el saldo esperado **se deriva**:

```
esperado = openingAmount + Σ (movimientos en efectivo de este turno)
```

No se guarda en ninguna columna. Guardarlo obligaría a mantenerlo sincronizado
en cada venta, cada retiro y cada anulación, y el día que un camino se olvide
de actualizarlo el número deja de significar nada —que es exactamente lo que
pasaba con `currentCash`—.

Al **cerrar**, ese valor derivado se congela en `expectedAmount`. Ahí sí es una
columna, y es correcta: es un registro de qué esperaba el sistema en el momento
del cierre. Un turno cerrado no vuelve a cambiar, así que no puede
desincronizarse.

### `Branch.currentCash` no se borra

Sigue existiendo y sigue actualizándose. Es el acumulado histórico y hay dos
años de datos apoyados en él.

Lo que cambia es que **ya no decide nada**. El arqueo compara contra el turno,
la cabecera muestra el turno, el cierre calcula sobre el turno. `currentCash`
queda como un dato de sucursal, marcado como tal en el esquema.

## Reglas

### Apertura

- Se abre con un **monto inicial** que el cajero cuenta en el cajón.
- Queda registrado quién, cuándo y en qué sucursal.
- **Una sola caja abierta por sucursal.** No es una comprobación en el
  servicio: es un índice único parcial en PostgreSQL.

  ```sql
  CREATE UNIQUE INDEX "CashShift_one_open_per_branch"
    ON "CashShift"("branchId") WHERE status = 'open';
  ```

  Dos peticiones simultáneas de apertura no pueden ganar las dos. Una recibe
  violación de unicidad y el servicio la traduce a un 409 legible.

- **Un solo turno abierto por usuario**, con el mismo mecanismo. Hoy es
  redundante —un usuario pertenece a una sucursal— pero deja de serlo el día
  que exista más de una caja por local, y es una línea de SQL.

- El monto inicial **no se puede editar después**. Si estaba mal, se cierra el
  turno con la diferencia y se abre otro. Un saldo inicial editable convierte
  cualquier faltante en un problema de tipeo.

### Durante el turno

El saldo esperado se deriva de:

```
  saldo inicial
+ efectivo recibido por ventas
+ ingresos manuales
− egresos y retiros
− devoluciones en efectivo (anulaciones)
```

Sólo cuenta el **efectivo**. Una venta con transferencia no entra al cajón, así
que no mueve el esperado. Ver [PHASE3_ARCHITECTURE.md](PHASE3_ARCHITECTURE.md).

### Cierre

1. Muestra el saldo esperado.
2. Pide el monto contado.
3. Calcula la diferencia mientras se escribe.
4. Pide confirmación explícita.
5. Registra fecha, responsable y notas.
6. **El turno queda inmutable.** No se reabre, no se edita, no se borra.
7. Queda auditado con esperado, contado y diferencia.

Cerrar un turno ajeno exige `cash.shift.close.other`. Un cajero cierra el suyo;
un encargado puede cerrar el de otro cuando alguien se fue sin cerrar.

### Umbral de diferencia

`Branch.cashDifferenceThreshold` (por omisión `0.00`, o sea sin umbral): si la
diferencia en valor absoluto lo supera, el cierre exige que un usuario con
`cash.shift.authorize` lo autorice, y queda registrado quién.

**No se construyó un sistema de reglas.** Es un número por sucursal y una
comprobación. Cuando haga falta algo más —umbrales por rol, por horario, por
monto de ventas— se diseña entonces, con casos reales.

## Política: ¿hace falta un turno abierto para vender?

`Branch.requireOpenShift`, por omisión **verdadero**.

Con la política activa, `POST /api/sales` rechaza la venta si no hay turno
abierto, con un mensaje que dice qué hacer: _"No hay una caja abierta. Abrí la
caja antes de vender."_

Se puede apagar por sucursal. Es la única forma honesta de dar una salida a un
local que todavía no adoptó el flujo, sin que el sistema le mienta diciendo que
la caja "cuadra".

## Datos históricos: el turno `LEGACY`

La migración **no inventa turnos**. No hay forma de saber en qué turno ocurrió
una venta de marzo, y fabricar uno sería peor que no tenerlo.

Lo que hace es crear **un turno por sucursal** con:

```
status        'legacy'
openedAt      la fecha del movimiento de caja más viejo de esa sucursal
closedAt      la fecha de la migración
openingAmount 0.00
```

y engancharle todos los movimientos y arqueos anteriores. Ese turno dice, sin
disimulo, "acá está todo lo que pasó antes de que existieran los turnos". No
tiene diferencia calculada, porque no la hubo: no se contó nada al abrirlo.

Un turno `legacy` **no se puede cerrar ni reabrir**, y no cuenta como turno
abierto: al día siguiente de migrar, la sucursal necesita abrir una caja de
verdad para vender.

## Permisos

| Permiso                  | Quién lo tiene                              | Para qué                                 |
| ------------------------ | ------------------------------------------- | ---------------------------------------- |
| `cash.shift.open`        | dueño, admin, encargado, supervisor, cajero | Abrir la caja                            |
| `cash.shift.close`       | dueño, admin, encargado, supervisor, cajero | Cerrar **el propio** turno               |
| `cash.shift.close.other` | dueño, admin, encargado                     | Cerrar el turno de otro                  |
| `cash.shift.authorize`   | dueño, admin, encargado                     | Autorizar una diferencia sobre el umbral |
| `cash.view`              | + auditor                                   | Ver el turno y su historial              |

Un cajero abre y cierra su caja. No cierra la de otro y no autoriza su propio
faltante: son los dos controles que hacen que el turno sirva para algo.

## Lo que NO hace esta fase

- **No hay arqueo intermedio con cierre parcial.** El arqueo sigue existiendo y
  ahora se asocia al turno, pero no cierra nada.
- **No hay traspaso de turno** (cerrar uno y abrir el siguiente con el contado
  del anterior en un solo paso). Se abre con el monto que se cuenta.
- **No hay varias cajas por sucursal.** El índice único por sucursal es
  deliberado y se puede relajar cuando exista el concepto de "caja".
- **No hay cierre automático por horario.** Un turno que quedó abierto queda
  abierto y se ve en el historial.
